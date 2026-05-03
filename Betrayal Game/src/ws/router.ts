import { WebSocket } from 'ws';
import * as game from '../game/manager.js';
import type { C2SEvent, S2CEvent, ChatMessage, GameState, Role } from '../game/types.js';
import {
  broadcastToSession,
  broadcastToSessionPerRecipient,
  sendError,
  generateSessionToken,
  broadcastRecruitmentEvents,
  broadcastMorningEventWithRecruitment,
  scrubPlayersForRecipient,
  runSheriffInvestigation
} from './utils.js';
import { startVoteRevealSequence } from './voteReveal.js';

const activeChallengeTimers = new Map<string, NodeJS.Timeout>();

function clearChallengeTimer(sessionId: string): void {
  const t = activeChallengeTimers.get(sessionId);
  if (t) {
    clearTimeout(t);
    activeChallengeTimers.delete(sessionId);
  }
}

/**
 * Clean up all in-memory timers/intervals associated with a session.
 * Call this when a game session is destroyed (e.g. all players gone, manual cleanup).
 */
export function cleanupSessionTimers(sessionId: string): void {
  clearChallengeTimer(sessionId);
}

function countEligibleAnswerers(state: GameState): number {
  return state.players.filter(
    (p) => p.isAlive && p.lastChallengeWinRound !== state.currentRound - 1
  ).length;
}

function broadcastChallengeResult(
  sessionId: string,
  resolution: { winnerId?: string; winnerName?: string; correctAnswer?: string | number; shieldAwarded: boolean },
  games: Map<string, GameState>,
  playerConnections: Map<string, WebSocket>
): void {
  const gameState = games.get(sessionId);
  if (!gameState) return;

  // Per-recipient delivery: only the winner is told whether a shield
  // was awarded (or whether they already had one). Everyone else just
  // sees who won, with no shield-related information leaked.
  gameState.players.forEach((player) => {
    const connection = playerConnections.get(player.id);
    if (!connection || connection.readyState !== WebSocket.OPEN) return;

    const isWinner =
      resolution.winnerId !== undefined && player.id === resolution.winnerId;

    const payload: {
      phase: 'CHALLENGE_RESULT';
      winnerId?: string;
      winnerName?: string;
      correctAnswer?: string | number;
      shieldAwarded?: boolean;
    } = { phase: 'CHALLENGE_RESULT' };

    if (resolution.winnerId !== undefined) payload.winnerId = resolution.winnerId;
    if (resolution.winnerName !== undefined) payload.winnerName = resolution.winnerName;
    if (resolution.correctAnswer !== undefined) payload.correctAnswer = resolution.correctAnswer;
    if (isWinner) payload.shieldAwarded = resolution.shieldAwarded;

    connection.send(JSON.stringify({ type: 'S2C_CHALLENGE_RESULT', payload }));
  });
}

export interface WsContext {
  games: Map<string, GameState>;
  playerConnections: Map<string, WebSocket>;
  sessionTokens: Map<string, { playerId: string; sessionId: string }>;
  disconnectedPlayers: Map<string, { playerId: string; sessionId: string; disconnectedAt: number }>;
  setGame: (state: GameState) => void;
  removeGame: (sessionId: string) => void;
  setToken: (token: string, data: { playerId: string; sessionId: string }) => void;
  removeToken: (token: string) => void;

  upsertPlayerProfile: (deviceToken: string, playerName: string) => { isReturning: boolean };
  writeGameRecordIfNeeded: (state: GameState) => void;
  getPlayerStatsBundle: (deviceToken: string) => import('../game/types.js').PlayerStatsPayload;
  getLeaderboardEntries: (
    metric: 'winRate' | 'gamesPlayed' | 'traitorWins'
  ) => import('../game/types.js').LeaderboardEntryPayload[];
  getGlobalStats: () => import('../game/types.js').GlobalStatsPayload;
}

const PLAYER_NAME_REGEX = /^[A-Za-z0-9 ]{2,20}$/;
const DEVICE_TOKEN_REGEX = /^[a-zA-Z0-9-]{8,128}$/;

type ReconnectPayload = Extract<S2CEvent, { type: 'S2C_RECONNECTED' }>['payload'];

export function handleConnection(ws: WebSocket, ctx: WsContext): void {
  const {
    games, playerConnections, sessionTokens, disconnectedPlayers,
    setGame, removeGame, setToken, removeToken,
    upsertPlayerProfile, writeGameRecordIfNeeded,
    getPlayerStatsBundle, getLeaderboardEntries, getGlobalStats,
  } = ctx;
  let currentPlayerId: string | undefined;
  let currentSessionId: string | undefined;

  let currentDeviceToken: string | undefined;

  function broadcast(sessionId: string, event: S2CEvent): void {
    broadcastToSession(sessionId, event, games, playerConnections);
  }

  function broadcastPerRecipient(sessionId: string, buildEvent: (recipientId: string) => S2CEvent): void {
    broadcastToSessionPerRecipient(sessionId, buildEvent, games, playerConnections);
  }

  ws.on('message', (data: string) => {
    try {
      const event: C2SEvent = JSON.parse(data);


      if (event.type === 'C2S_IDENTIFY') {
        const { deviceToken, playerName } = event.payload;
        if (typeof deviceToken !== 'string' || !DEVICE_TOKEN_REGEX.test(deviceToken)) {
          ws.send(JSON.stringify({
            type: 'S2C_IDENTITY_ERROR',
            payload: { message: 'Invalid device token' }
          } satisfies S2CEvent));
          return;
        }
        const trimmedName = (playerName ?? '').trim();
        if (!PLAYER_NAME_REGEX.test(trimmedName)) {
          ws.send(JSON.stringify({
            type: 'S2C_IDENTITY_ERROR',
            payload: { message: 'Player name must be 2–20 letters, numbers, or spaces.' }
          } satisfies S2CEvent));
          return;
        }
        const { isReturning } = upsertPlayerProfile(deviceToken, trimmedName);
        currentDeviceToken = deviceToken;
        ws.send(JSON.stringify({
          type: 'S2C_IDENTITY_CONFIRMED',
          payload: { deviceToken, playerName: trimmedName, isReturningPlayer: isReturning }
        } satisfies S2CEvent));
        return;
      }

      // Stats / leaderboard queries.
      // SECURITY: a player can only query stats for THEIR OWN device token —
      // the one bound to this socket via C2S_IDENTIFY. Earlier this handler
      // accepted an arbitrary token from the payload, which let any client
      // enumerate any other player's stats just by guessing tokens.
      if (event.type === 'C2S_GET_PLAYER_STATS') {
        if (!currentDeviceToken) {
          sendError(ws, 'Identify first via C2S_IDENTIFY before requesting stats');
          return;
        }
        const bundle = getPlayerStatsBundle(currentDeviceToken);
        ws.send(JSON.stringify({
          type: 'S2C_PLAYER_STATS',
          payload: bundle
        } satisfies S2CEvent));
        return;
      }

      if (event.type === 'C2S_GET_LEADERBOARD') {
        const metric = event.payload.metric;
        if (metric !== 'winRate' && metric !== 'gamesPlayed' && metric !== 'traitorWins') {
          sendError(ws, 'Invalid leaderboard metric');
          return;
        }
        const entries = getLeaderboardEntries(metric);
        ws.send(JSON.stringify({
          type: 'S2C_LEADERBOARD',
          payload: { metric, entries }
        } satisfies S2CEvent));
        return;
      }

      if (event.type === 'C2S_GET_GLOBAL_STATS') {
        ws.send(JSON.stringify({
          type: 'S2C_GLOBAL_STATS',
          payload: getGlobalStats()
        } satisfies S2CEvent));
        return;
      }

      if (event.type === 'C2S_CREATE_GAME') {
        const gameState = game.createGame(event.payload.playerName, currentDeviceToken);
        setGame(gameState);

        currentPlayerId = gameState.hostId;
        currentSessionId = gameState.sessionId;
        playerConnections.set(currentPlayerId, ws);

        const sessionToken = generateSessionToken();
        setToken(sessionToken, { playerId: currentPlayerId, sessionId: currentSessionId });

        const response: S2CEvent = {
          type: 'S2C_GAME_CREATED',
          payload: {
            sessionId: gameState.sessionId,
            playerId: currentPlayerId,
            playerName: event.payload.playerName,
            sessionToken,
            settings: gameState.settings
          }
        };
        ws.send(JSON.stringify(response));
        broadcastPerRecipient(gameState.sessionId, (recipientId) => ({
          type: 'S2C_PLAYER_JOINED',
          payload: { players: scrubPlayersForRecipient(gameState.players, recipientId) }
        }));
        return;
      }

      if (event.type === 'C2S_JOIN_GAME') {
        const gameState = games.get(event.payload.sessionId);
        if (!gameState) {
          sendError(ws, 'Game not found');
          return;
        }

        const { game: updatedGame, playerId } = game.addPlayer(gameState, event.payload.playerName, currentDeviceToken);
        setGame(updatedGame);

        currentPlayerId = playerId;
        currentSessionId = event.payload.sessionId;
        playerConnections.set(playerId, ws);

        const sessionToken = generateSessionToken();
        setToken(sessionToken, { playerId, sessionId: event.payload.sessionId });

        const joinResponse: S2CEvent = {
          type: 'S2C_GAME_JOINED',
          payload: {
            sessionId: event.payload.sessionId,
            playerId: playerId,
            playerName: event.payload.playerName,
            players: scrubPlayersForRecipient(updatedGame.players, playerId),
            sessionToken,
            settings: updatedGame.settings
          }
        };
        ws.send(JSON.stringify(joinResponse));

        broadcastPerRecipient(event.payload.sessionId, (recipientId) => ({
          type: 'S2C_PLAYER_JOINED',
          payload: { players: scrubPlayersForRecipient(updatedGame.players, recipientId) }
        }));
        return;
      }

      if (event.type === 'C2S_RECONNECT') {
        const tokenData = sessionTokens.get(event.payload.sessionToken);
        if (!tokenData) {
          sendError(ws, 'Invalid or expired session token');
          return;
        }

        const gameState = games.get(tokenData.sessionId);
        if (!gameState) {
          sendError(ws, 'Game no longer exists');
          removeToken(event.payload.sessionToken);
          return;
        }

        const player = gameState.players.find((p) => p.id === tokenData.playerId);
        if (!player) {
          sendError(ws, 'Player not found in game');
          removeToken(event.payload.sessionToken);
          return;
        }

        disconnectedPlayers.delete(event.payload.sessionToken);

        currentPlayerId = tokenData.playerId;
        currentSessionId = tokenData.sessionId;
        playerConnections.set(currentPlayerId, ws);

        const updatedGame = {
          ...gameState,
          players: gameState.players.map((p) =>
            p.id === currentPlayerId ? { ...p, isConnected: true } : p
          )
        };
        setGame(updatedGame);

        const traitorIds = player.role === 'TRAITOR' ? game.getTraitorIds(updatedGame) : undefined;

        const banishedPlayer = updatedGame.banishedPlayerId
          ? updatedGame.players.find((p) => p.id === updatedGame.banishedPlayerId)
          : undefined;

        const murderedPlayer = updatedGame.lastMurderedPlayerId
          ? updatedGame.players.find((p) => p.id === updatedGame.lastMurderedPlayerId)
          : undefined;

        const tiedPlayerNames = updatedGame.tiedPlayerIds?.map((id) => {
          const p = updatedGame.players.find((pl) => pl.id === id);
          return p?.name ?? 'Unknown';
        });

        const aliveCount = updatedGame.players.filter((p) => p.isAlive).length;
        const voteCount = updatedGame.phase === 'VOTING' || updatedGame.phase === 'REVOTE'
          ? { received: updatedGame.votes.length, needed: aliveCount }
          : undefined;

        const aliveTraitors = updatedGame.players.filter((p) => p.isAlive && p.role === 'TRAITOR');
        const murderVoteProgress = updatedGame.phase === 'NIGHT'
          ? { received: updatedGame.murderVotes.length, needed: aliveTraitors.length }
          : undefined;

        const remainingTraitors = updatedGame.players.filter((p) => p.isAlive && p.role === 'TRAITOR').length;
        const remainingFaithful = updatedGame.players.filter((p) => p.isAlive && p.role && p.role !== 'TRAITOR').length;

        const reconnectPayload: ReconnectPayload = {
          sessionId: currentSessionId,
          playerId: currentPlayerId,
          playerName: player.name,
          players: scrubPlayersForRecipient(updatedGame.players, currentPlayerId),
          phase: updatedGame.phase,
          currentRound: updatedGame.currentRound,
          messages: updatedGame.messages,
          votes: updatedGame.votes,
          murderVotes: updatedGame.murderVotes,
          hostId: updatedGame.hostId,
          totalVotes: updatedGame.votes.length,
          settings: updatedGame.settings,
          history: updatedGame.history,
          aliveTraitorCount: aliveTraitors.length,
          remainingTraitors,
          remainingFaithful,
          revealedVotes: updatedGame.revealedVotes,
        };

        if (player.role !== undefined) reconnectPayload.role = player.role;
        if (traitorIds !== undefined) reconnectPayload.traitorIds = traitorIds;
        if (updatedGame.winner !== undefined) reconnectPayload.winner = updatedGame.winner;
        if (updatedGame.banishedPlayerId !== undefined) reconnectPayload.banishedPlayerId = updatedGame.banishedPlayerId;
        if (banishedPlayer !== undefined) {
          reconnectPayload.banishedPlayerName = banishedPlayer.name;
          if (banishedPlayer.role !== undefined) reconnectPayload.banishedPlayerRole = banishedPlayer.role;
        }
        if (updatedGame.lastMurderedPlayerId !== undefined) reconnectPayload.lastMurderedPlayerId = updatedGame.lastMurderedPlayerId;
        if (murderedPlayer !== undefined) reconnectPayload.lastMurderedPlayerName = murderedPlayer.name;
        if (updatedGame.timer !== undefined) reconnectPayload.timer = updatedGame.timer;
        if (updatedGame.tiedPlayerIds !== undefined) reconnectPayload.tiedPlayerIds = updatedGame.tiedPlayerIds;
        if (tiedPlayerNames !== undefined) reconnectPayload.tiedPlayerNames = tiedPlayerNames;
        if (voteCount !== undefined) reconnectPayload.voteCount = voteCount;
        if (murderVoteProgress !== undefined) reconnectPayload.murderVoteProgress = murderVoteProgress;
        if (updatedGame.revealIndex !== undefined) reconnectPayload.revealIndex = updatedGame.revealIndex;
        if (updatedGame.revealOrder !== undefined) reconnectPayload.revealOrder = updatedGame.revealOrder;
        if (updatedGame.currentTally !== undefined) reconnectPayload.currentTally = updatedGame.currentTally;
        if (updatedGame.tiebreakerResults !== undefined) reconnectPayload.tiebreakerResults = updatedGame.tiebreakerResults;
        if (updatedGame.randomlySelectedPlayerId !== undefined) {
          reconnectPayload.randomlySelectedPlayerId = updatedGame.randomlySelectedPlayerId;
          const rsp = updatedGame.players.find((p) => p.id === updatedGame.randomlySelectedPlayerId);
          if (rsp !== undefined) {
            reconnectPayload.randomlySelectedPlayerName = rsp.name;
            if (rsp.role !== undefined) reconnectPayload.randomlySelectedPlayerRole = rsp.role;
          }
        }

        ws.send(JSON.stringify({ type: 'S2C_RECONNECTED', payload: reconnectPayload } satisfies S2CEvent));

        broadcastPerRecipient(currentSessionId, (recipientId) => ({
          type: 'S2C_PLAYER_RECONNECTED',
          payload: { playerId: currentPlayerId!, players: scrubPlayersForRecipient(updatedGame.players, recipientId) }
        }));

        console.log(`Player ${player.name} reconnected to game ${currentSessionId}`);
        return;
      }

      if (!currentSessionId || !currentPlayerId) {
        sendError(ws, 'Not in a game session');
        return;
      }

      const gameState = games.get(currentSessionId);
      if (!gameState) {
        sendError(ws, 'Game session not found');
        return;
      }

      if (event.type === 'C2S_UPDATE_SETTINGS') {
        if (currentPlayerId !== gameState.hostId) {
          sendError(ws, 'Only the host can change settings');
          return;
        }

        const updatedGame = game.updateSettings(gameState, event.payload.settings);
        setGame(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_SETTINGS_UPDATED',
          payload: { settings: updatedGame.settings }
        });
        return;
      }

      if (event.type === 'C2S_START_GAME') {
        if (gameState.players.length < gameState.settings.minPlayers) {
          sendError(ws, `Need at least ${gameState.settings.minPlayers} players to start`);
          return;
        }

        const updatedGame = { ...gameState, phase: 'ROLE_ASSIGN' as const };
        setGame(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_GAME_STARTED',
          payload: { phase: 'ROLE_ASSIGN' }
        });
        return;
      }

      if (event.type === 'C2S_ASSIGN_ROLES') {
        const updatedGame = game.assignRoles(gameState);
        setGame(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_ROLES_ASSIGNED',
          payload: { phase: 'ROLE_REVEAL' }
        });

        const traitorIds = game.getTraitorIds(updatedGame);

        updatedGame.players.forEach((player) => {
          const connection = playerConnections.get(player.id);
          if (connection && connection.readyState === WebSocket.OPEN && player.role) {
            const basePayload = {
              role: player.role,
              phase: 'ROLE_REVEAL' as const
            };

            const roleReveal: S2CEvent = {
              type: 'S2C_ROLE_REVEAL',
              payload: player.role === 'TRAITOR'
                ? { ...basePayload, traitorIds }
                : basePayload
            };
            connection.send(JSON.stringify(roleReveal));
          }
        });
        return;
      }

      if (event.type === 'C2S_START_ROUNDTABLE') {
        const updatedGame = game.startRoundtable(gameState);
        setGame(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_ROUNDTABLE_STARTED',
          payload: { phase: 'ROUNDTABLE', currentRound: updatedGame.currentRound }
        });

        const timer = game.createTimer('ROUNDTABLE', updatedGame.settings);
        if (timer) {
          const gameWithTimer = { ...updatedGame, timer };
          setGame(gameWithTimer);
          broadcast(currentSessionId, {
            type: 'S2C_TIMER_UPDATE',
            payload: { endTime: timer.endTime, duration: timer.duration, phase: 'ROUNDTABLE' }
          });
        }
        return;
      }

      if (event.type === 'C2S_START_VOTING') {
        const updatedGame = game.startVoting(gameState);
        setGame(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_VOTING_STARTED',
          payload: { phase: 'VOTING' }
        });

        const timer = game.createTimer('VOTING', updatedGame.settings);
        if (timer) {
          const gameWithTimer = { ...updatedGame, timer };
          setGame(gameWithTimer);
          broadcast(currentSessionId, {
            type: 'S2C_TIMER_UPDATE',
            payload: { endTime: timer.endTime, duration: timer.duration, phase: 'VOTING' }
          });
        }
        return;
      }

      if (event.type === 'C2S_START_REVOTE') {
        const updatedGame = game.startRevote(gameState);
        setGame(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_REVOTE_STARTED',
          payload: { tiedPlayerIds: updatedGame.tiedPlayerIds ?? [], phase: 'REVOTE' }
        });

        const timer = game.createTimer('REVOTE', updatedGame.settings);
        if (timer) {
          const gameWithTimer = { ...updatedGame, timer };
          setGame(gameWithTimer);
          broadcast(currentSessionId, {
            type: 'S2C_TIMER_UPDATE',
            payload: { endTime: timer.endTime, duration: timer.duration, phase: 'REVOTE' }
          });
        }
        return;
      }

      if (event.type === 'C2S_SUBMIT_VOTE') {
        if (gameState.phase !== 'VOTING') {
          sendError(ws, 'Can only vote during voting phase');
          return;
        }
        if (gameState.votingLocked) {
          sendError(ws, 'Voting has ended');
          return;
        }

        const existingVote = gameState.votes.find((v) => v.voterId === currentPlayerId);
        if (existingVote) {
          sendError(ws, 'You have already voted');
          return;
        }

        const reasonText = event.payload.reasonText?.trim().slice(0, 120) || undefined;

        const updatedGame = game.submitVoteWithReason(
          gameState,
          currentPlayerId,
          event.payload.targetId,
          reasonText
        );
        setGame(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_VOTE_SUBMITTED',
          payload: { voterId: currentPlayerId }
        });

        const alivePlayerCount = updatedGame.players.filter((p) => p.isAlive).length;
        const voteCount = updatedGame.votes.length;

        broadcast(currentSessionId, {
          type: 'S2C_VOTE_COUNT_UPDATE',
          payload: { received: voteCount, needed: alivePlayerCount }
        });

        if (voteCount >= alivePlayerCount) {
          const lockedGame = { ...updatedGame, votingLocked: true };
          const revealedGame = game.revealVotes(lockedGame);
          setGame(revealedGame);

          startVoteRevealSequence(currentSessionId, games, playerConnections, setGame);
        }
        return;
      }

      if (event.type === 'C2S_FORCE_RESOLVE_VOTING') {
        if (gameState.phase !== 'VOTING' && gameState.phase !== 'REVOTE') {
          sendError(ws, 'Can only force resolve during voting phase');
          return;
        }

        const currentPlayer = gameState.players.find((p) => p.id === currentPlayerId);
        if (!currentPlayer?.isHost) {
          sendError(ws, 'Only host can force resolve voting');
          return;
        }

        const { game: gameWithAutoVotes, autoVotes } = game.generateAutoVotes(gameState);

        for (const autoVote of autoVotes) {
          const voter = gameWithAutoVotes.players.find((p) => p.id === autoVote.voterId);
          broadcast(currentSessionId, {
            type: 'S2C_VOTE_SUBMITTED',
            payload: { voterId: autoVote.voterId, isAutoVote: true, voterName: voter?.name ?? 'Unknown' }
          });
        }

        const alivePlayerCount = gameWithAutoVotes.players.filter((p) => p.isAlive).length;
        broadcast(currentSessionId, {
          type: 'S2C_VOTE_COUNT_UPDATE',
          payload: { received: gameWithAutoVotes.votes.length, needed: alivePlayerCount }
        });

        const lockedGame = { ...gameWithAutoVotes, votingLocked: true };
        const revealedGame = game.revealVotes(lockedGame);
        setGame(revealedGame);

        startVoteRevealSequence(currentSessionId, games, playerConnections, setGame);
        return;
      }

      if (event.type === 'C2S_REVEAL_VOTES') {
        const updatedGame = game.revealVotes(gameState);
        setGame(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_VOTES_REVEALED',
          payload: { votes: updatedGame.revealedVotes, phase: 'VOTE_REVEAL' }
        });
        return;
      }

      if (event.type === 'C2S_BANISH_PLAYER') {
        const result = game.banishPlayer(gameState);
        setGame(result.game);

        if (result.isTie && result.tiedPlayerIds) {
          const tiedPlayerNames = result.tiedPlayerIds.map((id) => {
            const player = result.game.players.find((p) => p.id === id);
            return player?.name ?? 'Unknown';
          });

          broadcast(currentSessionId, {
            type: 'S2C_TIE_DETECTED',
            payload: {
              tiedPlayerIds: result.tiedPlayerIds,
              tiedPlayerNames,
              phase: 'TIE_DETECTED'
            }
          });
        } else if (result.isRandomSelection && result.randomlySelectedPlayerId) {
          const selectedPlayer = result.game.players.find((p) => p.id === result.randomlySelectedPlayerId);
          const tiedPlayerNames = result.tiedPlayerIds?.map((id) => {
            const player = result.game.players.find((p) => p.id === id);
            return player?.name ?? 'Unknown';
          }) ?? [];

          if (selectedPlayer && selectedPlayer.role) {
            broadcast(currentSessionId, {
              type: 'S2C_TIEBREAKER_RESOLVED',
              payload: {
                selectedPlayerId: selectedPlayer.id,
                selectedPlayerName: selectedPlayer.name,
                selectedPlayerRole: selectedPlayer.role,
                tiedPlayerIds: result.tiedPlayerIds ?? [],
                tiedPlayerNames,
                phase: 'TIEBREAKER_REVEAL'
              }
            });
          }
        } else {
          const banishedPlayer = result.game.players.find((p) => p.id === result.game.banishedPlayerId);
          if (banishedPlayer && banishedPlayer.role) {
            broadcast(currentSessionId, {
              type: 'S2C_PLAYER_BANISHED',
              payload: {
                banishedPlayerId: banishedPlayer.id,
                banishedPlayerName: banishedPlayer.name,
                banishedPlayerRole: banishedPlayer.role,
                phase: 'BANISH_REVEAL'
              }
            });
          }
        }
        return;
      }

      if (event.type === 'C2S_SUBMIT_REVOTE') {
        if (gameState.phase !== 'REVOTE') {
          sendError(ws, 'Can only submit revotes during revote phase');
          return;
        }
        if (gameState.votingLocked) {
          sendError(ws, 'Voting has ended');
          return;
        }
        if (!gameState.tiedPlayerIds?.includes(event.payload.targetId)) {
          sendError(ws, 'Can only vote for tied candidates in revote');
          return;
        }

        const updatedGame = game.submitVote(gameState, currentPlayerId, event.payload.targetId);
        setGame(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_VOTE_SUBMITTED',
          payload: { voterId: currentPlayerId }
        });

        const alivePlayerCount = updatedGame.players.filter((p) => p.isAlive).length;
        const voteCount = updatedGame.votes.length;

        broadcast(currentSessionId, {
          type: 'S2C_VOTE_COUNT_UPDATE',
          payload: { received: voteCount, needed: alivePlayerCount }
        });

        if (voteCount >= alivePlayerCount) {
          const revealedGame = game.revealVotes(updatedGame);
          setGame(revealedGame);

          broadcast(currentSessionId, {
            type: 'S2C_VOTES_REVEALED',
            payload: { votes: revealedGame.revealedVotes, phase: 'VOTE_REVEAL' }
          });
        }
        return;
      }

      if (event.type === 'C2S_CHECK_WIN') {
        const updatedGame = game.checkWinCondition(gameState);
        setGame(updatedGame);

        if (updatedGame.phase === 'GAME_END' && updatedGame.winner) {

          writeGameRecordIfNeeded(updatedGame);

          const aliveTraitors = updatedGame.players.filter((p) => p.isAlive && p.role === 'TRAITOR').length;
          const aliveFaithful = updatedGame.players.filter((p) => p.isAlive && p.role && p.role !== 'TRAITOR').length;

          broadcast(currentSessionId, {
            type: 'S2C_GAME_END',
            payload: {
              winner: updatedGame.winner,
              phase: 'GAME_END',
              remainingTraitors: aliveTraitors,
              remainingFaithful: aliveFaithful,
              history: updatedGame.history
            }
          });
        } else {
          broadcast(currentSessionId, {
            type: 'S2C_CONTINUE_GAME',
            payload: { phase: updatedGame.phase, currentRound: updatedGame.currentRound }
          });

          if (updatedGame.phase === 'ROUNDTABLE') {
            const timer = game.createTimer('ROUNDTABLE', updatedGame.settings);
            if (timer) {
              const gameWithTimer = { ...updatedGame, timer };
              setGame(gameWithTimer);
              broadcast(currentSessionId, {
                type: 'S2C_TIMER_UPDATE',
                payload: { endTime: timer.endTime, duration: timer.duration, phase: 'ROUNDTABLE' }
              });
            }
          }
        }
        return;
      }

      if (event.type === 'C2S_START_NIGHT') {
        const updatedGame = game.startNight(gameState);
        setGame(updatedGame);

        const aliveTraitorCount = game.getAliveTraitorCount(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_NIGHT_STARTED',
          payload: {
            phase: 'NIGHT',
            currentRound: updatedGame.currentRound,
            aliveTraitorCount
          }
        });

        const timer = game.createTimer('NIGHT', updatedGame.settings);
        if (timer) {
          const gameWithTimer = { ...updatedGame, timer };
          setGame(gameWithTimer);
          broadcast(currentSessionId, {
            type: 'S2C_TIMER_UPDATE',
            payload: { endTime: timer.endTime, duration: timer.duration, phase: 'NIGHT' }
          });
        }
        return;
      }

      if (event.type === 'C2S_SUBMIT_MURDER') {
        const updatedGame = game.submitMurder(gameState, currentPlayerId, event.payload.targetId);
        setGame(updatedGame);

        const progress = game.getMurderVoteProgress(updatedGame);

        updatedGame.players.forEach((player) => {
          if (player.role === 'TRAITOR' && player.isAlive) {
            const connection = playerConnections.get(player.id);
            if (connection && connection.readyState === WebSocket.OPEN && currentPlayerId) {
              const murderUpdate: S2CEvent = {
                type: 'S2C_MURDER_SUBMITTED',
                payload: {
                  voterId: currentPlayerId,
                  votesReceived: progress.received,
                  votesNeeded: progress.needed
                }
              };
              connection.send(JSON.stringify(murderUpdate));
            }
          }
        });

        if (progress.received >= progress.needed && updatedGame.phase === 'NIGHT') {
          try {
            const result = game.resolveMurder(updatedGame);
            // Sheriff investigates BEFORE morning broadcast so the private
            // result lands first and the broadcast carries the appended history.
            const gameAfterSheriff = runSheriffInvestigation(result.game, playerConnections);
            setGame(gameAfterSheriff);

            broadcastRecruitmentEvents(result, gameAfterSheriff, playerConnections);

            if (result.blocked) {
              broadcastMorningEventWithRecruitment(
                'S2C_MORNING_STARTED',
                result.medicBlocked
                  ? { phase: 'MORNING', murderBlocked: true }
                  : {
                      phase: 'MORNING',
                      murderBlocked: true,
                      shieldedPlayerId: result.shieldedPlayerId,
                      shieldedPlayerName: result.shieldedPlayerName,
                    },
                result.recruitedPlayerId,
                result.recruitedPlayerName,
                gameAfterSheriff,
                playerConnections
              );
            } else if (result.murderedPlayerId) {
              broadcastMorningEventWithRecruitment(
                'S2C_MURDER_RESOLVED',
                {
                  murderedPlayerId: result.murderedPlayerId,
                  murderedPlayerName: result.murderedPlayerName,
                  phase: 'MORNING',
                },
                result.recruitedPlayerId,
                result.recruitedPlayerName,
                gameAfterSheriff,
                playerConnections
              );
            }
          } catch (err) {
            console.error('Error auto-resolving murder:', err);
          }
        }
        return;
      }

      if (event.type === 'C2S_RESOLVE_MURDER') {
        const result = game.resolveMurder(gameState);
        const gameAfterSheriff = runSheriffInvestigation(result.game, playerConnections);
        setGame(gameAfterSheriff);

        broadcastRecruitmentEvents(result, gameAfterSheriff, playerConnections);

        if (result.blocked) {
          broadcastMorningEventWithRecruitment(
            'S2C_MORNING_STARTED',
            result.medicBlocked
              ? { phase: 'MORNING', murderBlocked: true }
              : {
                  phase: 'MORNING',
                  murderBlocked: true,
                  shieldedPlayerId: result.shieldedPlayerId,
                  shieldedPlayerName: result.shieldedPlayerName,
                },
            result.recruitedPlayerId,
            result.recruitedPlayerName,
            gameAfterSheriff,
            playerConnections
          );
        } else if (result.murderedPlayerId) {
          broadcastMorningEventWithRecruitment(
            'S2C_MURDER_RESOLVED',
            {
              murderedPlayerId: result.murderedPlayerId,
              murderedPlayerName: result.murderedPlayerName,
              phase: 'MORNING',
            },
            result.recruitedPlayerId,
            result.recruitedPlayerName,
            gameAfterSheriff,
            playerConnections
          );
        }
        return;
      }

      if (event.type === 'C2S_START_MORNING') {
        const updatedGame = game.startMorning(gameState);
        setGame(updatedGame);

        const murderedPlayer = updatedGame.players.find((p) => p.id === updatedGame.lastMurderedPlayerId);
        const recruitedPlayer = updatedGame.players.find((p) => p.id === updatedGame.lastRecruitedPlayerId);

        if (murderedPlayer) {
          broadcastMorningEventWithRecruitment(
            'S2C_MORNING_STARTED',
            {
              phase: 'MORNING',
              lastMurderedPlayerId: murderedPlayer.id,
              lastMurderedPlayerName: murderedPlayer.name,
            },
            recruitedPlayer?.id,
            recruitedPlayer?.name,
            updatedGame,
            playerConnections
          );
        } else {
          broadcastMorningEventWithRecruitment(
            'S2C_MORNING_STARTED',
            { phase: 'MORNING' },
            recruitedPlayer?.id,
            recruitedPlayer?.name,
            updatedGame,
            playerConnections
          );
        }
        return;
      }

      if (event.type === 'C2S_CONTINUE_TO_DAY') {
        const updatedGame = game.continueToDayPhase(gameState);
        setGame(updatedGame);

        if (updatedGame.phase === 'GAME_END' && updatedGame.winner) {

          writeGameRecordIfNeeded(updatedGame);

          const aliveTraitors = updatedGame.players.filter((p) => p.isAlive && p.role === 'TRAITOR').length;
          const aliveFaithful = updatedGame.players.filter((p) => p.isAlive && p.role && p.role !== 'TRAITOR').length;

          broadcast(currentSessionId, {
            type: 'S2C_GAME_END',
            payload: {
              winner: updatedGame.winner,
              phase: 'GAME_END',
              remainingTraitors: aliveTraitors,
              remainingFaithful: aliveFaithful,
              history: updatedGame.history
            }
          });
        } else if (updatedGame.phase === 'CHALLENGE') {
          const challengeResult = game.createChallenge(updatedGame);
          const timer = game.createTimer('CHALLENGE', challengeResult.game.settings);
          const gameWithTimer = timer ? { ...challengeResult.game, timer } : challengeResult.game;
          setGame(gameWithTimer);

          const challenge = challengeResult.challenge;
          const eligibleCount = countEligibleAnswerers(gameWithTimer);
          broadcast(currentSessionId, {
            type: 'S2C_CHALLENGE_STARTED',
            payload: {
              phase: 'CHALLENGE',
              challengeType: challenge.type,
              startTime: challenge.startTime,
              eligibleCount,
              // NOTE: targetTime is intentionally NOT broadcast at challenge
              // start. TIME_ESTIMATE is a blind-guess game — the secret number
              // only appears in S2C_CHALLENGE_RESULT (as correctAnswer).
              ...(challenge.shownPlayerIds !== undefined ? { shownPlayerIds: challenge.shownPlayerIds } : {}),
              ...(challenge.scrambledWord !== undefined ? { scrambledWord: challenge.scrambledWord } : {}),
              ...(timer ? { endTime: timer.endTime, duration: timer.duration } : {}),
            }
          });

          if (timer) {
            broadcast(currentSessionId, {
              type: 'S2C_TIMER_UPDATE',
              payload: { endTime: timer.endTime, duration: timer.duration, phase: 'CHALLENGE' }
            });
          }

          if (challenge.type === 'MISSING_PLAYER') {
            setTimeout(() => {
              const currentGame = games.get(currentSessionId!);
              if (currentGame?.phase === 'CHALLENGE' && currentGame.challenge?.type === 'MISSING_PLAYER') {
                broadcast(currentSessionId!, {
                  type: 'S2C_CHALLENGE_PHASE_UPDATE',
                  payload: {
                    ...(currentGame.challenge.hiddenPlayerId !== undefined
                      ? { hiddenPlayerId: currentGame.challenge.hiddenPlayerId }
                      : {})
                  }
                });
              }
            }, 3000);
          }

          // Server-authoritative auto-resolve when timer expires
          clearChallengeTimer(currentSessionId);
          const sessionId = currentSessionId;
          const expiryMs = timer ? Math.max(0, timer.endTime - Date.now()) : 60000;
          activeChallengeTimers.set(sessionId, setTimeout(() => {
            activeChallengeTimers.delete(sessionId);
            const currentGame = games.get(sessionId);
            if (!currentGame || currentGame.phase !== 'CHALLENGE' || !currentGame.challenge) return;
            try {
              const resolution = game.resolveChallenge(currentGame);
              setGame(resolution.game);
              broadcastChallengeResult(sessionId, resolution, games, playerConnections);
            } catch (e) {
              console.error('Challenge auto-resolve error:', e);
            }
          }, expiryMs));
        } else {
          broadcast(currentSessionId, {
            type: 'S2C_CONTINUE_GAME',
            payload: { phase: updatedGame.phase, currentRound: updatedGame.currentRound }
          });
        }
        return;
      }

      if (event.type === 'C2S_SUBMIT_CHALLENGE_ANSWER') {
        if (gameState.phase !== 'CHALLENGE' || !gameState.challenge) {
          sendError(ws, 'Not in challenge phase');
          return;
        }

        const result = game.submitChallengeAnswer(gameState, currentPlayerId, event.payload.answer);
        setGame(result.game);

        const needed = countEligibleAnswerers(result.game);
        // Count only ELIGIBLE answers — ineligible players (e.g. last
        // round's challenge winner serving cooldown) may still submit, but
        // those submissions must not count toward the early-resolve quota
        // or `received` could exceed `needed` and end the round before all
        // eligible players have answered.
        const eligibleAnswerCount = (() => {
          const ch = result.game.challenge;
          if (!ch) return 0;
          let n = 0;
          ch.answers.forEach((_data, pId) => {
            const p = result.game.players.find((pp) => pp.id === pId);
            if (p && p.isAlive && p.lastChallengeWinRound !== result.game.currentRound - 1) n++;
          });
          return n;
        })();

        broadcast(currentSessionId, {
          type: 'S2C_CHALLENGE_ANSWER_RECEIVED',
          payload: { playerId: currentPlayerId, received: eligibleAnswerCount, needed }
        });

        // Resolve early if we have a winner OR every eligible player has answered.
        const allAnswered = eligibleAnswerCount >= needed && needed > 0;
        if ((result.isWinner || allAnswered) && result.game.challenge) {
          clearChallengeTimer(currentSessionId);
          const resolution = game.resolveChallenge(result.game);
          setGame(resolution.game);
          broadcastChallengeResult(currentSessionId, resolution, games, playerConnections);
        }
        return;
      }

      if (event.type === 'C2S_CONTINUE_TO_ROUNDTABLE') {
        if (gameState.phase !== 'CHALLENGE_RESULT') {
          if (gameState.phase === 'CHALLENGE' && gameState.challenge?.type === 'TIME_ESTIMATE') {
            clearChallengeTimer(currentSessionId);
            const resolution = game.resolveChallenge(gameState);
            setGame(resolution.game);
            broadcastChallengeResult(currentSessionId, resolution, games, playerConnections);
            return;
          }
          sendError(ws, 'Not in challenge result phase');
          return;
        }

        clearChallengeTimer(currentSessionId);
        const updatedGame = game.continueToRoundtable(gameState);
        setGame(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_ROUNDTABLE_STARTED',
          payload: { phase: 'ROUNDTABLE', currentRound: updatedGame.currentRound }
        });

        const timer = game.createTimer('ROUNDTABLE', updatedGame.settings);
        if (timer) {
          const gameWithTimer = { ...updatedGame, timer };
          setGame(gameWithTimer);
          broadcast(currentSessionId, {
            type: 'S2C_TIMER_UPDATE',
            payload: { endTime: timer.endTime, duration: timer.duration, phase: 'ROUNDTABLE' }
          });
        }
        return;
      }

      if (event.type === 'C2S_DECLINE_SHIELD') {
        // Player explicitly chooses NOT to use their shield. We mark the
        // decision in state and then auto-resolve the banishment so the host
        // doesn't have to retry — the shielded player has spoken.
        let updated;
        try {
          updated = game.declineShield(gameState, currentPlayerId);
        } catch (err) {
          sendError(ws, (err as Error).message);
          return;
        }
        setGame(updated);

        // Auto-banish using the same handler logic as C2S_BANISH_PLAYER.
        try {
          const result = game.banishPlayer(updated);
          setGame(result.game);

          if (result.isTie && result.tiedPlayerIds) {
            // Decline can never produce a tie because the gate only fires for
            // a SINGLE top candidate; this branch is defensive only.
            const tiedPlayerNames = result.tiedPlayerIds.map((id) => {
              const player = result.game.players.find((p) => p.id === id);
              return player?.name ?? 'Unknown';
            });
            broadcast(currentSessionId, {
              type: 'S2C_TIE_DETECTED',
              payload: { tiedPlayerIds: result.tiedPlayerIds, tiedPlayerNames, phase: 'TIE_DETECTED' }
            });
          } else {
            const banishedPlayer = result.game.players.find((p) => p.id === result.game.banishedPlayerId);
            if (banishedPlayer && banishedPlayer.role) {
              broadcast(currentSessionId, {
                type: 'S2C_PLAYER_BANISHED',
                payload: {
                  banishedPlayerId: banishedPlayer.id,
                  banishedPlayerName: banishedPlayer.name,
                  banishedPlayerRole: banishedPlayer.role,
                  phase: 'BANISH_REVEAL'
                }
              });
            }
          }
        } catch (err) {
          sendError(ws, (err as Error).message);
        }
        return;
      }

      if (event.type === 'C2S_REVEAL_SHIELD') {
        // Phase guards live inside revealShield() — it throws if not in
        // VOTE_REVEAL, not the top vote-getter, or not actually shielded.
        let result;
        try {
          result = game.revealShield(gameState, currentPlayerId);
        } catch (err) {
          sendError(ws, (err as Error).message);
          return;
        }
        setGame(result.game);

        broadcast(currentSessionId, {
          type: 'S2C_SHIELD_REVEALED',
          payload: {
            playerId: currentPlayerId,
            playerName: result.blockedTargetName ?? '',
            banishmentBlocked: result.banishmentBlocked,
          }
        });

        // The shield consumed the banishment — surface that to all clients
        // so the Voting screen flips to the "no one was banished" view and
        // the host's Continue button routes to CHECK_WIN.
        if (result.banishmentBlocked) {
          broadcast(currentSessionId, {
            type: 'S2C_CONTINUE_GAME',
            payload: { phase: result.game.phase, currentRound: result.game.currentRound }
          });
        }
        return;
      }

      if (event.type === 'C2S_MEDIC_PROTECT') {
        try {
          const { game: updatedGame, targetName } = game.medicProtect(
            gameState,
            currentPlayerId,
            event.payload.targetId
          );
          setGame(updatedGame);
          ws.send(JSON.stringify({
            type: 'S2C_MEDIC_PROTECT_CONFIRMED',
            payload: { targetId: event.payload.targetId, targetName },
          }));
        } catch (err) {
          sendError(ws, (err as Error).message);
        }
        return;
      }

      if (event.type === 'C2S_ACTIVATE_SEER') {
        try {
          const result = game.activateSeer(gameState, currentPlayerId);
          setGame(result.game);
          ws.send(JSON.stringify({
            type: 'S2C_SEER_RESULT',
            payload: {
              round: result.round,
              targetId: result.targetId,
              targetName: result.targetName,
              role: result.targetRole,
            },
          }));
          // Notify alive Traitors that the Seer's gift was used (round only, no name).
          result.game.players.forEach((p) => {
            if (p.isAlive && p.role === 'TRAITOR') {
              const sock = playerConnections.get(p.id);
              if (sock && sock.readyState === WebSocket.OPEN) {
                sock.send(JSON.stringify({
                  type: 'S2C_SEER_ACTIVATED',
                  payload: { round: result.round },
                }));
              }
            }
          });
        } catch (err) {
          sendError(ws, (err as Error).message);
        }
        return;
      }

      if (event.type === 'C2S_SUBMIT_RECRUITMENT') {
        const updatedGame = game.submitRecruitment(gameState, currentPlayerId, event.payload.targetId);
        setGame(updatedGame);

        const recruiter = updatedGame.players.find((p) => p.id === currentPlayerId);

        updatedGame.players.forEach((p) => {
          if (p.role === 'TRAITOR' && p.isAlive) {
            const connection = playerConnections.get(p.id);
            if (connection && connection.readyState === WebSocket.OPEN && recruiter) {
              connection.send(JSON.stringify({
                type: 'S2C_RECRUITMENT_SUBMITTED',
                payload: { recruiterId: currentPlayerId, recruiterName: recruiter.name }
              }));
            }
          }
        });
        return;
      }

      if (event.type === 'C2S_TRANSFER_HOST') {
        const currentPlayer = gameState.players.find((p) => p.id === currentPlayerId);
        if (!currentPlayer?.isHost) {
          sendError(ws, 'Only the host can transfer host');
          return;
        }
        const targetId = event.payload.targetPlayerId;
        const target = gameState.players.find((p) => p.id === targetId);
        if (!target) {
          sendError(ws, 'Target player not found');
          return;
        }
        if (target.id === currentPlayerId) {
          sendError(ws, 'You are already the host');
          return;
        }
        try {
          const updatedGame = game.transferHost(gameState, targetId);
          setGame(updatedGame);
          broadcast(currentSessionId, {
            type: 'S2C_HOST_TRANSFERRED',
            payload: {
              newHostId: target.id,
              newHostName: target.name,
              players: updatedGame.players,
            }
          });
        } catch (err) {
          sendError(ws, (err as Error).message);
        }
        return;
      }

      if (event.type === 'C2S_END_GAME_EARLY') {
        const currentPlayer = gameState.players.find((p) => p.id === currentPlayerId);
        if (!currentPlayer?.isHost) {
          sendError(ws, 'Only the host can end the game');
          return;
        }
        if (gameState.phase === 'GAME_END') {
          return;
        }
        const updatedGame = game.endGameEarly(gameState);
        setGame(updatedGame);
        const aliveTraitors = updatedGame.players.filter((p) => p.isAlive && p.role === 'TRAITOR').length;
        const aliveFaithful = updatedGame.players.filter((p) => p.isAlive && p.role && p.role !== 'TRAITOR').length;
        broadcast(currentSessionId, {
          type: 'S2C_GAME_END',
          payload: {
            phase: 'GAME_END',
            remainingTraitors: aliveTraitors,
            remainingFaithful: aliveFaithful,
            history: updatedGame.history,
            reason: 'HOST_ENDED',
          }
        });
        return;
      }

      if (event.type === 'C2S_SET_AVATAR') {
        const updatedGame = game.setAvatar(
          gameState,
          currentPlayerId,
          event.payload.color,
          event.payload.avatar
        );
        setGame(updatedGame);
        broadcastPerRecipient(currentSessionId, (recipientId) => ({
          type: 'S2C_AVATAR_UPDATED',
          payload: { players: scrubPlayersForRecipient(updatedGame.players, recipientId) }
        }));
        return;
      }

      if (event.type === 'C2S_SEND_MESSAGE') {
        const player = gameState.players.find((p) => p.id === currentPlayerId);
        if (!player) {
          sendError(ws, 'Player not found');
          return;
        }

        const message = event.payload.message.trim().slice(0, 200);
        if (!message) return;

        type PayloadType = { message: string; channel?: string; traitorOnly?: boolean };
        const payload = event.payload as PayloadType;
        let requestedChannel: 'general' | 'traitor' = 'general';
        if (payload.channel === 'traitor' || payload.traitorOnly === true) {
          requestedChannel = 'traitor';
        }

        if (requestedChannel === 'traitor') {
          if (player.role !== 'TRAITOR') {
            sendError(ws, 'Only traitors can use traitor chat');
            return;
          }
          if (!player.isAlive) {
            sendError(ws, 'Dead players cannot use traitor chat');
            return;
          }
        }

        const chatMessage: ChatMessage = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          playerId: player.id,
          playerName: player.name,
          message,
          timestamp: Date.now(),
          channel: requestedChannel
        };

        const updatedGame = {
          ...gameState,
          messages: [...gameState.messages, chatMessage]
        };
        setGame(updatedGame);

        if (requestedChannel === 'traitor') {
          gameState.players.forEach((p) => {
            if (p.role === 'TRAITOR' && p.isAlive) {
              const connection = playerConnections.get(p.id);
              if (connection && connection.readyState === WebSocket.OPEN) {
                connection.send(JSON.stringify({
                  type: 'S2C_CHAT_MESSAGE',
                  payload: chatMessage
                }));
              }
            }
          });
        } else {
          broadcast(currentSessionId, {
            type: 'S2C_CHAT_MESSAGE',
            payload: chatMessage
          });
        }
        return;
      }

    } catch (error) {
      console.error('Error handling message:', error);
      sendError(ws, error instanceof Error ? error.message : 'Unknown error');
    }
  });

  ws.on('close', () => {
    if (currentPlayerId && currentSessionId) {
      playerConnections.delete(currentPlayerId);

      const gameState = games.get(currentSessionId);
      if (gameState) {
        let updatedGame = {
          ...gameState,
          players: gameState.players.map((p) =>
            p.id === currentPlayerId ? { ...p, isConnected: false } : p
          )
        };

        for (const [token, data] of sessionTokens.entries()) {
          if (data.playerId === currentPlayerId && data.sessionId === currentSessionId) {
            disconnectedPlayers.set(token, {
              playerId: currentPlayerId,
              sessionId: currentSessionId,
              disconnectedAt: Date.now()
            });
            console.log(`Player ${currentPlayerId} disconnected, grace period started`);
            break;
          }
        }

        if (game.isGameEmpty(updatedGame)) {
          removeGame(currentSessionId);
          console.log(`Game ${currentSessionId} deleted - all players disconnected`);
          return;
        }

        const disconnectedPlayer = gameState.players.find((p) => p.id === currentPlayerId);
        if (disconnectedPlayer?.isHost) {
          const newHostId = game.findNewHost(updatedGame);
          if (newHostId) {
            updatedGame = game.transferHost(updatedGame, newHostId);
            console.log(`Host transferred to ${newHostId} in game ${currentSessionId}`);
          }
        }

        setGame(updatedGame);

        broadcastPerRecipient(currentSessionId, (recipientId) => ({
          type: 'S2C_PLAYER_DISCONNECTED',
          payload: { playerId: currentPlayerId!, players: scrubPlayersForRecipient(updatedGame.players, recipientId) }
        }));
      }
    }
  });
}

