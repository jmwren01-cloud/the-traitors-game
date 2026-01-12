export type Role = 'TRAITOR' | 'FAITHFUL';

export type GamePhase = 
  | 'LOBBY'
  | 'ROLE_ASSIGN'
  | 'ROLE_REVEAL'
  | 'ROUNDTABLE'
  | 'VOTING'
  | 'VOTE_REVEAL'
  | 'BANISH_REVEAL'
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
}

export interface GameState {
  sessionId: string;
  phase: GamePhase;
  players: Player[];
  myPlayerId?: string;
  myRole?: Role;
  traitorIds?: string[];
  votes?: Record<string, string>;
  banishedPlayer?: { id: string; name: string; role: Role };
  murderedPlayer?: { id: string; name: string };
  winner?: 'TRAITORS' | 'FAITHFUL';
  currentRound?: number;
  aliveTraitorCount?: number;
  murderVoteProgress?: { received: number; needed: number };
}

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
