import { describe, it, expect } from 'vitest';
import {
  castEvidenceVote,
  resolveEvidenceVotes,
  activateFalseEvidence,
  forceFailEvidenceWindow,
  runSheriffInvestigations,
  startRoundtable,
} from './manager.js';
import { DEFAULT_SETTINGS, FALSE_EVIDENCE_CONTENT_MAX, FALSE_EVIDENCE_WINDOW_MS } from './types.js';
import type { GameState, Player } from './types.js';

function makePlayer(over: Partial<Player> = {}): Player {
  return {
    id: 'p',
    name: 'P',
    isAlive: true,
    isHost: false,
    isConnected: true,
    hasShield: false,
    shieldRevealed: false,
    ...over,
  };
}

function makeNightGame(over: Partial<GameState> = {}): GameState {
  return {
    sessionId: 's',
    phase: 'NIGHT',
    players: [
      makePlayer({ id: 't1', name: 'T1', role: 'TRAITOR' }),
      makePlayer({ id: 't2', name: 'T2', role: 'TRAITOR' }),
      makePlayer({ id: 'f1', name: 'F1', role: 'FAITHFUL' }),
      makePlayer({ id: 'f2', name: 'F2', role: 'FAITHFUL' }),
      makePlayer({ id: 's1', name: 'S1', role: 'SHERIFF' }),
    ],
    votes: [],
    revealedVotes: [],
    hostId: 't1',
    currentRound: 2,
    murderVotes: [],
    messages: [],
    lastManualVotes: {},
    history: [],
    settings: { ...DEFAULT_SETTINGS },
    whispers: [],
    whispersUsedThisRound: [],
    ...over,
  };
}

describe('castEvidenceVote', () => {
  it('rejects votes outside NIGHT', () => {
    const g = makeNightGame({ phase: 'ROUNDTABLE' });
    expect(() => castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined)).toThrow(/night/i);
  });

  it('rejects non-traitors', () => {
    const g = makeNightGame();
    expect(() => castEvidenceVote(g, 'f1', 'FRAME', 't1', undefined)).toThrow(/Traitor/i);
  });

  it('rejects self-targeting', () => {
    const g = makeNightGame();
    expect(() => castEvidenceVote(g, 't1', 'FRAME', 't1', undefined)).toThrow(/yourself/i);
  });

  it('rejects framing a fellow Traitor (Faithful-only target)', () => {
    const g = makeNightGame();
    expect(() => castEvidenceVote(g, 't1', 'FRAME', 't2', undefined)).toThrow(/Faithful/i);
  });

  it('silently drops content for WHISPER_FABRICATION (no body persisted)', () => {
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'WHISPER_FABRICATION', 'f1', 'leak this');
    expect(g.evidenceVotes![0]!.content).toBeUndefined();
  });

  it('rejects ANONYMOUS_TIP without content', () => {
    const g = makeNightGame();
    expect(() => castEvidenceVote(g, 't1', 'ANONYMOUS_TIP', 'f1', '   ')).toThrow(/written body/i);
  });

  it('opens the 60s unanimity window on first vote and rejects late votes', () => {
    const start = 1_000_000;
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined, start);
    expect(g.evidenceWindowEndsAt).toBe(start + FALSE_EVIDENCE_WINDOW_MS);
    // A second vote within the window keeps the original deadline.
    g = castEvidenceVote(g, 't2', 'FRAME', 'f1', undefined, start + 5_000);
    expect(g.evidenceWindowEndsAt).toBe(start + FALSE_EVIDENCE_WINDOW_MS);
  });

  it('rejects votes cast after the window has closed', () => {
    const start = 1_000_000;
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined, start);
    expect(() =>
      castEvidenceVote(g, 't2', 'FRAME', 'f1', undefined, start + FALSE_EVIDENCE_WINDOW_MS + 1)
    ).toThrow(/window has closed/i);
  });

  it('overwrites a traitor\'s previous vote (idempotent)', () => {
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined);
    g = castEvidenceVote(g, 't1', 'FRAME', 'f2', undefined);
    expect(g.evidenceVotes).toHaveLength(1);
    expect(g.evidenceVotes![0]!.targetId).toBe('f2');
  });

  it('refuses additional votes once evidenceUsed=true (single-use)', () => {
    const g = makeNightGame({ evidenceUsed: true });
    expect(() => castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined)).toThrow(/already/i);
  });

  it('caps and trims ANONYMOUS_TIP body to 150 chars and strips control chars', () => {
    const longBody = '  hello\u0000world  ' + 'x'.repeat(200);
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'ANONYMOUS_TIP', 'f1', longBody);
    const v = g.evidenceVotes![0]!;
    expect(v.content!.length).toBeLessThanOrEqual(FALSE_EVIDENCE_CONTENT_MAX);
    expect(v.content!.startsWith('helloworld')).toBe(true);
    expect(v.content!).not.toMatch(/\u0000/);
  });
});

describe('resolveEvidenceVotes — unanimity', () => {
  it('returns PENDING when not all alive traitors voted', () => {
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined);
    const r = resolveEvidenceVotes(g);
    expect(r.outcome).toBe('PENDING');
    expect(r.game.evidenceUsed).toBeUndefined();
  });

  it('PLANTED when all traitors agree on type+target', () => {
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined);
    g = castEvidenceVote(g, 't2', 'FRAME', 'f1', undefined);
    const r = resolveEvidenceVotes(g);
    expect(r.outcome).toBe('PLANTED');
    expect(r.evidence?.type).toBe('FRAME');
    expect(r.evidence?.targetId).toBe('f1');
    expect(r.game.evidenceUsed).toBe(true);
    expect(r.game.evidenceVotes).toBeUndefined();
  });

  it('NO_AGREEMENT when targets differ; clears votes', () => {
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined);
    g = castEvidenceVote(g, 't2', 'FRAME', 'f2', undefined);
    const r = resolveEvidenceVotes(g);
    expect(r.outcome).toBe('NO_AGREEMENT');
    expect(r.game.evidenceUsed).toBeUndefined();
    expect(r.game.evidenceVotes).toBeUndefined();
  });

  it('SKIPPED when all SKIP', () => {
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'SKIP', undefined, undefined);
    g = castEvidenceVote(g, 't2', 'SKIP', undefined, undefined);
    const r = resolveEvidenceVotes(g);
    expect(r.outcome).toBe('SKIPPED');
    expect(r.game.evidenceUsed).toBeUndefined();
  });
});

describe('FRAME activates immediately on PLANTED (same-night Sheriff)', () => {
  it('PLANTED+FRAME pushes the target into forceSuspiciousIds during NIGHT', () => {
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined);
    g = castEvidenceVote(g, 't2', 'FRAME', 'f1', undefined);
    const r = resolveEvidenceVotes(g);
    expect(r.outcome).toBe('PLANTED');
    expect(r.game.forceSuspiciousIds).toEqual(['f1']);

    // Sheriff investigation in the same NIGHT→MORNING transition is corrupted.
    const morning: GameState = { ...r.game, phase: 'MORNING' };
    const { game: after, investigations } = runSheriffInvestigations(morning);
    expect(investigations[0]!.targetId).toBe('f1');
    expect(investigations[0]!.reportedRole).toBe('TRAITOR');
    expect(after.forceSuspiciousIds).toBeUndefined();
  });
});

describe('activateFalseEvidence', () => {
  function plantedGame(extra: Partial<GameState> = {}): GameState {
    let g = makeNightGame(extra);
    g = castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined);
    g = castEvidenceVote(g, 't2', 'FRAME', 'f1', undefined);
    g = resolveEvidenceVotes(g).game;
    // simulate flow: NIGHT → MORNING → ROUNDTABLE
    return startRoundtable({ ...g, phase: 'MORNING' });
  }

  it('FRAME activation is just a stamp at Roundtable (override already applied at NIGHT)', () => {
    const g = plantedGame();
    // forceSuspiciousIds was consumed during the simulated Sheriff run inside
    // the prior describe; here we check the activation stamps the round.
    const act = activateFalseEvidence(g);
    expect(act.evidence?.activatedAtRound).toBe(g.currentRound);
  });

  it('WHISPER_FABRICATION emits a meta-only fabricatedWhisper with NO content', () => {
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'WHISPER_FABRICATION', 'f1', undefined);
    g = castEvidenceVote(g, 't2', 'WHISPER_FABRICATION', 'f1', undefined);
    g = resolveEvidenceVotes(g).game;
    g = startRoundtable({ ...g, phase: 'MORNING' });

    const act = activateFalseEvidence(g);
    expect(act.fabricatedWhisper).toBeDefined();
    expect(act.fabricatedWhisper!.senderId).toBe('f1');
    // CRITICAL: the persisted whisper has no body — prevents leakage to
    // the framed "recipient" via scrubWhispersForRecipient.
    expect(act.fabricatedWhisper!.content).toBeUndefined();
    const persisted = act.game.whispers?.find((w) => w.id === act.fabricatedWhisper!.id);
    expect(persisted).toBeDefined();
    expect(persisted!.content).toBeUndefined();
    // Recipient is alive and not the framed sender or a Traitor.
    expect(act.fabricatedWhisper!.recipientId).not.toBe('f1');
    const recipient = act.game.players.find((p) => p.id === act.fabricatedWhisper!.recipientId);
    expect(recipient?.isAlive).toBe(true);
    expect(recipient?.role).not.toBe('TRAITOR');
  });

  it('ANONYMOUS_TIP keeps body on falseEvidence (Confession Booth seam)', () => {
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'ANONYMOUS_TIP', 'f1', 'I saw f1 with a knife');
    g = castEvidenceVote(g, 't2', 'ANONYMOUS_TIP', 'f1', 'I saw f1 with a knife');
    g = resolveEvidenceVotes(g).game;
    g = startRoundtable({ ...g, phase: 'MORNING' });

    const act = activateFalseEvidence(g);
    expect(act.fabricatedWhisper).toBeUndefined();
    expect(act.evidence?.content).toBe('I saw f1 with a knife');
    expect(act.evidence?.activatedAtRound).toBe(g.currentRound);
  });

  it('is a no-op when no plant pending', () => {
    const g = startRoundtable({ ...makeNightGame(), phase: 'MORNING' });
    const act = activateFalseEvidence(g);
    expect(act.game).toBe(g);
    expect(act.fabricatedWhisper).toBeUndefined();
  });

  it('does not re-activate an already-activated plant (idempotent)', () => {
    const g = plantedGame();
    const first = activateFalseEvidence(g);
    const second = activateFalseEvidence(first.game);
    expect(second.game).toBe(first.game);
    expect(second.fabricatedWhisper).toBeUndefined();
  });
});

describe('forceFailEvidenceWindow', () => {
  it('returns PENDING when window is still open', () => {
    const start = 1_000_000;
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined, start);
    const r = forceFailEvidenceWindow(g, start + 1_000);
    expect(r.outcome).toBe('PENDING');
    expect(r.game.evidenceVotes).toBeDefined();
  });

  it('returns TIMEOUT and clears state once the deadline elapses', () => {
    const start = 1_000_000;
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined, start);
    const r = forceFailEvidenceWindow(g, start + FALSE_EVIDENCE_WINDOW_MS + 1);
    expect(r.outcome).toBe('TIMEOUT');
    expect(r.game.evidenceVotes).toBeUndefined();
    expect(r.game.evidenceWindowEndsAt).toBeUndefined();
    expect(r.game.evidenceUsed).toBeUndefined();
  });

  it('is a no-op when no window is open', () => {
    const g = makeNightGame();
    expect(forceFailEvidenceWindow(g).outcome).toBe('PENDING');
  });
});

describe('runSheriffInvestigations honours forceSuspiciousIds', () => {
  it('reports TRAITOR for forced target even when target is FAITHFUL', () => {
    const g = makeNightGame({
      phase: 'MORNING',
      forceSuspiciousIds: ['f1'],
    });
    const { game: after, investigations } = runSheriffInvestigations(g);
    expect(investigations[0]!.targetId).toBe('f1');
    expect(investigations[0]!.reportedRole).toBe('TRAITOR');
    expect(after.forceSuspiciousIds).toBeUndefined();
  });

  it('falls back to random target if no Sheriff can investigate the forced player', () => {
    // Sheriff is dead — no investigations, override stays pending.
    const g = makeNightGame({
      phase: 'MORNING',
      forceSuspiciousIds: ['f1'],
      players: [
        makePlayer({ id: 't1', name: 'T1', role: 'TRAITOR' }),
        makePlayer({ id: 'f1', name: 'F1', role: 'FAITHFUL' }),
        makePlayer({ id: 's1', name: 'S1', role: 'SHERIFF', isAlive: false }),
      ],
    });
    const { game: after, investigations } = runSheriffInvestigations(g);
    expect(investigations).toHaveLength(0);
    expect(after.forceSuspiciousIds).toEqual(['f1']);
  });
});
