import { describe, it, expect } from 'vitest';
import {
  assignRoles,
  submitVote,
  banishPlayer,
  resolveMurder,
  checkWinCondition,
  generateAutoVotes,
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
