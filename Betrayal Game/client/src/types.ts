export type Role = 'TRAITOR' | 'FAITHFUL';

export interface GameSettings {
  timerDurations: {
    roundtable: number;
    voting: number;
    night: number;
  };
  traitorMode: 'auto' | 'fixed';
  traitorCount: number;
  minPlayers: number;
  round1DiscussionOnly: boolean;
  challengesEnabled: boolean;
  challengeTimerSeconds: number;
}

export type ChallengeType = 'TIME_ESTIMATE' | 'MISSING_PLAYER' | 'WORD_SCRAMBLE';

export interface ChallengeState {
  type: ChallengeType;
  startTime: number;
  targetTime?: number;
  hiddenPlayerId?: string;
  shownPlayerIds?: string[];
  scrambledWord?: string;
  winnerId?: string;
  winnerName?: string;
  correctAnswer?: string | number;
  completed: boolean;
  shieldAwarded?: boolean;
  answeredCount?: number;
  eligibleCount?: number;
}

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

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isAlive: boolean;
  role?: Role;
  isConnected?: boolean;
  hasShield?: boolean;
  shieldRevealed?: boolean;
  shieldDeclinedAtRound?: number;
  color?: string;
  avatar?: string;
  recruitmentUsed?: boolean;
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
  myPlayerId?: string;
  myRole?: Role;
  traitorIds?: string[];
  votes?: Vote[];
  banishedPlayer?: { id: string; name: string; role: Role };
  murderedPlayer?: { id: string; name: string };
  murderBlocked?: { shieldedPlayerId: string; shieldedPlayerName: string };
  winner?: 'TRAITORS' | 'FAITHFUL';
  endReason?: 'HOST_ENDED';
  remainingTraitors?: number;
  remainingFaithful?: number;
  currentRound?: number;
  aliveTraitorCount?: number;
  murderVoteProgress?: { received: number; needed: number };
  messages?: ChatMessage[];
  timer?: TimerState;
  tiedPlayerIds?: string[];
  tiedPlayerNames?: string[];
  tiebreakerResults?: TiebreakerResult[];
  voteCount?: { received: number; needed: number };
  randomlySelectedPlayer?: { id: string; name: string; role: Role };
  revealIndex?: number;
  revealOrder?: string[];
  currentTally?: VoteTally[];
  revealedVotes?: Vote[];
  totalVotes?: number;
  currentReveal?: {
    vote: Vote;
    voterName: string;
    targetName: string;
  };
  settings?: GameSettings;
  challenge?: ChallengeState;
  history?: RoundRecord[];
  murderVoterIds?: string[];
  justRecruited?: boolean;
  recruitedPlayer?: { id: string; name: string };
  nightRecruitmentSubmittedBy?: string;
  shieldBlockedBanishment?: boolean;
  shieldBlockedBanishmentName?: string;
}

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
  | { type: 'C2S_DECLINE_SHIELD'; payload: Record<string, never> }
  | { type: 'C2S_SET_AVATAR'; payload: { color?: string; avatar?: string } }
  | { type: 'C2S_SUBMIT_RECRUITMENT'; payload: { targetId: string } }
  | { type: 'C2S_IDENTIFY'; payload: { deviceToken: string; playerName: string } }
  | { type: 'C2S_GET_PLAYER_STATS'; payload: Record<string, never> }
  | { type: 'C2S_GET_LEADERBOARD'; payload: { metric: 'winRate' | 'gamesPlayed' | 'traitorWins' } }
  | { type: 'C2S_GET_GLOBAL_STATS'; payload: Record<string, never> }
  | { type: 'C2S_TRANSFER_HOST'; payload: { targetPlayerId: string } }
  | { type: 'C2S_END_GAME_EARLY'; payload: Record<string, never> };

// ============= Stats payload shapes (mirrors server) =============

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
