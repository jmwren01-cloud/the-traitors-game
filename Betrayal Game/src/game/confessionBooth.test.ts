// Wave 4 / 4 — Confession Booth unit tests.

import { describe, it, expect } from 'vitest';
import {
  startRoundtable,
  submitConfession,
  resolveConfessions,
  allAliveConfessed,
  getConfessionRevealsForBroadcast,
  ConfessionError,
  DEFAULT_CONFESSIONS,
} from './manager.js';
import type { GameState, Player, FalseEvidence } from './types.js';
import { CONFESSION_MIN_LENGTH, CONFESSION_MAX_LENGTH, DEFAULT_SETTINGS } from './types.js';

function p(id: string, name: string, isAlive = true): Player {
  return {
    id, name, isHost: false, isAlive,
    isConnected: true, hasShield: false, shieldRevealed: false,
  };
}

function baseGame(overrides: Partial<GameState> = {}): GameState {
  const players: Player[] = [
    { ...p('h', 'Host'), isHost: true },
    p('a', 'Alice'),
    p('b', 'Bob'),
    p('c', 'Cara'),
  ];
  return {
    sessionId: 's1',
    hostId: 'h',
    players,
    phase: 'ROLE_REVEAL',
    currentRound: 0,
    votes: [],
    murderVotes: [],
    messages: [],
    history: [],
    settings: DEFAULT_SETTINGS,
    whispers: [],
    ...overrides,
  } as GameState;
}

function openBooth(state?: GameState): GameState {
  return startRoundtable(state ?? baseGame());
}

describe('Confession Booth — phase init', () => {
  it('opens BOOTH on startRoundtable with empty entries and a 60s window', () => {
    const before = Date.now();
    const g = openBooth();
    expect(g.confessionPhase).toBe('BOOTH');
    expect(g.confessionEntries).toEqual([]);
    expect(g.confessionSubmittedIds).toEqual([]);
    expect(g.confessionRevealed).toBeUndefined();
    expect(g.confessionWindowEndsAt).toBeGreaterThanOrEqual(before + 59_000);
    expect(g.confessionWindowEndsAt).toBeLessThanOrEqual(Date.now() + 60_500);
  });
});

describe('Confession Booth — submitConfession validation', () => {
  it('rejects when not in BOOTH phase', () => {
    const g = baseGame({ phase: 'NIGHT' as const });
    expect(() => submitConfession(g, 'a', 'a'.repeat(20)))
      .toThrow(ConfessionError);
  });

  it('rejects dead players', () => {
    const g = openBooth(baseGame({
      players: [
        { ...p('h', 'Host'), isHost: true },
        { ...p('a', 'Alice', false) },
        p('b', 'Bob'),
      ],
    }));
    try {
      submitConfession(g, 'a', 'x'.repeat(20));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfessionError);
      expect((e as ConfessionError).code).toBe('DEAD');
    }
  });

  it('rejects double submission', () => {
    const g = openBooth();
    const g1 = submitConfession(g, 'a', 'x'.repeat(20));
    expect(() => submitConfession(g1, 'a', 'y'.repeat(20)))
      .toThrow(/already confessed/i);
  });

  it('rejects too-short content', () => {
    const g = openBooth();
    expect(() => submitConfession(g, 'a', 'x'.repeat(CONFESSION_MIN_LENGTH - 1)))
      .toThrow(/at least/i);
  });

  it('rejects too-long content', () => {
    const g = openBooth();
    expect(() => submitConfession(g, 'a', 'x'.repeat(CONFESSION_MAX_LENGTH + 1)))
      .toThrow(/at most/i);
  });

  it('appends real submissions and tracks ids', () => {
    let g = openBooth();
    g = submitConfession(g, 'a', 'I have a bad feeling about Cara');
    g = submitConfession(g, 'b', 'I trust Alice for now, watch the others');
    expect(g.confessionEntries).toHaveLength(2);
    expect(g.confessionSubmittedIds).toEqual(['a', 'b']);
    expect(allAliveConfessed(g)).toBe(false);
    g = submitConfession(g, 'h', 'Hosting is hard, you know');
    g = submitConfession(g, 'c', 'I would never lie to you all');
    expect(allAliveConfessed(g)).toBe(true);
  });
});

describe('Confession Booth — resolveConfessions', () => {
  it('backfills defaults for non-submitters with isDefault=true', () => {
    let g = openBooth();
    g = submitConfession(g, 'a', 'A real submission goes here');
    const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    let i = 0;
    const rng = () => seq[i++ % seq.length] as number;
    const resolved = resolveConfessions(g, rng);
    expect(resolved.confessionPhase).toBe('DISCUSSION');
    const real = (resolved.confessionEntries ?? []).filter((e) => !e.isDefault);
    const defaults = (resolved.confessionEntries ?? []).filter((e) => e.isDefault);
    expect(real).toHaveLength(1);
    expect(defaults).toHaveLength(3); // h, b, c defaulted
    for (const d of defaults) {
      expect(DEFAULT_CONFESSIONS).toContain(d.text);
      expect(d.playerId).toBeDefined();
    }
  });

  it('injects ANONYMOUS_TIP only when activatedAtRound === currentRound', () => {
    const fe: FalseEvidence = {
      type: 'ANONYMOUS_TIP',
      targetId: 'b',
      targetName: 'Bob',
      content: 'Bob met privately with the traitors at midnight.',
      plantedAtRound: 0,
      activatedAtRound: 1,
    };
    let g = openBooth(baseGame({ falseEvidence: fe }));
    expect(g.currentRound).toBe(1);
    for (const id of ['h', 'a', 'b', 'c']) {
      g = submitConfession(g, id, 'My honest take on tonight is x');
    }
    const resolved = resolveConfessions(g, () => 0);
    const tipEntry = (resolved.confessionEntries ?? []).find((e) => e.isAnonymousTip);
    expect(tipEntry).toBeDefined();
    expect(tipEntry?.text).toBe(fe.content);
    expect(tipEntry?.playerId).toBeUndefined();
    expect(resolved.confessionRevealed).toHaveLength(5);
  });

  it('does NOT inject ANONYMOUS_TIP when activated in a different round', () => {
    const fe: FalseEvidence = {
      type: 'ANONYMOUS_TIP',
      targetId: 'b',
      targetName: 'Bob',
      content: 'stale tip',
      plantedAtRound: 0,
      activatedAtRound: 2,
    };
    let g = openBooth(baseGame({ falseEvidence: fe })); // currentRound becomes 1
    g = submitConfession(g, 'a', 'a real submission text!');
    const resolved = resolveConfessions(g, () => 0);
    const tip = (resolved.confessionEntries ?? []).find((e) => e.isAnonymousTip);
    expect(tip).toBeUndefined();
  });

  it('reveal payload strips playerId and flags', () => {
    let g = openBooth();
    g = submitConfession(g, 'a', 'real submission text from alice');
    const resolved = resolveConfessions(g, () => 0);
    const reveals = getConfessionRevealsForBroadcast(resolved) ?? [];
    for (const r of reveals) {
      expect(Object.keys(r).sort()).toEqual(['id', 'text']);
    }
  });

  it('shuffle is deterministic with injected RNG', () => {
    const make = () => {
      let g = openBooth();
      g = submitConfession(g, 'h', 'host says one thing about it');
      g = submitConfession(g, 'a', 'alice says another thing here');
      g = submitConfession(g, 'b', 'bob has a third opinion now');
      g = submitConfession(g, 'c', 'cara closes the round w/ this');
      return g;
    };
    const seq = [0.42, 0.13, 0.77, 0.05, 0.91, 0.33];
    const mkRng = () => {
      let i = 0;
      return () => seq[i++ % seq.length] as number;
    };
    const r1 = resolveConfessions(make(), mkRng());
    const r2 = resolveConfessions(make(), mkRng());
    expect((r1.confessionRevealed ?? []).map((e) => e.text))
      .toEqual((r2.confessionRevealed ?? []).map((e) => e.text));
  });

  it('is idempotent (no-op when called outside BOOTH phase)', () => {
    let g = openBooth();
    g = submitConfession(g, 'a', 'a real submission text!');
    const once = resolveConfessions(g, () => 0);
    const twice = resolveConfessions(once, () => 0);
    expect(twice.confessionRevealed).toEqual(once.confessionRevealed);
    expect(twice.confessionEntries).toEqual(once.confessionEntries);
  });
});
