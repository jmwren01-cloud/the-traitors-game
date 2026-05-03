import { describe, it, expect } from 'vitest';
import { addPlayer, setAvatar, ensureAvatarSlotForReconnect } from './manager.js';
import type { GameState, Player } from './types.js';
import { DEFAULT_SETTINGS } from './types.js';

let _id = 1;
const uid = () => `player-${_id++}`;

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: uid(),
    name: `Player${_id}`,
    isAlive: true,
    isHost: false,
    isConnected: true,
    hasShield: false,
    shieldRevealed: false,
    ...overrides,
  };
}

function makeLobby(players: Player[]): GameState {
  return {
    sessionId: 'sess-test',
    phase: 'LOBBY',
    votes: [],
    revealedVotes: [],
    hostId: players[0]!.id,
    currentRound: 1,
    murderVotes: [],
    messages: [],
    lastManualVotes: {},
    history: [],
    settings: { ...DEFAULT_SETTINGS },
    whispers: [],
    whispersUsedThisRound: [],
    players,
  };
}

describe('Task #9 — keep color when someone else leaves', () => {
  it('addPlayer ignores disconnected players when picking colors', () => {
    const a = makePlayer({ color: 'red', avatar: 'fox', isConnected: false });
    const b = makePlayer({ color: 'blue', avatar: 'wolf' });
    const game = makeLobby([a, b]);
    const { game: next } = addPlayer(game, 'New', 'dev-token');
    const newPlayer = next.players[next.players.length - 1]!;
    // Disconnected player a's red should be claimable for the newcomer
    // (or any color other than blue). Critically not unique-collision:
    expect(newPlayer.color).not.toBe('blue');
  });

  it('setAvatar lets a player claim a disconnected player\'s color', () => {
    const ghost = makePlayer({ color: 'red', avatar: 'fox', isConnected: false });
    const me = makePlayer({ color: 'blue', avatar: 'wolf' });
    const game = makeLobby([ghost, me]);
    const next = setAvatar(game, me.id, 'red');
    expect(next.players.find((p) => p.id === me.id)?.color).toBe('red');
    // Ghost's stored color is cleared so reconnect picks fresh.
    expect(next.players.find((p) => p.id === ghost.id)?.color).toBeUndefined();
  });

  it('setAvatar still rejects taking a connected player\'s color', () => {
    const a = makePlayer({ color: 'red' });
    const b = makePlayer({ color: 'blue' });
    const game = makeLobby([a, b]);
    expect(() => setAvatar(game, b.id, 'red')).toThrow(/already taken/);
  });

  it('reconnect keeps stored color when no conflict', () => {
    const me = makePlayer({ color: 'red', avatar: 'fox', isConnected: true });
    const other = makePlayer({ color: 'blue', avatar: 'wolf' });
    const game = makeLobby([me, other]);
    const result = ensureAvatarSlotForReconnect(game, me.id);
    expect(result.changed).toBe(false);
    expect(result.game.players.find((p) => p.id === me.id)?.color).toBe('red');
  });

  it('reconnect auto-assigns when stored color was claimed by another connected player', () => {
    const me = makePlayer({ color: 'red', avatar: 'fox', isConnected: true });
    const thief = makePlayer({ color: 'red', avatar: 'wolf' });
    const game = makeLobby([me, thief]);
    const result = ensureAvatarSlotForReconnect(game, me.id);
    expect(result.changed).toBe(true);
    const updated = result.game.players.find((p) => p.id === me.id)!;
    expect(updated.color).toBeDefined();
    expect(updated.color).not.toBe('red');
  });

  it('reconnect auto-assigns when stored color was cleared', () => {
    const me = makePlayer({ isConnected: true });
    const other = makePlayer({ color: 'blue' });
    const game = makeLobby([me, other]);
    const result = ensureAvatarSlotForReconnect(game, me.id);
    expect(result.changed).toBe(true);
    const updated = result.game.players.find((p) => p.id === me.id)!;
    expect(updated.color).toBeDefined();
    expect(updated.color).not.toBe('blue');
  });

  it('reconnect outside LOBBY is a no-op', () => {
    const me = makePlayer({ color: 'red' });
    const game = { ...makeLobby([me]), phase: 'ROUNDTABLE' as const };
    const result = ensureAvatarSlotForReconnect(game, me.id);
    expect(result.changed).toBe(false);
    expect(result.game).toBe(game);
  });
});
