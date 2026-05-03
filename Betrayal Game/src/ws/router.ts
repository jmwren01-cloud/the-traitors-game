import { WebSocket } from 'ws';
import * as game from '../game/manager.js';
import type { C2SEvent, S2CEvent, ChatMessage, GameState, Role } from '../game/types.js';
import { TOKEN_REVEAL_DURATION_MS } from '../game/types.js';
import {
  broadcastToSession,
  broadcastToSessionPerRecipient,
  sendError,
  generateSessionToken,
  broadcastRecruitmentEvents,
  broadcastMorningEventWithRecruitment,
  scrubPlayersForRecipient
} from './utils.js';
import { startVoteRevealSequence } from './voteReveal.js';

// Phases where the host may remove a player or transfer host. Excludes
// any phase with an in-flight reveal sequence, timer, or active
// sub-phase (CHALLENGE, VOTING, VOTE_REVEAL, TIE_DETECTED, REVOTE,
// TIEBREAKER_REVEAL, BANISH_REVEAL, NIGHT, and ROUNDTABLE — which
// hosts the Confession Booth and Suspicion Token sub-phases).
const HOST_MGMT_SAFE_PHASES = new Set<GameState['phase']>([
  'LOBBY',
  'MORNING',
]);

const activeChallengeTimers = new Map<string, NodeJS.Timeout>();
// Wave 4 / 3 — server-side 60s false-evidence unanimity timer.
const evidenceWindowTimers = new Map<string, NodeJS.Timeout>();
// server-side 60s Confession Booth timer.
const confessionTimers = new Map<string, NodeJS.Timeout>();
// server-side 45s Suspicion Token placement timer + the 5s
// post-resolve reveal timer that auto-advances into VOTING.
const tokenTimers = new Map<string, NodeJS.Timeout>();

function clearChallengeTimer(sessionId: string): void {
  const t = activeChallengeTimers.get(sessionId);
  if (t) {
    clearTimeout(t);
    activeChallengeTimers.delete(sessionId);
  }
}

function clearEvidenceTimer(sessionId: string): void {
  const t = evidenceWindowTimers.get(sessionId);
  if (t) {
    clearTimeout(t);
    evidenceWindowTimers.delete(sessionId);
  }
}

function clearConfessionTimer(sessionId: string): void {
  const t = confessionTimers.get(sessionId);
  if (t) {
    clearTimeout(t);
    confessionTimers.delete(sessionId);
  }
}

function clearTokenTimer(sessionId: string): void {
  const t = tokenTimers.get(sessionId);
  if (t) {
    clearTimeout(t);
    tokenTimers.delete(sessionId);
  }
}

/**
 * Clean up all in-memory timers/intervals associated with a session.
 * Call this when a game session is destroyed (e.g. all players gone, manual cleanup).
 */
export function cleanupSessionTimers(sessionId: string): void {
  clearChallengeTimer(sessionId);
  clearEvidenceTimer(sessionId);
  clearConfessionTimer(sessionId);
  clearTokenTimer(sessionId);
}

function countEligibleAnswerers(state: GameState): number {
  return state.players.filter(
    (p) => p.isAlive && p.lastChallengeWinRound !== state.currentRound - 1
  ).length;
}

/**
 * Wave 4 — fan out per-Sheriff investigation results as private messages.
 * Called immediately after a NIGHT->MORNING transition (whether the kill
 * landed, was shielded, or was Medic-blocked).
 */
function broadcastSheriffResults(
  sessionId: string,
  games: Map<string, GameState>,
  playerConnections: Map<string, WebSocket>,
  setGame?: (state: GameState) => void
): void {
  const state = games.get(sessionId);
  if (!state) return;
  const { game: updated, investigations } = game.runSheriffInvestigations(state);
  // Persist any consumed forceSuspiciousIds so the override fires only once.
  if (updated !== state) {
    if (setGame) setGame(updated);
    else games.set(sessionId, updated);
  }
  for (const inv of investigations) {
    const socket = playerConnections.get(inv.sheriffId);
    if (!socket || socket.readyState !== WebSocket.OPEN) continue;
    socket.send(JSON.stringify({
      type: 'S2C_SHERIFF_RESULT',
      payload: {
        targetId: inv.targetId,
        targetName: inv.targetName,
        reportedRole: inv.reportedRole,
        round: state.currentRound,
      }
    } satisfies S2CEvent));
  }
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

  // ============= CONFESSION BOOTH HELPERS =============

  /**
   * Start the ROUNDTABLE discussion timer (the timer that was previously
   * started immediately at Roundtable entry). Now invoked AFTER the
   * Confession Booth resolves, so the timer is gated on the booth.
   */
  function startRoundtableDiscussionTimer(sessionId: string, current: GameState): GameState {
    const timer = game.createTimer('ROUNDTABLE', current.settings);
    if (!timer) return current;
    const withTimer = { ...current, timer };
    setGame(withTimer);
    broadcast(sessionId, {
      type: 'S2C_TIMER_UPDATE',
      payload: { endTime: timer.endTime, duration: timer.duration, phase: 'ROUNDTABLE' },
    });
    return withTimer;
  }

  /**
   * Resolve the booth (backfill defaults, inject ANONYMOUS_TIP, shuffle),
   * broadcast S2C_CONFESSIONS_REVEALED, then start the discussion timer.
   * Idempotent — safe to call from both the timeout fire and the
   * "all alive submitted" early path.
   */
  function fireConfessionResolution(sessionId: string): void {
    clearConfessionTimer(sessionId);
    const current = games.get(sessionId);
    if (!current) return;
    if (current.phase !== 'ROUNDTABLE' || current.confessionPhase !== 'BOOTH') return;
    const resolved = game.resolveConfessions(current);
    setGame(resolved);
    broadcast(sessionId, {
      type: 'S2C_CONFESSIONS_REVEALED',
      payload: {
        reveals: resolved.confessionRevealed ?? [],
        round: resolved.currentRound,
      },
    });
    startRoundtableDiscussionTimer(sessionId, resolved);
  }

  // ============= SUSPICION TOKEN HELPERS  =============

  /**
   * Final transition out of the Suspicion Token sub-phase: call
   * `startVoting` (which strips the sub-phase scaffolding), broadcast
   * S2C_VOTING_STARTED, and start the VOTING timer. Idempotent — bails
   * if we're no longer in ROUNDTABLE/REVEAL.
   */
  function proceedToVotingFromTokens(sessionId: string): void {
    clearTokenTimer(sessionId);
    const current = games.get(sessionId);
    if (!current) return;
    // Strict guard: only advance when the reveal hold is actually
    // active. Prevents accidental phase skipping if this is ever
    // called from a stray timer / out-of-order code path.
    if (current.phase !== 'ROUNDTABLE' || current.tokenPhase !== 'REVEAL') return;
    const voting = game.startVoting(current);
    setGame(voting);
    broadcast(sessionId, { type: 'S2C_VOTING_STARTED', payload: { phase: 'VOTING' } });
    const timer = game.createTimer('VOTING', voting.settings);
    if (timer) {
      const withTimer = { ...voting, timer };
      setGame(withTimer);
      broadcast(sessionId, {
        type: 'S2C_TIMER_UPDATE',
        payload: { endTime: timer.endTime, duration: timer.duration, phase: 'VOTING' },
      });
    }
  }

  /**
   * Resolve the Suspicion Token PLACEMENT window (backfill auto picks,
   * archive per-round graph), broadcast S2C_TOKENS_REVEALED, and
   * schedule the 5s reveal hold that auto-advances into VOTING.
   * Idempotent — safe to call from both the placement timeout and the
   * "all alive placed" early path.
   */
  function fireTokenResolution(sessionId: string): void {
    clearTokenTimer(sessionId);
    const current = games.get(sessionId);
    if (!current) return;
    if (current.phase !== 'ROUNDTABLE' || current.tokenPhase !== 'PLACEMENT') return;
    const resolved = game.resolveSuspicionTokens(current);
    const revealEndsAt = Date.now() + TOKEN_REVEAL_DURATION_MS;
    const withReveal = { ...resolved, tokenRevealEndsAt: revealEndsAt };
    setGame(withReveal);
    broadcast(sessionId, {
      type: 'S2C_TOKENS_REVEALED',
      payload: {
        tokens: resolved.suspicionTokensCurrent ?? [],
        round: resolved.currentRound,
        revealEndsAt,
      },
    });
    const handle = setTimeout(() => {
      tokenTimers.delete(sessionId);
      try {
        proceedToVotingFromTokens(sessionId);
      } catch (e) {
        console.error('Suspicion Token reveal -> voting transition error:', e);
      }
    }, Math.max(0, revealEndsAt - Date.now()));
    tokenTimers.set(sessionId, handle);
  }

  /**
   * Open the Suspicion Token PLACEMENT window: persist initialised
   * sub-phase state, broadcast S2C_TOKEN_PHASE_STARTED, and schedule
   * the 45s placement timeout.
   */
  function beginTokenPlacement(sessionId: string, current: GameState): void {
    clearTokenTimer(sessionId);
    const opened = game.beginSuspicionTokenPhase(current);
    setGame(opened);
    const aliveCount = opened.players.filter((p) => p.isAlive).length;
    const endsAt = opened.tokenWindowEndsAt ?? Date.now();
    const duration = Math.max(0, endsAt - Date.now());
    broadcast(sessionId, {
      type: 'S2C_TOKEN_PHASE_STARTED',
      payload: { endsAt, duration, aliveCount, round: opened.currentRound },
    });
    const handle = setTimeout(() => {
      tokenTimers.delete(sessionId);
      try {
        fireTokenResolution(sessionId);
      } catch (e) {
        console.error('Suspicion Token auto-resolve error:', e);
      }
    }, duration);
    tokenTimers.set(sessionId, handle);
  }

  /**
   * Open the booth: broadcast S2C_CONFESSION_PHASE_STARTED and schedule
   * the 60s timeout. Caller must have already broadcast
   * S2C_ROUNDTABLE_STARTED and persisted the booth-initialised state.
   */
  function beginConfessionBooth(sessionId: string, current: GameState): void {
    clearConfessionTimer(sessionId);
    const aliveCount = current.players.filter((p) => p.isAlive).length;
    const endsAt = current.confessionWindowEndsAt ?? Date.now();
    const duration = Math.max(0, endsAt - Date.now());
    broadcast(sessionId, {
      type: 'S2C_CONFESSION_PHASE_STARTED',
      payload: { endsAt, duration, aliveCount },
    });
    const handle = setTimeout(() => {
      confessionTimers.delete(sessionId);
      try {
        fireConfessionResolution(sessionId);
      } catch (e) {
        console.error('Confession booth auto-resolve error:', e);
      }
    }, duration);
    confessionTimers.set(sessionId, handle);
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

        const reconnectedGame = {
          ...gameState,
          players: gameState.players.map((p) =>
            p.id === currentPlayerId ? { ...p, isConnected: true } : p
          )
        };
        const slotResult = game.ensureAvatarSlotForReconnect(reconnectedGame, currentPlayerId);
        const updatedGame = slotResult.game;
        setGame(updatedGame);
        if (slotResult.changed) {
          broadcastPerRecipient(currentSessionId, (recipientId) => ({
            type: 'S2C_AVATAR_UPDATED',
            payload: { players: scrubPlayersForRecipient(updatedGame.players, recipientId) }
          }));
        }

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
        const remainingFaithful = updatedGame.players.filter((p) => p.isAlive && game.isFaithfulRole(p.role)).length;

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
          history: game.scrubHistoryForLive(updatedGame.history, updatedGame.phase),
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

        // Project the whisper log for this reconnecting player. During live
        // play only the recipient sees `content`; once the game has ended
        // every player gets the full body (post-game replay contract).
        reconnectPayload.whispers = game.scrubWhispersForRecipient(
          updatedGame.whispers,
          currentPlayerId,
          updatedGame.phase === 'GAME_END'
        );

        // Wave 4 / 3 — Hydrate false-evidence traitor-only state on
        // reconnect so a returning Traitor sees the active window and
        // prior tally, and is correctly locked out if the ability is
        // already spent. Non-traitors get nothing here.
        if (player.isAlive && player.role === 'TRAITOR') {
          if (updatedGame.evidenceVotes !== undefined) {
            reconnectPayload.evidenceVotes = updatedGame.evidenceVotes;
            const progress = game.getEvidenceVoteProgress(updatedGame);
            reconnectPayload.evidenceVoteProgress = progress;
          }
          if (updatedGame.evidenceWindowEndsAt !== undefined) {
            reconnectPayload.evidenceWindowEndsAt = updatedGame.evidenceWindowEndsAt;
          }
          if (updatedGame.evidenceUsed !== undefined) {
            reconnectPayload.evidenceUsed = updatedGame.evidenceUsed;
          }
          if (updatedGame.falseEvidence !== undefined) {
            reconnectPayload.falseEvidence = updatedGame.falseEvidence;
          }
        }

        // Hydrate Confession Booth state on reconnect so a
        // returning alive player sees the open booth (with their submitted
        // flag) or the freshly revealed cards. Public fields only — never
        // ship `confessionEntries` (carries playerIds).
        if (updatedGame.phase === 'ROUNDTABLE') {
          if (updatedGame.confessionPhase !== undefined) {
            reconnectPayload.confessionPhase = updatedGame.confessionPhase;
          }
          if (updatedGame.confessionRevealed !== undefined) {
            reconnectPayload.confessionRevealed = updatedGame.confessionRevealed;
          }
          if (updatedGame.confessionWindowEndsAt !== undefined) {
            reconnectPayload.confessionWindowEndsAt = updatedGame.confessionWindowEndsAt;
          }
          const aliveCount = updatedGame.players.filter((p) => p.isAlive).length;
          const submittedCount = (updatedGame.confessionSubmittedIds ?? []).length;
          reconnectPayload.confessionTotalCount = aliveCount;
          reconnectPayload.confessionSubmittedCount = submittedCount;
          reconnectPayload.confessionMySubmitted =
            (updatedGame.confessionSubmittedIds ?? []).includes(currentPlayerId);

          // Suspicion Token sub-phase rehydration. During
          // PLACEMENT we never broadcast individual placements (privacy),
          // so we only ship counts + the caller's own pick. On REVEAL we
          // ship the full current-round graph. The byRound archive is
          // always shipped so the in-game history panel can render past
          // rounds' graphs after a mid-game reconnect.
          if (updatedGame.tokenPhase !== undefined) {
            reconnectPayload.tokenPhase = updatedGame.tokenPhase;
            const tokenAlive = updatedGame.players.filter((p) => p.isAlive).length;
            const tokenSubmitted = (updatedGame.tokensSubmittedIds ?? []).length;
            reconnectPayload.tokenTotalCount = tokenAlive;
            reconnectPayload.tokenSubmittedCount = tokenSubmitted;
            if (updatedGame.tokenWindowEndsAt !== undefined) {
              reconnectPayload.tokenWindowEndsAt = updatedGame.tokenWindowEndsAt;
            }
            if (updatedGame.tokenRevealEndsAt !== undefined) {
              reconnectPayload.tokenRevealEndsAt = updatedGame.tokenRevealEndsAt;
            }
            if (updatedGame.tokenPhase === 'PLACEMENT') {
              const mine = (updatedGame.suspicionTokensCurrent ?? []).find(
                (t) => t.placerId === currentPlayerId,
              );
              if (mine) reconnectPayload.myTokenTargetId = mine.targetId;
            } else {
              // REVEAL — full graph is public.
              reconnectPayload.suspicionTokensCurrent =
                updatedGame.suspicionTokensCurrent ?? [];
            }
          }
          if (updatedGame.suspicionTokensByRound !== undefined) {
            reconnectPayload.suspicionTokensByRound = updatedGame.suspicionTokensByRound;
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
        const roundtableGame = game.startRoundtable(gameState);

        // Wave 4 / 3 — consume any pending FalseEvidence at the start of
        // the new Roundtable. FRAME -> forceSuspiciousIds; WHISPER_FAB ->
        // public-meta whisper broadcast (no recipient delivery, content
        // stays on the persisted whisper for post-game replay).
        const activation = game.activateFalseEvidence(roundtableGame);
        let updatedGame = activation.game;
        setGame(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_ROUNDTABLE_STARTED',
          payload: { phase: 'ROUNDTABLE', currentRound: updatedGame.currentRound }
        });

        if (activation.fabricatedWhisper) {
          // Public meta only — never send S2C_WHISPER_RECEIVED (which would
          // tip the framed "recipient" off that they're being framed).
          const fanout = game.buildWhisperFanout(activation.fabricatedWhisper);
          broadcast(currentSessionId, {
            type: 'S2C_WHISPER_SENT',
            payload: fanout.broadcast,
          });
        }

        // open Confession Booth before discussion timer.
        beginConfessionBooth(currentSessionId, updatedGame);
        return;
      }

      if (event.type === 'C2S_SUBMIT_CONFESSION') {
        let after: GameState;
        try {
          after = game.submitConfession(gameState, currentPlayerId, event.payload.content);
        } catch (err) {
          if (err instanceof game.ConfessionError) {
            sendError(ws, err.message);
          } else {
            sendError(ws, (err as Error).message);
          }
          return;
        }
        setGame(after);

        const aliveIds = after.players.filter((p) => p.isAlive).map((p) => p.id);
        const received = (after.confessionSubmittedIds ?? []).length;
        const needed = aliveIds.length;

        broadcast(currentSessionId, {
          type: 'S2C_CONFESSION_SUBMITTED',
          payload: { received, needed },
        });

        if (game.allAliveConfessed(after)) {
          // Early-resolve: every alive player has confessed.
          fireConfessionResolution(currentSessionId);
        }
        return;
      }

      if (event.type === 'C2S_CAST_EVIDENCE_VOTE') {
        // Wave 4 / 3 — only alive Traitors can plant during NIGHT.
        let voted: GameState;
        try {
          voted = game.castEvidenceVote(
            gameState,
            currentPlayerId,
            event.payload.voteType,
            event.payload.targetId,
            event.payload.content,
          );
        } catch (err) {
          sendError(ws, (err as Error).message);
          return;
        }

        const resolution = game.resolveEvidenceVotes(voted);
        const finalState = resolution.game;
        setGame(finalState);

        const traitorSocketsFor = (state: GameState): WebSocket[] =>
          state.players
            .filter((p) => p.isAlive && p.role === 'TRAITOR')
            .map((p) => playerConnections.get(p.id))
            .filter((s): s is WebSocket => !!s && s.readyState === WebSocket.OPEN);

        const traitorSockets = traitorSocketsFor(finalState);

        const progress = game.getEvidenceVoteProgress(
          resolution.outcome === 'PENDING' ? finalState : voted
        );
        const stateForVotes = resolution.outcome === 'PENDING' ? finalState : voted;
        const tallyMsg: S2CEvent = {
          type: 'S2C_EVIDENCE_VOTE_CAST',
          payload: {
            votes: stateForVotes.evidenceVotes ?? [],
            received: progress.received,
            needed: progress.needed,
            ...(stateForVotes.evidenceWindowEndsAt !== undefined
              ? { windowEndsAt: stateForVotes.evidenceWindowEndsAt }
              : {}),
          },
        };
        for (const sock of traitorSockets) sock.send(JSON.stringify(tallyMsg));

        if (resolution.outcome === 'PLANTED' && resolution.evidence) {
          clearEvidenceTimer(currentSessionId);
          const msg: S2CEvent = {
            type: 'S2C_EVIDENCE_PLANTED',
            payload: { evidence: resolution.evidence },
          };
          for (const sock of traitorSockets) sock.send(JSON.stringify(msg));
        } else if (resolution.outcome === 'SKIPPED' || resolution.outcome === 'NO_AGREEMENT') {
          clearEvidenceTimer(currentSessionId);
          const msg: S2CEvent = {
            type: 'S2C_EVIDENCE_FAILED',
            payload: { reason: resolution.outcome },
          };
          for (const sock of traitorSockets) sock.send(JSON.stringify(msg));
        } else if (
          resolution.outcome === 'PENDING' &&
          finalState.evidenceWindowEndsAt !== undefined &&
          currentSessionId !== undefined &&
          !evidenceWindowTimers.has(currentSessionId)
        ) {
          // Schedule the one-shot timeout the first time the window opens.
          const sessionId = currentSessionId;
          const fireIn = Math.max(0, finalState.evidenceWindowEndsAt - Date.now());
          const handle = setTimeout(() => {
            evidenceWindowTimers.delete(sessionId);
            const current = games.get(sessionId);
            if (!current) return;
            const failed = game.forceFailEvidenceWindow(current);
            if (failed.outcome !== 'TIMEOUT') return;
            setGame(failed.game);
            const sockets = traitorSocketsFor(failed.game);
            const failMsg: S2CEvent = {
              type: 'S2C_EVIDENCE_FAILED',
              payload: { reason: 'TIMEOUT' },
            };
            for (const sock of sockets) sock.send(JSON.stringify(failMsg));
          }, fireIn);
          evidenceWindowTimers.set(sessionId, handle);
        }
        return;
      }

      if (event.type === 'C2S_START_VOTING') {
        // host has ended discussion. Open the public 45s
        // Suspicion Token sub-phase BEFORE voting starts. The reveal
        // hold + voting timer are scheduled by `fireTokenResolution` /
        // `proceedToVotingFromTokens` (not here).
        const startingPlayer = gameState.players.find((p) => p.id === currentPlayerId);
        if (!startingPlayer?.isHost) {
          sendError(ws, 'Only the host can start voting');
          return;
        }
        if (gameState.phase !== 'ROUNDTABLE') {
          sendError(ws, 'Can only start voting from Roundtable');
          return;
        }
        // Confession Booth must have moved past BOOTH before suspicion
        // tokens open. The token sub-phase belongs strictly between
        // discussion-end and voting; opening it during BOOTH would let
        // the booth timer be skipped via `proceedToVotingFromTokens`.
        if (gameState.confessionPhase === 'BOOTH') {
          sendError(ws, 'Confession Booth must finish before voting');
          return;
        }
        if (gameState.tokenPhase !== undefined) {
          // Already in PLACEMENT or REVEAL — idempotent no-op.
          return;
        }
        beginTokenPlacement(currentSessionId, gameState);
        return;
      }

      if (event.type === 'C2S_PLACE_SUSPICION_TOKEN') {
        let after: GameState;
        try {
          after = game.placeSuspicionToken(gameState, currentPlayerId, event.payload.targetId);
        } catch (err) {
          if (err instanceof game.SuspicionTokenError) {
            ws.send(JSON.stringify({
              type: 'S2C_TOKEN_ERROR',
              payload: { code: err.code, message: err.message },
            } satisfies S2CEvent));
          } else {
            sendError(ws, (err as Error).message);
          }
          return;
        }
        setGame(after);

        // Private echo to the placer so their UI locks in immediately —
        // even if the public broadcast loses ordering with their tab.
        ws.send(JSON.stringify({
          type: 'S2C_TOKEN_PLACED_PRIVATE',
          payload: { targetId: event.payload.targetId },
        } satisfies S2CEvent));

        const aliveIds = after.players.filter((p) => p.isAlive).map((p) => p.id);
        const received = (after.tokensSubmittedIds ?? []).length;
        const needed = aliveIds.length;
        broadcast(currentSessionId, {
          type: 'S2C_TOKEN_PLACED',
          payload: { received, needed },
        });

        // Intentionally do NOT early-resolve once all alive players
        // have placed: the 45s window must stay open so anyone can
        // change their pick (upsert) up until tokenWindowEndsAt.
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
          const aliveFaithful = updatedGame.players.filter((p) => p.isAlive && game.isFaithfulRole(p.role)).length;

          broadcast(currentSessionId, {
            type: 'S2C_GAME_END',
            payload: {
              winner: updatedGame.winner,
              phase: 'GAME_END',
              remainingTraitors: aliveTraitors,
              remainingFaithful: aliveFaithful,
              history: updatedGame.history,
              whispers: updatedGame.whispers ?? [],
              ...(updatedGame.falseEvidence ? { falseEvidence: updatedGame.falseEvidence } : {}),
            }
          });
        } else {
          broadcast(currentSessionId, {
            type: 'S2C_CONTINUE_GAME',
            payload: { phase: updatedGame.phase, currentRound: updatedGame.currentRound }
          });

          if (updatedGame.phase === 'ROUNDTABLE') {
            // booth gates the discussion timer.
            beginConfessionBooth(currentSessionId, updatedGame);
          }
        }
        return;
      }

      if (event.type === 'C2S_START_NIGHT') {
        // Wave 4 / 3 — drop any stale evidence-window timer from a prior
        // night so we never fire after the round has rolled over.
        clearEvidenceTimer(currentSessionId);
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
            setGame(result.game);

            broadcastRecruitmentEvents(result, result.game, playerConnections);

            if (result.blocked) {
              const isShieldBlock = result.shieldedPlayerId !== undefined;
              broadcastMorningEventWithRecruitment(
                'S2C_MORNING_STARTED',
                isShieldBlock
                  ? {
                      phase: 'MORNING',
                      murderBlocked: true,
                      shieldedPlayerId: result.shieldedPlayerId,
                      shieldedPlayerName: result.shieldedPlayerName,
                    }
                  : {
                      // Wave 4 — Medic silent block. The Traitors voted, the
                      // strike was attempted, but the target survived. We
                      // surface a generic survival announcement WITHOUT
                      // revealing the target's identity (which would out
                      // the Medic's pick).
                      phase: 'MORNING',
                      murderBlocked: true,
                      medicBlocked: true,
                    },
                result.recruitedPlayerId,
                result.recruitedPlayerName,
                result.game,
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
                result.game,
                playerConnections
              );
            }
            // Sheriff investigations resolve overnight regardless of
            // whether the kill landed, was shielded, or was Medic-blocked.
            broadcastSheriffResults(currentSessionId, games, playerConnections, setGame);
          } catch (err) {
            console.error('Error auto-resolving murder:', err);
          }
        }
        return;
      }

      if (event.type === 'C2S_RESOLVE_MURDER') {
        const result = game.resolveMurder(gameState);
        setGame(result.game);

        broadcastRecruitmentEvents(result, result.game, playerConnections);

        if (result.blocked) {
          const isShieldBlock = result.shieldedPlayerId !== undefined;
          broadcastMorningEventWithRecruitment(
            'S2C_MORNING_STARTED',
            isShieldBlock
              ? {
                  phase: 'MORNING',
                  murderBlocked: true,
                  shieldedPlayerId: result.shieldedPlayerId,
                  shieldedPlayerName: result.shieldedPlayerName,
                }
              : {
                  // Wave 4 — Medic silent block. See the auto-resolve branch
                  // above for the rationale: announce a failed strike but
                  // not the protected identity.
                  phase: 'MORNING',
                  murderBlocked: true,
                  medicBlocked: true,
                },
            result.recruitedPlayerId,
            result.recruitedPlayerName,
            result.game,
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
            result.game,
            playerConnections
          );
        }
        broadcastSheriffResults(currentSessionId, games, playerConnections, setGame);
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
        broadcastSheriffResults(currentSessionId, games, playerConnections, setGame);
        return;
      }

      if (event.type === 'C2S_MEDIC_PROTECT') {
        let updatedGame: GameState;
        try {
          updatedGame = game.submitMedicProtect(gameState, currentPlayerId, event.payload.targetId);
        } catch (err) {
          sendError(ws, (err as Error).message);
          return;
        }
        setGame(updatedGame);
        const target = updatedGame.players.find((p) => p.id === event.payload.targetId);
        ws.send(JSON.stringify({
          type: 'S2C_MEDIC_PROTECTED',
          payload: {
            targetId: event.payload.targetId,
            targetName: target?.name ?? 'Unknown',
          }
        } satisfies S2CEvent));
        return;
      }

      if (event.type === 'C2S_ACTIVATE_SEER') {
        let result;
        try {
          // Per spec the target is RANDOM and chosen by the server.
          result = game.activateSeer(gameState, currentPlayerId);
        } catch (err) {
          sendError(ws, (err as Error).message);
          return;
        }
        setGame(result.game);

        // Tell the Seer the true role.
        ws.send(JSON.stringify({
          type: 'S2C_SEER_RESULT',
          payload: {
            targetId: result.targetId,
            targetName: result.targetName,
            actualRole: result.actualRole,
          }
        } satisfies S2CEvent));

        // Alert all alive Traitors that the Seer's gift was burned.
        for (const tid of result.traitorIds) {
          const sock = playerConnections.get(tid);
          if (sock && sock.readyState === WebSocket.OPEN) {
            sock.send(JSON.stringify({
              type: 'S2C_SEER_ACTIVATED',
              payload: {}
            } satisfies S2CEvent));
          }
        }
        return;
      }

      if (event.type === 'C2S_CONTINUE_TO_DAY') {
        let updatedGame = game.continueToDayPhase(gameState);
        // Wave 4 / 3 — when challenges are disabled, MORNING flows directly
        // into ROUNDTABLE. Activate any planted FalseEvidence here so
        // ANONYMOUS_TIP/WHISPER_FABRICATION fire for this loop too.
        if (updatedGame.phase === 'ROUNDTABLE') {
          const activation = game.activateFalseEvidence(updatedGame);
          updatedGame = activation.game;
          if (activation.fabricatedWhisper) {
            const fanout = game.buildWhisperFanout(activation.fabricatedWhisper);
            broadcast(currentSessionId, {
              type: 'S2C_WHISPER_SENT',
              payload: fanout.broadcast,
            });
          }
        }
        setGame(updatedGame);

        if (updatedGame.phase === 'GAME_END' && updatedGame.winner) {

          writeGameRecordIfNeeded(updatedGame);

          const aliveTraitors = updatedGame.players.filter((p) => p.isAlive && p.role === 'TRAITOR').length;
          const aliveFaithful = updatedGame.players.filter((p) => p.isAlive && game.isFaithfulRole(p.role)).length;

          broadcast(currentSessionId, {
            type: 'S2C_GAME_END',
            payload: {
              winner: updatedGame.winner,
              phase: 'GAME_END',
              remainingTraitors: aliveTraitors,
              remainingFaithful: aliveFaithful,
              history: updatedGame.history,
              whispers: updatedGame.whispers ?? [],
              ...(updatedGame.falseEvidence ? { falseEvidence: updatedGame.falseEvidence } : {}),
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
          if (updatedGame.phase === 'ROUNDTABLE') {
            // challenges-disabled path also opens the booth.
            broadcast(currentSessionId, {
              type: 'S2C_ROUNDTABLE_STARTED',
              payload: { phase: 'ROUNDTABLE', currentRound: updatedGame.currentRound }
            });
            beginConfessionBooth(currentSessionId, updatedGame);
          }
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
        const continueGame = game.continueToRoundtable(gameState);
        // Wave 4 / 3 — Roundtable entered via the CHALLENGE branch must
        // also consume any planted FalseEvidence.
        const activation = game.activateFalseEvidence(continueGame);
        const updatedGame = activation.game;
        setGame(updatedGame);

        broadcast(currentSessionId, {
          type: 'S2C_ROUNDTABLE_STARTED',
          payload: { phase: 'ROUNDTABLE', currentRound: updatedGame.currentRound }
        });

        if (activation.fabricatedWhisper) {
          const fanout = game.buildWhisperFanout(activation.fabricatedWhisper);
          broadcast(currentSessionId, {
            type: 'S2C_WHISPER_SENT',
            payload: fanout.broadcast,
          });
        }

        // booth gates the discussion timer.
        beginConfessionBooth(currentSessionId, updatedGame);
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

      if (event.type === 'C2S_SUBMIT_RECRUITMENT') {
        const updatedGame = game.submitRecruitment(gameState, currentPlayerId, event.payload.targetId);
        setGame(updatedGame);

        const recruiter = updatedGame.players.find((p) => p.id === currentPlayerId);
        const target = updatedGame.players.find((p) => p.id === event.payload.targetId);

        updatedGame.players.forEach((p) => {
          if (p.role === 'TRAITOR' && p.isAlive) {
            const connection = playerConnections.get(p.id);
            if (connection && connection.readyState === WebSocket.OPEN && recruiter && target) {
              connection.send(JSON.stringify({
                type: 'S2C_RECRUITMENT_SUBMITTED',
                payload: {
                  recruiterId: currentPlayerId,
                  recruiterName: recruiter.name,
                  targetId: target.id,
                  targetName: target.name,
                }
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
        if (!HOST_MGMT_SAFE_PHASES.has(gameState.phase)) {
          sendError(ws, 'Host actions are only available in the lobby or after morning resolves.');
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
        if (target.isConnected === false) {
          sendError(ws, 'Cannot transfer host to a disconnected player');
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

      if (event.type === 'C2S_REMOVE_PLAYER') {
        const currentPlayer = gameState.players.find((p) => p.id === currentPlayerId);
        if (!currentPlayer?.isHost) {
          sendError(ws, 'Only the host can remove a player');
          return;
        }
        if (!HOST_MGMT_SAFE_PHASES.has(gameState.phase)) {
          sendError(ws, 'Host actions are only available in the lobby or after morning resolves.');
          return;
        }
        const targetId = event.payload.targetPlayerId;
        if (targetId === currentPlayerId) {
          sendError(ws, 'Use Transfer Host before removing yourself');
          return;
        }
        const target = gameState.players.find((p) => p.id === targetId);
        if (!target) {
          sendError(ws, 'Target player not found');
          return;
        }

        let result;
        try {
          result = game.removePlayer(gameState, targetId);
        } catch (err) {
          sendError(ws, (err as Error).message);
          return;
        }
        const updatedGame = result.game;
        setGame(updatedGame);

        // Notify the removed player privately, then close their socket
        // and tear down their session token + any pending grace-period
        // disconnection record so they can't auto-reconnect into the
        // game they were just removed from.
        const removedSocket = playerConnections.get(targetId);
        if (removedSocket) {
          // Mark this close as an intentional host removal so the
          // socket's generic close handler skips the standard
          // S2C_PLAYER_DISCONNECTED broadcast and grace-period setup.
          (removedSocket as unknown as { __hostRemoved?: boolean }).__hostRemoved = true;
          if (removedSocket.readyState === WebSocket.OPEN) {
            try {
              removedSocket.send(JSON.stringify({
                type: 'S2C_YOU_WERE_REMOVED',
                payload: {
                  reason: 'HOST_REMOVED',
                  message: 'The host removed you from the game.',
                }
              } satisfies S2CEvent));
            } catch {
              // Ignore send failures — we're closing the socket regardless.
            }
            try { removedSocket.close(); } catch { /* ignore */ }
          }
        }
        playerConnections.delete(targetId);
        for (const [token, data] of Array.from(sessionTokens.entries())) {
          if (data.playerId === targetId && data.sessionId === currentSessionId) {
            removeToken(token);
            disconnectedPlayers.delete(token);
          }
        }

        const removalPayload: {
          removedPlayerId: string;
          removedPlayerName: string;
          players: typeof updatedGame.players;
          newHostId?: string;
        } = {
          removedPlayerId: target.id,
          removedPlayerName: target.name,
          players: updatedGame.players,
        };
        if (result.newHostId !== undefined) removalPayload.newHostId = result.newHostId;

        broadcastPerRecipient(currentSessionId, (recipientId) => ({
          type: 'S2C_PLAYER_REMOVED',
          payload: {
            ...removalPayload,
            players: scrubPlayersForRecipient(updatedGame.players, recipientId),
          },
        }));

        if (result.hostChanged && result.newHostId) {
          const newHost = updatedGame.players.find((p) => p.id === result.newHostId);
          if (newHost) {
            broadcast(currentSessionId, {
              type: 'S2C_HOST_TRANSFERRED',
              payload: {
                newHostId: newHost.id,
                newHostName: newHost.name,
                players: updatedGame.players,
              },
            });
          }
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
        const aliveFaithful = updatedGame.players.filter((p) => p.isAlive && game.isFaithfulRole(p.role)).length;
        broadcast(currentSessionId, {
          type: 'S2C_GAME_END',
          payload: {
            phase: 'GAME_END',
            remainingTraitors: aliveTraitors,
            remainingFaithful: aliveFaithful,
            history: updatedGame.history,
            reason: 'HOST_ENDED',
            whispers: updatedGame.whispers ?? [],
            ...(updatedGame.falseEvidence ? { falseEvidence: updatedGame.falseEvidence } : {}),
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

      if (event.type === 'C2S_SEND_WHISPER') {
        // Public meta-only fanout, private content to the recipient,
        // typed error back to the sender on validation failure.
        let result;
        try {
          result = game.sendWhisper(
            gameState,
            currentPlayerId,
            event.payload.recipientId,
            event.payload.content
          );
        } catch (err) {
          if (err instanceof game.WhisperError) {
            ws.send(JSON.stringify({
              type: 'S2C_WHISPER_ERROR',
              payload: { code: err.code, message: err.message }
            } satisfies S2CEvent));
          } else {
            sendError(ws, (err as Error).message);
          }
          return;
        }
        setGame(result.game);

        const fanout = game.buildWhisperFanout(result.whisper);
        broadcast(currentSessionId, { type: 'S2C_WHISPER_SENT', payload: fanout.broadcast });

        const recipientSocket = playerConnections.get(fanout.privateRecipientId);
        if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
          recipientSocket.send(JSON.stringify({
            type: 'S2C_WHISPER_RECEIVED',
            payload: fanout.privateForRecipient,
          } satisfies S2CEvent));
        }
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

      // The host-remove handler tears state down and broadcasts
      // S2C_PLAYER_REMOVED itself; skip the generic disconnect path so
      // we don't broadcast a stale S2C_PLAYER_DISCONNECTED for a
      // player who no longer exists.
      if ((ws as unknown as { __hostRemoved?: boolean }).__hostRemoved) {
        return;
      }

      const gameState = games.get(currentSessionId);
      if (gameState) {
        // Keep the disconnected player's stored color/avatar on the
        // record so they can resume with it if it's still free on
        // reconnect. The lobby treats disconnected players as not
        // holding their slot (see Lobby.tsx + addPlayer / setAvatar).
        let updatedGame = {
          ...gameState,
          players: gameState.players.map((p) =>
            p.id === currentPlayerId ? { ...p, isConnected: false } : p
          )
        };
        const wasInLobby = updatedGame.phase === 'LOBBY';

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
          // Wave 4 / 3 — drop the evidence-window timer along with any
          // other per-session timers so a stale callback can't fire after
          // the game record is gone.
          cleanupSessionTimers(currentSessionId);
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
        // In the LOBBY, also broadcast an explicit avatar-updated
        // event so color pickers refresh and the freed slot becomes
        // immediately clickable for the remaining players.
        if (wasInLobby) {
          broadcastPerRecipient(currentSessionId, (recipientId) => ({
            type: 'S2C_AVATAR_UPDATED',
            payload: { players: scrubPlayersForRecipient(updatedGame.players, recipientId) }
          }));
        }
      }
    }
  });
}

