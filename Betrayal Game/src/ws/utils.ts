import { WebSocket } from 'ws';
import crypto from 'crypto';
import type { S2CEvent, GameState, Player } from '../game/types.js';
import { performSheriffInvestigation, type MurderResult } from '../game/manager.js';

/**
 * Returns a copy of the players list scrubbed for the given recipient:
 * `hasShield` is preserved only for the recipient themselves and for
 * players whose shield has been publicly revealed. For everyone else
 * `hasShield` is forced to `false` so the field cannot leak via the
 * raw WebSocket payload.
 *
 * `recipientId` may be `undefined` (e.g. broadcasting before a
 * connection has a known player id); in that case no player is
 * treated as "self" and only revealed shields remain visible.
 */
export function scrubPlayersForRecipient(
  players: Player[],
  recipientId: string | undefined
): Player[] {
  return players.map((p) => {
    // Strip server-only fields from every broadcast (deviceToken must never leave the server)
    const { deviceToken: _dt, ...rest } = p;
    const safe = rest as Player;
    const isSelf = recipientId !== undefined && safe.id === recipientId;
    // Special-role private fields would leak the player's role to others —
    // only the recipient themselves should ever see them.
    let scrubbed: Player = safe;
    if (!isSelf) {
      const {
        sheriffInvestigations: _si,
        medicLastProtectedId: _mp,
        seerUsedAtRound: _su,
        ...sanitized
      } = safe;
      scrubbed = sanitized as Player;
    }
    if (!scrubbed.hasShield) return scrubbed;
    if (isSelf) return scrubbed;
    if (scrubbed.shieldRevealed) return scrubbed;
    return { ...scrubbed, hasShield: false };
  });
}

export function broadcastToSession(
  sessionId: string,
  event: S2CEvent,
  games: Map<string, GameState>,
  playerConnections: Map<string, WebSocket>
): void {
  const gameState = games.get(sessionId);
  if (!gameState) return;

  const payload = (event as { payload?: unknown }).payload;
  const hasPlayersArray =
    payload !== null &&
    typeof payload === 'object' &&
    Array.isArray((payload as { players?: unknown }).players);

  gameState.players.forEach((player) => {
    const connection = playerConnections.get(player.id);
    if (!connection || connection.readyState !== WebSocket.OPEN) return;

    let toSend: S2CEvent = event;
    if (hasPlayersArray) {
      const originalPlayers = (payload as { players: Player[] }).players;
      const scrubbed = scrubPlayersForRecipient(originalPlayers, player.id);
      toSend = {
        ...event,
        payload: { ...(payload as object), players: scrubbed },
      } as S2CEvent;
    }
    connection.send(JSON.stringify(toSend));
  });
}

export function broadcastToSessionPerRecipient(
  sessionId: string,
  buildEvent: (recipientId: string) => S2CEvent,
  games: Map<string, GameState>,
  playerConnections: Map<string, WebSocket>
): void {
  const gameState = games.get(sessionId);
  if (!gameState) return;

  gameState.players.forEach((player) => {
    const connection = playerConnections.get(player.id);
    if (connection && connection.readyState === WebSocket.OPEN) {
      connection.send(JSON.stringify(buildEvent(player.id)));
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
  removeToken: (token: string) => void,
  gracePeriodMs = 60000
): void {
  const now = Date.now();
  for (const [token, data] of disconnectedPlayers.entries()) {
    if (now - data.disconnectedAt > gracePeriodMs) {
      disconnectedPlayers.delete(token);
      removeToken(token);
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

/**
 * Runs the SHERIFF morning investigation (if any) and sends a private
 * S2C_SHERIFF_RESULT to the sheriff BEFORE the morning broadcast occurs.
 * Returns the updated game state (with the investigation appended on the
 * sheriff's player object) — the caller MUST persist it via setGame and use
 * the returned state for any subsequent broadcasts so scrubbing stays correct.
 */
export function runSheriffInvestigation(
  game: GameState,
  playerConnections: Map<string, WebSocket>
): GameState {
  const result = performSheriffInvestigation(game);
  if (!result.sheriffId || !result.investigation) return result.game;
  const socket = playerConnections.get(result.sheriffId);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'S2C_SHERIFF_RESULT',
      payload: {
        round: result.investigation.round,
        targetId: result.investigation.targetId,
        targetName: result.investigation.targetName,
        result: result.investigation.displayedResult,
      },
    }));
  }
  return result.game;
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
