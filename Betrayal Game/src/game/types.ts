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
  /**
   * Confession Booth. Full attribution for the post-game
   * replay. Includes default-statement entries (`isDefault: true`) and
   * any injected ANONYMOUS_TIP (`isAnonymousTip: true`,
   * `playerId: undefined` since it has no real author).
   */
  confessions?: ConfessionEntry[];
  /**
   * Suspicion Tokens. Public per-round directed graph of
   * who placed a token on whom before voting opened. `isAuto: true` flags
   * server-assigned placements for players who didn't pick in time.
   */
  suspicionTokens?: SuspicionToken[];
  /**
   * Sheriff investigations carried out this round (one per alive Sheriff).
   * Populated only on the post-game replay payload — stripped mid-game by
   * `scrubHistoryForLive` so reportedRole never leaks while the game runs.
   */
  sheriffInvestigations?: SheriffInvestigationRecord[];
  /**
   * Medic protection target for this round and whether it actually blocked
   * a kill. Stripped mid-game by `scrubHistoryForLive`.
   */
  medicProtection?: MedicProtectionRecord;
  /**
   * Seer's one-time gift, if used this round. Stripped mid-game by
   * `scrubHistoryForLive` so the actual role isn't leaked.
   */
  seerReveal?: SeerRevealRecord;
}

/** Per-round archive of a single Sheriff investigation. Post-game only. */
export interface SheriffInvestigationRecord {
  sheriffId: string;
  sheriffName: string;
  targetId: string;
  targetName: string;
  reportedRole: 'TRAITOR' | 'FAITHFUL';
}

/** Per-round archive of the Medic's chosen protect. Post-game only. */
export interface MedicProtectionRecord {
  medicId: string;
  medicName: string;
  targetId: string;
  targetName: string;
  /** True iff `resolveMurder` silently blocked a kill on this target. */
  saved: boolean;
}

/** Per-round archive of a Seer reveal. Post-game only. */
export interface SeerRevealRecord {
  seerId: string;
  seerName: string;
  targetId: string;
  targetName: string;
  actualRole: Role;
}

/**
 * Suspicion Tokens. A single public placement during the
 * pre-voting Suspicion Token sub-phase. `placerId`/`targetId` reference
 * `Player.id`. `round` snapshots the round in which it was cast.
 * `isAuto` is true when the server backfilled a random valid target
 * because the player didn't place in time.
 */
export interface SuspicionToken {
  placerId: string;
  targetId: string;
  round: number;
  isAuto?: boolean;
}

/** Sub-phase of a ROUNDTABLE for the  Suspicion Token system. */
export type SuspicionTokenPhase = 'PLACEMENT' | 'REVEAL';

/** Length of the public placement window before auto-resolve. */
export const TOKEN_PLACEMENT_WINDOW_MS = 45_000;

/** How long the reveal graph stays up before voting auto-starts. */
export const TOKEN_REVEAL_DURATION_MS = 5_000;

/**
 * Confession Booth. Server-side full record for one
 * statement made during a Roundtable's Booth sub-phase. `playerId` is
 * NEVER broadcast during the live game — only in the post-game replay
 * via `RoundRecord.confessions`.
 */
export interface ConfessionEntry {
  /** Unique id; used as the React key on reveal cards. */
  id: string;
  /** Author. Undefined for an injected ANONYMOUS_TIP (no real author). */
  playerId?: string;
  text: string;
  /** True when the player did not submit and the server backfilled. */
  isDefault?: boolean;
  /** True for an ANONYMOUS_TIP injected by an active FalseEvidence plant. */
  isAnonymousTip?: boolean;
}

/** Public-facing reveal — strips author and the default/tip flags. */
export interface ConfessionReveal {
  id: string;
  text: string;
}

/** Min/max length of a player-submitted confession. */
export const CONFESSION_MIN_LENGTH = 10;
export const CONFESSION_MAX_LENGTH = 120;

/** Booth window length. */
export const CONFESSION_WINDOW_MS = 60_000;

/** Sub-phase of a ROUNDTABLE; controls which UI is shown to the player. */
export type ConfessionPhase = 'BOOTH' | 'DISCUSSION';

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
  /**
   * Wave 4 / 3 — Unix-ms deadline by which all alive Traitors must agree.
   * Set the moment the FIRST evidence vote of the game is cast; cleared on
   * any terminal outcome (PLANTED / SKIPPED / NO_AGREEMENT / TIMEOUT) or
   * on the next NIGHT start. Drives the client countdown and the server
   * timeout that auto-fails an unfinished round.
   */
  evidenceWindowEndsAt?: number;
  /**
   * Confession Booth state for the current Roundtable.
   * `confessionPhase === 'BOOTH'` means the 60s booth overlay is active and
   * the discussion timer has NOT started yet. `'DISCUSSION'` means the
   * reveal has happened (or the booth is irrelevant — set on every fresh
   * Roundtable and again after `resolveConfessions`).
   */
  confessionPhase?: ConfessionPhase;
  /** Server-only full entries (with playerId). Reset on each Roundtable. */
  confessionEntries?: ConfessionEntry[];
  /** Player ids of players who have already submitted this round. */
  confessionSubmittedIds?: string[];
  /** Public-facing shuffled reveal list. Set by resolveConfessions. */
  confessionRevealed?: ConfessionReveal[];
  /** Unix-ms deadline for the 60s booth window. Cleared on resolve. */
  confessionWindowEndsAt?: number;
  /**
   * Suspicion Token sub-phase nested inside a ROUNDTABLE
   * after discussion ends but before VOTING starts. `'PLACEMENT'` while
   * the 45s window is open; `'REVEAL'` while the directed graph is shown
   * before the voting timer auto-starts. Undefined outside the sub-phase.
   */
  tokenPhase?: SuspicionTokenPhase;
  /** Unix-ms deadline for the 45s placement window. Cleared on resolve. */
  tokenWindowEndsAt?: number;
  /** Unix-ms deadline for the 5s post-resolve reveal hold. */
  tokenRevealEndsAt?: number;
  /** Tokens placed (real + auto-backfilled) for the current round. */
  suspicionTokensCurrent?: SuspicionToken[];
  /**
   * Special-role activity captured for the CURRENT round, copied into the
   * round's `RoundRecord` by `buildRoundRecord` and then cleared. Never
   * broadcast outside the post-game `S2C_GAME_END` payload.
   */
  currentSheriffInvestigations?: SheriffInvestigationRecord[];
  currentMedicProtection?: MedicProtectionRecord;
  currentSeerReveal?: SeerRevealRecord;
  /** Player ids that have already submitted a token this round. */
  tokensSubmittedIds?: string[];
  /**
   * Per-round archive of every Suspicion Token placement, keyed by round.
   * Hydrated on reconnect and rendered in the post-game replay alongside
   * each round's `RoundRecord`.
   */
  suspicionTokensByRound?: Record<number, SuspicionToken[]>;
}

export type EvidenceType = 'FRAME' | 'WHISPER_FABRICATION' | 'ANONYMOUS_TIP';

/** Cap for the optional ANONYMOUS_TIP body. WHISPER_FABRICATION never carries content. */
export const FALSE_EVIDENCE_CONTENT_MAX = 150;

/** Server-enforced unanimity window for false-evidence voting (60 s). */
export const FALSE_EVIDENCE_WINDOW_MS = 60_000;

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
  /**
   * Body for ANONYMOUS_TIP only (Confession Booth seam, Task #33).
   * WHISPER_FABRICATION deliberately stores no body — the lie is the
   * meta-only "X whispered to Y" feed entry; persisting content would
   * leak through `scrubWhispersForRecipient` to the framed "recipient".
   */
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
  | { type: 'C2S_REMOVE_PLAYER'; payload: { targetPlayerId: string } }
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
    } }
  /**
   * Confession Booth. Submit the player's anonymous statement
   * during the 60s booth window. Server validates length (10-120 chars
   * after trim), liveness, and single-submission per round.
   */
  | { type: 'C2S_SUBMIT_CONFESSION'; payload: { content: string } }
  /**
   * Place this player's single public Suspicion Token on
   * `targetId` during the 45s pre-voting placement window. Server
   * validates phase, liveness, single-submission, valid alive non-self
   * target. Replays after timeout/all-submitted are rejected.
   */
  | { type: 'C2S_PLACE_SUSPICION_TOKEN'; payload: { targetId: string } };

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
      /**
       * Wave 4 / 3 — False Evidence traitor-only state. Populated only
       * when the reconnecting player is an alive Traitor so the planting
       * UI can rehydrate (active window, prior votes, single-use guard).
       */
      evidenceVotes?: EvidenceVote[];
      evidenceVoteProgress?: { received: number; needed: number };
      evidenceWindowEndsAt?: number;
      evidenceUsed?: boolean;
      falseEvidence?: FalseEvidence;
      /**
       * Booth state for the current Roundtable. Only the
       * public-facing fields are sent (no server-side `confessionEntries`).
       * `confessionMySubmitted` lets the rejoining player skip straight to
       * the "recorded" state when they had already submitted.
       */
      confessionPhase?: ConfessionPhase;
      confessionRevealed?: ConfessionReveal[];
      confessionWindowEndsAt?: number;
      confessionSubmittedCount?: number;
      confessionTotalCount?: number;
      confessionMySubmitted?: boolean;
      /**
       * Suspicion Token sub-phase rehydration. `tokenPhase`
       * is set only while the sub-phase is active. During PLACEMENT the
       * server only sends `tokenSubmittedCount`/`tokenTotalCount` and the
       * caller's own `myTokenTargetId` (if any). On REVEAL/post-reveal the
       * full current-round `suspicionTokensCurrent` is included so the
       * graph can render. `suspicionTokensByRound` archives prior rounds
       * for the in-game history panel; the post-game replay reads from
       * RoundRecord.suspicionTokens instead.
       */
      tokenPhase?: SuspicionTokenPhase;
      tokenWindowEndsAt?: number;
      tokenRevealEndsAt?: number;
      tokenSubmittedCount?: number;
      tokenTotalCount?: number;
      myTokenTargetId?: string;
      suspicionTokensCurrent?: SuspicionToken[];
      suspicionTokensByRound?: Record<number, SuspicionToken[]>;
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
  /**
   * Broadcast to every remaining player after the host removes a player
   * mid-game. `players` is the post-removal roster (per-recipient scrubbed
   * by the router). `newHostId` is set only when the removed player was
   * the host and the role was auto-transferred.
   */
  | { type: 'S2C_PLAYER_REMOVED'; payload: {
      removedPlayerId: string;
      removedPlayerName: string;
      players: Player[];
      newHostId?: string;
    } }
  /**
   * Sent privately to the player being removed by the host, just before
   * their socket is closed. The client uses this to clear local game
   * state and surface a "you were removed" notice instead of treating
   * the close as a transient disconnect.
   */
  | { type: 'S2C_YOU_WERE_REMOVED'; payload: {
      reason: 'HOST_REMOVED';
      message: string;
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
  | { type: 'S2C_RECRUITMENT_SUBMITTED'; payload: { recruiterId: string; recruiterName: string; targetId: string; targetName: string } }
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
      /** Unix-ms deadline for all traitors to agree. */
      windowEndsAt?: number;
    } }
  /** Sent to alive Traitors when a unanimous plant succeeds. */
  | { type: 'S2C_EVIDENCE_PLANTED'; payload: {
      evidence: FalseEvidence;
    } }
  /** Sent to alive Traitors when the vote concluded with no plant. */
  | { type: 'S2C_EVIDENCE_FAILED'; payload: {
      reason: 'SKIPPED' | 'NO_AGREEMENT' | 'TIMEOUT';
    } }
  /**
   * Booth opens. Sent at the start of every Roundtable to
   * every player. `endsAt` is the Unix-ms deadline for the 60s window;
   * `aliveCount` is the denominator for the public progress count.
   */
  | { type: 'S2C_CONFESSION_PHASE_STARTED'; payload: {
      endsAt: number;
      duration: number;
      aliveCount: number;
    } }
  /**
   * Public progress only — never carries the submitter's identity. The
   * server emits this on every individual submission AND on the resolve
   * step so reconnecting clients converge on the right count.
   */
  | { type: 'S2C_CONFESSION_SUBMITTED'; payload: {
      received: number;
      needed: number;
    } }
  /**
   * Booth resolves. Server-shuffled, attribution stripped.
   * The roundtable discussion timer starts immediately after this event.
   */
  | { type: 'S2C_CONFESSIONS_REVEALED'; payload: {
      reveals: ConfessionReveal[];
      round: number;
    } }
  /**
   * Suspicion Token sub-phase opens. Sent at the moment the
   * host advances out of the discussion via C2S_START_VOTING. `aliveCount`
   * is the denominator for the public progress count.
   */
  | { type: 'S2C_TOKEN_PHASE_STARTED'; payload: {
      endsAt: number;
      duration: number;
      aliveCount: number;
      round: number;
    } }
  /**
   * Public progress only — never carries the placer's identity or their
   * target. Emitted on every individual placement; the placer also gets
   * a private `S2C_TOKEN_PLACED_PRIVATE` echo so their UI can lock in.
   */
  | { type: 'S2C_TOKEN_PLACED'; payload: {
      received: number;
      needed: number;
    } }
  /**
   * Private echo to a single placer confirming their pick was recorded.
   * Carries `targetId` so a client that placed and immediately reloaded
   * still sees the locked-in selection.
   */
  | { type: 'S2C_TOKEN_PLACED_PRIVATE'; payload: {
      targetId: string;
    } }
  /**
   * Suspicion Token reveal. Server-resolved, public directed graph.
   * Includes server-backfilled placements (`isAuto: true`) for any
   * non-submitter. The voting timer auto-starts after a 5s reveal hold.
   */
  | { type: 'S2C_TOKENS_REVEALED'; payload: {
      tokens: SuspicionToken[];
      round: number;
      revealEndsAt: number;
    } }
  /** Validation rejection for a Suspicion Token placement attempt. */
  | { type: 'S2C_TOKEN_ERROR'; payload: {
      code: 'PHASE' | 'EXPIRED' | 'DEAD' | 'ALREADY_PLACED' | 'INVALID_TARGET' | 'SELF';
      message: string;
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
