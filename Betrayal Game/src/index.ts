// WebSocket Server & Event Handlers

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import * as game from './game/manager.js';
import type { GameState, C2SEvent, S2CEvent, ChatMessage } from './game/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 5000;
const CLIENT_DIST = join(__dirname, '..', 'client', 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const httpServer = createServer((req, res) => {
  let filePath = req.url || '/';
  
  if (filePath === '/') {
    filePath = '/index.html';
  }
  
  const fullPath = join(CLIENT_DIST, filePath);
  
  if (existsSync(fullPath) && statSync(fullPath).isFile()) {
    try {
      const content = readFileSync(fullPath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end('Error loading file');
    }
  } else {
    try {
      const indexPath = join(CLIENT_DIST, 'index.html');
      const content = readFileSync(indexPath);
      res.writeHead(200, { 
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

const wss = new WebSocketServer({ server: httpServer });

const games = new Map<string, GameState>();
const playerConnections = new Map<string, WebSocket>();
const activeRevealSequences = new Map<string, NodeJS.Timeout>();

// Session token tracking for reconnection
const sessionTokens = new Map<string, { playerId: string; sessionId: string }>();
const disconnectedPlayers = new Map<string, { playerId: string; sessionId: string; disconnectedAt: number }>();
const GRACE_PERIOD_MS = 60000; // 60 seconds grace period for reconnection

function generateSessionToken(): string {
  return crypto.randomUUID();
}

function cleanupExpiredDisconnections() {
  const now = Date.now();
  for (const [token, data] of disconnectedPlayers.entries()) {
    if (now - data.disconnectedAt > GRACE_PERIOD_MS) {
      disconnectedPlayers.delete(token);
      sessionTokens.delete(token);
      console.log(`Session token expired for player ${data.playerId}`);
    }
  }
}

// Run cleanup every 15 seconds
setInterval(cleanupExpiredDisconnections, 15000);

function broadcastRecruitmentEvents(
  sessionId: string,
  result: game.MurderResult,
  updatedGame: GameState
) {
  if (!result.recruitedPlayerId || !result.recruitedPlayerName) return;

  const newTraitorIds = updatedGame.players
    .filter((p) => p.isAlive && p.role === 'TRAITOR')
    .map((p) => p.id);

  const recruitedSocket = playerConnections.get(result.recruitedPlayerId);
  if (recruitedSocket && recruitedSocket.readyState === WebSocket.OPEN) {
    recruitedSocket.send(JSON.stringify({
      type: 'S2C_YOU_WERE_RECRUITED',
      payload: { traitorIds: newTraitorIds }
    }));
  }

  // All traitors (including the newly recruited player) receive the full picture.
  updatedGame.players.forEach((p) => {
    if (p.role === 'TRAITOR') {
      const socket = playerConnections.get(p.id);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'S2C_PLAYER_RECRUITED',
          payload: {
            newTraitorId: result.recruitedPlayerId!,
            newTraitorName: result.recruitedPlayerName!,
            updatedTraitorIds: newTraitorIds
          }
        }));
      }
    }
  });
}

// Broadcasts a morning event (S2C_MORNING_STARTED or S2C_MURDER_RESOLVED) with
// role-scoped recruitment info: traitors see full identity, faithful see only a boolean.
function broadcastMorningEventWithRecruitment(
  eventType: 'S2C_MURDER_RESOLVED' | 'S2C_MORNING_STARTED',
  basePayload: Record<string, unknown>,
  recruitedPlayerId: string | undefined,
  recruitedPlayerName: string | undefined,
  updatedGame: GameState
) {
  updatedGame.players.forEach((p) => {
    const socket = playerConnections.get(p.id);
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const recruitPayload = recruitedPlayerId
      ? (p.role === 'TRAITOR'
          ? { recruitedPlayerId, recruitedPlayerName }
          : { recruitmentOccurred: true })
      : {};

    socket.send(JSON.stringify({
      type: eventType,
      payload: { ...basePayload, ...recruitPayload }
    }));
  });
}

function startVoteRevealSequence(sessionId: string) {
  if (activeRevealSequences.has(sessionId)) {
    return;
  }
  
  const gameState = games.get(sessionId);
  if (!gameState || gameState.phase !== 'VOTE_REVEAL') {
    return;
  }
  
  const revealOrder = gameState.players
    .filter((p) => p.isAlive)
    .map((p) => p.id);
  
  const votes = [...gameState.votes];
  let revealIndex = 0;
  const currentTally = new Map<string, number>();
  
  broadcastToSession(sessionId, {
    type: 'S2C_VOTE_REVEAL_STARTED',
    payload: {
      phase: 'VOTE_REVEAL',
      revealOrder,
      totalVotes: votes.length
    }
  });
  
  const revealNextVote = () => {
    const currentGameState = games.get(sessionId);
    if (!currentGameState || currentGameState.phase !== 'VOTE_REVEAL') {
      const timeout = activeRevealSequences.get(sessionId);
      if (timeout) clearInterval(timeout);
      activeRevealSequences.delete(sessionId);
      return;
    }
    
    if (revealIndex >= votes.length) {
      const timeout = activeRevealSequences.get(sessionId);
      if (timeout) clearInterval(timeout);
      activeRevealSequences.delete(sessionId);
      
      const finalTally = Array.from(currentTally.entries()).map(([playerId, count]) => {
        const player = currentGameState.players.find((p) => p.id === playerId);
        return {
          playerId,
          playerName: player?.name || 'Unknown',
          voteCount: count
        };
      }).sort((a, b) => b.voteCount - a.voteCount);
      
      broadcastToSession(sessionId, {
        type: 'S2C_VOTE_REVEAL_COMPLETE',
        payload: {
          allVotes: votes,
          finalTally,
          totalVotes: votes.length,
          revealIndex: votes.length,
          phase: 'VOTE_REVEAL'
        }
      });
      return;
    }
    
    const vote = votes[revealIndex];
    if (!vote) {
      revealIndex++;
      return;
    }
    
    currentTally.set(vote.targetId, (currentTally.get(vote.targetId) || 0) + 1);
    
    const voter = currentGameState.players.find((p) => p.id === vote.voterId);
    const target = currentGameState.players.find((p) => p.id === vote.targetId);
    
    const tallyArray = Array.from(currentTally.entries()).map(([playerId, count]) => {
      const player = currentGameState.players.find((p) => p.id === playerId);
      return {
        playerId,
        playerName: player?.name || 'Unknown',
        voteCount: count
      };
    }).sort((a, b) => b.voteCount - a.voteCount);
    
    broadcastToSession(sessionId, {
      type: 'S2C_VOTE_REVEAL_STEP',
      payload: {
        revealIndex,
        vote,
        voterName: voter?.name || 'Unknown',
        targetName: target?.name || 'Unknown',
        currentTally: tallyArray
      }
    });
    
    const updatedGame = {
      ...currentGameState,
      revealIndex: revealIndex + 1,
      revealedVotes: votes.slice(0, revealIndex + 1),
      currentTally: tallyArray
    };
    games.set(sessionId, updatedGame);
    
    revealIndex++;
  };
  
  setTimeout(revealNextVote, 1000);
  
  const interval = setInterval(revealNextVote, 4000);
  activeRevealSequences.set(sessionId, interval);
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Betrayal Game Server running on http://0.0.0.0:${PORT}`);
  console.log(`🔌 WebSocket available at ws://0.0.0.0:${PORT}`);
});

wss.on('connection', (ws: WebSocket) => {
  let currentPlayerId: string | undefined;
  let currentSessionId: string | undefined;

  ws.on('message', (data: string) => {
    try {
      const event: C2SEvent = JSON.parse(data);
      
      if (event.type === 'C2S_CREATE_GAME') {
        const gameState = game.createGame(event.payload.playerName);
        games.set(gameState.sessionId, gameState);
        
        currentPlayerId = gameState.hostId;
        currentSessionId = gameState.sessionId;
        playerConnections.set(currentPlayerId, ws);

        const sessionToken = generateSessionToken();
        sessionTokens.set(sessionToken, { playerId: currentPlayerId, sessionId: currentSessionId });

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
        broadcastToSession(gameState.sessionId, {
          type: 'S2C_PLAYER_JOINED',
          payload: { players: gameState.players }
        });
        return;
      }

      if (event.type === 'C2S_JOIN_GAME') {
        const gameState = games.get(event.payload.sessionId);
        if (!gameState) {
          sendError(ws, 'Game not found');
          return;
        }

        const { game: updatedGame, playerId } = game.addPlayer(gameState, event.payload.playerName);
        games.set(event.payload.sessionId, updatedGame);
        
        currentPlayerId = playerId;
        currentSessionId = event.payload.sessionId;
        playerConnections.set(playerId, ws);

        const sessionToken = generateSessionToken();
        sessionTokens.set(sessionToken, { playerId, sessionId: event.payload.sessionId });

        const joinResponse: S2CEvent = {
          type: 'S2C_GAME_JOINED',
          payload: {
            sessionId: event.payload.sessionId,
            playerId: playerId,
            playerName: event.payload.playerName,
            players: updatedGame.players,
            sessionToken,
            settings: updatedGame.settings
          }
        };
        ws.send(JSON.stringify(joinResponse));

        broadcastToSession(event.payload.sessionId, {
          type: 'S2C_PLAYER_JOINED',
          payload: { players: updatedGame.players }
        });
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
          sessionTokens.delete(event.payload.sessionToken);
          return;
        }

        const player = gameState.players.find((p) => p.id === tokenData.playerId);
        if (!player) {
          sendError(ws, 'Player not found in game');
          sessionTokens.delete(event.payload.sessionToken);
          return;
        }

        // Remove from disconnected tracking
        disconnectedPlayers.delete(event.payload.sessionToken);

        // Restore connection
        currentPlayerId = tokenData.playerId;
        currentSessionId = tokenData.sessionId;
        playerConnections.set(currentPlayerId, ws);

        // Mark player as connected
        const updatedGame = {
          ...gameState,
          players: gameState.players.map((p) =>
            p.id === currentPlayerId ? { ...p, isConnected: true } : p
          )
        };
        games.set(currentSessionId, updatedGame);

        // Get traitor IDs if player is a traitor
        const traitorIds = player.role === 'TRAITOR' ? game.getTraitorIds(updatedGame) : undefined;

        // Get banished player info
        const banishedPlayer = updatedGame.banishedPlayerId 
          ? updatedGame.players.find((p) => p.id === updatedGame.banishedPlayerId)
          : undefined;

        // Get murdered player info
        const murderedPlayer = updatedGame.lastMurderedPlayerId
          ? updatedGame.players.find((p) => p.id === updatedGame.lastMurderedPlayerId)
          : undefined;

        // Get tied player names
        const tiedPlayerNames = updatedGame.tiedPlayerIds?.map((id) => {
          const p = updatedGame.players.find((pl) => pl.id === id);
          return p?.name || 'Unknown';
        });

        // Calculate vote count
        const aliveCount = updatedGame.players.filter((p) => p.isAlive).length;
        const voteCount = updatedGame.phase === 'VOTING' || updatedGame.phase === 'REVOTE'
          ? { received: updatedGame.votes.length, needed: aliveCount }
          : undefined;

        // Calculate murder vote progress
        const aliveTraitors = updatedGame.players.filter((p) => p.isAlive && p.role === 'TRAITOR');
        const murderVoteProgress = updatedGame.phase === 'NIGHT'
          ? { received: updatedGame.murderVotes.length, needed: aliveTraitors.length }
          : undefined;

        // Get win condition counts
        const remainingTraitors = updatedGame.players.filter((p) => p.isAlive && p.role === 'TRAITOR').length;
        const remainingFaithful = updatedGame.players.filter((p) => p.isAlive && p.role === 'FAITHFUL').length;

        // Send full state sync to reconnecting player
        const reconnectResponse: S2CEvent = {
          type: 'S2C_RECONNECTED',
          payload: {
            sessionId: currentSessionId,
            playerId: currentPlayerId,
            playerName: player.name,
            players: updatedGame.players,
            phase: updatedGame.phase,
            role: player.role,
            traitorIds,
            currentRound: updatedGame.currentRound,
            messages: updatedGame.messages,
            votes: updatedGame.votes,
            murderVotes: updatedGame.murderVotes,
            hostId: updatedGame.hostId,
            winner: updatedGame.winner,
            banishedPlayerId: updatedGame.banishedPlayerId,
            banishedPlayerName: banishedPlayer?.name,
            banishedPlayerRole: banishedPlayer?.role,
            lastMurderedPlayerId: updatedGame.lastMurderedPlayerId,
            lastMurderedPlayerName: murderedPlayer?.name,
            timer: updatedGame.timer,
            tiedPlayerIds: updatedGame.tiedPlayerIds,
            tiedPlayerNames,
            voteCount,
            murderVoteProgress,
            aliveTraitorCount: aliveTraitors.length,
            revealIndex: updatedGame.revealIndex,
            revealOrder: updatedGame.revealOrder,
            currentTally: updatedGame.currentTally,
            revealedVotes: updatedGame.revealedVotes,
            remainingTraitors,
            remainingFaithful,
            tiebreakerResults: updatedGame.tiebreakerResults,
            randomlySelectedPlayerId: updatedGame.randomlySelectedPlayerId,
            randomlySelectedPlayerName: updatedGame.randomlySelectedPlayerId 
              ? updatedGame.players.find((p) => p.id === updatedGame.randomlySelectedPlayerId)?.name 
              : undefined,
            randomlySelectedPlayerRole: updatedGame.randomlySelectedPlayerId
              ? updatedGame.players.find((p) => p.id === updatedGame.randomlySelectedPlayerId)?.role
              : undefined,
            totalVotes: updatedGame.votes.length,
            settings: updatedGame.settings,
            history: updatedGame.history
          }
        };
        ws.send(JSON.stringify(reconnectResponse));

        // Notify other players
        broadcastToSession(currentSessionId, {
          type: 'S2C_PLAYER_RECONNECTED',
          payload: { playerId: currentPlayerId, players: updatedGame.players }
        });

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
        games.set(currentSessionId, updatedGame);
        
        broadcastToSession(currentSessionId, {
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
        games.set(currentSessionId, updatedGame);
        
        broadcastToSession(currentSessionId, {
          type: 'S2C_GAME_STARTED',
          payload: { phase: 'ROLE_ASSIGN' }
        });
        return;
      }

      if (event.type === 'C2S_ASSIGN_ROLES') {
        const updatedGame = game.assignRoles(gameState);
        games.set(currentSessionId, updatedGame);
        
        broadcastToSession(currentSessionId, {
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
        games.set(currentSessionId, updatedGame);
        
        broadcastToSession(currentSessionId, {
          type: 'S2C_ROUNDTABLE_STARTED',
          payload: { phase: 'ROUNDTABLE', currentRound: updatedGame.currentRound }
        });

        const timer = game.createTimer('ROUNDTABLE', updatedGame.settings);
        if (timer) {
          const gameWithTimer = { ...updatedGame, timer };
          games.set(currentSessionId, gameWithTimer);
          broadcastToSession(currentSessionId, {
            type: 'S2C_TIMER_UPDATE',
            payload: { endTime: timer.endTime, duration: timer.duration, phase: 'ROUNDTABLE' }
          });
        }
        return;
      }

      if (event.type === 'C2S_START_VOTING') {
        const updatedGame = game.startVoting(gameState);
        games.set(currentSessionId, updatedGame);
        
        broadcastToSession(currentSessionId, {
          type: 'S2C_VOTING_STARTED',
          payload: { phase: 'VOTING' }
        });

        const timer = game.createTimer('VOTING', updatedGame.settings);
        if (timer) {
          const gameWithTimer = { ...updatedGame, timer };
          games.set(currentSessionId, gameWithTimer);
          broadcastToSession(currentSessionId, {
            type: 'S2C_TIMER_UPDATE',
            payload: { endTime: timer.endTime, duration: timer.duration, phase: 'VOTING' }
          });
        }
        return;
      }

      if (event.type === 'C2S_START_REVOTE') {
        const updatedGame = game.startRevote(gameState);
        games.set(currentSessionId, updatedGame);
        
        broadcastToSession(currentSessionId, {
          type: 'S2C_REVOTE_STARTED',
          payload: { tiedPlayerIds: updatedGame.tiedPlayerIds || [], phase: 'REVOTE' }
        });

        const timer = game.createTimer('REVOTE', updatedGame.settings);
        if (timer) {
          const gameWithTimer = { ...updatedGame, timer };
          games.set(currentSessionId, gameWithTimer);
          broadcastToSession(currentSessionId, {
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
        games.set(currentSessionId, updatedGame);
        
        broadcastToSession(currentSessionId, {
          type: 'S2C_VOTE_SUBMITTED',
          payload: { voterId: currentPlayerId }
        });

        const alivePlayerCount = updatedGame.players.filter((p) => p.isAlive).length;
        const voteCount = updatedGame.votes.length;
        
        broadcastToSession(currentSessionId, {
          type: 'S2C_VOTE_COUNT_UPDATE',
          payload: { received: voteCount, needed: alivePlayerCount }
        });

        if (voteCount >= alivePlayerCount) {
          const lockedGame = { ...updatedGame, votingLocked: true };
          const revealedGame = game.revealVotes(lockedGame);
          games.set(currentSessionId, revealedGame);
          
          startVoteRevealSequence(currentSessionId);
        }
        return;
      }

      if (event.type === 'C2S_FORCE_RESOLVE_VOTING') {
        // Host forces voting to complete - generate auto-votes for non-voters
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
        
        // Notify about auto-votes
        for (const autoVote of autoVotes) {
          const voter = gameWithAutoVotes.players.find((p) => p.id === autoVote.voterId);
          broadcastToSession(currentSessionId, {
            type: 'S2C_VOTE_SUBMITTED',
            payload: { voterId: autoVote.voterId, isAutoVote: true, voterName: voter?.name || 'Unknown' }
          });
        }
        
        const alivePlayerCount = gameWithAutoVotes.players.filter((p) => p.isAlive).length;
        broadcastToSession(currentSessionId, {
          type: 'S2C_VOTE_COUNT_UPDATE',
          payload: { received: gameWithAutoVotes.votes.length, needed: alivePlayerCount }
        });
        
        // Lock and reveal votes
        const lockedGame = { ...gameWithAutoVotes, votingLocked: true };
        const revealedGame = game.revealVotes(lockedGame);
        games.set(currentSessionId, revealedGame);
        
        startVoteRevealSequence(currentSessionId);
        return;
      }

      if (event.type === 'C2S_REVEAL_VOTES') {
        const updatedGame = game.revealVotes(gameState);
        games.set(currentSessionId, updatedGame);
        
        broadcastToSession(currentSessionId, {
          type: 'S2C_VOTES_REVEALED',
          payload: { votes: updatedGame.revealedVotes, phase: 'VOTE_REVEAL' }
        });
        return;
      }

      if (event.type === 'C2S_BANISH_PLAYER') {
        const result = game.banishPlayer(gameState);
        games.set(currentSessionId, result.game);
        
        if (result.isTie && result.tiedPlayerIds) {
          const tiedPlayerNames = result.tiedPlayerIds.map((id) => {
            const player = result.game.players.find((p) => p.id === id);
            return player?.name || 'Unknown';
          });
          
          broadcastToSession(currentSessionId, {
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
            return player?.name || 'Unknown';
          }) || [];
          
          if (selectedPlayer && selectedPlayer.role) {
            broadcastToSession(currentSessionId, {
              type: 'S2C_TIEBREAKER_RESOLVED',
              payload: {
                selectedPlayerId: selectedPlayer.id,
                selectedPlayerName: selectedPlayer.name,
                selectedPlayerRole: selectedPlayer.role,
                tiedPlayerIds: result.tiedPlayerIds || [],
                tiedPlayerNames,
                phase: 'TIEBREAKER_REVEAL'
              }
            });
          }
        } else {
          const banishedPlayer = result.game.players.find((p) => p.id === result.game.banishedPlayerId);
          if (banishedPlayer && banishedPlayer.role) {
            broadcastToSession(currentSessionId, {
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
        games.set(currentSessionId, updatedGame);
        
        broadcastToSession(currentSessionId, {
          type: 'S2C_VOTE_SUBMITTED',
          payload: { voterId: currentPlayerId }
        });

        const alivePlayerCount = updatedGame.players.filter((p) => p.isAlive).length;
        const voteCount = updatedGame.votes.length;
        
        broadcastToSession(currentSessionId, {
          type: 'S2C_VOTE_COUNT_UPDATE',
          payload: { received: voteCount, needed: alivePlayerCount }
        });

        if (voteCount >= alivePlayerCount) {
          const revealedGame = game.revealVotes(updatedGame);
          games.set(currentSessionId, revealedGame);
          
          broadcastToSession(currentSessionId, {
            type: 'S2C_VOTES_REVEALED',
            payload: { votes: revealedGame.revealedVotes, phase: 'VOTE_REVEAL' }
          });
        }
        return;
      }

      if (event.type === 'C2S_CHECK_WIN') {
        const updatedGame = game.checkWinCondition(gameState);
        games.set(currentSessionId, updatedGame);

        if (updatedGame.phase === 'GAME_END' && updatedGame.winner) {
          const aliveTraitors = updatedGame.players.filter((p) => p.isAlive && p.role === 'TRAITOR').length;
          const aliveFaithful = updatedGame.players.filter((p) => p.isAlive && p.role === 'FAITHFUL').length;
          
          broadcastToSession(currentSessionId, {
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
          broadcastToSession(currentSessionId, {
            type: 'S2C_CONTINUE_GAME',
            payload: { phase: updatedGame.phase, currentRound: updatedGame.currentRound }
          });

          if (updatedGame.phase === 'ROUNDTABLE') {
            const timer = game.createTimer('ROUNDTABLE', updatedGame.settings);
            if (timer) {
              const gameWithTimer = { ...updatedGame, timer };
              games.set(currentSessionId, gameWithTimer);
              broadcastToSession(currentSessionId, {
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
        games.set(currentSessionId, updatedGame);
        
        const aliveTraitorCount = game.getAliveTraitorCount(updatedGame);
        
        broadcastToSession(currentSessionId, {
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
          games.set(currentSessionId, gameWithTimer);
          broadcastToSession(currentSessionId, {
            type: 'S2C_TIMER_UPDATE',
            payload: { endTime: timer.endTime, duration: timer.duration, phase: 'NIGHT' }
          });
        }
        return;
      }

      if (event.type === 'C2S_SUBMIT_MURDER') {
        const updatedGame = game.submitMurder(gameState, currentPlayerId, event.payload.targetId);
        games.set(currentSessionId, updatedGame);
        
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

        // Auto-resolve murder when all traitors have voted
        if (progress.received >= progress.needed && updatedGame.phase === 'NIGHT') {
          try {
            const result = game.resolveMurder(updatedGame);
            games.set(currentSessionId, result.game);
            
            broadcastRecruitmentEvents(currentSessionId, result, result.game);

            if (result.blocked) {
              broadcastMorningEventWithRecruitment(
                'S2C_MORNING_STARTED',
                {
                  phase: 'MORNING',
                  murderBlocked: true,
                  shieldedPlayerId: result.shieldedPlayerId,
                  shieldedPlayerName: result.shieldedPlayerName,
                },
                result.recruitedPlayerId,
                result.recruitedPlayerName,
                result.game
              );
            } else if (result.murderedPlayerId) {
              broadcastMorningEventWithRecruitment(
                'S2C_MURDER_RESOLVED',
                {
                  murderedPlayerId: result.murderedPlayerId,
                  murderedPlayerName: result.murderedPlayerName!,
                  phase: 'MORNING',
                },
                result.recruitedPlayerId,
                result.recruitedPlayerName,
                result.game
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
        games.set(currentSessionId, result.game);

        broadcastRecruitmentEvents(currentSessionId, result, result.game);

        if (result.blocked) {
          broadcastMorningEventWithRecruitment(
            'S2C_MORNING_STARTED',
            {
              phase: 'MORNING',
              murderBlocked: true,
              shieldedPlayerId: result.shieldedPlayerId,
              shieldedPlayerName: result.shieldedPlayerName,
            },
            result.recruitedPlayerId,
            result.recruitedPlayerName,
            result.game
          );
        } else if (result.murderedPlayerId) {
          broadcastMorningEventWithRecruitment(
            'S2C_MURDER_RESOLVED',
            {
              murderedPlayerId: result.murderedPlayerId,
              murderedPlayerName: result.murderedPlayerName!,
              phase: 'MORNING',
            },
            result.recruitedPlayerId,
            result.recruitedPlayerName,
            result.game
          );
        }
        return;
      }

      if (event.type === 'C2S_START_MORNING') {
        const updatedGame = game.startMorning(gameState);
        games.set(currentSessionId, updatedGame);
        
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
            updatedGame
          );
        } else {
          broadcastMorningEventWithRecruitment(
            'S2C_MORNING_STARTED',
            { phase: 'MORNING' },
            recruitedPlayer?.id,
            recruitedPlayer?.name,
            updatedGame
          );
        }
        return;
      }

      if (event.type === 'C2S_CONTINUE_TO_DAY') {
        const updatedGame = game.continueToDayPhase(gameState);
        games.set(currentSessionId, updatedGame);

        if (updatedGame.phase === 'GAME_END' && updatedGame.winner) {
          const aliveTraitors = updatedGame.players.filter((p) => p.isAlive && p.role === 'TRAITOR').length;
          const aliveFaithful = updatedGame.players.filter((p) => p.isAlive && p.role === 'FAITHFUL').length;
          
          broadcastToSession(currentSessionId, {
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
          // Start challenge phase
          const challengeResult = game.createChallenge(updatedGame);
          games.set(currentSessionId, challengeResult.game);
          
          const challenge = challengeResult.challenge;
          broadcastToSession(currentSessionId, {
            type: 'S2C_CHALLENGE_STARTED',
            payload: {
              phase: 'CHALLENGE',
              challengeType: challenge.type,
              startTime: challenge.startTime,
              targetTime: challenge.targetTime,
              shownPlayerIds: challenge.shownPlayerIds,
              scrambledWord: challenge.scrambledWord
            }
          });

          // For MISSING_PLAYER, send phase update after 3 seconds to hide the player
          if (challenge.type === 'MISSING_PLAYER') {
            setTimeout(() => {
              const currentGame = games.get(currentSessionId);
              if (currentGame?.phase === 'CHALLENGE' && currentGame.challenge?.type === 'MISSING_PLAYER') {
                broadcastToSession(currentSessionId, {
                  type: 'S2C_CHALLENGE_PHASE_UPDATE',
                  payload: {
                    hiddenPlayerId: currentGame.challenge.hiddenPlayerId
                  }
                });
              }
            }, 3000);
          }
        } else {
          broadcastToSession(currentSessionId, {
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
        games.set(currentSessionId, result.game);

        // Notify all players that this player answered
        broadcastToSession(currentSessionId, {
          type: 'S2C_CHALLENGE_ANSWER_RECEIVED',
          payload: { playerId: currentPlayerId }
        });

        // For MISSING_PLAYER or WORD_SCRAMBLE, if there's a winner, resolve immediately
        if (result.isWinner && result.game.challenge) {
          const resolution = game.resolveChallenge(result.game);
          games.set(currentSessionId, resolution.game);

          broadcastToSession(currentSessionId, {
            type: 'S2C_CHALLENGE_RESULT',
            payload: {
              phase: 'CHALLENGE_RESULT',
              winnerId: resolution.winnerId,
              winnerName: resolution.winnerName,
              correctAnswer: resolution.correctAnswer,
              shieldAwarded: resolution.shieldAwarded
            }
          });
        }
        return;
      }

      if (event.type === 'C2S_CONTINUE_TO_ROUNDTABLE') {
        if (gameState.phase !== 'CHALLENGE_RESULT') {
          // Also allow from CHALLENGE for TIME_ESTIMATE resolution
          if (gameState.phase === 'CHALLENGE' && gameState.challenge?.type === 'TIME_ESTIMATE') {
            const resolution = game.resolveChallenge(gameState);
            games.set(currentSessionId, resolution.game);

            broadcastToSession(currentSessionId, {
              type: 'S2C_CHALLENGE_RESULT',
              payload: {
                phase: 'CHALLENGE_RESULT',
                winnerId: resolution.winnerId,
                winnerName: resolution.winnerName,
                correctAnswer: resolution.correctAnswer,
                shieldAwarded: resolution.shieldAwarded
              }
            });
            return;
          }
          sendError(ws, 'Not in challenge result phase');
          return;
        }

        const updatedGame = game.continueToRoundtable(gameState);
        games.set(currentSessionId, updatedGame);

        broadcastToSession(currentSessionId, {
          type: 'S2C_ROUNDTABLE_STARTED',
          payload: { phase: 'ROUNDTABLE', currentRound: updatedGame.currentRound }
        });

        const timer = game.createTimer('ROUNDTABLE', updatedGame.settings);
        if (timer) {
          const gameWithTimer = { ...updatedGame, timer };
          games.set(currentSessionId, gameWithTimer);
          broadcastToSession(currentSessionId, {
            type: 'S2C_TIMER_UPDATE',
            payload: { endTime: timer.endTime, duration: timer.duration, phase: 'ROUNDTABLE' }
          });
        }
        return;
      }

      if (event.type === 'C2S_REVEAL_SHIELD') {
        const updatedGame = game.revealShield(gameState, currentPlayerId);
        games.set(currentSessionId, updatedGame);

        const player = updatedGame.players.find((p) => p.id === currentPlayerId);
        if (player) {
          broadcastToSession(currentSessionId, {
            type: 'S2C_SHIELD_REVEALED',
            payload: { playerId: currentPlayerId, playerName: player.name }
          });
        }
        return;
      }

      if (event.type === 'C2S_SUBMIT_RECRUITMENT') {
        const updatedGame = game.submitRecruitment(gameState, currentPlayerId, event.payload.targetId);
        games.set(currentSessionId, updatedGame);

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

      if (event.type === 'C2S_SET_AVATAR') {
        const updatedGame = game.setAvatar(
          gameState,
          currentPlayerId,
          event.payload.color,
          event.payload.avatar
        );
        games.set(currentSessionId, updatedGame);
        broadcastToSession(currentSessionId, {
          type: 'S2C_AVATAR_UPDATED',
          payload: { players: updatedGame.players }
        });
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

        // Handle both new 'channel' field and legacy 'traitorOnly' field for backward compatibility
        type PayloadType = { message: string; channel?: string; traitorOnly?: boolean };
        const payload = event.payload as PayloadType;
        let requestedChannel: 'general' | 'traitor' = 'general';
        if (payload.channel === 'traitor' || payload.traitorOnly === true) {
          requestedChannel = 'traitor';
        }
        
        // Validate traitor channel access: must be alive traitor
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
        games.set(currentSessionId, updatedGame);

        if (requestedChannel === 'traitor') {
          // Only send to alive traitors
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
          // General channel - send to everyone
          broadcastToSession(currentSessionId, {
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

        // Track disconnection for potential reconnection
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

        // Check if game is now empty
        if (game.isGameEmpty(updatedGame)) {
          games.delete(currentSessionId);
          console.log(`Game ${currentSessionId} deleted - all players disconnected`);
          return;
        }

        // Check if host disconnected and transfer host
        const disconnectedPlayer = gameState.players.find((p) => p.id === currentPlayerId);
        if (disconnectedPlayer?.isHost) {
          const newHostId = game.findNewHost(updatedGame);
          if (newHostId) {
            updatedGame = game.transferHost(updatedGame, newHostId);
            console.log(`Host transferred to ${newHostId} in game ${currentSessionId}`);
          }
        }

        games.set(currentSessionId, updatedGame);

        // Notify other players of disconnect
        broadcastToSession(currentSessionId, {
          type: 'S2C_PLAYER_DISCONNECTED',
          payload: { playerId: currentPlayerId, players: updatedGame.players }
        });
      }
    }
  });
});

function broadcastToSession(sessionId: string, event: S2CEvent) {
  const gameState = games.get(sessionId);
  if (!gameState) return;

  gameState.players.forEach((player) => {
    const connection = playerConnections.get(player.id);
    if (connection && connection.readyState === WebSocket.OPEN) {
      connection.send(JSON.stringify(event));
    }
  });
}

function sendError(ws: WebSocket, message: string) {
  const error: S2CEvent = {
    type: 'S2C_ERROR',
    payload: { message }
  };
  ws.send(JSON.stringify(error));
}
