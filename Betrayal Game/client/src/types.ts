export type Role = 'TRAITOR' | 'FAITHFUL' | 'SHERIFF' | 'MEDIC' | 'SEER';

/* re-export FalseEvidence shape used in S2C_GAME_END below */
/**
 * Wave 4 — Sheriff / Medic / Seer all belong to the Faithful team for win
 * conditions and UI counts. Use this helper anywhere the literal team
 * matters (e.g. "X Faithful remain").
 */
export function isFaithfulRole(role: Role | undefined): boolean {
  return role !== undefined && role !== 'TRAITOR';
}

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
  enableSpecialRoles: boolean;
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
  seerGiftUsed?: boolean;
  medicLastProtectedTargetId?: string;
}

export interface Vote {
  voterId: string;
  targetId: string;
  reasonText?: string;
  timestamp?: number;
  isAutoVote?: boolean;
}

export type ChatChannel = 'general' | 'traitor' | 'confessions';

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

/**
 * Whisper. The public feed only ever sees sender + recipient + round;
 * `content` is populated only for whispers the local player sent or
 * received during the live game, and for ALL whispers in the post-game
 * replay (`S2C_GAME_END`).
 */
export interface Whisper {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  round: number;
  timestamp: number;
  content?: string;
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
  /**
   * full per-round confession archive (with playerId
   * attribution and isDefault/isAnonymousTip flags) so the post-game
   * replay can show who actually said what.
   */
  confessions?: ConfessionEntry[];
  /**
   * Wave 4 / 5 — public per-round Suspicion Token graph (auto-backfills
   * flagged with `isAuto: true`). Rendered in the post-game replay's
   * "How It Happened" timeline.
   */
  suspicionTokens?: SuspicionToken[];
}

// ============= Suspicion Tokens (Wave 4 / 5) =============

export const TOKEN_PLACEMENT_WINDOW_MS = 45_000;
export const TOKEN_REVEAL_DURATION_MS = 5_000;

export type SuspicionTokenPhase = 'PLACEMENT' | 'REVEAL';

/**
 * Mirrors the server `SuspicionToken`. `isAuto` flags placements the
 * server backfilled when a player didn't act in the placement window.
 */
export interface SuspicionToken {
  placerId: string;
  targetId: string;
  round: number;
  isAuto?: boolean;
}

export type SuspicionTokenErrorCode =
  | 'PHASE'
  | 'EXPIRED'
  | 'DEAD'
  | 'ALREADY_PLACED'
  | 'INVALID_TARGET'
  | 'SELF';

// ============= Confession Booth =============

export const CONFESSION_MIN_LENGTH = 10;
export const CONFESSION_MAX_LENGTH = 120;
export const CONFESSION_WINDOW_MS = 60_000;

export type ConfessionPhase = 'BOOTH' | 'DISCUSSION';

/**
 * Server-side confession entry. Mirrors the server type. `playerId` is
 * present for both real and default-backfilled entries (defaults still
 * track who-defaulted so the post-game replay can mark "(didn't
 * confess)"). ANONYMOUS_TIP injections have no author.
 */
export interface ConfessionEntry {
  id: string;
  playerId?: string;
  text: string;
  isDefault?: boolean;
  isAnonymousTip?: boolean;
}

/** Public reveal — attribution stripped. */
export interface ConfessionReveal {
  id: string;
  text: string;
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
  nightRecruitmentTargetId?: string;
  nightRecruitmentTargetName?: string;
  shieldBlockedBanishment?: boolean;
  shieldBlockedBanishmentName?: string;
  /**
   * Wave 4 — Sheriff's running list of investigations across the game,
   * appended each morning. Used to render "My Investigations" history.
   */
  sheriffReports?: SheriffReport[];
  /** Wave 4 — Medic's confirmed protection target for the current night. */
  medicProtectedTarget?: { id: string; name: string };
  /**
   * Wave 4 — Seer's revealed result after burning their one-time gift.
   * Note: targetId is informational; UI normally displays targetName.
   */
  seerResult?: { targetId: string; targetName: string; actualRole: Role };
  /** Wave 4 — Set on alive Traitors when the Seer's gift is activated. */
  seerActivatedAlert?: boolean;
  /**
   * Wave 4 — set during MORNING when the Medic silently blocked the
   * Traitors' kill. The protected identity is intentionally not sent.
   */
  medicBlocked?: boolean;
  /**
   * Whispers. Each entry has full sender/recipient metadata. `content` is
   * set only when this player sent or received the whisper (or, post-game,
   * for every whisper). Used for the public "X whispered to Y" feed, the
   * local inbox, and the post-game replay.
   */
  whispers?: Whisper[];
  /** Last whisper id we slid in as a notification — used to suppress repeats. */
  lastWhisperReceivedId?: string;
  /** Ids of received whispers the local player has already viewed. */
  whispersRead?: string[];
  /** Most recent whisper validation error returned for the local player. */
  whisperError?: { code: WhisperErrorCode; message: string };
  /**
   * Wave 4 / 3 — False Evidence. Mirrors server fields. `evidenceVotes`,
   * `falseEvidence`, `evidenceUsed` are populated only on traitors'
   * clients (never broadcast publicly during play). The post-game
   * `S2C_GAME_END` reveal exposes `falseEvidence` to everyone.
   */
  evidenceVotes?: EvidenceVote[];
  falseEvidence?: FalseEvidence;
  evidenceUsed?: boolean;
  /** Tally progress for the planting UI. */
  evidenceVoteProgress?: { received: number; needed: number };
  /** Wave 4 / 3 — Unix-ms deadline for the 60s unanimity window. */
  evidenceWindowEndsAt?: number;
  /** Last terminal evidence outcome — drives the inline failure banner. */
  evidenceLastFailure?: 'SKIPPED' | 'NO_AGREEMENT' | 'TIMEOUT';
  /**
   * Confession Booth public state. `confessionPhase` mirrors
   * the server's BOOTH/DISCUSSION sub-phase. `confessionRevealed` is the
   * shuffled, attribution-stripped reveal payload. The submitted/total
   * counts drive the public "X of Y" progress chip. `confessionWindowEndsAt`
   * is the Unix-ms deadline for the booth countdown.
   */
  confessionPhase?: ConfessionPhase;
  confessionRevealed?: ConfessionReveal[];
  confessionSubmittedCount?: number;
  confessionTotalCount?: number;
  confessionWindowEndsAt?: number;
  /** Local-only flag set when this player has submitted their confession. */
  mySubmittedConfession?: boolean;
  /** Round number whose confessions are currently in `confessionRevealed`. */
  confessionRound?: number;
  /**
   * Wave 4 / 5 — Suspicion Token sub-phase state. `tokenPhase` is set
   * only while the sub-phase is open. During PLACEMENT we know counts +
   * our own pick; on REVEAL we have the full directed graph in
   * `suspicionTokensCurrent`. `suspicionTokensByRound` archives all past
   * rounds for the live in-game history panel; the post-game replay
   * reads `RoundRecord.suspicionTokens` instead.
   */
  tokenPhase?: SuspicionTokenPhase;
  tokenWindowEndsAt?: number;
  tokenRevealEndsAt?: number;
  tokenSubmittedCount?: number;
  tokenTotalCount?: number;
  myTokenTargetId?: string;
  suspicionTokensCurrent?: SuspicionToken[];
  suspicionTokensByRound?: Record<number, SuspicionToken[]>;
  /** Last validation error from the server for our placement attempt. */
  tokenError?: { code: SuspicionTokenErrorCode; message: string };
}

export type EvidenceType = 'FRAME' | 'WHISPER_FABRICATION' | 'ANONYMOUS_TIP';

export const FALSE_EVIDENCE_CONTENT_MAX = 150;
export const FALSE_EVIDENCE_WINDOW_MS = 60_000;

export interface EvidenceVote {
  voterId: string;
  type: EvidenceType | 'SKIP';
  targetId?: string;
  content?: string;
}

export interface FalseEvidence {
  type: EvidenceType;
  targetId: string;
  targetName: string;
  content?: string;
  plantedAtRound: number;
  activatedAtRound?: number;
}

export interface SheriffReport {
  targetId: string;
  targetName: string;
  reportedRole: 'TRAITOR' | 'FAITHFUL';
  round: number;
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
  | { type: 'C2S_MEDIC_PROTECT'; payload: { targetId: string } }
  /** Wave 4 — Seer activates the gift. Target is RANDOM and chosen server-side. */
  | { type: 'C2S_ACTIVATE_SEER'; payload: Record<string, never> }
  | { type: 'C2S_IDENTIFY'; payload: { deviceToken: string; playerName: string } }
  | { type: 'C2S_GET_PLAYER_STATS'; payload: Record<string, never> }
  | { type: 'C2S_GET_LEADERBOARD'; payload: { metric: 'winRate' | 'gamesPlayed' | 'traitorWins' } }
  | { type: 'C2S_GET_GLOBAL_STATS'; payload: Record<string, never> }
  | { type: 'C2S_TRANSFER_HOST'; payload: { targetPlayerId: string } }
  | { type: 'C2S_END_GAME_EARLY'; payload: Record<string, never> }
  /** Send a private whisper to another alive player during ROUNDTABLE. */
  | { type: 'C2S_SEND_WHISPER'; payload: { recipientId: string; content: string } }
  | { type: 'C2S_CAST_EVIDENCE_VOTE'; payload: {
      voteType: EvidenceType | 'SKIP';
      targetId?: string;
      content?: string;
    } }
  /** Confession Booth submission (10–120 chars). */
  | { type: 'C2S_SUBMIT_CONFESSION'; payload: { content: string } }
  /** Wave 4 / 5 — place this player's single Suspicion Token. */
  | { type: 'C2S_PLACE_SUSPICION_TOKEN'; payload: { targetId: string } };

export const WHISPER_MAX_LENGTH = 200;

export type WhisperErrorCode =
  | 'PHASE'
  | 'DEAD'
  | 'SELF'
  | 'ALREADY_USED'
  | 'EMPTY'
  | 'TOO_LONG'
  | 'NOT_FOUND';

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
  // DB persists only the literal team; special roles are normalized to FAITHFUL.
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
