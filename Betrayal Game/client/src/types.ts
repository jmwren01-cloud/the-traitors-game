export type Role = 'TRAITOR' | 'FAITHFUL';

export type GamePhase = 
  | 'LOBBY'
  | 'ROLE_ASSIGN'
  | 'ROLE_REVEAL'
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
  winner?: 'TRAITORS' | 'FAITHFUL';
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
}

export type C2SEvent =
  | { type: 'C2S_CREATE_GAME'; payload: { playerName: string } }
  | { type: 'C2S_JOIN_GAME'; payload: { sessionId: string; playerName: string } }
  | { type: 'C2S_RECONNECT'; payload: { sessionToken: string } }
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
  | { type: 'C2S_SEND_MESSAGE'; payload: { message: string; channel: ChatChannel } };
