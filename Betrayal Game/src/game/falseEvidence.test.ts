import { describe, it, expect } from 'vitest';
import {
  castEvidenceVote,
  resolveEvidenceVotes,
  activateFalseEvidence,
  runSheriffInvestigations,
  startRoundtable,
} from './manager.js';
import { DEFAULT_SETTINGS, FALSE_EVIDENCE_CONTENT_MAX } from './types.js';
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

  it('rejects WHISPER_FABRICATION without content', () => {
    const g = makeNightGame();
    expect(() => castEvidenceVote(g, 't1', 'WHISPER_FABRICATION', 'f1', '   ')).toThrow(/written body/i);
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

describe('activateFalseEvidence', () => {
  function plantedGame(extra: Partial<GameState> = {}): GameState {
    let g = makeNightGame(extra);
    g = castEvidenceVote(g, 't1', 'FRAME', 'f1', undefined);
    g = castEvidenceVote(g, 't2', 'FRAME', 'f1', undefined);
    g = resolveEvidenceVotes(g).game;
    // simulate flow: NIGHT → MORNING → ROUNDTABLE
    return startRoundtable({ ...g, phase: 'MORNING' });
  }

  it('FRAME → forces forceSuspiciousIds and Sheriff reports TRAITOR for that target', () => {
    const g = plantedGame();
    const act = activateFalseEvidence(g);
    expect(act.evidence?.activatedAtRound).toBe(g.currentRound);
    expect(act.game.forceSuspiciousIds).toEqual(['f1']);

    // The Sheriff investigation should hit f1 with reportedRole TRAITOR.
    const { game: afterSheriff, investigations } = runSheriffInvestigations(act.game);
    expect(investigations).toHaveLength(1);
    expect(investigations[0]!.targetId).toBe('f1');
    expect(investigations[0]!.reportedRole).toBe('TRAITOR');
    // override is consumed (one-shot).
    expect(afterSheriff.forceSuspiciousIds).toBeUndefined();
  });

  it('WHISPER_FABRICATION returns a fabricatedWhisper and persists it; never delivers content', () => {
    let g = makeNightGame();
    g = castEvidenceVote(g, 't1', 'WHISPER_FABRICATION', 'f1', 'I am the traitor');
    g = castEvidenceVote(g, 't2', 'WHISPER_FABRICATION', 'f1', 'I am the traitor');
    g = resolveEvidenceVotes(g).game;
    g = startRoundtable({ ...g, phase: 'MORNING' });

    const act = activateFalseEvidence(g);
    expect(act.fabricatedWhisper).toBeDefined();
    expect(act.fabricatedWhisper!.senderId).toBe('f1');
    expect(act.fabricatedWhisper!.content).toBe('I am the traitor');
    // Whisper persisted on game.whispers for post-game replay.
    expect(act.game.whispers?.some((w) => w.id === act.fabricatedWhisper!.id)).toBe(true);
    // Recipient is alive and not the framed sender.
    expect(act.fabricatedWhisper!.recipientId).not.toBe('f1');
    const recipient = act.game.players.find((p) => p.id === act.fabricatedWhisper!.recipientId);
    expect(recipient?.isAlive).toBe(true);
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
