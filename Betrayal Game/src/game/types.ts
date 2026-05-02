// Game Types and Interfaces

export interface GameSettings {
  timerDurations: {
    roundtable: number; // 30-300 seconds
    voting: number;     // 30-120 seconds
    night: number;      // 30-180 seconds
  };
  traitorMode: 'auto' | 'fixed'; // auto = 1 per 5 players, fixed = use traitorCount
  traitorCount: number;          // 1-4 (only used when mode is 'fixed')
  minPlayers: number;            // 5-10
  round1DiscussionOnly: boolean; // Skip banishment in round 1
  challengesEnabled: boolean;    // Enable shield challenges
  challengeTimerSeconds: number; // 30-120 seconds, default 60
}

export type ChallengeType = 'TIME_ESTIMATE' | 'MISSING_PLAYER' | 'WORD_SCRAMBLE';

export interface ChallengeState {
  type: ChallengeType;
  startTime: number;
  targetTime?: number;        // For TIME_ESTIMATE: the target seconds (4-8)
  hiddenPlayerId?: string;    // For MISSING_PLAYER: who is hidden
  shownPlayerIds?: string[];  // For MISSING_PLAYER: players shown before hiding
  scrambledWord?: string;     // For WORD_SCRAMBLE: the scrambled word
  correctWord?: string;       // For WORD_SCRAMBLE: the correct answer
  answers: Map<string, { answer: string | number; timestamp: number }>;
  winnerId?: string;
  winnerName?: string;
  completed: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  timerDurations: {
    roundtable: 120,
    voting: 60,
    night: 90
  },
  traitorMode: 'auto',
  traitorCount: 1,
  minPlayers: 5,
  round1DiscussionOnly: true,
  challengesEnabled: true,
  challengeTimerSeconds: 60
};

export type GamePhase = 
  | 'LOBBY'
  | 'ROLE_ASSIGN'
  | 'ROLE_REVEAL'
  | 'CHALLENGE'
  | 'CHALLENGE_RESULT'
  | 'ROUNDTABLE'
  | 'VOTING'
  | 'VOTE_REVEAL'
  | 'TIE_DETECTED'
  | 'REVOTE'
  | 'TIEBREAKER_REVEAL'
  | 'BANISH_REVEAL'
  | 'CHECK_WIN'
  | 'NIGHT'
  | 'MORNING'
  | 'GAME_END';

export type Role = 'TRAITOR' | 'FAITHFUL';

export interface Player {
  id: string;
  name: string;
  role?: Role;
  isAlive: boolean;
  isHost: boolean;
  isConnected: boolean;
  hasShield: boolean;
  shieldRevealed: boolean;
  lastChallengeWinRound?: number;
  color?: string;
  avatar?: string;
  recruitmentUsed?: boolean;
  /**
   * Persistent device-fingerprint identity .
   * Server-only; never broadcast to other players. Used to link game records
   * back to the persistent player profile for stats/leaderboards.
   */
  deviceToken?: string;
}

export interface Vote {
  voterId: string;
  targetId: string;
  reasonText?: string;
  timestamp?: number;
  isAutoVote?: boolean;
}

export type ChatChannel = 'general' | 'traitor';

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
  channel: ChatChannel;
}

export interface TimerState {
  endTime: number;
  duration: number;
  phase: GamePhase;
}

export interface TiebreakerResult {
  playerId: string;
  playerName: string;
  hasShield: boolean;
}

export interface VoteTally {
  playerId: string;
  playerName: string;
  voteCount: number;
}

export interface VoteEntry {
  voterName: string;
  voterRole: Role;
  targetName: string;
  targetRole: Role;
  isAutoVote?: boolean;
  reasonText?: string;
}

export interface RoundRecord {
  round: number;
  votes: VoteEntry[];
  banishedName?: string;
  banishedRole?: Role;
  murderedName?: string;
  murderedRole?: Role;
  murderBlocked?: boolean;
  shieldedName?: string;
  shieldedRole?: Role;
  recruitedName?: string;
}

export interface GameState {
  sessionId: string;
  phase: GamePhase;
  players: Player[];
  votes: Vote[];
  revealedVotes: Vote[];
  hostId: string;
  banishedPlayerId?: string;
  winner?: 'TRAITORS' | 'FAITHFUL';
  currentRound: number;
  murderVotes: Vote[];
  lastMurderedPlayerId?: string;
  lastMurderBlocked?: boolean;
  lastShieldedPlayerId?: string;
  lastRoundVotes?: Vote[];
  history: RoundRecord[];
  messages: ChatMessage[];
  timer?: TimerState;
  tiedPlayerIds?: string[];
  tiebreakerResults?: TiebreakerResult[];
  votesNeededCount?: number;
  votesReceivedCount?: number;
  isRevote?: boolean;
  randomlySelectedPlayerId?: string;
  revealIndex?: number;
  revealOrder?: string[];
  currentTally?: VoteTally[];
  votingLocked?: boolean;
  lastManualVotes: Record<string, string>;
  settings: GameSettings;
  challenge?: ChallengeState;
  pendingRecruitmentTargetId?: string;
  lastRecruitedPlayerId?: string;
  /**
   * Set true when a shield was revealed during VOTE_REVEAL and consumed to
   * cancel the in-flight banishment. The host's subsequent "Continue" will
   * skip the kill and proceed straight to the win check.
   */
  shieldBlockedBanishment?: boolean;
  /** Game creation time (ms epoch). Used for persisted stats records. */
  startedAt?: number;
  /** Set after writeGameRecord runs so we don't double-record on duplicate end-game broadcasts. */
  recordedAt?: number;
}

// Client-to-Server Events
export type C2SEvent =
  | { type: 'C2S_CREATE_GAME'; payload: { playerName: string } }
  | { type: 'C2S_JOIN_GAME'; payload: { sessionId: string; playerName: string } }
  | { type: 'C2S_RECONNECT'; payload: { sessionToken: string } }
  | { type: 'C2S_UPDATE_SETTINGS'; payload: { settings: Partial<GameSettings> } }
  | { type: 'C2S_START_GAME'; payload: Record<string, never> }
  | { type: 'C2S_ASSIGN_ROLES'; payload: Record<string, never> }
  | { type: 'C2S_START_ROUNDTABLE'; payload: Record<string, never> }
  | { type: 'C2S_START_VOTING'; payload: Record<string, never> }
  | { type: 'C2S_SUBMIT_VOTE'; payload: { targetId: string; reasonText?: string } }
  | { type: 'C2S_FORCE_RESOLVE_VOTING'; payload: Record<string, never> }
  | { type: 'C2S_REVEAL_VOTES'; payload: Record<string, never> }
  | { type: 'C2S_BANISH_PLAYER'; payload: Record<string, never> }
  | { type: 'C2S_START_REVOTE'; payload: Record<string, never> }
  | { type: 'C2S_SUBMIT_REVOTE'; payload: { targetId: string } }
  | { type: 'C2S_RESOLVE_TIEBREAKER'; payload: Record<string, never> }
  | { type: 'C2S_CHECK_WIN'; payload: Record<string, never> }
  | { type: 'C2S_START_NIGHT'; payload: Record<string, never> }
  | { type: 'C2S_SUBMIT_MURDER'; payload: { targetId: string } }
  | { type: 'C2S_RESOLVE_MURDER'; payload: Record<string, never> }
  | { type: 'C2S_START_MORNING'; payload: Record<string, never> }
  | { type: 'C2S_CONTINUE_TO_DAY'; payload: Record<string, never> }
  | { type: 'C2S_SEND_MESSAGE'; payload: { message: string; channel: ChatChannel } }
  | { type: 'C2S_SUBMIT_CHALLENGE_ANSWER'; payload: { answer: string | number } }
  | { type: 'C2S_CONTINUE_TO_ROUNDTABLE'; payload: Record<string, never> }
  | { type: 'C2S_REVEAL_SHIELD'; payload: Record<string, never> }
  | { type: 'C2S_SET_AVATAR'; payload: { color?: string; avatar?: string } }
  | { type: 'C2S_SUBMIT_RECRUITMENT'; payload: { targetId: string } }
  | { type: 'C2S_IDENTIFY'; payload: { deviceToken: string; playerName: string } }
  | { type: 'C2S_GET_PLAYER_STATS'; payload: Record<string, never> }
  | { type: 'C2S_GET_LEADERBOARD'; payload: { metric: 'winRate' | 'gamesPlayed' | 'traitorWins' } }
  | { type: 'C2S_GET_GLOBAL_STATS'; payload: Record<string, never> };

// Server-to-Client Events
export type S2CEvent =
  | { type: 'S2C_GAME_CREATED'; payload: { sessionId: string; playerId: string; playerName: string; sessionToken: string; settings: GameSettings } }
  | { type: 'S2C_GAME_JOINED'; payload: { sessionId: string; playerId: string; playerName: string; players: Player[]; sessionToken: string; settings: GameSettings } }
  | { type: 'S2C_SETTINGS_UPDATED'; payload: { settings: GameSettings } }
  | { type: 'S2C_RECONNECTED'; payload: { 
      sessionId: string; 
      playerId: string; 
      playerName: string; 
      players: Player[];
      phase: GamePhase;
      role?: Role;
      traitorIds?: string[];
      currentRound: number;
      messages: ChatMessage[];
      votes: Vote[];
      murderVotes: Vote[];
      hostId: string;
      winner?: 'TRAITORS' | 'FAITHFUL';
      banishedPlayerId?: string;
      banishedPlayerName?: string;
      banishedPlayerRole?: Role;
      lastMurderedPlayerId?: string;
      lastMurderedPlayerName?: string;
      timer?: TimerState;
      tiedPlayerIds?: string[];
      tiedPlayerNames?: string[];
      voteCount?: { received: number; needed: number };
      murderVoteProgress?: { received: number; needed: number };
      aliveTraitorCount?: number;
      revealIndex?: number;
      revealOrder?: string[];
      currentTally?: VoteTally[];
      revealedVotes?: Vote[];
      remainingTraitors?: number;
      remainingFaithful?: number;
      tiebreakerResults?: TiebreakerResult[];
      randomlySelectedPlayerId?: string;
      randomlySelectedPlayerName?: string;
      randomlySelectedPlayerRole?: Role;
      totalVotes?: number;
      settings: GameSettings;
      history: RoundRecord[];
    } }
  | { type: 'S2C_PLAYER_RECONNECTED'; payload: { playerId: string; players: Player[] } }
  | { type: 'S2C_PLAYER_DISCONNECTED'; payload: { playerId: string; players: Player[] } }
  | { type: 'S2C_PLAYER_JOINED'; payload: { players: Player[] } }
  | { type: 'S2C_GAME_STARTED'; payload: { phase: GamePhase } }
  | { type: 'S2C_ROLES_ASSIGNED'; payload: { phase: GamePhase } }
  | { type: 'S2C_ROLE_REVEAL'; payload: { 
      role: Role; 
      phase: GamePhase;
      traitorIds?: string[];
    } }
  | { type: 'S2C_ROUNDTABLE_STARTED'; payload: { phase: GamePhase; currentRound?: number } }
  | { type: 'S2C_VOTING_STARTED'; payload: { phase: GamePhase } }
  | { type: 'S2C_VOTE_SUBMITTED'; payload: { voterId: string; isAutoVote?: boolean; voterName?: string } }
  | { type: 'S2C_VOTES_REVEALED'; payload: { votes: Vote[]; phase: GamePhase } }
  | { type: 'S2C_VOTE_REVEAL_STARTED'; payload: { 
      phase: GamePhase; 
      revealOrder: string[];
      totalVotes: number;
    } }
  | { type: 'S2C_VOTE_REVEAL_STEP'; payload: { 
      revealIndex: number;
      vote: Vote;
      voterName: string;
      targetName: string;
      currentTally: VoteTally[];
    } }
  | { type: 'S2C_VOTE_REVEAL_COMPLETE'; payload: { 
      allVotes: Vote[];
      finalTally: VoteTally[];
      totalVotes?: number;
      revealIndex?: number;
      phase?: GamePhase;
    } }
  | { type: 'S2C_VOTE_COUNT_UPDATE'; payload: { received: number; needed: number } }
  | { type: 'S2C_TIE_DETECTED'; payload: { tiedPlayerIds: string[]; tiedPlayerNames: string[]; phase: GamePhase } }
  | { type: 'S2C_REVOTE_STARTED'; payload: { tiedPlayerIds: string[]; phase: GamePhase } }
  | { type: 'S2C_TIEBREAKER_RESULT'; payload: { results: TiebreakerResult[]; phase: GamePhase } }
  | { type: 'S2C_TIEBREAKER_RESOLVED'; payload: {
      selectedPlayerId: string;
      selectedPlayerName: string;
      selectedPlayerRole: Role;
      tiedPlayerIds: string[];
      tiedPlayerNames: string[];
      phase: GamePhase;
    } }
  | { type: 'S2C_PLAYER_BANISHED'; payload: { 
      banishedPlayerId: string; 
      banishedPlayerName: string; 
      banishedPlayerRole: Role;
      phase: GamePhase 
    } }
  | { type: 'S2C_GAME_END'; payload: { 
      winner: 'TRAITORS' | 'FAITHFUL'; 
      phase: GamePhase;
      remainingTraitors: number;
      remainingFaithful: number;
      history: RoundRecord[];
    } }
  | { type: 'S2C_CONTINUE_GAME'; payload: { phase: GamePhase; currentRound: number } }
  | { type: 'S2C_NIGHT_STARTED'; payload: { 
      phase: GamePhase; 
      currentRound: number;
      aliveTraitorCount: number;
    } }
  | { type: 'S2C_MURDER_SUBMITTED'; payload: { voterId: string; votesReceived: number; votesNeeded: number } }
  | { type: 'S2C_MURDER_RESOLVED'; payload: { 
      murderedPlayerId: string; 
      murderedPlayerName: string;
      phase: GamePhase;
      recruitedPlayerId?: string;
      recruitedPlayerName?: string;
      recruitmentOccurred?: boolean;
    } }
  | { type: 'S2C_MORNING_STARTED'; payload: { 
      phase: GamePhase;
      lastMurderedPlayerId?: string;
      lastMurderedPlayerName?: string;
      murderBlocked?: boolean;
      shieldedPlayerId?: string;
      shieldedPlayerName?: string;
      recruitedPlayerId?: string;
      recruitedPlayerName?: string;
      recruitmentOccurred?: boolean;
    } }
  | { type: 'S2C_RECRUITMENT_SUBMITTED'; payload: { recruiterId: string; recruiterName: string } }
  | { type: 'S2C_YOU_WERE_RECRUITED'; payload: { traitorIds: string[] } }
  | { type: 'S2C_PLAYER_RECRUITED'; payload: { newTraitorId: string; newTraitorName: string; updatedTraitorIds: string[] } }
  | { type: 'S2C_CHALLENGE_STARTED'; payload: { 
      phase: GamePhase;
      challengeType: ChallengeType;
      startTime: number;
      targetTime?: number;
      shownPlayerIds?: string[];
      scrambledWord?: string;
      endTime?: number;
      duration?: number;
      eligibleCount?: number;
    } }
  | { type: 'S2C_CHALLENGE_ANSWER_RECEIVED'; payload: { playerId: string; received: number; needed: number } }
  | { type: 'S2C_CHALLENGE_PHASE_UPDATE'; payload: {
      hiddenPlayerId?: string;
    } }
  | { type: 'S2C_CHALLENGE_RESULT'; payload: { 
      phase: GamePhase;
      winnerId?: string;
      winnerName?: string;
      correctAnswer?: string | number;
      shieldAwarded: boolean;
    } }
  | { type: 'S2C_SHIELD_REVEALED'; payload: { playerId: string; playerName: string; banishmentBlocked?: boolean } }
  | { type: 'S2C_AVATAR_UPDATED'; payload: { players: Player[] } }
  | { type: 'S2C_CHAT_MESSAGE'; payload: ChatMessage }
  | { type: 'S2C_TIMER_UPDATE'; payload: { endTime: number; duration: number; phase: GamePhase } }
  | { type: 'S2C_IDENTITY_CONFIRMED'; payload: { deviceToken: string; playerName: string; isReturningPlayer: boolean } }
  | { type: 'S2C_IDENTITY_ERROR'; payload: { message: string } }
  | { type: 'S2C_PLAYER_STATS'; payload: PlayerStatsPayload }
  | { type: 'S2C_LEADERBOARD'; payload: { metric: string; entries: LeaderboardEntryPayload[] } }
  | { type: 'S2C_GLOBAL_STATS'; payload: GlobalStatsPayload }
  | { type: 'S2C_ERROR'; payload: { message: string } };

// ============= Stats payload shapes =============
// Defined here (not in db/types.ts) so client and server share types.

export interface PlayerStatsPayload {
  gamesPlayed: number;
  winsAsTraitor: number;
  lossesAsTraitor: number;
  winsAsFaithful: number;
  lossesAsFaithful: number;
  totalSurvived: number;
  totalBanished: number;
  totalMurdered: number;
  totalVotesCast: number;
  totalVotesReceived: number;
  winRate: number;
  traitorWinRate: number;
  faithfulWinRate: number;
  averageRoundsPlayed: number;
  recentGames: GameSummaryPayload[];
}

export interface GameSummaryPayload {
  gameId: string;
  sessionId: string;
  endedAt: number;
  winner: 'TRAITORS' | 'FAITHFUL';
  role: 'TRAITOR' | 'FAITHFUL';
  outcome: 'WON' | 'LOST';
  playerCount: number;
  totalRounds: number;
}

export interface LeaderboardEntryPayload {
  /**
   * Stable opaque rank identifier used as a React key on the client.
   * NOT the persistent device token — that value is server-only and must
   * never be broadcast (it identifies a player across sessions).
   */
  rankId: string;
  playerName: string;
  value: number;
  gamesPlayed: number;
}

export interface GlobalStatsPayload {
  totalGamesPlayed: number;
  totalPlayersEver: number;
  faithfulWinRate: number;
  traitorWinRate: number;
  averageGameLength: number;
}
