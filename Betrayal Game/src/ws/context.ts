import { WebSocket } from 'ws';
import type { GameState } from '../game/types.js';

export const games = new Map<string, GameState>();
export const playerConnections = new Map<string, WebSocket>();
export const activeRevealSequences = new Map<string, NodeJS.Timeout>();
export const sessionTokens = new Map<string, { playerId: string; sessionId: string }>();
export const disconnectedPlayers = new Map<string, { playerId: string; sessionId: string; disconnectedAt: number }>();

export const GRACE_PERIOD_MS = 60000;
