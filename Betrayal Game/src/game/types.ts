// Game Types and Interfaces

export type GamePhase = 
  | 'LOBBY'
  | 'ROLE_ASSIGN'
  | 'ROLE_REVEAL'
  | 'ROUNDTABLE'
  | 'VOTING'
  | 'VOTE_REVEAL'
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
}

export interface Vote {
  voterId: string;
  targetId: string;
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
}

// Client-to-Server Events
export type C2SEvent =
  | { type: 'C2S_CREATE_GAME'; payload: { playerName: string } }
  | { type: 'C2S_JOIN_GAME'; payload: { sessionId: string; playerName: string } }
  | { type: 'C2S_START_GAME'; payload: Record<string, never> }
  | { type: 'C2S_ASSIGN_ROLES'; payload: Record<string, never> }
  | { type: 'C2S_START_VOTING'; payload: Record<string, never> }
  | { type: 'C2S_SUBMIT_VOTE'; payload: { targetId: string } }
  | { type: 'C2S_REVEAL_VOTES'; payload: Record<string, never> }
  | { type: 'C2S_BANISH_PLAYER'; payload: Record<string, never> }
  | { type: 'C2S_CHECK_WIN'; payload: Record<string, never> }
  | { type: 'C2S_START_NIGHT'; payload: Record<string, never> }
  | { type: 'C2S_SUBMIT_MURDER'; payload: { targetId: string } }
  | { type: 'C2S_RESOLVE_MURDER'; payload: Record<string, never> }
  | { type: 'C2S_START_MORNING'; payload: Record<string, never> }
  | { type: 'C2S_CONTINUE_TO_DAY'; payload: Record<string, never> };

// Server-to-Client Events
export type S2CEvent =
  | { type: 'S2C_GAME_CREATED'; payload: { sessionId: string; playerId: string; playerName: string } }
  | { type: 'S2C_PLAYER_JOINED'; payload: { players: Player[] } }
  | { type: 'S2C_GAME_STARTED'; payload: { phase: GamePhase } }
  | { type: 'S2C_ROLES_ASSIGNED'; payload: { phase: GamePhase } }
  | { type: 'S2C_ROLE_REVEAL'; payload: { 
      role: Role; 
      phase: GamePhase;
      traitorIds?: string[];
    } }
  | { type: 'S2C_VOTING_STARTED'; payload: { phase: GamePhase } }
  | { type: 'S2C_VOTE_SUBMITTED'; payload: { voterId: string } }
  | { type: 'S2C_VOTES_REVEALED'; payload: { votes: Vote[]; phase: GamePhase } }
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
      phase: GamePhase 
    } }
  | { type: 'S2C_MORNING_STARTED'; payload: { 
      phase: GamePhase;
      lastMurderedPlayerId?: string;
      lastMurderedPlayerName?: string;
    } }
  | { type: 'S2C_ERROR'; payload: { message: string } };
