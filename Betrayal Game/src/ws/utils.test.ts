import { describe, it, expect, vi } from 'vitest';
import { WebSocket } from 'ws';
import { scrubPlayersForRecipient, broadcastToSession } from './utils.js';
import type { GameState, Player, S2CEvent } from '../game/types.js';
import { DEFAULT_SETTINGS } from '../game/types.js';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p',
    name: 'P',
    isAlive: true,
    isHost: false,
    isConnected: true,
    hasShield: false,
    shieldRevealed: false,
    ...overrides,
  };
}

function makeGame(players: Player[]): GameState {
  return {
    sessionId: 'sess',
    phase: 'LOBBY',
    players,
    votes: [],
    revealedVotes: [],
    hostId: players[0]!.id,
    currentRound: 1,
    murderVotes: [],
    messages: [],
    lastManualVotes: {},
    history: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

describe('scrubPlayersForRecipient', () => {
  it('preserves hasShield only for the recipient themselves', () => {
    const players = [
      makePlayer({ id: 'a', hasShield: true }),
      makePlayer({ id: 'b', hasShield: true }),
      makePlayer({ id: 'c', hasShield: false }),
    ];

    const forA = scrubPlayersForRecipient(players, 'a');
    expect(forA.find((p) => p.id === 'a')!.hasShield).toBe(true);
    expect(forA.find((p) => p.id === 'b')!.hasShield).toBe(false);
    expect(forA.find((p) => p.id === 'c')!.hasShield).toBe(false);

    const forB = scrubPlayersForRecipient(players, 'b');
    expect(forB.find((p) => p.id === 'a')!.hasShield).toBe(false);
    expect(forB.find((p) => p.id === 'b')!.hasShield).toBe(true);
  });

  it('preserves hasShield for everyone when shield is publicly revealed', () => {
    const players = [
      makePlayer({ id: 'a', hasShield: true, shieldRevealed: true }),
      makePlayer({ id: 'b', hasShield: true }),
    ];

    const forB = scrubPlayersForRecipient(players, 'b');
    // a's shield is revealed -> still visible to b
    expect(forB.find((p) => p.id === 'a')!.hasShield).toBe(true);
    // b owns their own shield
    expect(forB.find((p) => p.id === 'b')!.hasShield).toBe(true);

    const forA = scrubPlayersForRecipient(players, 'a');
    // b's shield is hidden from a (not revealed)
    expect(forA.find((p) => p.id === 'b')!.hasShield).toBe(false);
  });

  it('does not mutate the input players array', () => {
    const players = [
      makePlayer({ id: 'a', hasShield: true }),
      makePlayer({ id: 'b', hasShield: true }),
    ];
    const snapshot = JSON.parse(JSON.stringify(players));
    scrubPlayersForRecipient(players, 'a');
    expect(players).toEqual(snapshot);
  });

  it('strips all unrevealed shields when recipientId is undefined', () => {
    const players = [
      makePlayer({ id: 'a', hasShield: true }),
      makePlayer({ id: 'b', hasShield: true, shieldRevealed: true }),
    ];
    const out = scrubPlayersForRecipient(players, undefined);
    expect(out.find((p) => p.id === 'a')!.hasShield).toBe(false);
    expect(out.find((p) => p.id === 'b')!.hasShield).toBe(true);
  });
});

describe('broadcastToSession', () => {
  function fakeSocket() {
    return {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    };
  }

  it('scrubs hasShield per-recipient on events that carry a players array', () => {
    const players = [
      makePlayer({ id: 'a', hasShield: true }),
      makePlayer({ id: 'b', hasShield: false }),
    ];
    const game = makeGame(players);
    const games = new Map([[game.sessionId, game]]);

    const sockA = fakeSocket();
    const sockB = fakeSocket();
    const conns = new Map<string, WebSocket>([
      ['a', sockA as unknown as WebSocket],
      ['b', sockB as unknown as WebSocket],
    ]);

    const event: S2CEvent = {
      type: 'S2C_PLAYER_JOINED',
      payload: { players },
    };

    broadcastToSession(game.sessionId, event, games, conns);

    const sentToA = JSON.parse(sockA.send.mock.calls[0]![0] as string);
    const sentToB = JSON.parse(sockB.send.mock.calls[0]![0] as string);

    // A holds the shield -> A sees it
    expect(sentToA.payload.players.find((p: Player) => p.id === 'a').hasShield).toBe(true);
    // B should NOT see that A has a shield
    expect(sentToB.payload.players.find((p: Player) => p.id === 'a').hasShield).toBe(false);
  });

  it('passes through events without a players array unchanged', () => {
    const players = [makePlayer({ id: 'a', hasShield: true })];
    const game = makeGame(players);
    const games = new Map([[game.sessionId, game]]);
    const sockA = fakeSocket();
    const conns = new Map<string, WebSocket>([['a', sockA as unknown as WebSocket]]);

    const event: S2CEvent = {
      type: 'S2C_VOTE_COUNT_UPDATE',
      payload: { received: 1, needed: 5 },
    };
    broadcastToSession(game.sessionId, event, games, conns);

    const sent = JSON.parse(sockA.send.mock.calls[0]![0] as string);
    expect(sent).toEqual(event);
  });
});
