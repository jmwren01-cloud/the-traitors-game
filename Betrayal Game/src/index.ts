// WebSocket Server & Event Handlers

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import * as game from './game/manager.js';
import type { GameState, C2SEvent, S2CEvent } from './game/types.js';

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

        const response: S2CEvent = {
          type: 'S2C_GAME_CREATED',
          payload: {
            sessionId: gameState.sessionId,
            playerId: currentPlayerId,
            playerName: event.payload.playerName
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

        const joinResponse: S2CEvent = {
          type: 'S2C_GAME_JOINED',
          payload: {
            sessionId: event.payload.sessionId,
            playerId: playerId,
            playerName: event.payload.playerName,
            players: updatedGame.players
          }
        };
        ws.send(JSON.stringify(joinResponse));

        broadcastToSession(event.payload.sessionId, {
          type: 'S2C_PLAYER_JOINED',
          payload: { players: updatedGame.players }
        });
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

      if (event.type === 'C2S_START_GAME') {
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
          payload: { phase: 'ROUNDTABLE' }
        });

        const timer = game.createTimer('ROUNDTABLE');
        if (timer) {
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

        const timer = game.createTimer('VOTING');
        if (timer) {
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

        const timer = game.createTimer('VOTING');
        if (timer) {
          broadcastToSession(currentSessionId, {
            type: 'S2C_TIMER_UPDATE',
            payload: { endTime: timer.endTime, duration: timer.duration, phase: 'REVOTE' }
          });
        }
        return;
      }

      if (event.type === 'C2S_SUBMIT_VOTE') {
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
              remainingFaithful: aliveFaithful
            }
          });
        } else {
          broadcastToSession(currentSessionId, {
            type: 'S2C_CONTINUE_GAME',
            payload: { phase: updatedGame.phase, currentRound: updatedGame.currentRound }
          });

          if (updatedGame.phase === 'ROUNDTABLE') {
            const timer = game.createTimer('ROUNDTABLE');
            if (timer) {
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

        const timer = game.createTimer('NIGHT');
        if (timer) {
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
        return;
      }

      if (event.type === 'C2S_RESOLVE_MURDER') {
        const updatedGame = game.resolveMurder(gameState);
        games.set(currentSessionId, updatedGame);
        
        const murderedPlayer = updatedGame.players.find((p) => p.id === updatedGame.lastMurderedPlayerId);
        if (murderedPlayer) {
          broadcastToSession(currentSessionId, {
            type: 'S2C_MURDER_RESOLVED',
            payload: {
              murderedPlayerId: murderedPlayer.id,
              murderedPlayerName: murderedPlayer.name,
              phase: 'MORNING'
            }
          });
        }
        return;
      }

      if (event.type === 'C2S_START_MORNING') {
        const updatedGame = game.startMorning(gameState);
        games.set(currentSessionId, updatedGame);
        
        const murderedPlayer = updatedGame.players.find((p) => p.id === updatedGame.lastMurderedPlayerId);
        
        if (murderedPlayer) {
          broadcastToSession(currentSessionId, {
            type: 'S2C_MORNING_STARTED',
            payload: {
              phase: 'MORNING',
              lastMurderedPlayerId: murderedPlayer.id,
              lastMurderedPlayerName: murderedPlayer.name
            }
          });
        } else {
          broadcastToSession(currentSessionId, {
            type: 'S2C_MORNING_STARTED',
            payload: {
              phase: 'MORNING'
            }
          });
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
              remainingFaithful: aliveFaithful
            }
          });
        } else {
          broadcastToSession(currentSessionId, {
            type: 'S2C_CONTINUE_GAME',
            payload: { phase: updatedGame.phase, currentRound: updatedGame.currentRound }
          });
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

        const isTraitorOnly = event.payload.traitorOnly === true && player.role === 'TRAITOR';
        
        const chatMessage = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          playerId: player.id,
          playerName: player.name,
          message,
          timestamp: Date.now(),
          isTraitorOnly
        };

        const updatedGame = {
          ...gameState,
          messages: [...gameState.messages, chatMessage]
        };
        games.set(currentSessionId, updatedGame);

        if (isTraitorOnly) {
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
            
            // Notify all players of host change
            broadcastToSession(currentSessionId, {
              type: 'S2C_PLAYER_JOINED',
              payload: { players: updatedGame.players }
            });
          }
        }

        games.set(currentSessionId, updatedGame);
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
