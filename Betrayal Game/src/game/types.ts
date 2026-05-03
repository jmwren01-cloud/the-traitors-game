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
  /**
   * Wave 4: when true, eligible Faithful players are upgraded to special roles
   * (Sheriff/Medic/Seer) at role-assignment time depending on the player count.
   * Thresholds: Sheriff at 7+, Medic at 8+, Seer at 9+.
   */
  enableSpecialRoles: boolean;
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
  challengeTimerSeconds: 60,
  enableSpecialRoles: true
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

/**
 * Wave 4 special roles. Sheriff/Medic/Seer all belong to the Faithful team
 * for win-condition and recruitment purposes — anything that isn't 'TRAITOR'
 * is Faithful-aligned. Use `isFaithfulRole()` from manager.ts at boundaries
 * where the literal team matters.
 */
export type Role = 'TRAITOR' | 'FAITHFUL' | 'SHERIFF' | 'MEDIC' | 'SEER';

export interface Player {
  id: string;
  name: string;
  role?: Role;
  isAlive: boolean;
  isHost: boolean;
  isConnected: boolean;
  hasShield: boolean;
  shieldRevealed: boolean;
  /**
   * Round number in which the player explicitly declined to use their
   * shield. Tracked per-player (not per-game) so that revote-tie scenarios
   * with multiple shielded tied candidates can collect each player's
   * decision independently before random selection happens.
   */
  shieldDeclinedAtRound?: number;
  lastChallengeWinRound?: number;
  color?: string;
  avatar?: string;
  recruitmentUsed?: boolean;
  /**
   * Wave 4 — Seer one-time gift. True after the Seer has used their reveal
   * during a Roundtable.
   */
  seerGiftUsed?: boolean;
  /**
   * Wave 4 — Medic. The id of the player the Medic protected on the most
   * recent night they were active. Cleared when the Medic dies. Used to
   * enforce the "no two nights in a row" rule.
   */
  medicLastProtectedTargetId?: string;
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

/**
 * Whisper system. Sent privately during ROUNDTABLE; the public
 * feed only sees sender + recipient + round (NEVER the content). Content is
 * delivered to the recipient via `S2C_WHISPER_RECEIVED` and replayed to all
 * players post-game in the `S2C_GAME_END` payload. Persisted on `GameState`.
 */
export interface Whisper {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  round: number;
  timestamp: number;
  /**
   * Whisper body. ALWAYS populated server-side. Scrubbed to undefined in
   * public broadcasts (S2C_WHISPER_SENT) and in the per-recipient slice of
   * S2C_RECONNECTED for whispers the player neither sent nor received.
   * Always populated in S2C_GAME_END for the post-game replay.
   */
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
   * Wave 4 — Medic. Set when a living Medic submits a protect target during
   * NIGHT. Consumed by `resolveMurder()` to silently block a kill on the
   * matching player. Cleared on the next `startNight()`.
   */
  medicProtectionTargetId?: string;
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
  /**
   * Every whisper sent during this game, in send order. The
   * full list (with content) is replayed to all players post-game.
   */
  whispers?: Whisper[];
  /**
   * Player IDs that have already used their one whisper for the current
   * Roundtable. Reset to [] on each `startRoundtable()`. Stored as a plain
   * string array so the state remains JSON-serialisable for SQLite.
   */
  whispersUsedThisRound?: string[];
  /**
   * Wave 4 / 3 — False Evidence. Traitors may unanimously plant ONE piece
   * of fake evidence per game during NIGHT. The pending vote tally lives
   * in `evidenceVotes`; once unanimity is reached the agreed plant moves
   * to `falseEvidence` (status PENDING) and `evidenceUsed` becomes true.
   * The plant is consumed at the next ROUNDTABLE start by
   * `activateFalseEvidence()`. `forceSuspiciousIds` queues a one-shot
   * Sheriff override per framed target.
   */
  evidenceVotes?: EvidenceVote[];
  falseEvidence?: FalseEvidence;
  evidenceUsed?: boolean;
  forceSuspiciousIds?: string[];
}

export type EvidenceType = 'FRAME' | 'WHISPER_FABRICATION' | 'ANONYMOUS_TIP';

/** Cap for the optional WHISPER_FABRICATION / ANONYMOUS_TIP body. */
export const FALSE_EVIDENCE_CONTENT_MAX = 150;

export interface EvidenceVote {
  voterId: string;
  /** SKIP means "don't plant anything tonight". */
  type: EvidenceType | 'SKIP';
  /** Required for non-SKIP votes; the player being framed. */
  targetId?: string;
  /** Required for WHISPER_FABRICATION & ANONYMOUS_TIP. Sanitised, ≤150. */
  content?: string;
}

export interface FalseEvidence {
  type: EvidenceType;
  targetId: string;
  targetName: string;
  /** Body for WHISPER_FABRICATION (fake whisper text) and ANONYMOUS_TIP. */
  content?: string;
  /** Round of the NIGHT during which this was planted. */
  plantedAtRound: number;
  /** Set once activateFalseEvidence runs the plant at next ROUNDTABLE. */
  activatedAtRound?: number;
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
  | { type: 'C2S_DECLINE_SHIELD'; payload: Record<string, never> }
  | { type: 'C2S_SET_AVATAR'; payload: { color?: string; avatar?: string } }
  | { type: 'C2S_SUBMIT_RECRUITMENT'; payload: { targetId: string } }
  | { type: 'C2S_MEDIC_PROTECT'; payload: { targetId: string } }
  /**
   * Wave 4 — the Seer activates their one-time gift. Per spec the gift
   * reveals a RANDOM alive non-self player; the client does not pick a
   * target, so the payload is intentionally empty.
   */
  | { type: 'C2S_ACTIVATE_SEER'; payload: Record<string, never> }
  | { type: 'C2S_IDENTIFY'; payload: { deviceToken: string; playerName: string } }
  | { type: 'C2S_GET_PLAYER_STATS'; payload: Record<string, never> }
  | { type: 'C2S_GET_LEADERBOARD'; payload: { metric: 'winRate' | 'gamesPlayed' | 'traitorWins' } }
  | { type: 'C2S_GET_GLOBAL_STATS'; payload: Record<string, never> }
  | { type: 'C2S_TRANSFER_HOST'; payload: { targetPlayerId: string } }
  | { type: 'C2S_END_GAME_EARLY'; payload: Record<string, never> }
  /** Send a private whisper to another alive player during ROUNDTABLE. */
  | { type: 'C2S_SEND_WHISPER'; payload: { recipientId: string; content: string } }
  /**
   * Wave 4 / 3 — Traitor casts (or updates) their evidence vote during NIGHT.
   * `targetId`/`content` are omitted on SKIP. Server enforces unanimity.
   */
  | { type: 'C2S_CAST_EVIDENCE_VOTE'; payload: {
      voteType: EvidenceType | 'SKIP';
      targetId?: string;
      content?: string;
    } };

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
      /**
       * Whisper history scrubbed for this recipient. Content is
       * present only for whispers the reconnecting player sent or received.
       */
      whispers?: Whisper[];
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
      winner?: 'TRAITORS' | 'FAITHFUL'; 
      phase: GamePhase;
      remainingTraitors: number;
      remainingFaithful: number;
      history: RoundRecord[];
      reason?: 'HOST_ENDED';
      /** Full whisper log with content, for the post-game reveal. */
      whispers?: Whisper[];
      /** Wave 4 / 3 — revealed to everyone in the post-game summary. */
      falseEvidence?: FalseEvidence;
    } }
  | { type: 'S2C_HOST_TRANSFERRED'; payload: { 
      newHostId: string; 
      newHostName: string; 
      players: Player[];
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
      /**
       * Wave 4 — set when the Medic silently blocked the murder. The
       * server intentionally omits the target's identity so the Medic
       * is not outed; the UI just announces that the strike failed.
       */
      medicBlocked?: boolean;
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
      shieldAwarded?: boolean;
    } }
  | { type: 'S2C_SHIELD_REVEALED'; payload: { playerId: string; playerName: string; banishmentBlocked?: boolean } }
  /** Sent privately to a Sheriff each morning with their investigation result. */
  | { type: 'S2C_SHERIFF_RESULT'; payload: {
      targetId: string;
      targetName: string;
      reportedRole: 'TRAITOR' | 'FAITHFUL';
      round: number;
    } }
  /** Sent privately to the Medic to confirm their submitted protection target. */
  | { type: 'S2C_MEDIC_PROTECTED'; payload: { targetId: string; targetName: string } }
  /** Sent privately to the Seer with the actual role of their chosen target. */
  | { type: 'S2C_SEER_RESULT'; payload: {
      targetId: string;
      targetName: string;
      actualRole: Role;
    } }
  /**
   * Sent privately to all alive Traitors when the Seer activates their gift.
   * The spec is intentionally vague — Traitors learn that the gift was used
   * but NOT who the Seer is or who they read. Identity fields are optional
   * so future variants can opt into more disclosure without a breaking change.
   */
  | { type: 'S2C_SEER_ACTIVATED'; payload: {
      seerId?: string;
      seerName?: string;
      targetId?: string;
      targetName?: string;
    } }
  /**
   * broadcast to ALL players when any whisper is sent. The
   * payload deliberately omits `content`; only sender/recipient/round are
   * exposed publicly. Recipients additionally receive `S2C_WHISPER_RECEIVED`
   * with the body.
   */
  | { type: 'S2C_WHISPER_SENT'; payload: {
      id: string;
      senderId: string;
      senderName: string;
      recipientId: string;
      recipientName: string;
      round: number;
      timestamp: number;
    } }
  /** sent privately to the whisper's recipient with the body. */
  | { type: 'S2C_WHISPER_RECEIVED'; payload: Whisper }
  /** Whisper validation failure routed only to the offending sender. */
  | { type: 'S2C_WHISPER_ERROR'; payload: { code: 'PHASE' | 'DEAD' | 'SELF' | 'ALREADY_USED' | 'EMPTY' | 'TOO_LONG' | 'NOT_FOUND'; message: string } }
  /**
   * Wave 4 / 3 — Sent only to alive Traitors during NIGHT. Reports each
   * traitor's current vote (or that they have not yet voted) plus a
   * progress counter so the planting UI can render its tally.
   */
  | { type: 'S2C_EVIDENCE_VOTE_CAST'; payload: {
      votes: EvidenceVote[];
      received: number;
      needed: number;
    } }
  /** Sent to alive Traitors when a unanimous plant succeeds. */
  | { type: 'S2C_EVIDENCE_PLANTED'; payload: {
      evidence: FalseEvidence;
    } }
  /** Sent to alive Traitors when the vote concluded with no plant (SKIP). */
  | { type: 'S2C_EVIDENCE_FAILED'; payload: {
      reason: 'SKIPPED' | 'NO_AGREEMENT';
    } }
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
