import { describe, it, expect } from 'vitest';
import { gameStateReducer } from './gameStateReducer';
import type { GameState, Vote, VoteTally, Whisper } from '../types';

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
    enableSpecialRoles: true,
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

  describe('whispers', () => {
    const meta = {
      id: 'w1', senderId: 'p2', senderName: 'Bob',
      recipientId: 'player-1', recipientName: 'Alice',
      round: 1, timestamp: 100,
    };
    const full: Whisper = { ...meta, content: 'hello' };

    it('S2C_WHISPER_SENT appends a meta-only entry', () => {
      const next = gameStateReducer(baseState, { type: 'S2C_WHISPER_SENT', payload: meta as unknown as Record<string, unknown> });
      expect(next?.whispers).toHaveLength(1);
      expect(next?.whispers?.[0]).not.toHaveProperty('content');
    });

    it('S2C_WHISPER_SENT dedups by id', () => {
      const s1 = gameStateReducer(baseState, { type: 'S2C_WHISPER_SENT', payload: meta as unknown as Record<string, unknown> });
      const s2 = gameStateReducer(s1, { type: 'S2C_WHISPER_SENT', payload: meta as unknown as Record<string, unknown> });
      expect(s2?.whispers).toHaveLength(1);
    });

    it('S2C_WHISPER_RECEIVED upgrades the meta entry with content (no duplicate)', () => {
      const s1 = gameStateReducer(baseState, { type: 'S2C_WHISPER_SENT', payload: meta as unknown as Record<string, unknown> });
      const s2 = gameStateReducer(s1, { type: 'S2C_WHISPER_RECEIVED', payload: full as unknown as Record<string, unknown> });
      expect(s2?.whispers).toHaveLength(1);
      expect(s2?.whispers?.[0]?.content).toBe('hello');
      expect(s2?.lastWhisperReceivedId).toBe('w1');
    });

    it('S2C_WHISPER_RECEIVED first then S2C_WHISPER_SENT does not duplicate', () => {
      const s1 = gameStateReducer(baseState, { type: 'S2C_WHISPER_RECEIVED', payload: full as unknown as Record<string, unknown> });
      const s2 = gameStateReducer(s1, { type: 'S2C_WHISPER_SENT', payload: meta as unknown as Record<string, unknown> });
      expect(s2?.whispers).toHaveLength(1);
      expect(s2?.whispers?.[0]?.content).toBe('hello');
    });

    it('S2C_WHISPER_ERROR stores the error; CLIENT_CLEAR_WHISPER_ERROR drops it', () => {
      const s1 = gameStateReducer(baseState, { type: 'S2C_WHISPER_ERROR', payload: { code: 'TOO_LONG', message: 'over 200' } });
      expect(s1?.whisperError?.code).toBe('TOO_LONG');
      const s2 = gameStateReducer(s1, { type: 'CLIENT_CLEAR_WHISPER_ERROR', payload: {} });
      expect(s2?.whisperError).toBeUndefined();
    });

    it('CLIENT_MARK_WHISPER_READ records the id; CLIENT_MARK_ALL_WHISPERS_READ marks every received whisper', () => {
      const s0 = gameStateReducer(baseState, { type: 'S2C_WHISPER_RECEIVED', payload: full as unknown as Record<string, unknown> });
      const s1 = gameStateReducer(s0, { type: 'CLIENT_MARK_WHISPER_READ', payload: { id: 'w1' } });
      expect(s1?.whispersRead).toContain('w1');

      const other: Whisper = { ...meta, id: 'w2', content: 'second' };
      const s2 = gameStateReducer(s1, { type: 'S2C_WHISPER_RECEIVED', payload: other as unknown as Record<string, unknown> });
      const s3 = gameStateReducer(s2, { type: 'CLIENT_MARK_ALL_WHISPERS_READ', payload: {} });
      expect(s3?.whispersRead).toEqual(expect.arrayContaining(['w1', 'w2']));
    });
  });
});
