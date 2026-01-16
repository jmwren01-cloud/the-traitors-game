// WebSocket Server & Event Handlers

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
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
          payload: { phase: 'ROUNDTABLE', currentRound: updatedGame.currentRound }
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

        // Auto-resolve murder when all traitors have voted
        if (progress.received >= progress.needed) {
          const resolvedGame = game.resolveMurder(updatedGame);
          games.set(currentSessionId, resolvedGame);
          
          const murderedPlayer = resolvedGame.players.find((p) => p.id === resolvedGame.lastMurderedPlayerId);
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
        }
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
