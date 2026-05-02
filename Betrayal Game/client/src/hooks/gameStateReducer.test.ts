import { describe, it, expect } from 'vitest';
import { gameStateReducer } from './gameStateReducer';
import type { GameState, Vote, VoteTally } from '../types';

const baseState: GameState = {
  sessionId: 'test-session',
  phase: 'VOTING',
  players: [],
  myPlayerId: 'player-1',
  settings: {
    timerDurations: { roundtable: 120, voting: 60, night: 90 },
    traitorMode: 'auto',
    traitorCount: 1,
    minPlayers: 6,
    round1DiscussionOnly: true,
    challengesEnabled: true,
    challengeTimerSeconds: 60,
  },
};

const staleRevealState: Partial<GameState> = {
  revealIndex: 3,
  revealOrder: ['p1', 'p2', 'p3'],
  revealedVotes: [
    { voterId: 'p1', targetId: 'p2' },
    { voterId: 'p2', targetId: 'p3' },
  ] as Vote[],
  currentTally: [{ playerId: 'p2', playerName: 'Bob', voteCount: 2 }] as VoteTally[],
  totalVotes: 3,
  currentReveal: {
    vote: { voterId: 'p3', targetId: 'p2' },
    voterName: 'Charlie',
    targetName: 'Bob',
  },
};

describe('gameStateReducer', () => {
  it('S2C_VOTING_STARTED resets revealIndex to undefined', () => {
    const stateWithStaleReveal: GameState = { ...baseState, ...staleRevealState };

    const next = gameStateReducer(stateWithStaleReveal, {
      type: 'S2C_VOTING_STARTED',
      payload: { phase: 'VOTING' },
    });

    expect(next?.revealIndex).toBeUndefined();
  });

  it('S2C_ROUNDTABLE_STARTED resets revealedVotes to []', () => {
    const stateWithStaleReveal: GameState = { ...baseState, ...staleRevealState };

    const next = gameStateReducer(stateWithStaleReveal, {
      type: 'S2C_ROUNDTABLE_STARTED',
      payload: { phase: 'ROUNDTABLE', currentRound: 2 },
    });

    expect(next?.revealedVotes).toEqual([]);
  });

  it('S2C_REVOTE_STARTED resets currentTally to undefined', () => {
    const stateWithStaleReveal: GameState = {
      ...baseState,
      ...staleRevealState,
      phase: 'TIE_DETECTED',
      tiedPlayerIds: ['p1', 'p2'],
    };

    const next = gameStateReducer(stateWithStaleReveal, {
      type: 'S2C_REVOTE_STARTED',
      payload: { phase: 'REVOTE', tiedPlayerIds: ['p1', 'p2'] },
    });

    expect(next?.currentTally).toBeUndefined();
  });
});
