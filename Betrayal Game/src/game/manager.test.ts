import { describe, it, expect } from 'vitest';
import {
  assignRoles,
  submitVote,
  banishPlayer,
  resolveMurder,
  checkWinCondition,
  generateAutoVotes,
  medicProtect,
  activateSeer,
  performSheriffInvestigation,
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

// ============= Special roles: assignment thresholds =============

describe('assignRoles() — special roles', () => {
  it('assigns Sheriff at 7 players (no Medic/Seer yet)', () => {
    const players = makePlayers(7);
    const game = makeGame({ players, phase: 'ROLE_ASSIGN' });
    const result = assignRoles(game);
    const roles = result.players.map((p) => p.role).filter(Boolean);
    expect(roles.filter((r) => r === 'SHERIFF')).toHaveLength(1);
    expect(roles.filter((r) => r === 'MEDIC')).toHaveLength(0);
    expect(roles.filter((r) => r === 'SEER')).toHaveLength(0);
  });

  it('assigns Sheriff + Medic at 8 players', () => {
    const players = makePlayers(8);
    const game = makeGame({ players, phase: 'ROLE_ASSIGN' });
    const result = assignRoles(game);
    const roles = result.players.map((p) => p.role).filter(Boolean);
    expect(roles.filter((r) => r === 'SHERIFF')).toHaveLength(1);
    expect(roles.filter((r) => r === 'MEDIC')).toHaveLength(1);
    expect(roles.filter((r) => r === 'SEER')).toHaveLength(0);
  });

  it('assigns Sheriff + Medic + Seer at 9 players', () => {
    const players = makePlayers(9);
    const game = makeGame({ players, phase: 'ROLE_ASSIGN' });
    const result = assignRoles(game);
    const roles = result.players.map((p) => p.role).filter(Boolean);
    expect(roles.filter((r) => r === 'SHERIFF')).toHaveLength(1);
    expect(roles.filter((r) => r === 'MEDIC')).toHaveLength(1);
    expect(roles.filter((r) => r === 'SEER')).toHaveLength(1);
  });

  it('does not assign any special roles when enableSpecialRoles is false', () => {
    const players = makePlayers(12);
    const game = makeGame({
      players,
      phase: 'ROLE_ASSIGN',
      settings: { ...DEFAULT_SETTINGS, enableSpecialRoles: false },
    });
    const result = assignRoles(game);
    for (const p of result.players) {
      expect(p.role === 'SHERIFF' || p.role === 'MEDIC' || p.role === 'SEER').toBe(false);
    }
  });

  it('never overlaps a special role with a Traitor', () => {
    const players = makePlayers(12);
    const game = makeGame({ players, phase: 'ROLE_ASSIGN' });
    const result = assignRoles(game);
    for (const p of result.players) {
      if (p.role === 'SHERIFF' || p.role === 'MEDIC' || p.role === 'SEER') {
        expect(p.role).not.toBe('TRAITOR');
      }
    }
  });
});

// ============= Sheriff =============

describe('performSheriffInvestigation()', () => {
  it('returns no-op when no alive sheriff exists', () => {
    const players = makePlayers(5).map((p) => ({ ...p, role: 'FAITHFUL' as const }));
    const game = makeGame({ players, phase: 'NIGHT' });
    const out = performSheriffInvestigation(game);
    expect(out.investigation).toBeUndefined();
  });

  it('reports SUSPICIOUS for a Traitor target when not inverted', () => {
    const restore = Math.random;
    // First call: candidate selection (use 0 → first candidate). Second call: inversion test (≥0.25 → no invert).
    const seq = [0, 0.99];
    let i = 0;
    Math.random = () => seq[i++ % seq.length]!;
    try {
      const sheriff = makePlayer({ role: 'SHERIFF' });
      const traitor = makePlayer({ role: 'TRAITOR' });
      const others = [makePlayer({ role: 'FAITHFUL' }), makePlayer({ role: 'FAITHFUL' })];
      // Order players so the traitor is the first non-sheriff candidate.
      const players = [sheriff, traitor, ...others];
      const game = makeGame({ players, phase: 'NIGHT', currentRound: 2 });
      const out = performSheriffInvestigation(game);
      expect(out.investigation).toBeDefined();
      expect(out.investigation!.targetId).toBe(traitor.id);
      expect(out.investigation!.displayedResult).toBe('SUSPICIOUS');
      const updatedSheriff = out.game.players.find((p) => p.id === sheriff.id)!;
      expect(updatedSheriff.sheriffInvestigations).toHaveLength(1);
    } finally {
      Math.random = restore;
    }
  });

  it('inverts the result when the inversion seam fires (<0.25)', () => {
    const restore = Math.random;
    const seq = [0, 0.1]; // pick first candidate, invert
    let i = 0;
    Math.random = () => seq[i++ % seq.length]!;
    try {
      const sheriff = makePlayer({ role: 'SHERIFF' });
      const traitor = makePlayer({ role: 'TRAITOR' });
      const players = [sheriff, traitor, makePlayer({ role: 'FAITHFUL' })];
      const game = makeGame({ players, phase: 'NIGHT', currentRound: 1 });
      const out = performSheriffInvestigation(game);
      expect(out.investigation!.displayedResult).toBe('CLEAR');
    } finally {
      Math.random = restore;
    }
  });
});

// ============= Medic =============

describe('medicProtect()', () => {
  function setup() {
    const medic = makePlayer({ role: 'MEDIC' });
    const a = makePlayer({ role: 'FAITHFUL' });
    const b = makePlayer({ role: 'FAITHFUL' });
    const players = [medic, a, b];
    const game = makeGame({ players, phase: 'NIGHT' });
    return { medic, a, b, game };
  }

  it('stores medicProtectedTargetId on the game', () => {
    const { medic, a, game } = setup();
    const { game: g2 } = medicProtect(game, medic.id, a.id);
    expect(g2.medicProtectedTargetId).toBe(a.id);
  });

  it('rejects self-protection', () => {
    const { medic, game } = setup();
    expect(() => medicProtect(game, medic.id, medic.id)).toThrow();
  });

  it('rejects protecting the same player two nights in a row', () => {
    const { medic, a, game } = setup();
    const { game: g2 } = medicProtect(game, medic.id, a.id);
    expect(() => medicProtect(g2, medic.id, a.id)).toThrow();
  });

  it('blocks the murder silently when the murder target equals the protected player', () => {
    const traitor = makePlayer({ role: 'TRAITOR' });
    const medic = makePlayer({ role: 'MEDIC' });
    const victim = makePlayer({ role: 'FAITHFUL' });
    const bystander = makePlayer({ role: 'FAITHFUL' });
    const players = [traitor, medic, victim, bystander];
    const baseGame = makeGame({
      players,
      phase: 'NIGHT',
      murderVotes: [{ voterId: traitor.id, targetId: victim.id }],
    });
    const { game: protectedGame } = medicProtect(baseGame, medic.id, victim.id);
    const result = resolveMurder(protectedGame);
    expect(result.game.lastMurderBlocked).toBe(true);
    expect(result.game.lastMurderedPlayerId).toBeUndefined();
    const stillAlive = result.game.players.find((p) => p.id === victim.id)!;
    expect(stillAlive.isAlive).toBe(true);
    expect(result.game.medicProtectedTargetId).toBeUndefined();
  });
});

// ============= Seer =============

describe('activateSeer()', () => {
  it('returns target true role and marks gift used at current round', () => {
    const restore = Math.random;
    Math.random = () => 0;
    try {
      const seer = makePlayer({ role: 'SEER' });
      const traitor = makePlayer({ role: 'TRAITOR' });
      const players = [seer, traitor, makePlayer({ role: 'FAITHFUL' })];
      const game = makeGame({ players, phase: 'ROUNDTABLE', currentRound: 3 });
      const out = activateSeer(game, seer.id);
      expect(out.targetRole).toBe('TRAITOR');
      expect(out.round).toBe(3);
      const updatedSeer = out.game.players.find((p) => p.id === seer.id)!;
      expect(updatedSeer.seerUsedAtRound).toBe(3);
    } finally {
      Math.random = restore;
    }
  });

  it('rejects a second activation (one-shot)', () => {
    const seer = makePlayer({ role: 'SEER', seerUsedAtRound: 1 });
    const players = [seer, makePlayer({ role: 'FAITHFUL' }), makePlayer({ role: 'TRAITOR' })];
    const game = makeGame({ players, phase: 'ROUNDTABLE', currentRound: 2 });
    expect(() => activateSeer(game, seer.id)).toThrow();
  });

  it('rejects activation outside ROUNDTABLE', () => {
    const seer = makePlayer({ role: 'SEER' });
    const players = [seer, makePlayer({ role: 'TRAITOR' })];
    const game = makeGame({ players, phase: 'NIGHT' });
    expect(() => activateSeer(game, seer.id)).toThrow();
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
