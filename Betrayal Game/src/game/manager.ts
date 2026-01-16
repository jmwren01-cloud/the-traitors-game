// Game Manager - Core Game Logic

import type { GameState, Player, Role, Vote, TimerState, GamePhase } from './types.js';

// ============= TIMER CONFIGURATION =============

export const TIMER_DURATIONS: Partial<Record<GamePhase, number>> = {
  ROUNDTABLE: 120,
  VOTING: 60,
  NIGHT: 90,
};

export function createTimer(phase: GamePhase): TimerState | undefined {
  const duration = TIMER_DURATIONS[phase];
  if (!duration) return undefined;
  
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
    isConnected: true
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
    messages: []
  };
}

export function addPlayer(game: GameState, playerName: string): { game: GameState; playerId: string } {
  if (game.phase !== 'LOBBY') {
    throw new Error('Cannot join game in progress');
  }
  if (game.players.length >= 22) {
    throw new Error('Game is full (max 22 players)');
  }

  const playerId = generatePlayerId();
  const newPlayer: Player = {
    id: playerId,
    name: playerName,
    isAlive: true,
    isHost: false,
    isConnected: true
  };

  return {
    game: { ...game, players: [...game.players, newPlayer] },
    playerId
  };
}

// ============= ROLE ASSIGNMENT =============

/**
 * WEEK 4 UPDATE: Multiple traitors based on player count
 * Traitor ratio: 1 traitor per 5 players (rounded down)
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
  const traitorCount = Math.floor(playerCount / 5);
  
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
  if (game.phase !== 'VOTING') {
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

export function banishPlayer(game: GameState): GameState {
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

  // Handle tie: pick random from tied players
  const banishedId = topCandidates.length === 1 
    ? topCandidates[0] 
    : topCandidates[Math.floor(Math.random() * topCandidates.length)];

  // Update player status
  const updatedPlayers = game.players.map((p: Player) =>
    p.id === banishedId ? { ...p, isAlive: false } : p
  );

  return {
    ...game,
    players: updatedPlayers,
    banishedPlayerId: banishedId,
    phase: 'BANISH_REVEAL',
    votes: [],
    revealedVotes: []
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

export function checkWinCondition(game: GameState): GameState {
  if (game.phase !== 'BANISH_REVEAL' && game.phase !== 'CHECK_WIN') {
    throw new Error('Cannot check win condition in current phase');
  }

  const aliveTraitors = game.players.filter((p: Player) => p.isAlive && p.role === 'TRAITOR').length;
  const aliveFaithful = game.players.filter((p: Player) => p.isAlive && p.role === 'FAITHFUL').length;

  // Traitors win if they equal or outnumber faithful
  if (aliveTraitors >= aliveFaithful) {
    return {
      ...game,
      phase: 'GAME_END',
      winner: 'TRAITORS'
    };
  }

  // Faithful win if all traitors eliminated
  if (aliveTraitors === 0) {
    return {
      ...game,
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
  if (game.phase !== 'CHECK_WIN' && game.phase !== 'NIGHT') {
    throw new Error('Cannot start night from current phase');
  }

  return {
    ...game,
    phase: 'NIGHT',
    murderVotes: []
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

/**
 * WEEK 4 UPDATE: Resolve murder with multiple traitors
 * Requires ALL alive traitors to vote
 * If unanimous → murder happens
 * If not unanimous → random selection from voted targets
 */
export function resolveMurder(game: GameState): GameState {
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

  let murderedId: string;

  if (isUnanimous) {
    // Unanimous vote - use that target
    murderedId = firstTarget;
  } else {
    // Not unanimous - random selection from all voted targets
    const uniqueTargets = [...new Set(game.murderVotes.map((v: Vote) => v.targetId))];
    const randomIndex = Math.floor(Math.random() * uniqueTargets.length);
    const selectedTarget = uniqueTargets[randomIndex];
    if (!selectedTarget) {
      throw new Error('Failed to select murder target');
    }
    murderedId = selectedTarget;
  }

  // Update player status
  const updatedPlayers = game.players.map((p: Player) =>
    p.id === murderedId ? { ...p, isAlive: false } : p
  );

  return {
    ...game,
    players: updatedPlayers,
    lastMurderedPlayerId: murderedId,
    murderVotes: [],
    phase: 'MORNING'
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

  const aliveTraitors = game.players.filter((p: Player) => p.isAlive && p.role === 'TRAITOR').length;
  const aliveFaithful = game.players.filter((p: Player) => p.isAlive && p.role === 'FAITHFUL').length;

  // Check win conditions after murder
  if (aliveTraitors >= aliveFaithful) {
    return {
      ...game,
      phase: 'GAME_END',
      winner: 'TRAITORS'
    };
  }

  if (aliveTraitors === 0) {
    return {
      ...game,
      phase: 'GAME_END',
      winner: 'FAITHFUL'
    };
  }

  // Continue to next round
  return {
    ...game,
    phase: 'ROUNDTABLE',
    currentRound: game.currentRound + 1
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
