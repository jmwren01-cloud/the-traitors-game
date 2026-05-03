import { describe, it, expect } from 'vitest';
import { gameStateReducer } from './gameStateReducer';
import type {
  GameState,
  Vote,
  VoteTally,
  Whisper,
  Player,
  GameSettings,
  ChatMessage,
  SheriffReport,
  ConfessionReveal,
  FalseEvidence,
  EvidenceVote,
  RoundRecord,
} from '../types';

const settings: GameSettings = {
  timerDurations: { roundtable: 120, voting: 60, night: 90 },
  traitorMode: 'auto',
  traitorCount: 1,
  minPlayers: 6,
  round1DiscussionOnly: true,
  challengesEnabled: true,
  challengeTimerSeconds: 60,
  enableSpecialRoles: true,
};

const baseState: GameState = {
  sessionId: 'test-session',
  phase: 'VOTING',
  players: [],
  myPlayerId: 'player-1',
  settings,
};

const player = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: `Name-${id}`,
  isHost: false,
  isAlive: true,
  ...overrides,
});

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

  describe('lobby & session', () => {
    it('S2C_GAME_CREATED initialises a fresh LOBBY state', () => {
      const next = gameStateReducer(null, {
        type: 'S2C_GAME_CREATED',
        payload: { sessionId: 'S', playerId: 'P', playerName: 'A', sessionToken: 'T', settings },
      });
      expect(next?.sessionId).toBe('S');
      expect(next?.phase).toBe('LOBBY');
      expect(next?.myPlayerId).toBe('P');
      expect(next?.players).toEqual([]);
    });

    it('S2C_GAME_JOINED initialises LOBBY with provided players', () => {
      const players = [player('p1'), player('p2')];
      const next = gameStateReducer(null, {
        type: 'S2C_GAME_JOINED',
        payload: { sessionId: 'S', playerId: 'p1', playerName: 'A', players, sessionToken: 'T', settings },
      });
      expect(next?.players).toEqual(players);
      expect(next?.phase).toBe('LOBBY');
    });

    it('S2C_SETTINGS_UPDATED replaces settings', () => {
      const newSettings: GameSettings = { ...settings, traitorCount: 3 };
      const next = gameStateReducer(baseState, {
        type: 'S2C_SETTINGS_UPDATED',
        payload: { settings: newSettings },
      });
      expect(next?.settings?.traitorCount).toBe(3);
    });

    it('S2C_PLAYER_JOINED replaces the players array', () => {
      const players = [player('p1'), player('p2')];
      const next = gameStateReducer(baseState, { type: 'S2C_PLAYER_JOINED', payload: { players } });
      expect(next?.players).toEqual(players);
    });

    it('S2C_PLAYER_DISCONNECTED replaces the players array', () => {
      const players = [player('p1', { isConnected: false })];
      const next = gameStateReducer(baseState, { type: 'S2C_PLAYER_DISCONNECTED', payload: { playerId: 'p1', players } });
      expect(next?.players).toEqual(players);
    });

    it('S2C_PLAYER_RECONNECTED replaces the players array', () => {
      const players = [player('p1', { isConnected: true })];
      const next = gameStateReducer(baseState, { type: 'S2C_PLAYER_RECONNECTED', payload: { playerId: 'p1', players } });
      expect(next?.players).toEqual(players);
    });

    it('S2C_AVATAR_UPDATED replaces the players array', () => {
      const players = [player('p1', { color: 'red', avatar: 'cat' })];
      const next = gameStateReducer(baseState, { type: 'S2C_AVATAR_UPDATED', payload: { players } });
      expect(next?.players).toEqual(players);
    });

    it('S2C_HOST_TRANSFERRED replaces the players array', () => {
      const players = [player('p1', { isHost: true })];
      const next = gameStateReducer(baseState, {
        type: 'S2C_HOST_TRANSFERRED',
        payload: { newHostId: 'p1', newHostName: 'Name-p1', players },
      });
      expect(next?.players).toEqual(players);
    });
  });

  describe('phase transitions', () => {
    it('S2C_GAME_STARTED sets phase', () => {
      const next = gameStateReducer(baseState, { type: 'S2C_GAME_STARTED', payload: { phase: 'ROLE_ASSIGN' } });
      expect(next?.phase).toBe('ROLE_ASSIGN');
    });

    it('S2C_ROLES_ASSIGNED sets phase', () => {
      const next = gameStateReducer(baseState, { type: 'S2C_ROLES_ASSIGNED', payload: { phase: 'ROLE_REVEAL' } });
      expect(next?.phase).toBe('ROLE_REVEAL');
    });

    it('S2C_ROLE_REVEAL sets myRole and traitorIds', () => {
      const next = gameStateReducer(baseState, {
        type: 'S2C_ROLE_REVEAL',
        payload: { role: 'TRAITOR', phase: 'ROLE_REVEAL', traitorIds: ['player-1', 'p2'] },
      });
      expect(next?.myRole).toBe('TRAITOR');
      expect(next?.traitorIds).toEqual(['player-1', 'p2']);
    });

    it('S2C_NIGHT_STARTED resets night-scoped fields', () => {
      const dirty: GameState = {
        ...baseState,
        murderVoteProgress: { received: 1, needed: 2 },
        murderVoterIds: ['x'],
        justRecruited: true,
        recruitedPlayer: { id: 'r', name: 'R' },
        nightRecruitmentSubmittedBy: 'r',
        medicProtectedTarget: { id: 'm', name: 'M' },
        medicBlocked: true,
      };
      const next = gameStateReducer(dirty, {
        type: 'S2C_NIGHT_STARTED',
        payload: { phase: 'NIGHT', currentRound: 4, aliveTraitorCount: 2 },
      });
      expect(next?.phase).toBe('NIGHT');
      expect(next?.currentRound).toBe(4);
      expect(next?.aliveTraitorCount).toBe(2);
      expect(next?.murderVoteProgress).toBeUndefined();
      expect(next?.murderVoterIds).toEqual([]);
      expect(next?.justRecruited).toBeUndefined();
      expect(next?.recruitedPlayer).toBeUndefined();
      expect(next?.nightRecruitmentSubmittedBy).toBeUndefined();
      expect(next?.medicProtectedTarget).toBeUndefined();
      expect(next?.medicBlocked).toBeUndefined();
    });

    it('S2C_MORNING_STARTED with shield block sets murderBlocked', () => {
      const next = gameStateReducer(baseState, {
        type: 'S2C_MORNING_STARTED',
        payload: {
          phase: 'MORNING',
          murderBlocked: true,
          shieldedPlayerId: 's1',
          shieldedPlayerName: 'Shieldy',
        },
      });
      expect(next?.phase).toBe('MORNING');
      expect(next?.murderBlocked).toEqual({ shieldedPlayerId: 's1', shieldedPlayerName: 'Shieldy' });
      expect(next?.murderedPlayer).toBeUndefined();
      expect(next?.medicBlocked).toBe(false);
    });

    it('S2C_MORNING_STARTED with medic block does not expose identity', () => {
      const next = gameStateReducer(baseState, {
        type: 'S2C_MORNING_STARTED',
        payload: { phase: 'MORNING', medicBlocked: true },
      });
      expect(next?.medicBlocked).toBe(true);
      expect(next?.murderBlocked).toBeUndefined();
    });

    it('S2C_MORNING_STARTED with murdered player sets murderedPlayer', () => {
      const next = gameStateReducer(baseState, {
        type: 'S2C_MORNING_STARTED',
        payload: { phase: 'MORNING', lastMurderedPlayerId: 'm1', lastMurderedPlayerName: 'Mort' },
      });
      expect(next?.murderedPlayer).toEqual({ id: 'm1', name: 'Mort' });
    });

    it('S2C_CONTINUE_GAME clears banished/murdered/votes for normal transitions', () => {
      const dirty: GameState = {
        ...baseState,
        banishedPlayer: { id: 'b', name: 'B', role: 'FAITHFUL' },
        murderedPlayer: { id: 'm', name: 'M' },
        murderBlocked: { shieldedPlayerId: 's', shieldedPlayerName: 'S' },
        medicBlocked: true,
        votes: [{ voterId: 'a', targetId: 'b' }],
        shieldBlockedBanishment: true,
        shieldBlockedBanishmentName: 'X',
      };
      const next = gameStateReducer(dirty, {
        type: 'S2C_CONTINUE_GAME',
        payload: { phase: 'NIGHT', currentRound: 3 },
      });
      expect(next?.banishedPlayer).toBeUndefined();
      expect(next?.murderedPlayer).toBeUndefined();
      expect(next?.murderBlocked).toBeUndefined();
      expect(next?.medicBlocked).toBeUndefined();
      expect(next?.votes).toBeUndefined();
      expect(next?.shieldBlockedBanishment).toBe(false);
      expect(next?.shieldBlockedBanishmentName).toBeUndefined();
    });

    it('S2C_CONTINUE_GAME preserves shieldBlockedBanishment when entering BANISH_REVEAL', () => {
      const dirty: GameState = {
        ...baseState,
        shieldBlockedBanishment: true,
        shieldBlockedBanishmentName: 'X',
      };
      const next = gameStateReducer(dirty, {
        type: 'S2C_CONTINUE_GAME',
        payload: { phase: 'BANISH_REVEAL', currentRound: 3 },
      });
      expect(next?.shieldBlockedBanishment).toBe(true);
      expect(next?.shieldBlockedBanishmentName).toBe('X');
    });
  });

  describe('voting flow', () => {
    it('S2C_VOTE_SUBMITTED returns the same state', () => {
      const next = gameStateReducer(baseState, { type: 'S2C_VOTE_SUBMITTED', payload: {} });
      expect(next).toBe(baseState);
    });

    it('S2C_VOTE_COUNT_UPDATE stores received/needed', () => {
      const next = gameStateReducer(baseState, {
        type: 'S2C_VOTE_COUNT_UPDATE',
        payload: { received: 2, needed: 5 },
      });
      expect(next?.voteCount).toEqual({ received: 2, needed: 5 });
    });

    it('S2C_VOTES_REVEALED sets votes and phase', () => {
      const votes: Vote[] = [{ voterId: 'a', targetId: 'b' }];
      const next = gameStateReducer(baseState, {
        type: 'S2C_VOTES_REVEALED',
        payload: { votes, phase: 'VOTE_REVEAL' },
      });
      expect(next?.votes).toEqual(votes);
      expect(next?.phase).toBe('VOTE_REVEAL');
    });

    it('S2C_VOTE_REVEAL_STARTED initialises reveal state', () => {
      const next = gameStateReducer(baseState, {
        type: 'S2C_VOTE_REVEAL_STARTED',
        payload: { phase: 'VOTE_REVEAL', revealOrder: ['a', 'b'], totalVotes: 2 },
      });
      expect(next?.revealOrder).toEqual(['a', 'b']);
      expect(next?.revealIndex).toBe(0);
      expect(next?.revealedVotes).toEqual([]);
      expect(next?.currentTally).toEqual([]);
      expect(next?.totalVotes).toBe(2);
    });

    it('S2C_VOTE_REVEAL_STEP appends to revealedVotes and updates currentReveal', () => {
      const start: GameState = { ...baseState, revealedVotes: [{ voterId: 'a', targetId: 'b' }] };
      const next = gameStateReducer(start, {
        type: 'S2C_VOTE_REVEAL_STEP',
        payload: {
          revealIndex: 1,
          vote: { voterId: 'c', targetId: 'b' },
          voterName: 'Charlie',
          targetName: 'Bob',
          currentTally: [{ playerId: 'b', playerName: 'Bob', voteCount: 2 }],
        },
      });
      expect(next?.revealedVotes).toHaveLength(2);
      expect(next?.revealIndex).toBe(2);
      expect(next?.currentReveal?.voterName).toBe('Charlie');
      expect(next?.currentTally?.[0]?.voteCount).toBe(2);
    });

    it('S2C_VOTE_REVEAL_COMPLETE finalises tally and clears currentReveal', () => {
      const next = gameStateReducer({ ...baseState, ...staleRevealState } as GameState, {
        type: 'S2C_VOTE_REVEAL_COMPLETE',
        payload: {
          allVotes: [{ voterId: 'a', targetId: 'b' }] as Vote[],
          finalTally: [{ playerId: 'b', playerName: 'Bob', voteCount: 1 }] as VoteTally[],
          totalVotes: 1,
          revealIndex: 1,
          phase: 'BANISH_REVEAL',
        },
      });
      expect(next?.phase).toBe('BANISH_REVEAL');
      expect(next?.currentReveal).toBeUndefined();
      expect(next?.revealIndex).toBe(1);
      expect(next?.totalVotes).toBe(1);
      expect(next?.revealedVotes).toHaveLength(1);
    });

    it('S2C_TIE_DETECTED stores tied players and clears voteCount', () => {
      const start: GameState = { ...baseState, voteCount: { received: 5, needed: 5 } };
      const next = gameStateReducer(start, {
        type: 'S2C_TIE_DETECTED',
        payload: { tiedPlayerIds: ['a', 'b'], tiedPlayerNames: ['A', 'B'], phase: 'TIE_DETECTED' },
      });
      expect(next?.tiedPlayerIds).toEqual(['a', 'b']);
      expect(next?.tiedPlayerNames).toEqual(['A', 'B']);
      expect(next?.voteCount).toBeUndefined();
    });

    it('S2C_PLAYER_BANISHED marks player dead and clears tied state', () => {
      const start: GameState = {
        ...baseState,
        players: [player('p1'), player('p2')],
        tiedPlayerIds: ['p1', 'p2'],
        tiedPlayerNames: ['A', 'B'],
        randomlySelectedPlayer: { id: 'p1', name: 'A', role: 'FAITHFUL' },
      };
      const next = gameStateReducer(start, {
        type: 'S2C_PLAYER_BANISHED',
        payload: {
          banishedPlayerId: 'p1',
          banishedPlayerName: 'A',
          banishedPlayerRole: 'FAITHFUL',
          phase: 'BANISH_REVEAL',
        },
      });
      expect(next?.banishedPlayer).toEqual({ id: 'p1', name: 'A', role: 'FAITHFUL' });
      expect(next?.players.find((p) => p.id === 'p1')?.isAlive).toBe(false);
      expect(next?.players.find((p) => p.id === 'p2')?.isAlive).toBe(true);
      expect(next?.tiedPlayerIds).toBeUndefined();
      expect(next?.randomlySelectedPlayer).toBeUndefined();
    });

    it('S2C_TIEBREAKER_RESOLVED marks selected player dead and stores randomly-selected', () => {
      const start: GameState = { ...baseState, players: [player('p1'), player('p2')] };
      const next = gameStateReducer(start, {
        type: 'S2C_TIEBREAKER_RESOLVED',
        payload: {
          selectedPlayerId: 'p2',
          selectedPlayerName: 'Name-p2',
          selectedPlayerRole: 'FAITHFUL',
          tiedPlayerIds: ['p1', 'p2'],
          tiedPlayerNames: ['A', 'B'],
          phase: 'TIEBREAKER_REVEAL',
        },
      });
      expect(next?.randomlySelectedPlayer?.id).toBe('p2');
      expect(next?.banishedPlayer?.id).toBe('p2');
      expect(next?.players.find((p) => p.id === 'p2')?.isAlive).toBe(false);
      expect(next?.tiedPlayerIds).toEqual(['p1', 'p2']);
    });
  });

  describe('confessions', () => {
    it('S2C_CONFESSION_PHASE_STARTED enters BOOTH', () => {
      const next = gameStateReducer(baseState, {
        type: 'S2C_CONFESSION_PHASE_STARTED',
        payload: { endsAt: 1234, duration: 60, aliveCount: 5 },
      });
      expect(next?.confessionPhase).toBe('BOOTH');
      expect(next?.confessionWindowEndsAt).toBe(1234);
      expect(next?.confessionTotalCount).toBe(5);
      expect(next?.confessionSubmittedCount).toBe(0);
      expect(next?.mySubmittedConfession).toBe(false);
    });

    it('S2C_CONFESSION_SUBMITTED updates the progress counts', () => {
      const next = gameStateReducer(baseState, {
        type: 'S2C_CONFESSION_SUBMITTED',
        payload: { received: 2, needed: 5 },
      });
      expect(next?.confessionSubmittedCount).toBe(2);
      expect(next?.confessionTotalCount).toBe(5);
    });

    it('S2C_CONFESSIONS_REVEALED enters DISCUSSION with reveal payload', () => {
      const reveals: ConfessionReveal[] = [{ id: 'c1', text: 'I did it' }];
      const next = gameStateReducer(baseState, {
        type: 'S2C_CONFESSIONS_REVEALED',
        payload: { reveals, round: 2 },
      });
      expect(next?.confessionPhase).toBe('DISCUSSION');
      expect(next?.confessionRevealed).toEqual(reveals);
      expect(next?.confessionRound).toBe(2);
      expect(next?.confessionWindowEndsAt).toBeUndefined();
    });

    it('CLIENT_MY_CONFESSION_SUBMITTED sets the local flag', () => {
      const next = gameStateReducer(baseState, { type: 'CLIENT_MY_CONFESSION_SUBMITTED', payload: {} });
      expect(next?.mySubmittedConfession).toBe(true);
    });
  });

  describe('night & special roles', () => {
    it('S2C_SHERIFF_RESULT appends a report (and dedups by round+target)', () => {
      const report: SheriffReport = { targetId: 't1', targetName: 'T', reportedRole: 'TRAITOR', round: 2 };
      const s1 = gameStateReducer(baseState, { type: 'S2C_SHERIFF_RESULT', payload: report as unknown as Record<string, unknown> });
      expect(s1?.sheriffReports).toHaveLength(1);
      const s2 = gameStateReducer(s1, { type: 'S2C_SHERIFF_RESULT', payload: report as unknown as Record<string, unknown> });
      expect(s2?.sheriffReports).toHaveLength(1);
    });

    it('S2C_MEDIC_PROTECTED stores the target and updates own player record', () => {
      const start: GameState = { ...baseState, players: [player('player-1'), player('p2')] };
      const next = gameStateReducer(start, {
        type: 'S2C_MEDIC_PROTECTED',
        payload: { targetId: 'p2', targetName: 'Name-p2' },
      });
      expect(next?.medicProtectedTarget).toEqual({ id: 'p2', name: 'Name-p2' });
      expect(next?.players.find((p) => p.id === 'player-1')?.medicLastProtectedTargetId).toBe('p2');
    });

    it('S2C_SEER_RESULT stores the result and burns the gift', () => {
      const start: GameState = { ...baseState, players: [player('player-1')] };
      const next = gameStateReducer(start, {
        type: 'S2C_SEER_RESULT',
        payload: { targetId: 't1', targetName: 'T', actualRole: 'TRAITOR' },
      });
      expect(next?.seerResult?.actualRole).toBe('TRAITOR');
      expect(next?.players[0]?.seerGiftUsed).toBe(true);
    });

    it('S2C_SEER_ACTIVATED sets the alert flag', () => {
      const next = gameStateReducer(baseState, { type: 'S2C_SEER_ACTIVATED', payload: {} });
      expect(next?.seerActivatedAlert).toBe(true);
    });

    it('S2C_MURDER_SUBMITTED tracks progress and dedups voter ids', () => {
      const s1 = gameStateReducer(baseState, {
        type: 'S2C_MURDER_SUBMITTED',
        payload: { voterId: 'v1', votesReceived: 1, votesNeeded: 2 },
      });
      const s2 = gameStateReducer(s1, {
        type: 'S2C_MURDER_SUBMITTED',
        payload: { voterId: 'v1', votesReceived: 1, votesNeeded: 2 },
      });
      expect(s2?.murderVoteProgress).toEqual({ received: 1, needed: 2 });
      expect(s2?.murderVoterIds).toEqual(['v1']);
    });

    it('S2C_MURDER_RESOLVED marks the victim dead and tracks recruitment', () => {
      const start: GameState = { ...baseState, players: [player('m1'), player('p2')] };
      const next = gameStateReducer(start, {
        type: 'S2C_MURDER_RESOLVED',
        payload: {
          murderedPlayerId: 'm1',
          murderedPlayerName: 'Name-m1',
          phase: 'MORNING',
          recruitedPlayerId: 'p2',
          recruitedPlayerName: 'Name-p2',
        },
      });
      expect(next?.players.find((p) => p.id === 'm1')?.isAlive).toBe(false);
      expect(next?.murderedPlayer).toEqual({ id: 'm1', name: 'Name-m1' });
      expect(next?.recruitedPlayer).toEqual({ id: 'p2', name: 'Name-p2' });
    });

    it('S2C_MURDER_RESOLVED with recruitmentOccurred but no identity uses sentinel', () => {
      const start: GameState = { ...baseState, players: [player('m1')] };
      const next = gameStateReducer(start, {
        type: 'S2C_MURDER_RESOLVED',
        payload: {
          murderedPlayerId: 'm1',
          murderedPlayerName: 'Name-m1',
          phase: 'MORNING',
          recruitmentOccurred: true,
        },
      });
      expect(next?.recruitedPlayer?.id).toBe('__occurred__');
    });

    it('S2C_RECRUITMENT_SUBMITTED flags the recruiter and tracks submission', () => {
      const start: GameState = { ...baseState, players: [player('r1'), player('p2')] };
      const next = gameStateReducer(start, {
        type: 'S2C_RECRUITMENT_SUBMITTED',
        payload: { recruiterId: 'r1', recruiterName: 'Name-r1' },
      });
      expect(next?.players.find((p) => p.id === 'r1')?.recruitmentUsed).toBe(true);
      expect(next?.nightRecruitmentSubmittedBy).toBe('r1');
    });

    it('S2C_YOU_WERE_RECRUITED flips myRole and marks justRecruited', () => {
      const start: GameState = { ...baseState, players: [player('player-1')] };
      const next = gameStateReducer(start, {
        type: 'S2C_YOU_WERE_RECRUITED',
        payload: { traitorIds: ['player-1', 't2'] },
      });
      expect(next?.myRole).toBe('TRAITOR');
      expect(next?.traitorIds).toEqual(['player-1', 't2']);
      expect(next?.justRecruited).toBe(true);
      expect(next?.players[0]?.role).toBe('TRAITOR');
    });

    it('S2C_PLAYER_RECRUITED updates traitorIds and the player role', () => {
      const start: GameState = { ...baseState, players: [player('p2')] };
      const next = gameStateReducer(start, {
        type: 'S2C_PLAYER_RECRUITED',
        payload: { newTraitorId: 'p2', newTraitorName: 'Name-p2', updatedTraitorIds: ['t1', 'p2'] },
      });
      expect(next?.traitorIds).toEqual(['t1', 'p2']);
      expect(next?.players[0]?.role).toBe('TRAITOR');
      expect(next?.players[0]?.recruitmentUsed).toBe(true);
    });
  });

  describe('challenges', () => {
    it('S2C_CHALLENGE_STARTED initialises challenge state and timer', () => {
      const next = gameStateReducer(baseState, {
        type: 'S2C_CHALLENGE_STARTED',
        payload: {
          phase: 'CHALLENGE',
          challengeType: 'TIME_ESTIMATE',
          startTime: 100,
          targetTime: 30,
          endTime: 200,
          duration: 60,
          eligibleCount: 5,
        },
      });
      expect(next?.challenge?.type).toBe('TIME_ESTIMATE');
      expect(next?.challenge?.completed).toBe(false);
      expect(next?.challenge?.eligibleCount).toBe(5);
      expect(next?.timer?.phase).toBe('CHALLENGE');
    });

    it('S2C_CHALLENGE_ANSWER_RECEIVED updates answer counters', () => {
      const start: GameState = {
        ...baseState,
        challenge: { type: 'TIME_ESTIMATE', startTime: 0, completed: false, answeredCount: 0, eligibleCount: 5 },
      };
      const next = gameStateReducer(start, {
        type: 'S2C_CHALLENGE_ANSWER_RECEIVED',
        payload: { playerId: 'p1', received: 3, needed: 5 },
      });
      expect(next?.challenge?.answeredCount).toBe(3);
      expect(next?.challenge?.eligibleCount).toBe(5);
    });

    it('S2C_CHALLENGE_PHASE_UPDATE stores hiddenPlayerId', () => {
      const start: GameState = {
        ...baseState,
        challenge: { type: 'MISSING_PLAYER', startTime: 0, completed: false },
      };
      const next = gameStateReducer(start, {
        type: 'S2C_CHALLENGE_PHASE_UPDATE',
        payload: { hiddenPlayerId: 'p1' },
      });
      expect(next?.challenge?.hiddenPlayerId).toBe('p1');
    });

    it('S2C_CHALLENGE_RESULT awards shield only to the local winner', () => {
      const start: GameState = {
        ...baseState,
        players: [player('player-1'), player('p2')],
        challenge: { type: 'TIME_ESTIMATE', startTime: 0, completed: false },
      };
      const winSelf = gameStateReducer(start, {
        type: 'S2C_CHALLENGE_RESULT',
        payload: { phase: 'CHALLENGE_RESULT', winnerId: 'player-1', winnerName: 'Me', shieldAwarded: true },
      });
      expect(winSelf?.players.find((p) => p.id === 'player-1')?.hasShield).toBe(true);
      expect(winSelf?.challenge?.completed).toBe(true);

      const winOther = gameStateReducer(start, {
        type: 'S2C_CHALLENGE_RESULT',
        payload: { phase: 'CHALLENGE_RESULT', winnerId: 'p2', winnerName: 'Other', shieldAwarded: true },
      });
      expect(winOther?.players.find((p) => p.id === 'p2')?.hasShield).toBeUndefined();
    });

    it('S2C_SHIELD_REVEALED marks the player; banishment block consumes the shield', () => {
      const start: GameState = {
        ...baseState,
        players: [player('p1', { hasShield: true })],
      };
      const blocked = gameStateReducer(start, {
        type: 'S2C_SHIELD_REVEALED',
        payload: { playerId: 'p1', playerName: 'Name-p1', banishmentBlocked: true },
      });
      expect(blocked?.players[0]?.shieldRevealed).toBe(true);
      expect(blocked?.players[0]?.hasShield).toBe(false);
      expect(blocked?.shieldBlockedBanishment).toBe(true);
      expect(blocked?.shieldBlockedBanishmentName).toBe('Name-p1');

      const justRevealed = gameStateReducer(start, {
        type: 'S2C_SHIELD_REVEALED',
        payload: { playerId: 'p1', playerName: 'Name-p1' },
      });
      expect(justRevealed?.players[0]?.hasShield).toBe(true);
      expect(justRevealed?.shieldBlockedBanishment).toBeUndefined();
    });
  });

  describe('chat & timer', () => {
    it('S2C_CHAT_MESSAGE appends and dedups by id', () => {
      const m: ChatMessage = { id: 'm1', playerId: 'p1', playerName: 'A', message: 'hi', timestamp: 1, channel: 'general' };
      const s1 = gameStateReducer(baseState, { type: 'S2C_CHAT_MESSAGE', payload: m as unknown as Record<string, unknown> });
      expect(s1?.messages).toHaveLength(1);
      const s2 = gameStateReducer(s1, { type: 'S2C_CHAT_MESSAGE', payload: m as unknown as Record<string, unknown> });
      expect(s2?.messages).toHaveLength(1);
    });

    it('S2C_TIMER_UPDATE sets the timer object', () => {
      const next = gameStateReducer(baseState, {
        type: 'S2C_TIMER_UPDATE',
        payload: { endTime: 1000, duration: 60, phase: 'VOTING' },
      });
      expect(next?.timer).toEqual({ endTime: 1000, duration: 60, phase: 'VOTING' });
    });
  });

  describe('end game', () => {
    it('S2C_GAME_END writes winner, reason, history and whispers', () => {
      const history: RoundRecord[] = [{ round: 1, votes: [] }];
      const whispers: Whisper[] = [{ id: 'w', senderId: 'a', senderName: 'A', recipientId: 'b', recipientName: 'B', round: 1, timestamp: 1, content: 'x' }];
      const fe: FalseEvidence = { type: 'FRAME', targetId: 't', targetName: 'T', plantedAtRound: 1 };
      const next = gameStateReducer(baseState, {
        type: 'S2C_GAME_END',
        payload: {
          winner: 'TRAITORS',
          phase: 'GAME_END',
          remainingTraitors: 1,
          remainingFaithful: 0,
          history,
          reason: 'HOST_ENDED',
          whispers,
          falseEvidence: fe,
        },
      });
      expect(next?.phase).toBe('GAME_END');
      expect(next?.winner).toBe('TRAITORS');
      expect(next?.endReason).toBe('HOST_ENDED');
      expect(next?.history).toEqual(history);
      expect(next?.whispers).toEqual(whispers);
      expect(next?.falseEvidence).toEqual(fe);
    });
  });

  describe('false evidence', () => {
    it('S2C_EVIDENCE_VOTE_CAST stores votes and progress; clears prior failure', () => {
      const start: GameState = { ...baseState, evidenceLastFailure: 'NO_AGREEMENT' };
      const votes: EvidenceVote[] = [{ voterId: 'p1', type: 'FRAME', targetId: 't1' }];
      const next = gameStateReducer(start, {
        type: 'S2C_EVIDENCE_VOTE_CAST',
        payload: { votes, received: 1, needed: 2, windowEndsAt: 999 },
      });
      expect(next?.evidenceVotes).toEqual(votes);
      expect(next?.evidenceVoteProgress).toEqual({ received: 1, needed: 2 });
      expect(next?.evidenceWindowEndsAt).toBe(999);
      expect(next?.evidenceLastFailure).toBeUndefined();
    });

    it('S2C_EVIDENCE_PLANTED stores falseEvidence and clears working state', () => {
      const start: GameState = {
        ...baseState,
        evidenceVotes: [{ voterId: 'p1', type: 'FRAME', targetId: 't' }],
        evidenceVoteProgress: { received: 1, needed: 2 },
        evidenceWindowEndsAt: 1,
        evidenceLastFailure: 'TIMEOUT',
      };
      const fe: FalseEvidence = { type: 'FRAME', targetId: 't', targetName: 'T', plantedAtRound: 2 };
      const next = gameStateReducer(start, {
        type: 'S2C_EVIDENCE_PLANTED',
        payload: { evidence: fe },
      });
      expect(next?.falseEvidence).toEqual(fe);
      expect(next?.evidenceUsed).toBe(true);
      expect(next?.evidenceVotes).toBeUndefined();
      expect(next?.evidenceVoteProgress).toBeUndefined();
      expect(next?.evidenceWindowEndsAt).toBeUndefined();
      expect(next?.evidenceLastFailure).toBeUndefined();
    });

    it('S2C_EVIDENCE_FAILED records the failure reason and clears working state', () => {
      const start: GameState = {
        ...baseState,
        evidenceVotes: [{ voterId: 'p1', type: 'SKIP' }],
        evidenceVoteProgress: { received: 1, needed: 2 },
        evidenceWindowEndsAt: 1,
      };
      const next = gameStateReducer(start, {
        type: 'S2C_EVIDENCE_FAILED',
        payload: { reason: 'NO_AGREEMENT' },
      });
      expect(next?.evidenceLastFailure).toBe('NO_AGREEMENT');
      expect(next?.evidenceVotes).toBeUndefined();
      expect(next?.evidenceVoteProgress).toBeUndefined();
      expect(next?.evidenceWindowEndsAt).toBeUndefined();
    });
  });

  describe('reconnection', () => {
    it('S2C_RECONNECTED rebuilds state and reconstructs currentReveal mid-reveal', () => {
      const players = [player('p1'), player('p2'), player('p3')];
      const revealedVotes: Vote[] = [
        { voterId: 'p1', targetId: 'p2' },
        { voterId: 'p2', targetId: 'p3' },
      ];
      const next = gameStateReducer(null, {
        type: 'S2C_RECONNECTED',
        payload: {
          sessionId: 'S',
          playerId: 'p1',
          playerName: 'Name-p1',
          players,
          phase: 'VOTE_REVEAL',
          currentRound: 2,
          messages: [],
          votes: [],
          murderVotes: [],
          hostId: 'p1',
          revealIndex: 2,
          revealOrder: ['p1', 'p2', 'p3'],
          revealedVotes,
          totalVotes: 3,
          settings,
          history: [],
        },
      });
      expect(next?.sessionId).toBe('S');
      expect(next?.phase).toBe('VOTE_REVEAL');
      expect(next?.currentReveal?.voterName).toBe('Name-p2');
      expect(next?.currentReveal?.targetName).toBe('Name-p3');
      expect(next?.totalVotes).toBe(3);
    });

    it('S2C_RECONNECTED leaves currentReveal undefined when reveal is complete', () => {
      const players = [player('p1'), player('p2')];
      const revealedVotes: Vote[] = [{ voterId: 'p1', targetId: 'p2' }, { voterId: 'p2', targetId: 'p1' }];
      const next = gameStateReducer(null, {
        type: 'S2C_RECONNECTED',
        payload: {
          sessionId: 'S',
          playerId: 'p1',
          playerName: 'Name-p1',
          players,
          phase: 'BANISH_REVEAL',
          currentRound: 1,
          messages: [],
          votes: [],
          murderVotes: [],
          hostId: 'p1',
          revealedVotes,
          totalVotes: 2,
          settings,
          history: [],
        },
      });
      expect(next?.currentReveal).toBeUndefined();
    });

    it('S2C_RECONNECTED reconstructs banished/randomly-selected blocks when fields are present', () => {
      const next = gameStateReducer(null, {
        type: 'S2C_RECONNECTED',
        payload: {
          sessionId: 'S',
          playerId: 'p1',
          playerName: 'Name-p1',
          players: [player('p1'), player('p2')],
          phase: 'TIEBREAKER_REVEAL',
          currentRound: 1,
          messages: [],
          votes: [],
          murderVotes: [],
          hostId: 'p1',
          banishedPlayerId: 'p2',
          banishedPlayerName: 'Name-p2',
          banishedPlayerRole: 'FAITHFUL',
          randomlySelectedPlayerId: 'p2',
          randomlySelectedPlayerName: 'Name-p2',
          randomlySelectedPlayerRole: 'FAITHFUL',
          settings,
          history: [],
        },
      });
      expect(next?.banishedPlayer?.id).toBe('p2');
      expect(next?.randomlySelectedPlayer?.id).toBe('p2');
    });
  });

  describe('null handling & default', () => {
    it('returns null when reducing most messages against null state', () => {
      const next = gameStateReducer(null, { type: 'S2C_TIMER_UPDATE', payload: { endTime: 1, duration: 1, phase: 'VOTING' } });
      expect(next).toBeNull();
    });

    it('returns the same state for unknown message types', () => {
      const next = gameStateReducer(baseState, { type: 'S2C_UNKNOWN_NEW_MESSAGE', payload: {} });
      expect(next).toBe(baseState);
    });
  });
});
