import { describe, it, expect, vi, afterEach } from 'vitest';
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
  sendWhisper,
  WHISPER_MAX_LENGTH,
  removePlayer,
  submitRecruitment,
  createChallenge,
  submitChallengeAnswer,
  resolveChallenge,
  startNight,
  submitMurder,
  continueToDayPhase,
  startRevote,
  startVoting,
  revealVotes,
  generateAutoMurderVotes,
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
    whispers: [],
    whispersUsedThisRound: [],
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
    const { investigations: reports } = runSheriffInvestigations(game);
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
      const { investigations: truthful } = runSheriffInvestigations(game);
      expect(truthful[0]!.reportedRole).toBe('TRAITOR');

      i = 0; Math.random = () => [0, 0.1][i++ % 2]!;
      const { investigations: inverted } = runSheriffInvestigations(game);
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

  it('archives the literal target role on currentSeerReveal even for special roles', () => {
    const seer = makePlayer({ role: 'SEER' });
    const sheriff = makePlayer({ role: 'SHERIFF' });
    const game = makeGame({ players: [seer, sheriff], phase: 'ROUNDTABLE' });
    const out = activateSeer(game, seer.id);
    expect(out.actualRole).toBe('SHERIFF');
    expect(out.game.currentSeerReveal).toBeDefined();
    expect(out.game.currentSeerReveal!.actualRole).toBe('SHERIFF');
    expect(out.game.currentSeerReveal!.targetId).toBe(sheriff.id);
    expect(out.game.currentSeerReveal!.seerId).toBe(seer.id);
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

// ============= sendWhisper =============

describe('sendWhisper()', () => {
  it('appends a whisper, marks the sender as used, and returns the whisper', () => {
    const sender = makePlayer();
    const recipient = makePlayer();
    const game = makeGame({ players: [sender, recipient], phase: 'ROUNDTABLE', currentRound: 2 });
    const out = sendWhisper(game, sender.id, recipient.id, '  hello there  ');
    expect(out.whisper.content).toBe('hello there');
    expect(out.whisper.senderId).toBe(sender.id);
    expect(out.whisper.recipientId).toBe(recipient.id);
    expect(out.whisper.round).toBe(2);
    expect(out.game.whispers).toHaveLength(1);
    expect(out.game.whispersUsedThisRound).toEqual([sender.id]);
  });

  it('rejects a second whisper from the same sender in the same round', () => {
    const a = makePlayer();
    const b = makePlayer();
    const c = makePlayer();
    const game = makeGame({ players: [a, b, c], phase: 'ROUNDTABLE' });
    const first = sendWhisper(game, a.id, b.id, 'hi');
    expect(() => sendWhisper(first.game, a.id, c.id, 'again')).toThrow();
  });

  it('rejects whispers when not in the ROUNDTABLE phase', () => {
    const a = makePlayer();
    const b = makePlayer();
    const game = makeGame({ players: [a, b], phase: 'VOTING' });
    expect(() => sendWhisper(game, a.id, b.id, 'hey')).toThrow();
  });

  it('rejects whispering yourself', () => {
    const a = makePlayer();
    const game = makeGame({ players: [a, makePlayer()], phase: 'ROUNDTABLE' });
    expect(() => sendWhisper(game, a.id, a.id, 'hey')).toThrow();
  });

  it('rejects whispers when sender or recipient is dead', () => {
    const dead = makePlayer({ isAlive: false });
    const alive = makePlayer();
    const other = makePlayer();
    const g1 = makeGame({ players: [dead, alive, other], phase: 'ROUNDTABLE' });
    expect(() => sendWhisper(g1, dead.id, alive.id, 'hey')).toThrow();
    const deadTarget = makePlayer({ isAlive: false });
    const sender = makePlayer();
    const g2 = makeGame({ players: [sender, deadTarget], phase: 'ROUNDTABLE' });
    expect(() => sendWhisper(g2, sender.id, deadTarget.id, 'hey')).toThrow();
  });

  it('rejects empty / whitespace-only and over-cap content', () => {
    const a = makePlayer();
    const b = makePlayer();
    const game = makeGame({ players: [a, b], phase: 'ROUNDTABLE' });
    expect(() => sendWhisper(game, a.id, b.id, '   ')).toThrow();
    expect(() => sendWhisper(game, a.id, b.id, 'x'.repeat(WHISPER_MAX_LENGTH + 1))).toThrow();
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

// ============= revote -> reveal =============

describe('revealVotes() after a revote', () => {
  it('does not throw once every alive player has cast a revote, and moves to VOTE_REVEAL', () => {
    const players = makePlayers(4);
    const [a, b, c, d] = players as [Player, Player, Player, Player];

    // The tie that produced this TIE_DETECTED state came from a completed
    // VOTING round, which leaves votingLocked: true on the game — exactly
    // as the real router does once every alive player has voted.
    const tieGame = makeGame({
      players,
      phase: 'TIE_DETECTED',
      tiedPlayerIds: [a.id, b.id],
      votingLocked: true,
    });
    const revoteGame = startRevote(tieGame);
    expect(revoteGame.phase).toBe('REVOTE');
    // Router gates C2S_SUBMIT_REVOTE on `!gameState.votingLocked` — if this
    // stays true from the original vote, every revote is silently rejected.
    expect(revoteGame.votingLocked).toBe(false);

    let game = revoteGame;
    for (const voter of [a, b, c, d]) {
      game = submitVote(game, voter.id, voter.id === a.id ? b.id : a.id);
    }

    expect(() => revealVotes(game)).not.toThrow();
    const revealed = revealVotes(game);
    expect(revealed.phase).toBe('VOTE_REVEAL');
    expect(revealed.revealedVotes).toHaveLength(4);
  });
});

describe('startVoting()', () => {
  it('clears votingLocked left over from a previous round', () => {
    const players = makePlayers(4);
    const game = makeGame({
      players,
      phase: 'ROUNDTABLE',
      votingLocked: true,
    });
    const voting = startVoting(game);
    expect(voting.phase).toBe('VOTING');
    expect(voting.votingLocked).toBe(false);
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

// ============= removePlayer =============

describe('removePlayer()', () => {
  it('drops the target from players[] and scrubs vote rows on both sides', () => {
    const players = makePlayers(4);
    const [host, victim, voterA, voterB] = players as [Player, Player, Player, Player];
    host.isHost = true;
    const game = makeGame({
      players: [host, victim, voterA, voterB],
      hostId: host.id,
      phase: 'VOTING',
      votes: [
        { voterId: voterA.id, targetId: victim.id },
        { voterId: victim.id, targetId: voterB.id },
        { voterId: voterB.id, targetId: voterA.id },
      ],
      revealedVotes: [
        { voterId: voterA.id, targetId: victim.id },
      ],
      murderVotes: [{ voterId: victim.id, targetId: voterB.id }],
      currentTally: [
        { playerId: victim.id, playerName: victim.name, voteCount: 1 },
        { playerId: voterA.id, playerName: voterA.name, voteCount: 1 },
      ],
      tiedPlayerIds: [victim.id, voterA.id],
      revealOrder: [voterA.id, victim.id, voterB.id],
    });

    const { game: next, hostChanged } = removePlayer(game, victim.id);

    expect(next.players.find((p) => p.id === victim.id)).toBeUndefined();
    expect(next.players).toHaveLength(3);
    expect(next.votes).toEqual([{ voterId: voterB.id, targetId: voterA.id }]);
    expect(next.revealedVotes).toEqual([]);
    expect(next.murderVotes).toEqual([]);
    expect(next.currentTally).toEqual([
      { playerId: voterA.id, playerName: voterA.name, voteCount: 1 },
    ]);
    expect(next.tiedPlayerIds).toEqual([voterA.id]);
    expect(next.revealOrder).toEqual([voterA.id, voterB.id]);
    expect(hostChanged).toBe(false);
    expect(next.hostId).toBe(host.id);
  });

  it('auto-transfers host to a connected survivor when the host is removed', () => {
    const host = makePlayer({ isHost: true });
    const a = makePlayer({ isConnected: false });
    const b = makePlayer();
    const game = makeGame({
      players: [host, a, b],
      hostId: host.id,
      phase: 'ROUNDTABLE',
    });

    const { game: next, hostChanged, newHostId } = removePlayer(game, host.id);

    expect(hostChanged).toBe(true);
    // Prefers a connected player over the away player.
    expect(newHostId).toBe(b.id);
    expect(next.hostId).toBe(b.id);
    expect(next.players.find((p) => p.id === b.id)?.isHost).toBe(true);
    expect(next.players.find((p) => p.id === a.id)?.isHost).toBe(false);
  });

  it('clears state slots that referenced the removed player', () => {
    const host = makePlayer({ isHost: true });
    const target = makePlayer();
    const game = makeGame({
      players: [host, target],
      hostId: host.id,
      phase: 'NIGHT',
      banishedPlayerId: target.id,
      lastMurderedPlayerId: target.id,
      lastShieldedPlayerId: target.id,
      randomlySelectedPlayerId: target.id,
      pendingRecruitmentTargetId: target.id,
      lastRecruitedPlayerId: target.id,
      medicProtectionTargetId: target.id,
      whispersUsedThisRound: [target.id, host.id],
      confessionSubmittedIds: [target.id],
      confessionEntries: [{ id: 'c1', playerId: target.id, text: 'oops' }],
    });

    const { game: next } = removePlayer(game, target.id);

    expect(next.banishedPlayerId).toBeUndefined();
    expect(next.lastMurderedPlayerId).toBeUndefined();
    expect(next.lastShieldedPlayerId).toBeUndefined();
    expect(next.randomlySelectedPlayerId).toBeUndefined();
    expect(next.pendingRecruitmentTargetId).toBeUndefined();
    expect(next.lastRecruitedPlayerId).toBeUndefined();
    expect(next.medicProtectionTargetId).toBeUndefined();
    expect(next.whispersUsedThisRound).toEqual([host.id]);
    expect(next.confessionSubmittedIds).toEqual([]);
    expect(next.confessionEntries).toEqual([]);
  });

  it('scrubs Suspicion Token edges, submission ids, and the current-round archive', () => {
    const host = makePlayer({ isHost: true });
    const target = makePlayer();
    const other = makePlayer();
    const game = makeGame({
      players: [host, target, other],
      hostId: host.id,
      phase: 'ROUNDTABLE',
      currentRound: 2,
      tokenPhase: 'PLACEMENT',
      tokensSubmittedIds: [host.id, target.id],
      suspicionTokensCurrent: [
        { placerId: host.id, targetId: target.id, round: 2 },
        { placerId: target.id, targetId: other.id, round: 2 },
        { placerId: other.id, targetId: host.id, round: 2 },
      ],
      suspicionTokensByRound: {
        1: [{ placerId: other.id, targetId: target.id, round: 1 }],
        2: [
          { placerId: host.id, targetId: target.id, round: 2 },
          { placerId: other.id, targetId: host.id, round: 2 },
        ],
      },
    });

    const { game: next } = removePlayer(game, target.id);

    expect(next.tokensSubmittedIds).toEqual([host.id]);
    expect(next.suspicionTokensCurrent).toEqual([
      { placerId: other.id, targetId: host.id, round: 2 },
    ]);
    // Prior-round archive is untouched; current round is scrubbed.
    expect(next.suspicionTokensByRound?.[1]).toEqual([
      { placerId: other.id, targetId: target.id, round: 1 },
    ]);
    expect(next.suspicionTokensByRound?.[2]).toEqual([
      { placerId: other.id, targetId: host.id, round: 2 },
    ]);
  });

  it('throws when the target does not exist or is the only player', () => {
    const solo = makePlayer({ isHost: true });
    const game = makeGame({ players: [solo], hostId: solo.id });
    expect(() => removePlayer(game, solo.id)).toThrow(/only player/);
    expect(() => removePlayer(game, 'no-such-id')).toThrow(/not found/);
  });
});

// ============= submitRecruitment =============

describe('submitRecruitment()', () => {
  it('records the pending recruitment and marks the recruiter as having used the ability', () => {
    const traitor = makePlayer({ role: 'TRAITOR' });
    const target = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({ players: [traitor, target], phase: 'NIGHT' });

    const out = submitRecruitment(game, traitor.id, target.id);

    expect(out.pendingRecruitmentTargetId).toBe(target.id);
    expect(out.players.find((p) => p.id === traitor.id)?.recruitmentUsed).toBe(true);
    // Target's role isn't flipped until resolveMurder runs.
    expect(out.players.find((p) => p.id === target.id)?.role).toBe('FAITHFUL');
  });

  it('rejects when not in NIGHT phase', () => {
    const traitor = makePlayer({ role: 'TRAITOR' });
    const target = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({ players: [traitor, target], phase: 'ROUNDTABLE' });
    expect(() => submitRecruitment(game, traitor.id, target.id)).toThrow(/night/);
  });

  it('rejects when the caller is not an alive Traitor', () => {
    const faithful = makePlayer({ role: 'FAITHFUL' });
    const target = makePlayer({ role: 'FAITHFUL' });
    const deadTraitor = makePlayer({ role: 'TRAITOR', isAlive: false });
    const game = makeGame({
      players: [faithful, target, deadTraitor],
      phase: 'NIGHT',
    });
    expect(() => submitRecruitment(game, faithful.id, target.id)).toThrow(/traitors/i);
    expect(() => submitRecruitment(game, deadTraitor.id, target.id)).toThrow(/traitors/i);
  });

  it('rejects when the recruiter has already used recruitment this game', () => {
    const traitor = makePlayer({ role: 'TRAITOR', recruitmentUsed: true });
    const target = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({ players: [traitor, target], phase: 'NIGHT' });
    expect(() => submitRecruitment(game, traitor.id, target.id)).toThrow(/already used/i);
  });

  it('rejects when a recruitment is already pending this night', () => {
    const traitor = makePlayer({ role: 'TRAITOR' });
    const target = makePlayer({ role: 'FAITHFUL' });
    const otherTarget = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({
      players: [traitor, target, otherTarget],
      phase: 'NIGHT',
      pendingRecruitmentTargetId: otherTarget.id,
    });
    expect(() => submitRecruitment(game, traitor.id, target.id)).toThrow(/already pending/i);
  });

  it('rejects targeting another Traitor (non-Faithful target)', () => {
    const traitor = makePlayer({ role: 'TRAITOR' });
    const otherTraitor = makePlayer({ role: 'TRAITOR' });
    const game = makeGame({ players: [traitor, otherTraitor], phase: 'NIGHT' });
    expect(() => submitRecruitment(game, traitor.id, otherTraitor.id)).toThrow(/Faithful/);
  });

  it('rejects targeting a dead player', () => {
    const traitor = makePlayer({ role: 'TRAITOR' });
    const deadTarget = makePlayer({ role: 'FAITHFUL', isAlive: false });
    const game = makeGame({ players: [traitor, deadTarget], phase: 'NIGHT' });
    expect(() => submitRecruitment(game, traitor.id, deadTarget.id)).toThrow();
  });
});

// ============= resolveMurder() with pending recruitment =============

describe('resolveMurder() — pending recruitment', () => {
  it('flips the recruited player to TRAITOR and exposes lastRecruitedPlayerId on a successful murder', () => {
    const traitor = makePlayer({ role: 'TRAITOR' });
    const victim = makePlayer({ role: 'FAITHFUL' });
    const recruit = makePlayer({ role: 'SHERIFF' });
    const game = makeGame({
      players: [traitor, victim, recruit],
      phase: 'NIGHT',
      murderVotes: [{ voterId: traitor.id, targetId: victim.id }],
      pendingRecruitmentTargetId: recruit.id,
    });

    const result = resolveMurder(game);

    expect(result.blocked).toBe(false);
    expect(result.murderedPlayerId).toBe(victim.id);
    expect(result.recruitedPlayerId).toBe(recruit.id);
    expect(result.recruitedPlayerName).toBe(recruit.name);
    // Recruited player is flipped to TRAITOR and marked as having used recruitment.
    const flipped = result.game.players.find((p) => p.id === recruit.id)!;
    expect(flipped.role).toBe('TRAITOR');
    expect(flipped.isAlive).toBe(true);
    expect(flipped.recruitmentUsed).toBe(true);
    // pending field cleared, last-recruited surfaced for morning UI.
    expect(result.game.pendingRecruitmentTargetId).toBeUndefined();
    expect(result.game.lastRecruitedPlayerId).toBe(recruit.id);
  });

  it('still applies the recruitment when the murder is blocked by a shield', () => {
    const traitor = makePlayer({ role: 'TRAITOR' });
    const shielded = makePlayer({ role: 'FAITHFUL', hasShield: true });
    const recruit = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({
      players: [traitor, shielded, recruit],
      phase: 'NIGHT',
      murderVotes: [{ voterId: traitor.id, targetId: shielded.id }],
      pendingRecruitmentTargetId: recruit.id,
    });

    const result = resolveMurder(game);

    expect(result.blocked).toBe(true);
    expect(result.shieldedPlayerId).toBe(shielded.id);
    expect(result.recruitedPlayerId).toBe(recruit.id);
    const flipped = result.game.players.find((p) => p.id === recruit.id)!;
    expect(flipped.role).toBe('TRAITOR');
    expect(flipped.isAlive).toBe(true);
    expect(result.game.lastRecruitedPlayerId).toBe(recruit.id);
    expect(result.game.pendingRecruitmentTargetId).toBeUndefined();
  });

  it('still applies the recruitment when the murder is silently blocked by the Medic', () => {
    const traitor = makePlayer({ role: 'TRAITOR' });
    const victim = makePlayer({ role: 'FAITHFUL' });
    const recruit = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({
      players: [traitor, victim, recruit],
      phase: 'NIGHT',
      murderVotes: [{ voterId: traitor.id, targetId: victim.id }],
      medicProtectionTargetId: victim.id,
      pendingRecruitmentTargetId: recruit.id,
    });

    const result = resolveMurder(game);

    expect(result.blocked).toBe(true);
    expect(result.shieldedPlayerId).toBeUndefined();
    expect(result.recruitedPlayerId).toBe(recruit.id);
    const flipped = result.game.players.find((p) => p.id === recruit.id)!;
    expect(flipped.role).toBe('TRAITOR');
    expect(flipped.isAlive).toBe(true);
    expect(result.game.lastRecruitedPlayerId).toBe(recruit.id);
    expect(result.game.pendingRecruitmentTargetId).toBeUndefined();
  });
});

// ============= CHALLENGE SYSTEM =============

function makeChallengeGame(playerCount: number, currentRound = 1): GameState {
  const players = makePlayers(playerCount).map((p) => ({ ...p, role: 'FAITHFUL' as const }));
  return makeGame({ players, phase: 'CHALLENGE', currentRound });
}

describe('createChallenge()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Pin Math.random so each test deterministically picks one of the
  // three challenge types (index = floor(random * 3)).
  it('produces valid TIME_ESTIMATE state with a target between 4 and 8 seconds', () => {
    const seq = [0.0, 0.5];
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]!);

    const game = makeChallengeGame(6);
    const { challenge } = createChallenge(game);
    expect(challenge.type).toBe('TIME_ESTIMATE');
    expect(challenge.completed).toBe(false);
    expect(challenge.answers.size).toBe(0);
    expect(typeof challenge.startTime).toBe('number');
    expect(challenge.targetTime).toBeGreaterThanOrEqual(4);
    expect(challenge.targetTime).toBeLessThanOrEqual(8);
    expect(challenge.shownPlayerIds).toBeUndefined();
    expect(challenge.correctWord).toBeUndefined();
  });

  it('produces valid MISSING_PLAYER state with a hidden player drawn from the shown set', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.4);

    const game = makeChallengeGame(6);
    const { challenge } = createChallenge(game);
    expect(challenge.type).toBe('MISSING_PLAYER');
    expect(challenge.completed).toBe(false);
    expect(challenge.answers.size).toBe(0);
    expect(challenge.shownPlayerIds).toBeDefined();
    expect(challenge.shownPlayerIds!.length).toBeGreaterThan(0);
    expect(challenge.shownPlayerIds!.length).toBeLessThanOrEqual(6);
    expect(challenge.hiddenPlayerId).toBeDefined();
    expect(challenge.shownPlayerIds!).toContain(challenge.hiddenPlayerId!);
    // Hidden player is one of the alive players in the game.
    const aliveIds = new Set(game.players.filter((p) => p.isAlive).map((p) => p.id));
    expect(aliveIds.has(challenge.hiddenPlayerId!)).toBe(true);
  });

  it('produces valid WORD_SCRAMBLE state with a known word and same-length scramble', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);

    const game = makeChallengeGame(6);
    const { challenge } = createChallenge(game);
    expect(challenge.type).toBe('WORD_SCRAMBLE');
    expect(challenge.completed).toBe(false);
    expect(challenge.answers.size).toBe(0);
    expect(challenge.correctWord).toBeDefined();
    expect(challenge.scrambledWord).toBeDefined();
    expect(challenge.scrambledWord!.length).toBe(challenge.correctWord!.length);
    // scramble is a permutation of the original
    const sortChars = (s: string) => s.split('').sort().join('');
    expect(sortChars(challenge.scrambledWord!)).toBe(sortChars(challenge.correctWord!));
  });

  it('transitions the game phase to CHALLENGE', () => {
    const game = makeChallengeGame(5);
    const result = createChallenge({ ...game, phase: 'ROUNDTABLE' });
    expect(result.game.phase).toBe('CHALLENGE');
    expect(result.game.challenge).toBeDefined();
  });
});

describe('submitChallengeAnswer()', () => {
  it('records the answer in the challenge state', () => {
    const game = makeChallengeGame(3);
    const word = 'table';
    const target: GameState = {
      ...game,
      challenge: {
        type: 'WORD_SCRAMBLE',
        startTime: Date.now(),
        answers: new Map(),
        completed: false,
        correctWord: word,
        scrambledWord: 'btale',
      },
    };

    const result = submitChallengeAnswer(target, target.players[0]!.id, word);
    expect(result.isCorrect).toBe(true);
    expect(result.game.challenge!.answers.has(target.players[0]!.id)).toBe(true);
    expect(result.game.challenge!.answers.get(target.players[0]!.id)!.answer).toBe(word);
  });

  it('returns isCorrect=false (and does not re-record) when the player has already answered', () => {
    const game = makeChallengeGame(3);
    const word = 'table';
    let state: GameState = {
      ...game,
      challenge: {
        type: 'WORD_SCRAMBLE',
        startTime: Date.now(),
        answers: new Map(),
        completed: false,
        correctWord: word,
        scrambledWord: 'btale',
      },
    };
    const pid = state.players[0]!.id;
    state = submitChallengeAnswer(state, pid, word).game;
    const second = submitChallengeAnswer(state, pid, 'wrong');
    expect(second.isCorrect).toBe(false);
    expect(second.isWinner).toBe(false);
    // First-write-wins: the original correct answer is still recorded.
    expect(second.game.challenge!.answers.get(pid)!.answer).toBe(word);
  });

  it('marks the challenge completed exactly when the final alive player answers', () => {
    const players = makePlayers(3).map((p) => ({ ...p, role: 'FAITHFUL' as const }));
    // Mark one player dead so we only need answers from the alive 2.
    players[2] = { ...players[2]!, isAlive: false };
    const game = makeGame({ players, phase: 'CHALLENGE', currentRound: 1 });
    const word = 'table';
    let state: GameState = {
      ...game,
      challenge: {
        type: 'WORD_SCRAMBLE',
        startTime: Date.now(),
        answers: new Map(),
        completed: false,
        correctWord: word,
        scrambledWord: 'btale',
      },
    };
    // After the first alive player answers, completion is still false.
    const afterFirst = submitChallengeAnswer(state, players[0]!.id, word);
    expect(afterFirst.game.challenge!.answers.size).toBe(1);
    expect(afterFirst.game.challenge!.completed).toBe(false);

    // After the last alive player answers, submitChallengeAnswer itself
    // flips `completed` to true (no resolveChallenge required).
    const afterLast = submitChallengeAnswer(afterFirst.game, players[1]!.id, 'xxxxx');
    expect(afterLast.game.challenge!.answers.size).toBe(2);
    expect(afterLast.game.challenge!.completed).toBe(true);

    // The dead player's lack of an answer must not prevent completion,
    // and resolveChallenge still advances the phase as before.
    const resolved = resolveChallenge(afterLast.game);
    expect(resolved.game.phase).toBe('CHALLENGE_RESULT');
    expect(resolved.game.challenge!.completed).toBe(true);
  });

  it('rejects submission when not in CHALLENGE phase', () => {
    const game = makeChallengeGame(3);
    expect(() =>
      submitChallengeAnswer({ ...game, phase: 'ROUNDTABLE' }, game.players[0]!.id, 'x'),
    ).toThrow();
  });

  it('rejects submission from a dead player', () => {
    const game = makeChallengeGame(3);
    const dead = { ...game.players[0]!, isAlive: false };
    const state: GameState = {
      ...game,
      players: [dead, ...game.players.slice(1)],
      challenge: {
        type: 'WORD_SCRAMBLE',
        startTime: Date.now(),
        answers: new Map(),
        completed: false,
        correctWord: 'table',
        scrambledWord: 'btale',
      },
    };
    expect(() => submitChallengeAnswer(state, dead.id, 'table')).toThrow();
  });
});

describe('resolveChallenge() — TIME_ESTIMATE', () => {
  it('picks the player whose guess is closest to the target', () => {
    const game = makeChallengeGame(3);
    const [a, b, c] = game.players;
    const answers = new Map<string, { answer: string | number; timestamp: number }>([
      [a!.id, { answer: 3, timestamp: 100 }],
      [b!.id, { answer: 5, timestamp: 200 }],
      [c!.id, { answer: 9, timestamp: 300 }],
    ]);
    const state: GameState = {
      ...game,
      challenge: {
        type: 'TIME_ESTIMATE',
        startTime: 0,
        answers,
        completed: false,
        targetTime: 6,
      },
    };

    const result = resolveChallenge(state);
    expect(result.winnerId).toBe(b!.id);
    expect(result.correctAnswer).toBe(6);
    expect(result.shieldAwarded).toBe(true);
  });

  it('breaks ties by earliest submission timestamp', () => {
    const game = makeChallengeGame(3);
    const [a, b] = game.players;
    const answers = new Map<string, { answer: string | number; timestamp: number }>([
      // Both are equidistant from 5 (diff=2). The earlier submitter wins.
      [a!.id, { answer: 7, timestamp: 500 }],
      [b!.id, { answer: 3, timestamp: 200 }],
    ]);
    const state: GameState = {
      ...game,
      challenge: {
        type: 'TIME_ESTIMATE',
        startTime: 0,
        answers,
        completed: false,
        targetTime: 5,
      },
    };

    const result = resolveChallenge(state);
    expect(result.winnerId).toBe(b!.id);
  });

  it('returns no winner when no players answered', () => {
    const game = makeChallengeGame(3);
    const state: GameState = {
      ...game,
      challenge: {
        type: 'TIME_ESTIMATE',
        startTime: 0,
        answers: new Map(),
        completed: false,
        targetTime: 5,
      },
    };
    const result = resolveChallenge(state);
    expect(result.winnerId).toBeUndefined();
    expect(result.shieldAwarded).toBe(false);
  });
});

describe('resolveChallenge() — MISSING_PLAYER', () => {
  it('awards the win to the first player who names the hidden player (case-insensitive)', () => {
    const game = makeChallengeGame(4);
    const [a, b, c, hidden] = game.players;
    const state: GameState = {
      ...game,
      challenge: {
        type: 'MISSING_PLAYER',
        startTime: 0,
        answers: new Map(),
        completed: false,
        shownPlayerIds: [a!.id, b!.id, c!.id, hidden!.id],
        hiddenPlayerId: hidden!.id,
      },
    };

    let next = submitChallengeAnswer(state, a!.id, 'wrong-name');
    expect(next.isCorrect).toBe(false);
    expect(next.isWinner).toBe(false);

    next = submitChallengeAnswer(next.game, b!.id, hidden!.name.toUpperCase());
    expect(next.isCorrect).toBe(true);
    expect(next.isWinner).toBe(true);

    // A later correct answer must NOT steal the win.
    next = submitChallengeAnswer(next.game, c!.id, hidden!.name);
    expect(next.isCorrect).toBe(true);
    expect(next.isWinner).toBe(false);

    const resolved = resolveChallenge(next.game);
    expect(resolved.winnerId).toBe(b!.id);
    expect(resolved.correctAnswer).toBe(hidden!.name);
    expect(resolved.shieldAwarded).toBe(true);
  });

  it('also accepts the hidden player id as a valid answer', () => {
    const game = makeChallengeGame(3);
    const [a, , hidden] = game.players;
    const state: GameState = {
      ...game,
      challenge: {
        type: 'MISSING_PLAYER',
        startTime: 0,
        answers: new Map(),
        completed: false,
        shownPlayerIds: game.players.map((p) => p.id),
        hiddenPlayerId: hidden!.id,
      },
    };
    const next = submitChallengeAnswer(state, a!.id, hidden!.id);
    expect(next.isCorrect).toBe(true);
    expect(next.isWinner).toBe(true);
  });
});

describe('resolveChallenge() — WORD_SCRAMBLE', () => {
  it('accepts an exact match', () => {
    const game = makeChallengeGame(2);
    const [a] = game.players;
    const state: GameState = {
      ...game,
      challenge: {
        type: 'WORD_SCRAMBLE',
        startTime: 0,
        answers: new Map(),
        completed: false,
        correctWord: 'table',
        scrambledWord: 'btale',
      },
    };
    const next = submitChallengeAnswer(state, a!.id, 'table');
    expect(next.isCorrect).toBe(true);
    expect(next.isWinner).toBe(true);

    const resolved = resolveChallenge(next.game);
    expect(resolved.winnerId).toBe(a!.id);
    expect(resolved.correctAnswer).toBe('table');
    expect(resolved.shieldAwarded).toBe(true);
  });

  it('accepts a single-character typo (Levenshtein distance = 1)', () => {
    const game = makeChallengeGame(3);
    const [a, b] = game.players;
    const state: GameState = {
      ...game,
      challenge: {
        type: 'WORD_SCRAMBLE',
        startTime: 0,
        answers: new Map(),
        completed: false,
        correctWord: 'table',
        scrambledWord: 'btale',
      },
    };
    // substitution
    let next = submitChallengeAnswer(state, a!.id, 'tabke');
    expect(next.isCorrect).toBe(true);
    expect(next.isWinner).toBe(true);
    // a deletion (distance 1) is also accepted but doesn't steal the win
    next = submitChallengeAnswer(next.game, b!.id, 'tale');
    expect(next.isCorrect).toBe(true);
    expect(next.isWinner).toBe(false);
  });

  it('rejects answers with Levenshtein distance > 1', () => {
    const game = makeChallengeGame(2);
    const [a] = game.players;
    const state: GameState = {
      ...game,
      challenge: {
        type: 'WORD_SCRAMBLE',
        startTime: 0,
        answers: new Map(),
        completed: false,
        correctWord: 'table',
        scrambledWord: 'btale',
      },
    };
    const next = submitChallengeAnswer(state, a!.id, 'xxxxx');
    expect(next.isCorrect).toBe(false);
    expect(next.isWinner).toBe(false);

    const resolved = resolveChallenge(next.game);
    expect(resolved.winnerId).toBeUndefined();
    expect(resolved.shieldAwarded).toBe(false);
  });
});

describe('challenge shield cooldown', () => {
  it('prevents a player who won last round from winning again (WORD_SCRAMBLE)', () => {
    const game = makeChallengeGame(3, /* currentRound */ 2);
    const [a, b] = game.players;
    // Player A won the previous round (round 1) and still has the shield.
    const aWithCooldown: Player = { ...a!, lastChallengeWinRound: 1, hasShield: true };
    const state: GameState = {
      ...game,
      players: [aWithCooldown, ...game.players.slice(1)],
      challenge: {
        type: 'WORD_SCRAMBLE',
        startTime: 0,
        answers: new Map(),
        completed: false,
        correctWord: 'table',
        scrambledWord: 'btale',
      },
    };

    const aSubmit = submitChallengeAnswer(state, aWithCooldown.id, 'table');
    expect(aSubmit.isCorrect).toBe(true);
    // On cooldown — answer recorded, but no win.
    expect(aSubmit.isWinner).toBe(false);
    expect(aSubmit.game.challenge!.winnerId).toBeUndefined();

    const bSubmit = submitChallengeAnswer(aSubmit.game, b!.id, 'table');
    expect(bSubmit.isWinner).toBe(true);

    const resolved = resolveChallenge(bSubmit.game);
    expect(resolved.winnerId).toBe(b!.id);
    expect(resolved.shieldAwarded).toBe(true);

    // Player A's shield/cooldown state is untouched.
    const aAfter = resolved.game.players.find((p) => p.id === aWithCooldown.id)!;
    expect(aAfter.lastChallengeWinRound).toBe(1);
    expect(aAfter.hasShield).toBe(true);
    // Player B is now the new winner, with hasShield + cooldown stamp.
    const bAfter = resolved.game.players.find((p) => p.id === b!.id)!;
    expect(bAfter.hasShield).toBe(true);
    expect(bAfter.lastChallengeWinRound).toBe(2);
  });

  it('prevents a player who won last round from winning TIME_ESTIMATE (skipped during resolution)', () => {
    const game = makeChallengeGame(2, /* currentRound */ 5);
    const [a, b] = game.players;
    const aWithCooldown: Player = { ...a!, lastChallengeWinRound: 4, hasShield: true };
    const answers = new Map<string, { answer: string | number; timestamp: number }>([
      // A's guess is closer (perfect), but A is on cooldown, so B should win.
      [aWithCooldown.id, { answer: 6, timestamp: 100 }],
      [b!.id, { answer: 9, timestamp: 200 }],
    ]);
    const state: GameState = {
      ...game,
      players: [aWithCooldown, b!],
      challenge: {
        type: 'TIME_ESTIMATE',
        startTime: 0,
        answers,
        completed: false,
        targetTime: 6,
      },
    };

    const resolved = resolveChallenge(state);
    expect(resolved.winnerId).toBe(b!.id);
  });

  it('does NOT award a shield to a winner who already holds one', () => {
    const game = makeChallengeGame(2);
    const [a] = game.players;
    const aWithShield: Player = { ...a!, hasShield: true };
    const state: GameState = {
      ...game,
      players: [aWithShield, ...game.players.slice(1)],
      challenge: {
        type: 'WORD_SCRAMBLE',
        startTime: 0,
        answers: new Map(),
        completed: false,
        correctWord: 'table',
        scrambledWord: 'btale',
      },
    };
    const next = submitChallengeAnswer(state, aWithShield.id, 'table');
    expect(next.isWinner).toBe(true);

    const resolved = resolveChallenge(next.game);
    expect(resolved.winnerId).toBe(aWithShield.id);
    // shield was already held — no new award, lastChallengeWinRound stays put.
    expect(resolved.shieldAwarded).toBe(false);
    const aAfter = resolved.game.players.find((p) => p.id === aWithShield.id)!;
    expect(aAfter.hasShield).toBe(true);
    expect(aAfter.lastChallengeWinRound).toBeUndefined();
  });
});

// ============= Full night-cycle smoke test =============

describe('full night cycle (startNight → submitMurder → resolveMurder → continueToDayPhase)', () => {
  it('walks a 5-player game through one full night cycle and advances to the next round', () => {
    const traitor = makePlayer({ name: 'Traitor', role: 'TRAITOR' });
    const victim = makePlayer({ name: 'Victim', role: 'FAITHFUL' });
    const f2 = makePlayer({ name: 'Faithful2', role: 'FAITHFUL' });
    const f3 = makePlayer({ name: 'Faithful3', role: 'FAITHFUL' });
    const f4 = makePlayer({ name: 'Faithful4', role: 'FAITHFUL' });
    const players = [traitor, victim, f2, f3, f4];

    // Round 1 ROUNDTABLE → startNight is allowed (round-1 skip-voting path).
    // Disable challenges so continueToDayPhase lands directly in ROUNDTABLE,
    // matching the task's expected phase advance.
    const initial = makeGame({
      players,
      phase: 'ROUNDTABLE',
      currentRound: 1,
      settings: { ...DEFAULT_SETTINGS, challengesEnabled: false },
    });

    // 1. startNight() → NIGHT
    const night = startNight(initial);
    expect(night.phase).toBe('NIGHT');
    expect(night.murderVotes).toEqual([]);

    // 2. submitMurderVote() (single traitor)
    const voted = submitMurder(night, traitor.id, victim.id);
    expect(voted.murderVotes).toHaveLength(1);
    expect(voted.murderVotes[0]).toEqual({ voterId: traitor.id, targetId: victim.id });

    // 3. resolveMurder() → MORNING (murder confirmed, victim dead)
    const resolved = resolveMurder(voted);
    expect(resolved.blocked).toBe(false);
    expect(resolved.murderedPlayerId).toBe(victim.id);
    expect(resolved.murderedPlayerName).toBe('Victim');
    expect(resolved.game.phase).toBe('MORNING');
    expect(resolved.game.players.find((p) => p.id === victim.id)?.isAlive).toBe(false);
    expect(resolved.game.lastMurderedPlayerId).toBe(victim.id);
    expect(resolved.game.murderVotes).toEqual([]);

    // 4. continueToDayPhase() → ROUNDTABLE / phase advance
    const advanced = continueToDayPhase(resolved.game);

    // 5. Assertions: victim is dead, history has the round record, game not ended.
    expect(advanced.phase).toBe('ROUNDTABLE');
    expect(advanced.phase).not.toBe('GAME_END');
    expect(advanced.winner).toBeUndefined();
    expect(advanced.currentRound).toBe(2);
    expect(advanced.players.find((p) => p.id === victim.id)?.isAlive).toBe(false);

    expect(advanced.history).toHaveLength(1);
    const record = advanced.history[0]!;
    expect(record.round).toBe(1);
    expect(record.murderedName).toBe('Victim');
    expect(record.murderedRole).toBe('FAITHFUL');
    expect(record.murderBlocked).toBe(false);
  });
});

// ============= generateAutoMurderVotes =============

describe('generateAutoMurderVotes()', () => {
  it('fills a vote for every alive traitor who has not voted', () => {
    const t1 = makePlayer({ role: 'TRAITOR' });
    const t2 = makePlayer({ role: 'TRAITOR' });
    const f1 = makePlayer({ role: 'FAITHFUL' });
    const f2 = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({ players: [t1, t2, f1, f2], phase: 'NIGHT', murderVotes: [] });

    const { game: filled, autoVotes } = generateAutoMurderVotes(game);
    expect(autoVotes).toHaveLength(2);
    // Every filled vote targets a Faithful-team player, never a traitor/self.
    for (const v of filled.murderVotes) {
      expect([f1.id, f2.id]).toContain(v.targetId);
    }
    // One vote per alive traitor.
    expect(new Set(filled.murderVotes.map((v) => v.voterId))).toEqual(new Set([t1.id, t2.id]));
  });

  it('biases non-voters onto the target a teammate already picked', () => {
    const t1 = makePlayer({ role: 'TRAITOR' });
    const t2 = makePlayer({ role: 'TRAITOR' });
    const f1 = makePlayer({ role: 'FAITHFUL' });
    const f2 = makePlayer({ role: 'FAITHFUL' });
    // t1 already voted for f2; t2 is AFK.
    const game = makeGame({
      players: [t1, t2, f1, f2],
      phase: 'NIGHT',
      murderVotes: [{ voterId: t1.id, targetId: f2.id }],
    });

    const { game: filled, autoVotes } = generateAutoMurderVotes(game);
    expect(autoVotes).toHaveLength(1);
    expect(autoVotes[0]!.voterId).toBe(t2.id);
    // Consensus: the AFK traitor is dropped onto the existing target.
    expect(autoVotes[0]!.targetId).toBe(f2.id);
    expect(filled.murderVotes).toHaveLength(2);
  });

  it('does not overwrite existing votes and is a no-op when all have voted', () => {
    const t1 = makePlayer({ role: 'TRAITOR' });
    const f1 = makePlayer({ role: 'FAITHFUL' });
    const game = makeGame({
      players: [t1, f1],
      phase: 'NIGHT',
      murderVotes: [{ voterId: t1.id, targetId: f1.id }],
    });
    const { autoVotes, game: filled } = generateAutoMurderVotes(game);
    expect(autoVotes).toHaveLength(0);
    expect(filled.murderVotes).toHaveLength(1);
  });

  it('produces no auto-votes when there is no valid (non-traitor) target', () => {
    const t1 = makePlayer({ role: 'TRAITOR' });
    const t2 = makePlayer({ role: 'TRAITOR' });
    const game = makeGame({ players: [t1, t2], phase: 'NIGHT', murderVotes: [] });
    const { autoVotes } = generateAutoMurderVotes(game);
    expect(autoVotes).toHaveLength(0);
  });
});
