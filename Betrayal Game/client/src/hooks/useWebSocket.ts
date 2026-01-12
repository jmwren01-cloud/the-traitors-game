import { useState, useEffect, useCallback, useRef } from 'react';
import type { GameState, C2SEvent, Player, Role, Vote } from '../types';

const getWebSocketUrl = () => {
  const domain = window.location.host;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${domain}`;
};

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const myPlayerIdRef = useRef<string | null>(null);

  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setError('Connection error');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  const handleMessage = useCallback((msg: { type: string; payload: Record<string, unknown> }) => {
    switch (msg.type) {
      case 'S2C_GAME_CREATED': {
        const payload = msg.payload as { sessionId: string; playerId: string; playerName: string };
        myPlayerIdRef.current = payload.playerId;
        setGameState({
          sessionId: payload.sessionId,
          phase: 'LOBBY',
          players: [],
          myPlayerId: payload.playerId,
        });
        break;
      }

      case 'S2C_GAME_JOINED': {
        const payload = msg.payload as { sessionId: string; playerId: string; playerName: string; players: Player[] };
        myPlayerIdRef.current = payload.playerId;
        setGameState({
          sessionId: payload.sessionId,
          phase: 'LOBBY',
          players: payload.players,
          myPlayerId: payload.playerId,
        });
        break;
      }

      case 'S2C_PLAYER_JOINED': {
        const payload = msg.payload as { players: Player[] };
        setGameState((prev) => prev ? { ...prev, players: payload.players } : null);
        break;
      }

      case 'S2C_GAME_STARTED': {
        const payload = msg.payload as { phase: string };
        setGameState((prev) => prev ? { ...prev, phase: payload.phase as GameState['phase'] } : null);
        break;
      }

      case 'S2C_ROLES_ASSIGNED': {
        const payload = msg.payload as { phase: string };
        setGameState((prev) => prev ? { ...prev, phase: payload.phase as GameState['phase'] } : null);
        break;
      }

      case 'S2C_ROLE_REVEAL': {
        const payload = msg.payload as { role: Role; phase: string; traitorIds?: string[] };
        setGameState((prev) => prev ? {
          ...prev,
          phase: payload.phase as GameState['phase'],
          myRole: payload.role,
          traitorIds: payload.traitorIds,
        } : null);
        break;
      }

      case 'S2C_VOTING_STARTED': {
        const payload = msg.payload as { phase: string };
        setGameState((prev) => prev ? { ...prev, phase: payload.phase as GameState['phase'], votes: [] } : null);
        break;
      }

      case 'S2C_VOTE_SUBMITTED': {
        break;
      }

      case 'S2C_VOTES_REVEALED': {
        const payload = msg.payload as { votes: Vote[]; phase: string };
        setGameState((prev) => prev ? {
          ...prev,
          phase: payload.phase as GameState['phase'],
          votes: payload.votes,
        } : null);
        break;
      }

      case 'S2C_PLAYER_BANISHED': {
        const payload = msg.payload as { banishedPlayerId: string; banishedPlayerName: string; banishedPlayerRole: Role; phase: string };
        setGameState((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            phase: payload.phase as GameState['phase'],
            banishedPlayer: {
              id: payload.banishedPlayerId,
              name: payload.banishedPlayerName,
              role: payload.banishedPlayerRole,
            },
            players: prev.players.map((p) =>
              p.id === payload.banishedPlayerId ? { ...p, isAlive: false } : p
            ),
          };
        });
        break;
      }

      case 'S2C_NIGHT_STARTED': {
        const payload = msg.payload as { phase: string; currentRound: number; aliveTraitorCount: number };
        setGameState((prev) => prev ? {
          ...prev,
          phase: payload.phase as GameState['phase'],
          currentRound: payload.currentRound,
          aliveTraitorCount: payload.aliveTraitorCount,
          murderVoteProgress: undefined,
        } : null);
        break;
      }

      case 'S2C_MURDER_SUBMITTED': {
        const payload = msg.payload as { votesReceived: number; votesNeeded: number };
        setGameState((prev) => prev ? {
          ...prev,
          murderVoteProgress: { received: payload.votesReceived, needed: payload.votesNeeded },
        } : null);
        break;
      }

      case 'S2C_MURDER_RESOLVED': {
        const payload = msg.payload as { murderedPlayerId: string; murderedPlayerName: string; phase: string };
        setGameState((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            phase: payload.phase as GameState['phase'],
            murderedPlayer: { id: payload.murderedPlayerId, name: payload.murderedPlayerName },
            players: prev.players.map((p) =>
              p.id === payload.murderedPlayerId ? { ...p, isAlive: false } : p
            ),
          };
        });
        break;
      }

      case 'S2C_MORNING_STARTED': {
        const payload = msg.payload as { phase: string; lastMurderedPlayerId?: string; lastMurderedPlayerName?: string };
        setGameState((prev) => prev ? {
          ...prev,
          phase: payload.phase as GameState['phase'],
          murderedPlayer: payload.lastMurderedPlayerId
            ? { id: payload.lastMurderedPlayerId, name: payload.lastMurderedPlayerName || '' }
            : undefined,
        } : null);
        break;
      }

      case 'S2C_CONTINUE_GAME': {
        const payload = msg.payload as { phase: string; currentRound: number };
        setGameState((prev) => prev ? {
          ...prev,
          phase: payload.phase as GameState['phase'],
          currentRound: payload.currentRound,
          banishedPlayer: undefined,
          murderedPlayer: undefined,
          votes: undefined,
        } : null);
        break;
      }

      case 'S2C_GAME_END': {
        const payload = msg.payload as { winner: 'TRAITORS' | 'FAITHFUL'; phase: string; remainingTraitors: number; remainingFaithful: number };
        setGameState((prev) => prev ? {
          ...prev,
          phase: payload.phase as GameState['phase'],
          winner: payload.winner,
          remainingTraitors: payload.remainingTraitors,
          remainingFaithful: payload.remainingFaithful,
        } : null);
        break;
      }

      case 'S2C_ERROR': {
        const payload = msg.payload as { message: string };
        setError(payload.message);
        setTimeout(() => setError(null), 5000);
        break;
      }
    }
  }, []);

  const send = useCallback((event: C2SEvent) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
    }
  }, []);

  return { connected, gameState, error, send, myPlayerId: myPlayerIdRef.current };
}
