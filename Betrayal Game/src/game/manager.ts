// Game Manager - Core Game Logic

import type { GameState, Player, Role, Vote, TimerState, GamePhase, GameSettings, ChallengeState, ChallengeType, RoundRecord, VoteEntry, Whisper } from './types.js';
import { DEFAULT_SETTINGS } from './types.js';
import { pickAvailableColor, pickRandomAvatar, COLOR_IDS, AVATAR_IDS } from './avatarConstants.js';

// Word bank for Word Scramble challenge (simple 4-5 letter words)
const WORD_BANK = [
  'table', 'chair', 'house', 'water', 'light', 'music', 'party', 'dance',
  'smile', 'happy', 'trust', 'peace', 'brave', 'quiet', 'lucky', 'magic',
  'crown', 'royal', 'guard', 'night', 'storm', 'flame', 'ghost', 'manor',
  'vote', 'game', 'play', 'team', 'hero', 'gold', 'star', 'moon', 'fire',
  'king', 'lord', 'lady', 'duke', 'earl', 'hunt', 'mask', 'clue', 'trap'
];

// ============= INTERNAL HELPERS =============

/**
 * Strip a set of optional keys from an object so that
 * `exactOptionalPropertyTypes` is happy. Use this instead of writing
 * `field: undefined` (which the strict TS settings reject) when you want
 * to clear an optional GameState/ChallengeState field across spreads.
 */
function omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const copy: T = { ...obj };
  for (const k of keys) {
    delete copy[k];
  }
  return copy;
}

// ============= TIMER CONFIGURATION =============

export function createTimer(phase: GamePhase, settings: GameSettings): TimerState | undefined {
  let duration: number | undefined;
  
  switch (phase) {
    case 'ROUNDTABLE':
      duration = settings.timerDurations.roundtable;
      break;
    case 'VOTING':
    case 'REVOTE':
      duration = settings.timerDurations.voting;
      break;
    case 'NIGHT':
      duration = settings.timerDurations.night;
      break;
    case 'CHALLENGE':
      duration = settings.challengeTimerSeconds;
      break;
    default:
      return undefined;
  }
  
  return {
    endTime: Date.now() + duration * 1000,
    duration,
    phase
  };
}

export function isTimerExpired(timer?: TimerState): boolean {
  if (!timer) return false;
  return Date.now() >= timer.endTime;
}

// ============= GAME CREATION & PLAYER MANAGEMENT =============

export function createGame(hostName: string, deviceToken?: string): GameState {
  const sessionId = generateSessionId();
  const hostId = generatePlayerId();
  
  const host: Player = {
    id: hostId,
    name: hostName,
    isAlive: true,
    isHost: true,
    isConnected: true,
    hasShield: false,
    shieldRevealed: false,
    color: pickAvailableColor([]),
    avatar: pickRandomAvatar(),
    ...(deviceToken ? { deviceToken } : {})
  };

  return {
    sessionId,
    phase: 'LOBBY',
    players: [host],
    votes: [],
    revealedVotes: [],
    hostId,
    currentRound: 0,
    murderVotes: [],
    messages: [],
    lastManualVotes: {},
    history: [],
    settings: { ...DEFAULT_SETTINGS },
    startedAt: Date.now(),
    whispers: [],
    whispersUsedThisRound: []
  };
}

export function updateSettings(game: GameState, partialSettings: Partial<GameSettings>): GameState {
  if (game.phase !== 'LOBBY') {
    throw new Error('Can only change settings in lobby');
  }

  const newSettings: GameSettings = { ...game.settings };

  if (partialSettings.timerDurations) {
    newSettings.timerDurations = {
      roundtable: Math.min(300, Math.max(30, partialSettings.timerDurations.roundtable ?? game.settings.timerDurations.roundtable)),
      voting: Math.min(120, Math.max(30, partialSettings.timerDurations.voting ?? game.settings.timerDurations.voting)),
      night: Math.min(180, Math.max(30, partialSettings.timerDurations.night ?? game.settings.timerDurations.night))
    };
  }

  if (partialSettings.traitorMode !== undefined) {
    newSettings.traitorMode = partialSettings.traitorMode;
  }

  if (partialSettings.traitorCount !== undefined) {
    newSettings.traitorCount = Math.min(4, Math.max(1, partialSettings.traitorCount));
  }

  if (partialSettings.minPlayers !== undefined) {
    newSettings.minPlayers = Math.min(10, Math.max(5, partialSettings.minPlayers));
  }

  if (partialSettings.round1DiscussionOnly !== undefined) {
    newSettings.round1DiscussionOnly = partialSettings.round1DiscussionOnly;
  }

  if (partialSettings.challengesEnabled !== undefined) {
    newSettings.challengesEnabled = partialSettings.challengesEnabled;
  }

  if (partialSettings.challengeTimerSeconds !== undefined) {
    newSettings.challengeTimerSeconds = Math.min(120, Math.max(30, partialSettings.challengeTimerSeconds));
  }

  if (partialSettings.enableSpecialRoles !== undefined) {
    newSettings.enableSpecialRoles = partialSettings.enableSpecialRoles;
  }

  return {
    ...game,
    settings: newSettings
  };
}

// ============= ROLE TEAM HELPERS =============

/**
 * Wave 4: a role belongs to the Faithful team if it isn't 'TRAITOR'.
 * Sheriff/Medic/Seer all share win conditions and "non-recruitment" status
 * with vanilla Faithful, so this single predicate covers every team check.
 */
export function isFaithfulRole(role: Role | undefined): boolean {
  return role !== undefined && role !== 'TRAITOR';
}

export function addPlayer(game: GameState, playerName: string, deviceToken?: string): { game: GameState; playerId: string } {
  if (game.phase !== 'LOBBY') {
    throw new Error('Cannot join game in progress');
  }
  if (game.players.length >= 22) {
    throw new Error('Game is full (max 22 players)');
  }
  
  const normalizedName = playerName.trim().toLowerCase();
  const duplicateName = game.players.some((p: Player) => p.name.toLowerCase() === normalizedName);
  if (duplicateName) {
    throw new Error('A player with that name already exists');
  }

  const playerId = generatePlayerId();
  const takenColors = game.players.map((p: Player) => p.color).filter(Boolean) as string[];
  const takenAvatars = game.players.map((p: Player) => p.avatar).filter(Boolean) as string[];
  const newPlayer: Player = {
    id: playerId,
    name: playerName,
    isAlive: true,
    isHost: false,
    isConnected: true,
    hasShield: false,
    shieldRevealed: false,
    color: pickAvailableColor(takenColors),
    avatar: AVATAR_IDS.find((a) => !takenAvatars.includes(a)) ?? pickRandomAvatar(),
    ...(deviceToken ? { deviceToken } : {})
  };

  return {
    game: { ...game, players: [...game.players, newPlayer] },
    playerId
  };
}

export function setAvatar(game: GameState, playerId: string, color?: string, avatar?: string): GameState {
  if (game.phase !== 'LOBBY') {
    throw new Error('Can only change avatar in the lobby');
  }

  const player = game.players.find((p: Player) => p.id === playerId);
  if (!player) {
    throw new Error('Player not found');
  }

  if (color !== undefined) {
    if (!COLOR_IDS.includes(color)) {
      throw new Error('Invalid color choice');
    }
    const takenByOther = game.players.some((p: Player) => p.id !== playerId && p.color === color);
    if (takenByOther) {
      throw new Error('Color already taken by another player');
    }
  }

  if (avatar !== undefined && !AVATAR_IDS.includes(avatar)) {
    throw new Error('Invalid avatar choice');
  }

  const updatedPlayers = game.players.map((p: Player) => {
    if (p.id !== playerId) return p;
    return {
      ...p,
      ...(color !== undefined ? { color } : {}),
      ...(avatar !== undefined ? { avatar } : {}),
    };
  });

  return { ...game, players: updatedPlayers };
}

// ============= ROLE ASSIGNMENT =============

/**
 * WEEK 4 UPDATE: Multiple traitors based on player count
 * Traitor ratio: 1 traitor per 5 players (rounded down) OR fixed count from settings
 * - 5-9 players: 1 traitor
 * - 10-14 players: 2 traitors  
 * - 15-19 players: 3 traitors
 * - 20-22 players: 4 traitors
 */
export function assignRoles(game: GameState): GameState {
  if (game.phase !== 'ROLE_ASSIGN') {
    throw new Error('Cannot assign roles in current phase');
  }

  const playerCount = game.players.length;
  let traitorCount: number;
  
  if (game.settings.traitorMode === 'fixed') {
    traitorCount = Math.min(game.settings.traitorCount, Math.floor(playerCount / 2) - 1);
    traitorCount = Math.max(1, traitorCount);
  } else {
    traitorCount = Math.floor(playerCount / 5);
  }
  
  if (traitorCount === 0) {
    throw new Error('Need at least 5 players to assign roles');
  }

  // Shuffle players for random role assignment
  const shuffled = [...game.players].sort(() => Math.random() - 0.5);

  // Assign traitors first; everyone else starts as plain FAITHFUL.
  let assigned: Player[] = shuffled.map((player, index) => ({
    ...player,
    role: (index < traitorCount ? 'TRAITOR' : 'FAITHFUL') as Role
  }));

  // Wave 4: upgrade vanilla Faithful into Sheriff / Medic / Seer based on
  // player-count thresholds. Special roles do NOT increase the Faithful
  // count — they are stronger Faithful, not extra ones.
  if (game.settings.enableSpecialRoles) {
    const faithfulIds = assigned
      .filter((p) => p.role === 'FAITHFUL')
      .map((p) => p.id);
    // Shuffle independently so traitor selection isn't correlated with which
    // Faithful gets the special powers.
    const pool = [...faithfulIds].sort(() => Math.random() - 0.5);
    const upgrades: Role[] = [];
    if (playerCount >= 7) upgrades.push('SHERIFF');
    if (playerCount >= 8) upgrades.push('MEDIC');
    if (playerCount >= 9) upgrades.push('SEER');

    const upgradesById = new Map<string, Role>();
    for (let i = 0; i < upgrades.length && i < pool.length; i++) {
      upgradesById.set(pool[i]!, upgrades[i]!);
    }
    if (upgradesById.size > 0) {
      assigned = assigned.map((p) =>
        upgradesById.has(p.id) ? { ...p, role: upgradesById.get(p.id)! } : p
      );
    }
  }

  return {
    ...game,
    players: assigned,
    phase: 'ROLE_REVEAL'
  };
}

// ============= WAVE 4 SPECIAL ROLE HELPERS =============

export function getSheriffIds(game: GameState): string[] {
  return game.players.filter((p) => p.role === 'SHERIFF').map((p) => p.id);
}

export interface SheriffInvestigation {
  sheriffId: string;
  sheriffName: string;
  targetId: string;
  targetName: string;
  reportedRole: 'TRAITOR' | 'FAITHFUL';
}

/**
 * Wave 4 — Sheriff investigation. Called when transitioning into MORNING.
 * For each alive Sheriff, picks a random alive non-self target and reports
 * a role. There is a 25% chance the report is INVERTED (TRAITOR <->
 * FAITHFUL), capturing the spec's "imperfect investigation" rule.
 *
 * Returns one investigation per alive Sheriff, or an empty array if none.
 * The router fans these out as private S2C_SHERIFF_RESULT messages.
 */
export function runSheriffInvestigations(game: GameState): SheriffInvestigation[] {
  const out: SheriffInvestigation[] = [];
  const alive = game.players.filter((p) => p.isAlive);
  for (const sheriff of alive) {
    if (sheriff.role !== 'SHERIFF') continue;
    const candidates = alive.filter((p) => p.id !== sheriff.id);
    if (candidates.length === 0) continue;
    const target = candidates[Math.floor(Math.random() * candidates.length)]!;
    const trueIsTraitor = target.role === 'TRAITOR';
    const inverted = Math.random() < 0.25;
    const reported: 'TRAITOR' | 'FAITHFUL' = trueIsTraitor !== inverted ? 'TRAITOR' : 'FAITHFUL';
    out.push({
      sheriffId: sheriff.id,
      sheriffName: sheriff.name,
      targetId: target.id,
      targetName: target.name,
      reportedRole: reported,
    });
  }
  return out;
}

/**
 * Wave 4 — Medic protect. Called during NIGHT. The Medic chooses a target
 * to silently protect from murder this night.
 *
 * Rules:
 *   - Medic must be alive and have role 'MEDIC'.
 *   - Cannot self-protect.
 *   - Cannot protect the same player two nights in a row.
 *   - Only one protect per night (overwrites if Medic resubmits before
 *     murder resolution; the spec calls for a single in-flight choice).
 */
export function submitMedicProtect(
  game: GameState,
  medicId: string,
  targetId: string
): GameState {
  if (game.phase !== 'NIGHT') {
    throw new Error('Can only protect during the night phase');
  }
  const medic = game.players.find((p) => p.id === medicId);
  if (!medic || !medic.isAlive || medic.role !== 'MEDIC') {
    throw new Error('Only an alive Medic can protect a player');
  }
  if (targetId === medicId) {
    throw new Error('Medic cannot protect themselves');
  }
  const target = game.players.find((p) => p.id === targetId);
  if (!target || !target.isAlive) {
    throw new Error('Target not found or not alive');
  }
  if (medic.medicLastProtectedTargetId === targetId) {
    throw new Error('Cannot protect the same player two nights in a row');
  }

  const updatedPlayers = game.players.map((p) =>
    p.id === medicId ? { ...p, medicLastProtectedTargetId: targetId } : p
  );

  return {
    ...game,
    players: updatedPlayers,
    medicProtectionTargetId: targetId,
  };
}

export interface SeerActivationResult {
  game: GameState;
  seerId: string;
  seerName: string;
  targetId: string;
  targetName: string;
  actualRole: Role;
  traitorIds: string[];
}

/**
 * Wave 4 — Seer one-time gift. Activated during ROUNDTABLE. Picks a
 * RANDOM alive non-self player and reveals their TRUE role to the Seer
 * (always accurate, never inverted). Also notifies all alive Traitors
 * that the Seer used their gift on someone.
 *
 * The target is chosen by the server, not the Seer, so this function
 * intentionally takes no targetId.
 */
export function activateSeer(
  game: GameState,
  seerId: string
): SeerActivationResult {
  if (game.phase !== 'ROUNDTABLE') {
    throw new Error('Seer can only be activated during the Roundtable');
  }
  const seer = game.players.find((p) => p.id === seerId);
  if (!seer || !seer.isAlive || seer.role !== 'SEER') {
    throw new Error('Only an alive Seer can use the Seer gift');
  }
  if (seer.seerGiftUsed) {
    throw new Error('Seer gift has already been used');
  }

  const candidates = game.players.filter(
    (p) => p.isAlive && p.id !== seerId && !!p.role
  );
  if (candidates.length === 0) {
    throw new Error('No valid target available for the Seer');
  }
  const target = candidates[Math.floor(Math.random() * candidates.length)]!;

  const updatedPlayers = game.players.map((p) =>
    p.id === seerId ? { ...p, seerGiftUsed: true } : p
  );
  const updated: GameState = { ...game, players: updatedPlayers };

  return {
    game: updated,
    seerId,
    seerName: seer.name,
    targetId: target.id,
    targetName: target.name,
    actualRole: target.role!,
    traitorIds: updated.players.filter((p) => p.isAlive && p.role === 'TRAITOR').map((p) => p.id),
  };
}

// ============= ROUNDTABLE SYSTEM =============

export function startRoundtable(game: GameState): GameState {
  if (game.phase !== 'ROLE_REVEAL' && game.phase !== 'MORNING') {
    throw new Error('Cannot start roundtable from current phase');
  }

  // First roundtable after role reveal is Round 1
  const newRound = game.phase === 'ROLE_REVEAL' ? 1 : game.currentRound;

  return {
    ...game,
    phase: 'ROUNDTABLE',
    currentRound: newRound,
    // fresh whisper budget every Roundtable: each alive player
    // gets exactly one outgoing whisper for the round.
    whispersUsedThisRound: []
  };
}

// ============= WHISPER SYSTEM =============

/**
 * append a private whisper to game state.
 *
 * Validation:
 *   - Must be in ROUNDTABLE phase
 *   - Sender must be alive
 *   - Recipient must exist and be alive
 *   - Sender ≠ recipient
 *   - Sender has not already whispered this round
 *   - Content trims to 1..200 characters
 *
 * Returns both the updated game state and the persisted Whisper so the
 * router can fan it out (publicly without content; privately with content).
 */
export const WHISPER_MAX_LENGTH = 200;

export type WhisperErrorCode =
  | 'PHASE'
  | 'DEAD'
  | 'SELF'
  | 'ALREADY_USED'
  | 'EMPTY'
  | 'TOO_LONG'
  | 'NOT_FOUND';

export class WhisperError extends Error {
  constructor(public code: WhisperErrorCode, message: string) {
    super(message);
    this.name = 'WhisperError';
  }
}

/**
 * Strip a whisper of its `content` for public broadcast.
 * Anyone other than the recipient should only ever learn that
 * "X whispered to Y" — never the body. `content` is omitted (not set to
 * `undefined`) so the resulting object satisfies `exactOptionalPropertyTypes`.
 */
export function toPublicWhisper(w: Whisper): Whisper {
  const { content: _drop, ...rest } = w;
  void _drop;
  return rest;
}

/**
 * Build the public + private payloads for a single whisper send. The public
 * broadcast omits content; the private payload (delivered only to the
 * recipient socket) carries the full whisper.
 */
export function buildWhisperFanout(w: Whisper): {
  broadcast: Whisper;
  privateForRecipient: Whisper;
  privateRecipientId: string;
} {
  return {
    broadcast: toPublicWhisper(w),
    privateForRecipient: w,
    privateRecipientId: w.recipientId,
  };
}

/**
 * Project the whisper log for a single player. During live play only the
 * recipient sees `content`; once the game has ended every player sees the
 * full content (this is the post-game replay contract).
 */
export function scrubWhispersForRecipient(
  whispers: Whisper[] | undefined,
  recipientId: string,
  gameEnded: boolean
): Whisper[] {
  return (whispers ?? []).map((w) => {
    if (gameEnded || w.recipientId === recipientId) return w;
    return toPublicWhisper(w);
  });
}

export function sendWhisper(
  game: GameState,
  senderId: string,
  recipientId: string,
  rawContent: string
): { game: GameState; whisper: Whisper } {
  if (game.phase !== 'ROUNDTABLE') {
    throw new WhisperError('PHASE', 'Whispers can only be sent during the Roundtable');
  }
  if (senderId === recipientId) {
    throw new WhisperError('SELF', 'You cannot whisper to yourself');
  }
  const sender = game.players.find((p) => p.id === senderId);
  if (!sender || !sender.isAlive) {
    throw new WhisperError('DEAD', 'Only alive players can whisper');
  }
  const recipient = game.players.find((p) => p.id === recipientId);
  if (!recipient) {
    throw new WhisperError('NOT_FOUND', 'Recipient is not in the game');
  }
  if (!recipient.isAlive) {
    throw new WhisperError('DEAD', 'Recipient is no longer alive');
  }
  const used = game.whispersUsedThisRound ?? [];
  if (used.includes(senderId)) {
    throw new WhisperError('ALREADY_USED', 'You have already whispered this round');
  }
  const content = (rawContent ?? '').trim();
  if (content.length === 0) {
    throw new WhisperError('EMPTY', 'Whisper cannot be empty');
  }
  if (content.length > WHISPER_MAX_LENGTH) {
    throw new WhisperError('TOO_LONG', `Whisper exceeds ${WHISPER_MAX_LENGTH} characters`);
  }

  const whisper: Whisper = {
    id: `whisper_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    senderId,
    senderName: sender.name,
    recipientId,
    recipientName: recipient.name,
    round: game.currentRound,
    timestamp: Date.now(),
    content,
  };

  return {
    game: {
      ...game,
      whispers: [...(game.whispers ?? []), whisper],
      whispersUsedThisRound: [...used, senderId],
    },
    whisper,
  };
}

// ============= VOTING SYSTEM =============

export function startVoting(game: GameState): GameState {
  if (game.phase !== 'ROUNDTABLE') {
    throw new Error('Cannot start voting from current phase');
  }

  return {
    ...game,
    phase: 'VOTING',
    votes: []
  };
}

export function submitVote(game: GameState, voterId: string, targetId: string): GameState {
  if (game.phase !== 'VOTING' && game.phase !== 'REVOTE') {
    throw new Error('Not in voting phase');
  }

  const voter = game.players.find((p: Player) => p.id === voterId);
  if (!voter || !voter.isAlive) {
    throw new Error('Voter not found or not alive');
  }

  const target = game.players.find((p: Player) => p.id === targetId);
  if (!target || !target.isAlive) {
    throw new Error('Target not found or not alive');
  }

  // Remove any existing vote from this voter
  const filteredVotes = game.votes.filter((v: Vote) => v.voterId !== voterId);
  
  return {
    ...game,
    votes: [...filteredVotes, { voterId, targetId }]
  };
}

export function submitVoteWithReason(game: GameState, voterId: string, targetId: string, reasonText?: string): GameState {
  if (game.phase !== 'VOTING' && game.phase !== 'REVOTE') {
    throw new Error('Not in voting phase');
  }

  const voter = game.players.find((p: Player) => p.id === voterId);
  if (!voter || !voter.isAlive) {
    throw new Error('Voter not found or not alive');
  }

  const target = game.players.find((p: Player) => p.id === targetId);
  if (!target || !target.isAlive) {
    throw new Error('Target not found or not alive');
  }

  // Remove any existing vote from this voter
  const filteredVotes = game.votes.filter((v: Vote) => v.voterId !== voterId);
  
  const trimmedReason = reasonText?.trim().slice(0, 120);
  const vote: Vote = {
    voterId,
    targetId,
    timestamp: Date.now(),
    ...(trimmedReason ? { reasonText: trimmedReason } : {}),
  };
  
  // Track this as a manual vote for future auto-vote fallback
  const updatedLastManualVotes = { ...game.lastManualVotes, [voterId]: targetId };
  
  return {
    ...game,
    votes: [...filteredVotes, vote],
    lastManualVotes: updatedLastManualVotes
  };
}

export interface AutoVoteResult {
  game: GameState;
  autoVotes: Vote[];
}

export function generateAutoVotes(game: GameState): AutoVoteResult {
  const alivePlayers = game.players.filter((p: Player) => p.isAlive);
  const playersWhoVoted = new Set(game.votes.map((v: Vote) => v.voterId));
  const playersWhoNeedAutoVote = alivePlayers.filter((p: Player) => !playersWhoVoted.has(p.id));
  
  const autoVotes: Vote[] = [];
  let updatedVotes = [...game.votes];
  
  for (const player of playersWhoNeedAutoVote) {
    // Get valid targets (alive players excluding self)
    let validTargets = alivePlayers.filter((p: Player) => p.id !== player.id);
    
    // For revotes, only allow voting for tied candidates
    if (game.phase === 'REVOTE' && game.tiedPlayerIds) {
      validTargets = validTargets.filter((p: Player) => game.tiedPlayerIds!.includes(p.id));
    }
    
    if (validTargets.length === 0) continue;
    
    let targetId: string;
    
    if (game.currentRound === 1) {
      // Round 1: always random
      targetId = validTargets[Math.floor(Math.random() * validTargets.length)]!.id;
    } else {
      // Round 2+: check if they have a previous manual vote
      const lastVoteTarget = game.lastManualVotes[player.id];
      const lastTargetStillValid = lastVoteTarget && validTargets.some((p: Player) => p.id === lastVoteTarget);
      
      if (lastTargetStillValid) {
        // Vote for the same player as last round
        targetId = lastVoteTarget;
      } else {
        // Random selection
        targetId = validTargets[Math.floor(Math.random() * validTargets.length)]!.id;
      }
    }
    
    const autoVote: Vote = {
      voterId: player.id,
      targetId,
      reasonText: '[Auto-vote: player did not vote in time]',
      timestamp: Date.now(),
      isAutoVote: true
    };
    
    autoVotes.push(autoVote);
    updatedVotes.push(autoVote);
  }
  
  return {
    game: {
      ...game,
      votes: updatedVotes
    },
    autoVotes
  };
}

export function revealVotes(game: GameState): GameState {
  if (game.phase !== 'VOTING') {
    throw new Error('Not in voting phase');
  }

  // Per-player shield decisions are tracked on Player.shieldDeclinedAtRound,
  // so a fresh VOTE_REVEAL window doesn't need to reset anything globally —
  // the gate in banishPlayer() compares shieldDeclinedAtRound to currentRound.
  return {
    ...game,
    phase: 'VOTE_REVEAL',
    revealedVotes: [...game.votes],
  };
}

/**
 * Mark that a shielded player at risk of banishment has explicitly chosen
 * NOT to burn their shield this round. Allowed for any tied top-candidate
 * during VOTE_REVEAL, so revote-tie scenarios with multiple shielded tied
 * players can collect each decision independently.
 */
export function declineShield(game: GameState, playerId: string): GameState {
  if (game.phase !== 'VOTE_REVEAL') {
    throw new Error('Shield decisions can only be made during the vote reveal');
  }
  const player = game.players.find((p: Player) => p.id === playerId);
  if (!player || !player.isAlive) {
    throw new Error('Player not found or not alive');
  }
  if (!player.hasShield || player.shieldRevealed) {
    throw new Error('You have no shield to decline');
  }

  const topCandidates = computeTopCandidates(game.revealedVotes);
  if (!topCandidates.includes(playerId)) {
    throw new Error('Only a top vote-getter can make a shield decision');
  }

  return {
    ...game,
    players: game.players.map((p: Player) =>
      p.id === playerId ? { ...p, shieldDeclinedAtRound: game.currentRound } : p
    ),
  };
}

function computeTopCandidates(revealedVotes: Vote[]): string[] {
  const counts = new Map<string, number>();
  for (const v of revealedVotes) {
    counts.set(v.targetId, (counts.get(v.targetId) ?? 0) + 1);
  }
  let topCount = 0;
  const top: string[] = [];
  counts.forEach((n, id) => {
    if (n > topCount) { topCount = n; top.length = 0; top.push(id); }
    else if (n === topCount && topCount > 0) { top.push(id); }
  });
  return top;
}

export interface BanishResult {
  game: GameState;
  isTie: boolean;
  tiedPlayerIds?: string[];
  isRandomSelection?: boolean;
  randomlySelectedPlayerId?: string;
}

export function banishPlayer(game: GameState): BanishResult {
  if (game.phase !== 'VOTE_REVEAL') {
    throw new Error('Cannot banish outside vote reveal phase');
  }

  // Count votes
  const voteCounts = new Map<string, number>();
  game.revealedVotes.forEach((vote: Vote) => {
    voteCounts.set(vote.targetId, (voteCounts.get(vote.targetId) || 0) + 1);
  });

  // Find player(s) with most votes
  let maxVotes = 0;
  const topCandidates: string[] = [];
  
  voteCounts.forEach((count, playerId) => {
    if (count > maxVotes) {
      maxVotes = count;
      topCandidates.length = 0;
      topCandidates.push(playerId);
    } else if (count === maxVotes && maxVotes > 0) {
      topCandidates.push(playerId);
    }
  });

  if (topCandidates.length === 0) {
    throw new Error('No votes cast');
  }

  // Shield-reveal gate: any alive top candidate (single OR among tied) who
  // holds an unrevealed shield AND has not yet declined this round must be
  // given the chance to reveal. The gate covers the normal banishment path
  // AND the revote random-tiebreaker path, so the host cannot race past a
  // shielded player's reveal prompt — even when the random pick has not
  // happened yet (we don't know who the random pick will be, so we wait
  // for every shielded tied candidate to decide first).
  for (const candidateId of topCandidates) {
    const candidate = game.players.find((p: Player) => p.id === candidateId);
    if (
      candidate &&
      candidate.isAlive &&
      candidate.hasShield &&
      !candidate.shieldRevealed &&
      candidate.shieldDeclinedAtRound !== game.currentRound
    ) {
      throw new Error(
        `Waiting for ${candidate.name} to choose: reveal shield or accept banishment`
      );
    }
  }

  // Handle tie
  if (topCandidates.length > 1) {
    // If this is a revote tie, do random selection
    if (game.isRevote) {
      const randomIndex = Math.floor(Math.random() * topCandidates.length);
      const randomlySelectedId = topCandidates[randomIndex]!;
      const updatedPlayers = game.players.map((p: Player) =>
        p.id === randomlySelectedId ? { ...p, isAlive: false } : p
      );
      const snapshotVotes = [...game.revealedVotes];

      return {
        game: {
          ...game,
          phase: 'TIEBREAKER_REVEAL',
          players: updatedPlayers,
          banishedPlayerId: randomlySelectedId,
          randomlySelectedPlayerId: randomlySelectedId,
          tiedPlayerIds: topCandidates,
          isRevote: false,
          lastRoundVotes: snapshotVotes,
        },
        isTie: false,
        isRandomSelection: true,
        randomlySelectedPlayerId: randomlySelectedId,
        tiedPlayerIds: topCandidates
      };
    }

    // First tie: transition to REVOTE phase (don't snapshot yet — revote will determine final banishment)
    return {
      game: {
        ...game,
        phase: 'TIE_DETECTED',
        tiedPlayerIds: topCandidates,
        votes: [],
        revealedVotes: [],
        isRevote: false
      },
      isTie: true,
      tiedPlayerIds: topCandidates
    };
  }

  // Clear winner - banish them
  const banishedId = topCandidates[0]!;
  const snapshotVotes = [...game.revealedVotes];
  const updatedPlayers = game.players.map((p: Player) =>
    p.id === banishedId ? { ...p, isAlive: false } : p
  );

  return {
    game: {
      ...omit(game, 'tiedPlayerIds'),
      players: updatedPlayers,
      banishedPlayerId: banishedId,
      phase: 'BANISH_REVEAL',
      votes: [],
      revealedVotes: [],
      lastRoundVotes: snapshotVotes,
    },
    isTie: false
  };
}

export function startRevote(game: GameState): GameState {
  if (game.phase !== 'TIE_DETECTED') {
    throw new Error('Cannot start revote outside tie detected phase');
  }

  return {
    ...game,
    phase: 'REVOTE',
    votes: [],
    revealedVotes: [],
    isRevote: true
  };
}

// ============= HOST TRANSFER =============

export function transferHost(game: GameState, newHostId: string): GameState {
  const newHost = game.players.find((p: Player) => p.id === newHostId);
  if (!newHost) {
    throw new Error('New host not found');
  }

  const updatedPlayers = game.players.map((p: Player) => ({
    ...p,
    isHost: p.id === newHostId
  }));

  return {
    ...game,
    players: updatedPlayers,
    hostId: newHostId
  };
}

/**
 * End the game immediately at the host's request. Sets phase to GAME_END
 * with no winner so the client can render an "ended early" state. Game
 * record persistence is intentionally skipped by the router for this path.
 */
export function endGameEarly(game: GameState): GameState {
  return {
    ...omit(game, 'winner', 'timer'),
    phase: 'GAME_END',
  };
}

export function findNewHost(game: GameState): string | null {
  const connectedPlayers = game.players.filter((p: Player) => p.isConnected && p.id !== game.hostId);
  if (connectedPlayers.length === 0) return null;
  return connectedPlayers[0]!.id;
}

export function isGameEmpty(game: GameState): boolean {
  return game.players.every((p: Player) => !p.isConnected);
}

// ============= WIN CONDITION =============

function buildRoundRecord(game: GameState): RoundRecord {
  const votes: VoteEntry[] = (game.lastRoundVotes ?? []).map((v) => {
    const voter = game.players.find((p: Player) => p.id === v.voterId);
    const target = game.players.find((p: Player) => p.id === v.targetId);
    const entry: VoteEntry = {
      voterName: voter?.name ?? 'Unknown',
      voterRole: (voter?.role ?? 'FAITHFUL') as Role,
      targetName: target?.name ?? 'Unknown',
      targetRole: (target?.role ?? 'FAITHFUL') as Role,
      ...(v.isAutoVote !== undefined ? { isAutoVote: v.isAutoVote } : {}),
      ...(v.reasonText !== undefined ? { reasonText: v.reasonText } : {}),
    };
    return entry;
  });

  const banishedPlayer = game.players.find((p: Player) => p.id === game.banishedPlayerId);
  const murderedPlayer = game.players.find((p: Player) => p.id === game.lastMurderedPlayerId);
  const shieldedPlayer = game.players.find((p: Player) => p.id === game.lastShieldedPlayerId);

  const recruitedPlayer = game.players.find((p: Player) => p.id === game.lastRecruitedPlayerId);

  return {
    round: game.currentRound,
    votes,
    murderBlocked: game.lastMurderBlocked ?? false,
    ...(banishedPlayer?.name !== undefined ? { banishedName: banishedPlayer.name } : {}),
    ...(banishedPlayer?.role !== undefined ? { banishedRole: banishedPlayer.role } : {}),
    ...(murderedPlayer?.name !== undefined ? { murderedName: murderedPlayer.name } : {}),
    ...(murderedPlayer?.role !== undefined ? { murderedRole: murderedPlayer.role } : {}),
    ...(shieldedPlayer?.name !== undefined ? { shieldedName: shieldedPlayer.name } : {}),
    ...(shieldedPlayer?.role !== undefined ? { shieldedRole: shieldedPlayer.role } : {}),
    ...(recruitedPlayer?.name !== undefined ? { recruitedName: recruitedPlayer.name } : {}),
  };
}

export function checkWinCondition(game: GameState): GameState {
  if (game.phase !== 'BANISH_REVEAL' && game.phase !== 'CHECK_WIN' && game.phase !== 'TIEBREAKER_REVEAL') {
    throw new Error('Cannot check win condition in current phase');
  }

  const aliveTraitors = game.players.filter((p: Player) => p.isAlive && p.role === 'TRAITOR').length;
  const aliveFaithful = game.players.filter((p: Player) => p.isAlive && isFaithfulRole(p.role)).length;

  // Traitors win if they equal or outnumber faithful — game ended after banishment, no murder
  if (aliveTraitors >= aliveFaithful) {
    const record = buildRoundRecord(game);
    return {
      ...omit(game, 'lastRoundVotes', 'lastRecruitedPlayerId'),
      history: [...game.history, record],
      phase: 'GAME_END',
      winner: 'TRAITORS'
    };
  }

  // Faithful win if all traitors eliminated
  if (aliveTraitors === 0) {
    const record = buildRoundRecord(game);
    return {
      ...omit(game, 'lastRoundVotes', 'lastRecruitedPlayerId'),
      history: [...game.history, record],
      phase: 'GAME_END',
      winner: 'FAITHFUL'
    };
  }

  // Game continues - route to NIGHT or ROUNDTABLE based on round
  if (game.currentRound === 0) {
    // First banishment complete - move to Round 1 ROUNDTABLE (skip first night)
    return {
      ...game,
      phase: 'ROUNDTABLE',
      currentRound: 1
    };
  } else {
    // Subsequent banishments - move to NIGHT phase
    return {
      ...game,
      phase: 'NIGHT'
    };
  }
}

// ============= NIGHT PHASE & MURDER SYSTEM =============

export function startNight(game: GameState): GameState {
  const isRound1SkipVoting = game.phase === 'ROUNDTABLE' && game.currentRound === 1;
  
  if (game.phase !== 'CHECK_WIN' && game.phase !== 'NIGHT' && !isRound1SkipVoting) {
    throw new Error('Cannot start night from current phase');
  }

  return {
    ...omit(game, 'pendingRecruitmentTargetId', 'lastRecruitedPlayerId', 'medicProtectionTargetId'),
    phase: 'NIGHT',
    murderVotes: [],
  };
}

export function submitRecruitment(game: GameState, recruiterId: string, targetId: string): GameState {
  if (game.phase !== 'NIGHT') {
    throw new Error('Can only recruit during the night phase');
  }

  const recruiter = game.players.find((p: Player) => p.id === recruiterId);
  if (!recruiter || !recruiter.isAlive || recruiter.role !== 'TRAITOR') {
    throw new Error('Only alive traitors can recruit');
  }

  if (recruiter.recruitmentUsed) {
    throw new Error('You have already used your recruitment ability');
  }

  if (game.pendingRecruitmentTargetId) {
    throw new Error('A recruitment is already pending this night');
  }

  const target = game.players.find((p: Player) => p.id === targetId);
  // Wave 4: any non-Traitor (vanilla Faithful, Sheriff, Medic, or Seer) is a
  // valid recruitment target. Recruitment converts them into a Traitor and
  // strips their special powers (the role is overwritten in resolveMurder).
  if (!target || !target.isAlive || !isFaithfulRole(target.role)) {
    throw new Error('Target must be an alive Faithful-team player');
  }

  const updatedPlayers = game.players.map((p: Player) =>
    p.id === recruiterId ? { ...p, recruitmentUsed: true } : p
  );

  return {
    ...game,
    players: updatedPlayers,
    pendingRecruitmentTargetId: targetId,
  };
}

/**
 * WEEK 4 UPDATE: Multiple traitors can vote on murder target
 * All alive traitors must agree (unanimous vote required)
 */
export function submitMurder(game: GameState, traitorId: string, targetId: string): GameState {
  if (game.phase !== 'NIGHT') {
    throw new Error('Not in night phase');
  }

  const traitor = game.players.find((p: Player) => p.id === traitorId);
  if (!traitor || traitor.role !== 'TRAITOR' || !traitor.isAlive) {
    throw new Error('Only alive traitors can submit murder votes');
  }

  const target = game.players.find((p: Player) => p.id === targetId);
  if (!target || !target.isAlive) {
    throw new Error('Target not found or not alive');
  }

  if (target.role === 'TRAITOR') {
    throw new Error('Cannot murder another traitor');
  }

  // Remove any existing vote from this traitor
  const filteredVotes = game.murderVotes.filter((v: Vote) => v.voterId !== traitorId);
  
  return {
    ...game,
    murderVotes: [...filteredVotes, { voterId: traitorId, targetId }]
  };
}

export interface MurderResult {
  game: GameState;
  blocked: boolean;
  shieldedPlayerId?: string;
  shieldedPlayerName?: string;
  murderedPlayerId?: string;
  murderedPlayerName?: string;
  recruitedPlayerId?: string;
  recruitedPlayerName?: string;
}

/**
 * WEEK 4 UPDATE: Resolve murder with multiple traitors
 * Requires ALL alive traitors to vote
 * If unanimous → murder happens (unless target has shield)
 * If not unanimous → random selection from voted targets
 * 
 * SHIELD UPDATE: If target has shield, murder is blocked and shield is consumed
 */
export function resolveMurder(game: GameState): MurderResult {
  if (game.phase !== 'NIGHT') {
    throw new Error('Cannot resolve murder outside night phase');
  }

  const aliveTraitors = game.players.filter((p: Player) => p.isAlive && p.role === 'TRAITOR');
  
  if (game.murderVotes.length !== aliveTraitors.length) {
    throw new Error(`All traitors must vote. Received ${game.murderVotes.length}/${aliveTraitors.length} votes`);
  }

  // Check if all votes are for the same target (unanimous)
  const firstVote = game.murderVotes[0];
  if (!firstVote) {
    throw new Error('No murder votes found');
  }
  
  const firstTarget = firstVote.targetId;
  const isUnanimous = game.murderVotes.every((v: Vote) => v.targetId === firstTarget);

  let targetId: string;

  if (isUnanimous) {
    // Unanimous vote - use that target
    targetId = firstTarget;
  } else {
    // Not unanimous - random selection from all voted targets
    const uniqueTargets = [...new Set(game.murderVotes.map((v: Vote) => v.targetId))];
    const randomIndex = Math.floor(Math.random() * uniqueTargets.length);
    const selectedTarget = uniqueTargets[randomIndex];
    if (!selectedTarget) {
      throw new Error('Failed to select murder target');
    }
    targetId = selectedTarget;
  }

  const targetPlayer = game.players.find((p: Player) => p.id === targetId);
  if (!targetPlayer) {
    throw new Error('Target player not found');
  }

  // Resolve pending recruitment: flip role before murder so the new traitor is
  // never eligible to be murdered (murder already targets a FAITHFUL player).
  let playersWithRecruitment = game.players;
  let recruitedPlayerId: string | undefined;
  let recruitedPlayerName: string | undefined;

  // Recruitment and murder resolve independently. Both can target the same player;
  // if so, the player is converted first (becomes a Traitor) then immediately killed.
  if (game.pendingRecruitmentTargetId) {
    const recruitTarget = game.players.find(
      (p: Player) =>
        p.id === game.pendingRecruitmentTargetId && p.isAlive && isFaithfulRole(p.role)
    );
    if (recruitTarget) {
      recruitedPlayerId = recruitTarget.id;
      recruitedPlayerName = recruitTarget.name;
      playersWithRecruitment = game.players.map((p: Player) =>
        p.id === recruitedPlayerId
          ? { ...p, role: 'TRAITOR' as Role, recruitmentUsed: true }
          : p
      );
    }
  }

  const finalTarget = playersWithRecruitment.find((p: Player) => p.id === targetId)!;

  // Wave 4 — Medic silent protection. If the Medic protected this exact
  // target tonight, the murder is silently blocked: no shield is consumed,
  // no public "shield blocked" reveal is broadcast, the morning simply
  // shows "no one died". The Traitors don't learn why their kill missed.
  if (
    game.medicProtectionTargetId !== undefined &&
    game.medicProtectionTargetId === targetId
  ) {
    return {
      game: {
        ...omit(game, 'lastMurderedPlayerId', 'lastShieldedPlayerId', 'pendingRecruitmentTargetId', 'medicProtectionTargetId'),
        players: playersWithRecruitment,
        lastMurderBlocked: true,
        ...(recruitedPlayerId !== undefined ? { lastRecruitedPlayerId: recruitedPlayerId } : {}),
        murderVotes: [],
        phase: 'MORNING',
      },
      blocked: true,
      // Intentionally omit shieldedPlayerId / shieldedPlayerName so the
      // router routes this as the silent "no one died" morning event.
      ...(recruitedPlayerId !== undefined ? { recruitedPlayerId } : {}),
      ...(recruitedPlayerName !== undefined ? { recruitedPlayerName } : {}),
    };
  }

  // Check if target has a shield
  if (finalTarget.hasShield) {
    const updatedPlayers = playersWithRecruitment.map((p: Player) =>
      p.id === targetId ? { ...p, hasShield: false, shieldRevealed: false } : p
    );

    return {
      game: {
        ...omit(game, 'lastMurderedPlayerId', 'pendingRecruitmentTargetId'),
        players: updatedPlayers,
        lastMurderBlocked: true,
        lastShieldedPlayerId: targetId,
        ...(recruitedPlayerId !== undefined ? { lastRecruitedPlayerId: recruitedPlayerId } : {}),
        murderVotes: [],
        phase: 'MORNING'
      },
      blocked: true,
      shieldedPlayerId: targetId,
      shieldedPlayerName: finalTarget.name,
      ...(recruitedPlayerId !== undefined ? { recruitedPlayerId } : {}),
      ...(recruitedPlayerName !== undefined ? { recruitedPlayerName } : {}),
    };
  }

  // No shield - murder happens
  const updatedPlayers = playersWithRecruitment.map((p: Player) =>
    p.id === targetId ? { ...p, isAlive: false } : p
  );

  return {
    game: {
      ...omit(game, 'lastShieldedPlayerId', 'pendingRecruitmentTargetId'),
      players: updatedPlayers,
      lastMurderedPlayerId: targetId,
      lastMurderBlocked: false,
      ...(recruitedPlayerId !== undefined ? { lastRecruitedPlayerId: recruitedPlayerId } : {}),
      murderVotes: [],
      phase: 'MORNING'
    },
    blocked: false,
    murderedPlayerId: targetId,
    murderedPlayerName: finalTarget.name,
    ...(recruitedPlayerId !== undefined ? { recruitedPlayerId } : {}),
    ...(recruitedPlayerName !== undefined ? { recruitedPlayerName } : {}),
  };
}

export function startMorning(game: GameState): GameState {
  if (game.phase !== 'MORNING') {
    throw new Error('Not in morning phase');
  }

  return {
    ...game,
    phase: 'MORNING'
  };
}

export function continueToDayPhase(game: GameState): GameState {
  if (game.phase !== 'MORNING') {
    throw new Error('Not in morning phase');
  }

  // Build round record for this completed round (banishment + murder/block)
  const record = buildRoundRecord(game);
  const newHistory = [...game.history, record];

  const aliveTraitors = game.players.filter((p: Player) => p.isAlive && p.role === 'TRAITOR').length;
  const aliveFaithful = game.players.filter((p: Player) => p.isAlive && isFaithfulRole(p.role)).length;

  // Check win conditions after murder
  if (aliveTraitors >= aliveFaithful) {
    return {
      ...omit(game, 'lastRoundVotes', 'lastShieldedPlayerId'),
      history: newHistory,
      phase: 'GAME_END',
      winner: 'TRAITORS'
    };
  }

  if (aliveTraitors === 0) {
    return {
      ...omit(game, 'lastRoundVotes', 'lastShieldedPlayerId'),
      history: newHistory,
      phase: 'GAME_END',
      winner: 'FAITHFUL'
    };
  }

  // Increment round
  const nextRound = game.currentRound + 1;

  // If challenges are enabled, go to CHALLENGE phase, otherwise go directly to ROUNDTABLE
  if (game.settings.challengesEnabled) {
    return {
      ...omit(game, 'lastRoundVotes', 'lastShieldedPlayerId', 'lastRecruitedPlayerId'),
      history: newHistory,
      phase: 'CHALLENGE',
      currentRound: nextRound,
      lastMurderBlocked: false
    };
  }

  // Continue directly to roundtable
  return {
    ...omit(game, 'lastRoundVotes', 'lastShieldedPlayerId', 'lastRecruitedPlayerId'),
    history: newHistory,
    phase: 'ROUNDTABLE',
    currentRound: nextRound,
    lastMurderBlocked: false
  };
}

// ============= HELPER FUNCTIONS =============

/**
 * WEEK 4 HELPER: Get all traitor IDs
 * Used for role reveal so traitors know each other
 */
export function getTraitorIds(game: GameState): string[] {
  return game.players
    .filter((p: Player) => p.role === 'TRAITOR')
    .map((p: Player) => p.id);
}

/**
 * WEEK 4 HELPER: Get alive traitor count
 * Used during night phase to show progress
 */
export function getAliveTraitorCount(game: GameState): number {
  return game.players.filter((p: Player) => p.isAlive && p.role === 'TRAITOR').length;
}

/**
 * WEEK 4 HELPER: Get murder vote progress
 * Returns how many traitors have voted and how many total needed
 */
export function getMurderVoteProgress(game: GameState): { received: number; needed: number } {
  const aliveTraitorCount = getAliveTraitorCount(game);
  return {
    received: game.murderVotes.length,
    needed: aliveTraitorCount
  };
}

function generateSessionId(): string {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function generatePlayerId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// ============= CHALLENGE SYSTEM =============

// Mulberry32 PRNG — seeded so the scramble is reproducible across reconnects
// and survives state replay/snapshot rehydration. The seed is derived from
// the game's session id + challenge start time so every game still gets a
// fresh scramble, but a single challenge is stable.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function shuffleWord(word: string, seed: number): string {
  const arr = word.split('');
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  const shuffled = arr.join('');
  // If by chance we got the same string back, derive a new seed deterministically
  // (still no Math.random) until we get a different arrangement.
  if (shuffled === word) {
    return shuffleWord(word, (seed * 2654435761) >>> 0 || 1);
  }
  return shuffled;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1,
          matrix[i]![j]! + 1,
          matrix[i]![j - 1]! + 1
        );
      }
    }
  }
  return matrix[b.length]![a.length]!;
}

export function createChallenge(game: GameState): { game: GameState; challenge: ChallengeState } {
  const challengeTypes: ChallengeType[] = ['TIME_ESTIMATE', 'MISSING_PLAYER', 'WORD_SCRAMBLE'];
  const type = challengeTypes[Math.floor(Math.random() * challengeTypes.length)]!;
  
  const alivePlayers = game.players.filter((p: Player) => p.isAlive);
  const startTime = Date.now();

  let challenge: ChallengeState = {
    type,
    startTime,
    answers: new Map(),
    completed: false
  };

  switch (type) {
    case 'TIME_ESTIMATE':
      // Random target between 4-8 seconds
      challenge.targetTime = 4 + Math.floor(Math.random() * 5);
      break;

    case 'MISSING_PLAYER':
      // Select up to 6 random players to show
      const shuffledPlayers = [...alivePlayers].sort(() => Math.random() - 0.5);
      const shownPlayers = shuffledPlayers.slice(0, Math.min(6, shuffledPlayers.length));
      const hiddenPlayer = shownPlayers[Math.floor(Math.random() * shownPlayers.length)]!;
      challenge.shownPlayerIds = shownPlayers.map((p: Player) => p.id);
      challenge.hiddenPlayerId = hiddenPlayer.id;
      break;

    case 'WORD_SCRAMBLE': {
      const word = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)]!;
      challenge.correctWord = word;
      // Deterministic scramble: same word + same start time always produces the
      // same arrangement, so a reconnecting client sees the identical puzzle.
      const seed = seedFromString(`${game.sessionId}:${startTime}:${word}`);
      challenge.scrambledWord = shuffleWord(word, seed);
      break;
    }
  }

  return {
    game: {
      ...game,
      phase: 'CHALLENGE',
      challenge
    },
    challenge
  };
}

export interface ChallengeAnswerResult {
  game: GameState;
  isCorrect: boolean;
  isWinner: boolean;
}

export function submitChallengeAnswer(
  game: GameState, 
  playerId: string, 
  answer: string | number
): ChallengeAnswerResult {
  if (game.phase !== 'CHALLENGE' || !game.challenge) {
    throw new Error('Not in challenge phase');
  }

  const player = game.players.find((p: Player) => p.id === playerId);
  if (!player || !player.isAlive) {
    throw new Error('Player not found or not alive');
  }

  // Check if already answered
  if (game.challenge.answers.has(playerId)) {
    return { game, isCorrect: false, isWinner: false };
  }

  // Check cooldown (can't win if won last round)
  if (player.lastChallengeWinRound === game.currentRound - 1) {
    // On cooldown - can still answer but won't win
  }

  const timestamp = Date.now();
  const updatedAnswers = new Map(game.challenge.answers);
  updatedAnswers.set(playerId, { answer, timestamp });

  let isCorrect = false;
  let isWinner = false;

  switch (game.challenge.type) {
    case 'TIME_ESTIMATE':
      // For time estimate, we evaluate at the end, not on each answer
      isCorrect = true; // All answers are valid
      break;

    case 'MISSING_PLAYER':
      const hiddenPlayer = game.players.find((p: Player) => p.id === game.challenge!.hiddenPlayerId);
      if (hiddenPlayer) {
        const answerStr = String(answer).toLowerCase().trim();
        const correctName = hiddenPlayer.name.toLowerCase().trim();
        // Accept if it matches name or ID
        isCorrect = answerStr === correctName || answerStr === game.challenge.hiddenPlayerId;
        
        // First correct answer wins (if not on cooldown)
        if (isCorrect && !game.challenge.winnerId && player.lastChallengeWinRound !== game.currentRound - 1) {
          isWinner = true;
        }
      }
      break;

    case 'WORD_SCRAMBLE':
      const correctWord = game.challenge.correctWord!.toLowerCase();
      const answerWord = String(answer).toLowerCase().trim();
      // Accept exact match or typo (Levenshtein distance <= 1)
      const distance = levenshteinDistance(answerWord, correctWord);
      isCorrect = distance <= 1;
      
      // First correct answer wins (if not on cooldown)
      if (isCorrect && !game.challenge.winnerId && player.lastChallengeWinRound !== game.currentRound - 1) {
        isWinner = true;
      }
      break;
  }

  const nextWinnerId = isWinner ? playerId : game.challenge.winnerId;
  const nextWinnerName = isWinner ? player.name : game.challenge.winnerName;
  const updatedChallenge: ChallengeState = {
    ...game.challenge,
    answers: updatedAnswers,
    ...(nextWinnerId !== undefined ? { winnerId: nextWinnerId } : {}),
    ...(nextWinnerName !== undefined ? { winnerName: nextWinnerName } : {}),
  };

  return {
    game: {
      ...game,
      challenge: updatedChallenge
    },
    isCorrect,
    isWinner
  };
}

export interface ChallengeResolution {
  game: GameState;
  winnerId?: string;
  winnerName?: string;
  correctAnswer?: string | number;
  shieldAwarded: boolean;
}

export function resolveChallenge(game: GameState): ChallengeResolution {
  if (game.phase !== 'CHALLENGE' || !game.challenge) {
    throw new Error('Not in challenge phase');
  }

  let winnerId = game.challenge.winnerId;
  let winnerName = game.challenge.winnerName;
  let correctAnswer: string | number | undefined;

  // For TIME_ESTIMATE, calculate winner now.
  // Scoring rule: each player submits a numeric guess; the closest guess to
  // targetTime wins. Ties are broken by EARLIEST server-side submission
  // timestamp (first to submit the equal-distance answer wins).
  if (game.challenge.type === 'TIME_ESTIMATE' && !winnerId) {
    const target = game.challenge.targetTime!;
    let closestDiff = Infinity;
    let earliestTs = Infinity;

    game.challenge.answers.forEach((data, pId) => {
      const player = game.players.find((p: Player) => p.id === pId);
      if (!player || player.lastChallengeWinRound === game.currentRound - 1) return;

      const guess = typeof data.answer === 'number'
        ? data.answer
        : parseFloat(String(data.answer));
      if (!Number.isFinite(guess)) return;

      const diff = Math.abs(guess - target);
      if (diff < closestDiff || (diff === closestDiff && data.timestamp < earliestTs)) {
        closestDiff = diff;
        earliestTs = data.timestamp;
        winnerId = pId;
        winnerName = player.name;
      }
    });
    correctAnswer = game.challenge.targetTime;
  } else if (game.challenge.type === 'WORD_SCRAMBLE') {
    correctAnswer = game.challenge.correctWord;
  } else if (game.challenge.type === 'MISSING_PLAYER') {
    const hiddenPlayer = game.players.find((p: Player) => p.id === game.challenge!.hiddenPlayerId);
    correctAnswer = hiddenPlayer?.name;
  }

  // Award shield to winner (if they don't already have one)
  let shieldAwarded = false;
  let updatedPlayers = game.players;

  if (winnerId) {
    const winner = game.players.find((p: Player) => p.id === winnerId);
    if (winner && !winner.hasShield) {
      shieldAwarded = true;
      updatedPlayers = game.players.map((p: Player) =>
        p.id === winnerId 
          ? { ...p, hasShield: true, lastChallengeWinRound: game.currentRound }
          : p
      );
    }
  }

  return {
    game: {
      ...game,
      phase: 'CHALLENGE_RESULT',
      players: updatedPlayers,
      challenge: {
        ...game.challenge,
        ...(winnerId !== undefined ? { winnerId } : {}),
        ...(winnerName !== undefined ? { winnerName } : {}),
        completed: true
      }
    },
    ...(winnerId !== undefined ? { winnerId } : {}),
    ...(winnerName !== undefined ? { winnerName } : {}),
    ...(correctAnswer !== undefined ? { correctAnswer } : {}),
    shieldAwarded
  };
}

export function continueToRoundtable(game: GameState): GameState {
  if (game.phase !== 'CHALLENGE_RESULT') {
    throw new Error('Not in challenge result phase');
  }

  return {
    ...omit(game, 'challenge'),
    phase: 'ROUNDTABLE',
  };
}

// ============= SHIELD REVEAL =============

export interface RevealShieldResult {
  game: GameState;
  banishmentBlocked: boolean;
  blockedTargetId?: string;
  blockedTargetName?: string;
}

/**
 * Reveal a shield to block an in-flight banishment.
 *
 * Rules:
 *  - Only valid during VOTE_REVEAL (the window between the votes being shown
 *    and the host confirming the banishment).
 *  - Only the current top vote-getter may invoke it.
 *  - Player must actually hold a shield (no bluffing — bluff revealing has
 *    no effect on the game state and would lie to other players).
 *  - On success the shield is CONSUMED, the banishment is cancelled, and the
 *    game advances to BANISH_REVEAL with banishedPlayerId=undefined and
 *    shieldBlockedBanishment=true so the host's next "Continue" routes to
 *    the win check without anyone dying.
 */
export function revealShield(game: GameState, playerId: string): RevealShieldResult {
  const player = game.players.find((p: Player) => p.id === playerId);
  if (!player || !player.isAlive) {
    throw new Error('Player not found or not alive');
  }
  if (game.phase !== 'VOTE_REVEAL') {
    throw new Error('Shield can only be revealed during the vote reveal');
  }
  if (!player.hasShield) {
    throw new Error('You do not hold a shield');
  }

  // Compute current top candidate from the revealed votes.
  const counts = new Map<string, number>();
  for (const v of game.revealedVotes) {
    counts.set(v.targetId, (counts.get(v.targetId) ?? 0) + 1);
  }
  let topCount = 0;
  const topCandidates: string[] = [];
  counts.forEach((n, id) => {
    if (n > topCount) { topCount = n; topCandidates.length = 0; topCandidates.push(id); }
    else if (n === topCount && topCount > 0) { topCandidates.push(id); }
  });
  // Reveal is allowed for any top candidate (single OR among tied). For
  // the first-vote tie this routes the round straight past TIE_DETECTED /
  // REVOTE — but that's the right call: the player has chosen to burn the
  // shield to escape banishment, and the cancellation applies to the in-
  // flight vote regardless of whether a tiebreaker was about to run.
  if (!topCandidates.includes(playerId)) {
    throw new Error('Shield can only be revealed when you are a top vote-getter');
  }

  // Consume the shield, mark it revealed for the toast, cancel the banishment,
  // and skip directly to BANISH_REVEAL with no banished player so the host's
  // "Continue" naturally proceeds to CHECK_WIN.
  const updatedPlayers = game.players.map((p: Player) =>
    p.id === playerId ? { ...p, hasShield: false, shieldRevealed: true } : p
  );

  // Strip any prior banishedPlayerId from the spread — under
  // exactOptionalPropertyTypes we cannot assign `undefined`; the field must
  // be absent. The shielded outcome is "no one banished".
  const { banishedPlayerId: _stripped, ...gameWithoutBanish } = game;
  void _stripped;
  return {
    game: {
      ...gameWithoutBanish,
      players: updatedPlayers,
      phase: 'BANISH_REVEAL',
      shieldBlockedBanishment: true,
      votes: [],
      revealedVotes: [],
      lastRoundVotes: [...game.revealedVotes],
    },
    banishmentBlocked: true,
    blockedTargetId: playerId,
    blockedTargetName: player.name,
  };
}

/** @deprecated kept for any callers not yet migrated; new logic lives in revealShield(). */
export function revealShieldLegacy(game: GameState, playerId: string): GameState {
  const player = game.players.find((p: Player) => p.id === playerId);
  if (!player || !player.isAlive) {
    throw new Error('Player not found or not alive');
  }
  const updatedPlayers = game.players.map((p: Player) =>
    p.id === playerId ? { ...p, shieldRevealed: true } : p
  );

  return {
    ...game,
    players: updatedPlayers
  };
}
