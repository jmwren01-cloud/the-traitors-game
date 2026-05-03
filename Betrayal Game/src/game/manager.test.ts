import { describe, it, expect } from 'vitest';
import {
  assignRoles,
  submitVote,
  banishPlayer,
  resolveMurder,
  checkWinCondition,
  generateAutoVotes,
  isFaithfulRole,
  runSheriffInvestigations,
  submitMedicProtect,
  activateSeer,
} from './manager.js';
import type { GameState, Player } from './types.js';
import { DEFAULT_SETTINGS } from './types.js';

// ============= HELPERS =============

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

function makePlayers(n: number): Player[] {
  return Array.from({ length: n }, () => makePlayer());
}

function makeGame(overrides: Partial<GameState> & { players: Player[] }): GameState {
  return {
    sessionId: 'sess-test',
    phase: 'LOBBY',
    votes: [],
    revealedVotes: [],
    hostId: overrides.players[0]!.id,
    currentRound: 1,
    murderVotes: [],
    messages: [],
    lastManualVotes: {},
    history: [],
    settings: { ...DEFAULT_SETTINGS },
    ...overrides,
  };
}

// ============= assignRoles =============

describe('assignRoles()', () => {
  it('assigns 1 traitor for a 5-player game (auto mode)', () => {
    const players = makePlayers(5);
    const game = makeGame({ players, phase: 'ROLE_ASSIGN' });
    const result = assignRoles(game);
    const traitors = result.players.filter((p) => p.role === 'TRAITOR');
    expect(traitors).toHaveLength(1);
  });

  it('assigns 2 traitors for a 10-player game (auto mode)', () => {
    const players = makePlayers(10);
    const game = makeGame({ players, phase: 'ROLE_ASSIGN' });
    const result = assignRoles(game);
    const traitors = result.players.filter((p) => p.role === 'TRAITOR');
    expect(traitors).toHaveLength(2);
  });

  it('assigns 3 traitors for a 15-player game (auto mode)', () => {
    const players = makePlayers(15);
    const game = makeGame({ players, phase: 'ROLE_ASSIGN' });
    const result = assignRoles(game);
    const traitors = result.players.filter((p) => p.role === 'TRAITOR');
    expect(traitors).toHaveLength(3);
  });

  it('Wave 4 — assigns SHERIFF at 7+, SHERIFF+MEDIC at 8+, all three at 9+', () => {
    for (const [count, expected] of [
      [7, ['SHERIFF']],
      [8, ['SHERIFF', 'MEDIC']],
      [9, ['SHERIFF', 'MEDIC', 'SEER']],
    ] as const) {
      const game = makeGame({ players: makePlayers(count), phase: 'ROLE_ASSIGN' });
      const result = assignRoles(game);
      const specials = result.players.map((p) => p.role).filter((r) => r === 'SHERIFF' || r === 'MEDIC' || r === 'SEER');
      expect(specials.sort()).toEqual([...expected].sort());
      // Special roles do not increase the traitor count and replace plain Faithful.
      expect(result.players.filter((p) => p.role === 'TRAITOR')).toHaveLength(Math.floor(count / 5));
    }
  });

  it('Wave 4 — does not upgrade special roles when enableSpecialRoles is off', () => {
    const game = makeGame({
      players: makePlayers(9),
      phase: 'ROLE_ASSIGN',
      settings: { ...DEFAULT_SETTINGS, enableSpecialRoles: false },
    });
    const result = assignRoles(game);
    const specials = result.players.filter((p) => p.role === 'SHERIFF' || p.role === 'MEDIC' || p.role === 'SEER');
    expect(specials).toHaveLength(0);
  });
});

// ============= Wave 4: special-role helpers =============

describe('isFaithfulRole()', () => {
  it('treats every non-traitor role as Faithful for win-counting', () => {
    expect(isFaithfulRole('FAITHFUL')).toBe(true);
    expect(isFaithfulRole('SHERIFF')).toBe(true);
    expect(isFaithfulRole('MEDIC')).toBe(true);
    expect(isFaithfulRole('SEER')).toBe(true);
    expect(isFaithfulRole('TRAITOR')).toBe(false);
    expect(isFaithfulRole(undefined)).toBe(false);
  });
});

describe('runSheriffInvestigations()', () => {
  it('returns one report per alive Sheriff and never targets self', () => {
    const sheriff = makePlayer({ role: 'SHERIFF' });
    const t = makePlayer({ role: 'TRAITOR' });
    const f = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({ players: [sheriff, t, f], phase: 'MORNING' });
    const reports = runSheriffInvestigations(game);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.sheriffId).toBe(sheriff.id);
    expect(reports[0]!.targetId).not.toBe(sheriff.id);
  });

  it('inverts ~25% of reports (deterministic via Math.random stub)', () => {
    const sheriff = makePlayer({ role: 'SHERIFF' });
    const traitor = makePlayer({ role: 'TRAITOR' });
    const game = makeGame({ players: [sheriff, traitor], phase: 'MORNING' });
    const orig = Math.random;
    try {
      // First call picks the only candidate (target). Second call is the
      // inversion roll; <0.25 inverts, >=0.25 reports truth.
      const seq = [0, 0.99]; let i = 0;
      Math.random = () => seq[i++ % seq.length]!;
      const truthful = runSheriffInvestigations(game);
      expect(truthful[0]!.reportedRole).toBe('TRAITOR');

      i = 0; Math.random = () => [0, 0.1][i++ % 2]!;
      const inverted = runSheriffInvestigations(game);
      expect(inverted[0]!.reportedRole).toBe('FAITHFUL');
    } finally {
      Math.random = orig;
    }
  });
});

describe('submitMedicProtect()', () => {
  it('rejects self-protection', () => {
    const medic = makePlayer({ role: 'MEDIC' });
    const game = makeGame({ players: [medic, makePlayer()], phase: 'NIGHT' });
    expect(() => submitMedicProtect(game, medic.id, medic.id)).toThrow();
  });

  it('rejects protecting the same target two nights in a row', () => {
    const medic = makePlayer({ role: 'MEDIC' });
    const target = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({
      players: [
        { ...medic, medicLastProtectedTargetId: target.id },
        target,
      ],
      phase: 'NIGHT',
    });
    expect(() => submitMedicProtect(game, medic.id, target.id)).toThrow();
  });

  it('records the protection target and bumps the Medic\'s last-target memory', () => {
    const medic = makePlayer({ role: 'MEDIC' });
    const target = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({ players: [medic, target], phase: 'NIGHT' });
    const out = submitMedicProtect(game, medic.id, target.id);
    expect(out.medicProtectionTargetId).toBe(target.id);
    expect(out.players.find((p) => p.id === medic.id)?.medicLastProtectedTargetId).toBe(target.id);
  });
});

describe('resolveMurder() — Wave 4 Medic block', () => {
  it('silently blocks the murder when the Medic protects the chosen victim (no shield consumed)', () => {
    const traitor = makePlayer({ role: 'TRAITOR' });
    const victim = makePlayer({ role: 'FAITHFUL' });
    const medic = makePlayer({ role: 'MEDIC' });
    const game = makeGame({
      players: [traitor, victim, medic],
      phase: 'NIGHT',
      murderVotes: [{ voterId: traitor.id, targetId: victim.id }],
      medicProtectionTargetId: victim.id,
    });
    const result = resolveMurder(game);
    expect(result.blocked).toBe(true);
    // Critical: medic-block does NOT expose a shielded player to the morning UI.
    expect(result.shieldedPlayerId).toBeUndefined();
    expect(result.game.players.find((p) => p.id === victim.id)?.isAlive).toBe(true);
    expect(result.game.players.find((p) => p.id === victim.id)?.hasShield).toBe(false);
  });
});

describe('activateSeer()', () => {
  it('reveals the true role of a randomly chosen alive non-self player', () => {
    const seer = makePlayer({ role: 'SEER' });
    const traitor = makePlayer({ role: 'TRAITOR' });
    const game = makeGame({ players: [seer, traitor], phase: 'ROUNDTABLE' });
    const out = activateSeer(game, seer.id);
    // Only one valid candidate (the traitor) → must be picked.
    expect(out.targetId).toBe(traitor.id);
    expect(out.actualRole).toBe('TRAITOR');
    expect(out.game.players.find((p) => p.id === seer.id)?.seerGiftUsed).toBe(true);
    expect(out.traitorIds).toEqual([traitor.id]);
  });

  it('never picks the Seer themselves', () => {
    const seer = makePlayer({ role: 'SEER' });
    const a = makePlayer({ role: 'FAITHFUL' });
    const b = makePlayer({ role: 'FAITHFUL' });
    const c = makePlayer({ role: 'TRAITOR' });
    const game = makeGame({ players: [seer, a, b, c], phase: 'ROUNDTABLE' });
    for (let i = 0; i < 25; i++) {
      const out = activateSeer(game, seer.id);
      expect(out.targetId).not.toBe(seer.id);
    }
  });

  it('rejects re-use after the gift is consumed', () => {
    const seer = makePlayer({ role: 'SEER', seerGiftUsed: true });
    const target = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({ players: [seer, target], phase: 'ROUNDTABLE' });
    expect(() => activateSeer(game, seer.id)).toThrow();
  });

  it('rejects activation outside the ROUNDTABLE phase', () => {
    const seer = makePlayer({ role: 'SEER' });
    const target = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({ players: [seer, target], phase: 'NIGHT' });
    expect(() => activateSeer(game, seer.id)).toThrow();
  });
});

describe('checkWinCondition() — Wave 4 special roles count as Faithful', () => {
  it('does not award TRAITORS the win while a Sheriff or Medic still lives', () => {
    const traitor = makePlayer({ role: 'TRAITOR' });
    const sheriff = makePlayer({ role: 'SHERIFF' });
    const medic = makePlayer({ role: 'MEDIC' });
    const game = makeGame({
      players: [traitor, sheriff, medic],
      phase: 'CHECK_WIN',
      currentRound: 2,
    });
    const result = checkWinCondition(game);
    // 1 traitor vs 2 faithful-team players → game continues.
    expect(result.winner).toBeUndefined();
  });
});

// ============= submitVote =============

describe('submitVote()', () => {
  it('throws when the vote target is dead', () => {
    const voter = makePlayer();
    const deadTarget = makePlayer({ isAlive: false });
    const game = makeGame({
      players: [voter, deadTarget],
      phase: 'VOTING',
      votes: [],
    });
    expect(() => submitVote(game, voter.id, deadTarget.id)).toThrow();
  });
});

// ============= banishPlayer =============

describe('banishPlayer()', () => {
  it('banishes the player with a clear vote majority and transitions to BANISH_REVEAL', () => {
    const players = makePlayers(4);
    const [a, b, c, d] = players as [Player, Player, Player, Player];

    const revealedVotes = [
      { voterId: b.id, targetId: a.id },
      { voterId: c.id, targetId: a.id },
      { voterId: d.id, targetId: a.id },
      { voterId: a.id, targetId: b.id },
    ];

    const game = makeGame({ players, phase: 'VOTE_REVEAL', revealedVotes });
    const result = banishPlayer(game);

    expect(result.isTie).toBe(false);
    expect(result.game.phase).toBe('BANISH_REVEAL');
    expect(result.game.banishedPlayerId).toBe(a.id);
    expect(result.game.players.find((p) => p.id === a.id)?.isAlive).toBe(false);
  });

  it('produces TIE_DETECTED phase and isTie:true when candidates are tied', () => {
    const players = makePlayers(4);
    const [a, b, c, d] = players as [Player, Player, Player, Player];

    const revealedVotes = [
      { voterId: c.id, targetId: a.id },
      { voterId: d.id, targetId: a.id },
      { voterId: a.id, targetId: b.id },
      { voterId: b.id, targetId: b.id },
    ];

    const game = makeGame({ players, phase: 'VOTE_REVEAL', revealedVotes });
    const result = banishPlayer(game);

    expect(result.isTie).toBe(true);
    expect(result.game.phase).toBe('TIE_DETECTED');
    expect(result.tiedPlayerIds).toContain(a.id);
    expect(result.tiedPlayerIds).toContain(b.id);
  });
});

// ============= resolveMurder =============

describe('resolveMurder()', () => {
  it('blocks the murder and consumes the shield when the target has hasShield:true', () => {
    const traitor = makePlayer({ role: 'TRAITOR' });
    const shieldedFaithful = makePlayer({ role: 'FAITHFUL', hasShield: true });
    const otherFaithful = makePlayer({ role: 'FAITHFUL' });

    const murderVotes = [{ voterId: traitor.id, targetId: shieldedFaithful.id }];

    const game = makeGame({
      players: [traitor, shieldedFaithful, otherFaithful],
      phase: 'NIGHT',
      murderVotes,
    });

    const result = resolveMurder(game);

    expect(result.blocked).toBe(true);
    expect(result.shieldedPlayerId).toBe(shieldedFaithful.id);
    expect(result.game.players.find((p) => p.id === shieldedFaithful.id)?.hasShield).toBe(false);
    expect(result.game.players.find((p) => p.id === shieldedFaithful.id)?.isAlive).toBe(true);
    expect(result.game.phase).toBe('MORNING');
  });
});

// ============= checkWinCondition =============

describe('checkWinCondition()', () => {
  it('returns GAME_END with winner TRAITORS when traitors >= faithful', () => {
    const traitor1 = makePlayer({ role: 'TRAITOR', isAlive: true });
    const traitor2 = makePlayer({ role: 'TRAITOR', isAlive: true });
    const faithful = makePlayer({ role: 'FAITHFUL', isAlive: true });

    const game = makeGame({
      players: [traitor1, traitor2, faithful],
      phase: 'CHECK_WIN',
      currentRound: 2,
    });

    const result = checkWinCondition(game);

    expect(result.phase).toBe('GAME_END');
    expect(result.winner).toBe('TRAITORS');
  });

  it('returns GAME_END with winner FAITHFUL when all traitors are eliminated', () => {
    const deadTraitor = makePlayer({ role: 'TRAITOR', isAlive: false });
    const faithful1 = makePlayer({ role: 'FAITHFUL', isAlive: true });
    const faithful2 = makePlayer({ role: 'FAITHFUL', isAlive: true });

    const game = makeGame({
      players: [deadTraitor, faithful1, faithful2],
      phase: 'CHECK_WIN',
      currentRound: 2,
    });

    const result = checkWinCondition(game);

    expect(result.phase).toBe('GAME_END');
    expect(result.winner).toBe('FAITHFUL');
  });
});

// ============= generateAutoVotes =============

describe('generateAutoVotes()', () => {
  it('generates auto-votes whose target IDs all belong to alive players', () => {
    const players = makePlayers(5);
    const [p1, ...rest] = players as [Player, ...Player[]];

    const game = makeGame({
      players,
      phase: 'VOTING',
      votes: [{ voterId: p1.id, targetId: rest[0]!.id }],
      currentRound: 1,
    });

    const { autoVotes, game: updatedGame } = generateAutoVotes(game);

    const aliveIds = new Set(updatedGame.players.filter((p) => p.isAlive).map((p) => p.id));
    for (const vote of autoVotes) {
      expect(aliveIds.has(vote.targetId)).toBe(true);
    }
  });

  it('reuses the last manual vote target in round 2+ when that player is still alive', () => {
    const players = makePlayers(4);
    const [voter, lastTarget, ...others] = players as [Player, Player, ...Player[]];

    const game = makeGame({
      players,
      phase: 'VOTING',
      votes: others.map((p) => ({ voterId: p.id, targetId: lastTarget.id })),
      currentRound: 2,
      lastManualVotes: { [voter.id]: lastTarget.id },
    });

    const { autoVotes } = generateAutoVotes(game);

    const voterAutoVote = autoVotes.find((v) => v.voterId === voter.id);
    expect(voterAutoVote).toBeDefined();
    expect(voterAutoVote!.targetId).toBe(lastTarget.id);
  });
});
