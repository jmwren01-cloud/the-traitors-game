import { describe, it, expect } from 'vitest';
import {
  beginSuspicionTokenPhase,
  placeSuspicionToken,
  resolveSuspicionTokens,
  allAlivePlacedTokens,
  clearSuspicionTokenPhase,
  startVoting,
  startRoundtable,
  SuspicionTokenError,
} from './manager.js';
import type { GameState, Player } from './types.js';
import { TOKEN_PLACEMENT_WINDOW_MS, DEFAULT_SETTINGS } from './types.js';

function mkPlayer(id: string, opts: Partial<Player> = {}): Player {
  return {
    id,
    name: id.toUpperCase(),
    isHost: false,
    isAlive: true,
    isConnected: true,
    role: 'FAITHFUL',
    ...opts,
  } as Player;
}

function mkGame(overrides: Partial<GameState> = {}): GameState {
  return {
    sessionId: 'test',
    hostId: 'p1',
    players: [mkPlayer('p1', { isHost: true }), mkPlayer('p2'), mkPlayer('p3'), mkPlayer('p4')],
    phase: 'ROUNDTABLE',
    currentRound: 1,
    votes: [],
    murderVotes: [],
    messages: [],
    history: [],
    settings: DEFAULT_SETTINGS,
    confessionPhase: 'DISCUSSION',
    ...overrides,
  } as GameState;
}

describe('Suspicion Tokens — beginSuspicionTokenPhase', () => {
  it('opens PLACEMENT with a 45s window and empty placements', () => {
    const before = Date.now();
    const opened = beginSuspicionTokenPhase(mkGame());
    expect(opened.tokenPhase).toBe('PLACEMENT');
    expect(opened.suspicionTokensCurrent).toEqual([]);
    expect(opened.tokensSubmittedIds).toEqual([]);
    expect(opened.tokenWindowEndsAt).toBeGreaterThanOrEqual(before + TOKEN_PLACEMENT_WINDOW_MS - 50);
  });

  it('throws when not in ROUNDTABLE', () => {
    expect(() => beginSuspicionTokenPhase(mkGame({ phase: 'VOTING' }))).toThrow(SuspicionTokenError);
  });

  it('is idempotent if a sub-phase is already open', () => {
    const g1 = beginSuspicionTokenPhase(mkGame());
    const g2 = beginSuspicionTokenPhase(g1);
    expect(g2).toBe(g1);
  });
});

describe('Suspicion Tokens — placeSuspicionToken validation', () => {
  it('rejects placement when sub-phase is not open', () => {
    expect(() => placeSuspicionToken(mkGame(), 'p1', 'p2')).toThrowError(/not open/);
  });

  it('rejects self-placement', () => {
    const g = beginSuspicionTokenPhase(mkGame());
    expect(() => placeSuspicionToken(g, 'p1', 'p1')).toThrow(/yourself/);
  });

  it('rejects dead placer', () => {
    const g = beginSuspicionTokenPhase(mkGame({
      players: [mkPlayer('p1', { isAlive: false }), mkPlayer('p2'), mkPlayer('p3'), mkPlayer('p4')],
    }));
    expect(() => placeSuspicionToken(g, 'p1', 'p2')).toThrow(/alive players/);
  });

  it('rejects dead target', () => {
    const g = beginSuspicionTokenPhase(mkGame({
      players: [mkPlayer('p1'), mkPlayer('p2', { isAlive: false }), mkPlayer('p3'), mkPlayer('p4')],
    }));
    expect(() => placeSuspicionToken(g, 'p1', 'p2')).toThrow(/alive player/);
  });

  it('rejects unknown target', () => {
    const g = beginSuspicionTokenPhase(mkGame());
    expect(() => placeSuspicionToken(g, 'p1', 'pX')).toThrow(/alive player/);
  });

  it('rejects double-placement', () => {
    const g = beginSuspicionTokenPhase(mkGame());
    const after = placeSuspicionToken(g, 'p1', 'p2');
    expect(() => placeSuspicionToken(after, 'p1', 'p3')).toThrow(/already placed/);
  });

  it('rejects placement after window expires', () => {
    const g: GameState = {
      ...beginSuspicionTokenPhase(mkGame()),
      tokenWindowEndsAt: Date.now() - 1,
    };
    expect(() => placeSuspicionToken(g, 'p1', 'p2')).toThrow(/closed/);
  });

  it('records valid placement and tracks submission', () => {
    const g = beginSuspicionTokenPhase(mkGame());
    const after = placeSuspicionToken(g, 'p1', 'p3');
    expect(after.suspicionTokensCurrent).toHaveLength(1);
    expect(after.suspicionTokensCurrent![0]).toMatchObject({
      placerId: 'p1', targetId: 'p3', round: 1,
    });
    expect(after.tokensSubmittedIds).toEqual(['p1']);
  });
});

describe('Suspicion Tokens — allAlivePlacedTokens', () => {
  it('returns false until every alive player has placed', () => {
    let g = beginSuspicionTokenPhase(mkGame());
    g = placeSuspicionToken(g, 'p1', 'p2');
    g = placeSuspicionToken(g, 'p2', 'p3');
    expect(allAlivePlacedTokens(g)).toBe(false);
    g = placeSuspicionToken(g, 'p3', 'p4');
    g = placeSuspicionToken(g, 'p4', 'p1');
    expect(allAlivePlacedTokens(g)).toBe(true);
  });

  it('ignores dead players in the denominator', () => {
    let g = beginSuspicionTokenPhase(mkGame({
      players: [mkPlayer('p1'), mkPlayer('p2'), mkPlayer('p3'), mkPlayer('p4', { isAlive: false })],
    }));
    g = placeSuspicionToken(g, 'p1', 'p2');
    g = placeSuspicionToken(g, 'p2', 'p3');
    g = placeSuspicionToken(g, 'p3', 'p1');
    expect(allAlivePlacedTokens(g)).toBe(true);
  });
});

describe('Suspicion Tokens — resolveSuspicionTokens backfill', () => {
  it('flips to REVEAL and archives current round into byRound', () => {
    let g = beginSuspicionTokenPhase(mkGame());
    g = placeSuspicionToken(g, 'p1', 'p2');
    g = placeSuspicionToken(g, 'p2', 'p3');
    g = placeSuspicionToken(g, 'p3', 'p4');
    g = placeSuspicionToken(g, 'p4', 'p1');
    const resolved = resolveSuspicionTokens(g);
    expect(resolved.tokenPhase).toBe('REVEAL');
    expect(resolved.tokenWindowEndsAt).toBeUndefined();
    expect(resolved.suspicionTokensByRound?.[1]).toHaveLength(4);
  });

  it('backfills auto-tokens for non-submitters with valid alive non-self targets', () => {
    let g = beginSuspicionTokenPhase(mkGame());
    g = placeSuspicionToken(g, 'p1', 'p2');
    // p2/p3/p4 do not submit
    // Deterministic RNG: always pick first candidate
    const resolved = resolveSuspicionTokens(g, () => 0);
    const tokens = resolved.suspicionTokensCurrent!;
    expect(tokens).toHaveLength(4);
    const auto = tokens.filter((t) => t.isAuto);
    expect(auto).toHaveLength(3);
    for (const t of tokens) {
      expect(t.placerId).not.toBe(t.targetId);
      const target = g.players.find((p) => p.id === t.targetId);
      expect(target?.isAlive).toBe(true);
    }
  });

  it('uses injected RNG deterministically', () => {
    let g = beginSuspicionTokenPhase(mkGame());
    // No real placements — every alive player gets auto-backfilled.
    const r1 = resolveSuspicionTokens(g, () => 0);
    const r2 = resolveSuspicionTokens(g, () => 0);
    expect(r1.suspicionTokensCurrent).toEqual(r2.suspicionTokensCurrent);
    const r3 = resolveSuspicionTokens(g, () => 0.999);
    expect(r3.suspicionTokensCurrent).not.toEqual(r1.suspicionTokensCurrent);
  });

  it('is a no-op when called outside PLACEMENT', () => {
    const g = mkGame({ tokenPhase: 'REVEAL' });
    const r = resolveSuspicionTokens(g);
    expect(r).toBe(g);
  });
});

describe('Suspicion Tokens — round transitions', () => {
  it('startVoting strips the sub-phase but keeps the round archive', () => {
    let g = beginSuspicionTokenPhase(mkGame());
    g = placeSuspicionToken(g, 'p1', 'p2');
    g = resolveSuspicionTokens(g, () => 0);
    const voting = startVoting(g);
    expect(voting.phase).toBe('VOTING');
    expect(voting.tokenPhase).toBeUndefined();
    expect(voting.tokenWindowEndsAt).toBeUndefined();
    expect(voting.suspicionTokensByRound?.[1]?.length).toBeGreaterThan(0);
    // suspicionTokensCurrent intentionally preserved so buildRoundRecord
    // (called at end-of-round) can copy it onto the RoundRecord.
    expect(voting.suspicionTokensCurrent?.length).toBeGreaterThan(0);
  });

  it('startRoundtable clears the sub-phase fields for the new round', () => {
    const g: GameState = {
      ...mkGame({ phase: 'MORNING' }),
      tokenPhase: 'REVEAL',
      tokenWindowEndsAt: 12345,
      tokenRevealEndsAt: 67890,
      suspicionTokensCurrent: [{ placerId: 'p1', targetId: 'p2', round: 1 }],
      tokensSubmittedIds: ['p1'],
      suspicionTokensByRound: { 1: [{ placerId: 'p1', targetId: 'p2', round: 1 }] },
    };
    const next = startRoundtable(g);
    expect(next.tokenPhase).toBeUndefined();
    expect(next.tokenWindowEndsAt).toBeUndefined();
    expect(next.suspicionTokensCurrent).toBeUndefined();
    expect(next.tokensSubmittedIds).toBeUndefined();
    // Archive is preserved across rounds.
    expect(next.suspicionTokensByRound?.[1]).toBeDefined();
  });

  it('clearSuspicionTokenPhase removes only sub-phase fields', () => {
    const g: GameState = {
      ...mkGame(),
      tokenPhase: 'PLACEMENT',
      tokenWindowEndsAt: 999,
      tokensSubmittedIds: ['p1'],
      suspicionTokensCurrent: [{ placerId: 'p1', targetId: 'p2', round: 1 }],
    };
    const cleared = clearSuspicionTokenPhase(g);
    expect(cleared.tokenPhase).toBeUndefined();
    expect(cleared.tokenWindowEndsAt).toBeUndefined();
    expect(cleared.tokensSubmittedIds).toBeUndefined();
    // Current placements stay so buildRoundRecord can read them at end-of-round.
    expect(cleared.suspicionTokensCurrent).toEqual([{ placerId: 'p1', targetId: 'p2', round: 1 }]);
  });
});
