import { WebSocket } from 'ws';
import crypto from 'crypto';
import type { S2CEvent, GameState, Player } from '../game/types.js';
import type { MurderResult } from '../game/manager.js';

/**
 * Returns a copy of the players list scrubbed for the given recipient.
 *
 * Hidden information removed for everyone except the recipient themselves
 * (and except in `GAME_END`, where every role is publicly revealed):
 *   - `role` (a Faithful must never see another player's true role,
 *     including the Wave 4 special roles SHERIFF / MEDIC / SEER)
 *   - `seerGiftUsed` (would out the Seer)
 *   - `medicLastProtectedTargetId` (would out the Medic and their pick)
 *
 * `hasShield` is also stripped except for the recipient and for players
 * whose shield is publicly revealed.
 *
 * `recipientId` may be `undefined` (e.g. broadcasting before a connection
 * has a known player id); in that case no player is treated as "self".
 */
export function scrubPlayersForRecipient(
  players: Player[],
  recipientId: string | undefined,
  opts: { revealAllRoles?: boolean } = {}
): Player[] {
  const revealAll = opts.revealAllRoles === true;
  return players.map((p) => {
    // Strip server-only fields from every broadcast (deviceToken must never leave the server)
    const { deviceToken: _dt, ...rest } = p;
    const isSelf = recipientId !== undefined && rest.id === recipientId;

    // Per-recipient role/special-role privacy.
    const safe: Player = { ...rest } as Player;
    if (!isSelf && !revealAll) {
      delete safe.role;
      delete safe.seerGiftUsed;
      delete safe.medicLastProtectedTargetId;
    }

    if (!safe.hasShield) return safe;
    if (isSelf) return safe;
    if (safe.shieldRevealed) return safe;
    return { ...safe, hasShield: false };
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

  // Roles become public once the game ends so the post-game summary can
  // colour everyone correctly. Mid-game, scrubPlayersForRecipient hides
  // them.
  const revealAllRoles = gameState.phase === 'GAME_END';

  gameState.players.forEach((player) => {
    const connection = playerConnections.get(player.id);
    if (!connection || connection.readyState !== WebSocket.OPEN) return;

    let toSend: S2CEvent = event;
    if (hasPlayersArray) {
      const originalPlayers = (payload as { players: Player[] }).players;
      const scrubbed = scrubPlayersForRecipient(originalPlayers, player.id, { revealAllRoles });
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
