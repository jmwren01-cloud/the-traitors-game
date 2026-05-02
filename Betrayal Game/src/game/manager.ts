// Game Manager - Core Game Logic

import type { GameState, Player, Role, Vote, TimerState, GamePhase, GameSettings, ChallengeState, ChallengeType, RoundRecord, VoteEntry } from './types.js';
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

export function createGame(hostName: string): GameState {
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
    avatar: pickRandomAvatar()
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
    settings: { ...DEFAULT_SETTINGS }
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

  return {
    ...game,
    settings: newSettings
  };
}

export function addPlayer(game: GameState, playerName: string): { game: GameState; playerId: string } {
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
    avatar: AVATAR_IDS.find((a) => !takenAvatars.includes(a)) ?? pickRandomAvatar()
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

  const updatedPlayers = game.players.map((p: Player) =>
    p.id === playerId
      ? { ...p, color: color ?? p.color, avatar: avatar ?? p.avatar }
      : p
  );

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
  
  // Assign traitors
  const updatedPlayers = shuffled.map((player, index) => ({
    ...player,
    role: (index < traitorCount ? 'TRAITOR' : 'FAITHFUL') as Role
  }));

  return {
    ...game,
    players: updatedPlayers,
    phase: 'ROLE_REVEAL'
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
    currentRound: newRound
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
  
  const vote: Vote = { 
    voterId, 
    targetId,
    reasonText: reasonText?.trim().slice(0, 120) || undefined,
    timestamp: Date.now()
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

  return {
    ...game,
    phase: 'VOTE_REVEAL',
    revealedVotes: [...game.votes]
  };
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

  // Handle tie
  if (topCandidates.length > 1) {
    // If this is a revote tie, do random selection
    if (game.isRevote) {
      const randomIndex = Math.floor(Math.random() * topCandidates.length);
      const randomlySelectedId = topCandidates[randomIndex];
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
  const banishedId = topCandidates[0];
  const snapshotVotes = [...game.revealedVotes];
  const updatedPlayers = game.players.map((p: Player) =>
    p.id === banishedId ? { ...p, isAlive: false } : p
  );

  return {
    game: {
      ...game,
      players: updatedPlayers,
      banishedPlayerId: banishedId,
      phase: 'BANISH_REVEAL',
      votes: [],
      revealedVotes: [],
      tiedPlayerIds: undefined,
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

export function findNewHost(game: GameState): string | null {
  const connectedPlayers = game.players.filter((p: Player) => p.isConnected && p.id !== game.hostId);
  if (connectedPlayers.length === 0) return null;
  return connectedPlayers[0].id;
}

export function isGameEmpty(game: GameState): boolean {
  return game.players.every((p: Player) => !p.isConnected);
}

// ============= WIN CONDITION =============

function buildRoundRecord(game: GameState): RoundRecord {
  const votes: VoteEntry[] = (game.lastRoundVotes ?? []).map((v) => {
    const voter = game.players.find((p: Player) => p.id === v.voterId);
    const target = game.players.find((p: Player) => p.id === v.targetId);
    return {
      voterName: voter?.name ?? 'Unknown',
      voterRole: (voter?.role ?? 'FAITHFUL') as Role,
      targetName: target?.name ?? 'Unknown',
      targetRole: (target?.role ?? 'FAITHFUL') as Role,
      isAutoVote: v.isAutoVote,
      reasonText: v.reasonText,
    } satisfies VoteEntry;
  });

  const banishedPlayer = game.players.find((p: Player) => p.id === game.banishedPlayerId);
  const murderedPlayer = game.players.find((p: Player) => p.id === game.lastMurderedPlayerId);
  const shieldedPlayer = game.players.find((p: Player) => p.id === game.lastShieldedPlayerId);

  const recruitedPlayer = game.players.find((p: Player) => p.id === game.lastRecruitedPlayerId);

  return {
    round: game.currentRound,
    votes,
    banishedName: banishedPlayer?.name,
    banishedRole: banishedPlayer?.role,
    murderedName: murderedPlayer?.name,
    murderedRole: murderedPlayer?.role,
    murderBlocked: game.lastMurderBlocked ?? false,
    shieldedName: shieldedPlayer?.name,
    shieldedRole: shieldedPlayer?.role,
    recruitedName: recruitedPlayer?.name,
  };
}

export function checkWinCondition(game: GameState): GameState {
  if (game.phase !== 'BANISH_REVEAL' && game.phase !== 'CHECK_WIN' && game.phase !== 'TIEBREAKER_REVEAL') {
    throw new Error('Cannot check win condition in current phase');
  }

  const aliveTraitors = game.players.filter((p: Player) => p.isAlive && p.role === 'TRAITOR').length;
  const aliveFaithful = game.players.filter((p: Player) => p.isAlive && p.role === 'FAITHFUL').length;

  // Traitors win if they equal or outnumber faithful — game ended after banishment, no murder
  if (aliveTraitors >= aliveFaithful) {
    const record = buildRoundRecord(game);
    return {
      ...game,
      history: [...game.history, record],
      lastRoundVotes: undefined,
      lastRecruitedPlayerId: undefined,
      phase: 'GAME_END',
      winner: 'TRAITORS'
    };
  }

  // Faithful win if all traitors eliminated
  if (aliveTraitors === 0) {
    const record = buildRoundRecord(game);
    return {
      ...game,
      history: [...game.history, record],
      lastRoundVotes: undefined,
      lastRecruitedPlayerId: undefined,
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
    ...game,
    phase: 'NIGHT',
    murderVotes: [],
    pendingRecruitmentTargetId: undefined,
    lastRecruitedPlayerId: undefined,
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
  if (!target || !target.isAlive || target.role !== 'FAITHFUL') {
    throw new Error('Target must be an alive Faithful player');
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

  // Recruitment and murder are independent selections; if the same target is chosen
  // for both, murder takes priority and the recruitment is silently cancelled.
  if (game.pendingRecruitmentTargetId && game.pendingRecruitmentTargetId !== targetId) {
    const recruitTarget = game.players.find(
      (p: Player) =>
        p.id === game.pendingRecruitmentTargetId && p.isAlive && p.role === 'FAITHFUL'
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

  // Check if target has a shield
  if (finalTarget.hasShield) {
    const updatedPlayers = playersWithRecruitment.map((p: Player) =>
      p.id === targetId ? { ...p, hasShield: false, shieldRevealed: false } : p
    );

    return {
      game: {
        ...game,
        players: updatedPlayers,
        lastMurderedPlayerId: undefined,
        lastMurderBlocked: true,
        lastShieldedPlayerId: targetId,
        lastRecruitedPlayerId: recruitedPlayerId,
        pendingRecruitmentTargetId: undefined,
        murderVotes: [],
        phase: 'MORNING'
      },
      blocked: true,
      shieldedPlayerId: targetId,
      shieldedPlayerName: finalTarget.name,
      recruitedPlayerId,
      recruitedPlayerName,
    };
  }

  // No shield - murder happens
  const updatedPlayers = playersWithRecruitment.map((p: Player) =>
    p.id === targetId ? { ...p, isAlive: false } : p
  );

  return {
    game: {
      ...game,
      players: updatedPlayers,
      lastMurderedPlayerId: targetId,
      lastMurderBlocked: false,
      lastShieldedPlayerId: undefined,
      lastRecruitedPlayerId: recruitedPlayerId,
      pendingRecruitmentTargetId: undefined,
      murderVotes: [],
      phase: 'MORNING'
    },
    blocked: false,
    murderedPlayerId: targetId,
    murderedPlayerName: finalTarget.name,
    recruitedPlayerId,
    recruitedPlayerName,
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
  const aliveFaithful = game.players.filter((p: Player) => p.isAlive && p.role === 'FAITHFUL').length;

  // Check win conditions after murder
  if (aliveTraitors >= aliveFaithful) {
    return {
      ...game,
      history: newHistory,
      lastRoundVotes: undefined,
      lastShieldedPlayerId: undefined,
      phase: 'GAME_END',
      winner: 'TRAITORS'
    };
  }

  if (aliveTraitors === 0) {
    return {
      ...game,
      history: newHistory,
      lastRoundVotes: undefined,
      lastShieldedPlayerId: undefined,
      phase: 'GAME_END',
      winner: 'FAITHFUL'
    };
  }

  // Increment round
  const nextRound = game.currentRound + 1;

  // If challenges are enabled, go to CHALLENGE phase, otherwise go directly to ROUNDTABLE
  if (game.settings.challengesEnabled) {
    return {
      ...game,
      history: newHistory,
      lastRoundVotes: undefined,
      lastShieldedPlayerId: undefined,
      lastRecruitedPlayerId: undefined,
      phase: 'CHALLENGE',
      currentRound: nextRound,
      lastMurderBlocked: false
    };
  }

  // Continue directly to roundtable
  return {
    ...game,
    history: newHistory,
    lastRoundVotes: undefined,
    lastShieldedPlayerId: undefined,
    lastRecruitedPlayerId: undefined,
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

function shuffleWord(word: string): string {
  const arr = word.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  const shuffled = arr.join('');
  // Make sure it's actually different
  return shuffled === word ? shuffleWord(word) : shuffled;
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

    case 'WORD_SCRAMBLE':
      const word = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)]!;
      challenge.correctWord = word;
      challenge.scrambledWord = shuffleWord(word);
      break;
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

  const updatedChallenge: ChallengeState = {
    ...game.challenge,
    answers: updatedAnswers,
    winnerId: isWinner ? playerId : game.challenge.winnerId,
    winnerName: isWinner ? player.name : game.challenge.winnerName
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

  // For TIME_ESTIMATE, calculate winner now
  if (game.challenge.type === 'TIME_ESTIMATE' && !winnerId) {
    const targetTime = game.challenge.targetTime! * 1000; // Convert to ms
    let closestDiff = Infinity;
    
    game.challenge.answers.forEach((data, pId) => {
      const player = game.players.find((p: Player) => p.id === pId);
      if (!player || player.lastChallengeWinRound === game.currentRound - 1) return;
      
      const elapsed = data.timestamp - game.challenge!.startTime;
      const diff = Math.abs(elapsed - targetTime);
      if (diff < closestDiff) {
        closestDiff = diff;
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
        winnerId,
        winnerName,
        completed: true
      }
    },
    winnerId,
    winnerName,
    correctAnswer,
    shieldAwarded
  };
}

export function continueToRoundtable(game: GameState): GameState {
  if (game.phase !== 'CHALLENGE_RESULT') {
    throw new Error('Not in challenge result phase');
  }

  return {
    ...game,
    phase: 'ROUNDTABLE',
    challenge: undefined
  };
}

// ============= SHIELD REVEAL =============

export function revealShield(game: GameState, playerId: string): GameState {
  const player = game.players.find((p: Player) => p.id === playerId);
  if (!player || !player.isAlive) {
    throw new Error('Player not found or not alive');
  }

  // Can reveal (or bluff!) regardless of actually having a shield
  const updatedPlayers = game.players.map((p: Player) =>
    p.id === playerId ? { ...p, shieldRevealed: true } : p
  );

  return {
    ...game,
    players: updatedPlayers
  };
}
