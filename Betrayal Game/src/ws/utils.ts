import { WebSocket } from 'ws';
import crypto from 'crypto';
import type { S2CEvent, GameState } from '../game/types.js';
import type { MurderResult } from '../game/manager.js';

export function broadcastToSession(
  sessionId: string,
  event: S2CEvent,
  games: Map<string, GameState>,
  playerConnections: Map<string, WebSocket>
): void {
  const gameState = games.get(sessionId);
  if (!gameState) return;

  gameState.players.forEach((player) => {
    const connection = playerConnections.get(player.id);
    if (connection && connection.readyState === WebSocket.OPEN) {
      connection.send(JSON.stringify(event));
    }
  });
}

export function sendError(ws: WebSocket, message: string): void {
  const error: S2CEvent = {
    type: 'S2C_ERROR',
    payload: { message }
  };
  ws.send(JSON.stringify(error));
}

export function generateSessionToken(): string {
  return crypto.randomUUID();
}

export function cleanupExpiredDisconnections(
  disconnectedPlayers: Map<string, { playerId: string; sessionId: string; disconnectedAt: number }>,
  sessionTokens: Map<string, { playerId: string; sessionId: string }>,
  gracePeriodMs = 60000
): void {
  const now = Date.now();
  for (const [token, data] of disconnectedPlayers.entries()) {
    if (now - data.disconnectedAt > gracePeriodMs) {
      disconnectedPlayers.delete(token);
      sessionTokens.delete(token);
      console.log(`Session token expired for player ${data.playerId}`);
    }
  }
}

export function broadcastRecruitmentEvents(
  result: MurderResult,
  updatedGame: GameState,
  playerConnections: Map<string, WebSocket>
): void {
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

export function broadcastMorningEventWithRecruitment(
  eventType: 'S2C_MURDER_RESOLVED' | 'S2C_MORNING_STARTED',
  basePayload: Record<string, unknown>,
  recruitedPlayerId: string | undefined,
  recruitedPlayerName: string | undefined,
  updatedGame: GameState,
  playerConnections: Map<string, WebSocket>
): void {
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
