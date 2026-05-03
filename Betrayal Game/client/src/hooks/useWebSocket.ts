import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  GameState, C2SEvent, PlayerStatsPayload, LeaderboardEntryPayload, GlobalStatsPayload
} from '../types';
import { gameStateReducer } from './gameStateReducer';
import { getOrCreateDeviceToken, getSavedPlayerName } from '../utils/identity';

const getWebSocketUrl = () => {
  const domain = window.location.host;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${domain}`;
};

const SESSION_TOKEN_KEY = 'traitors_session_token';

function saveSessionToken(token: string) {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

function clearSessionToken() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
}

export interface IdentityState {
  deviceToken: string;
  playerName: string;
  isReturningPlayer: boolean;
}

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const [identity, setIdentity] = useState<IdentityState | null>(null);
  const [identifyError, setIdentifyError] = useState<string | null>(null);

  const [playerStats, setPlayerStats] = useState<PlayerStatsPayload | null>(null);
  const [leaderboard, setLeaderboard] = useState<{ metric: string; entries: LeaderboardEntryPayload[] } | null>(null);
  const [globalStats, setGlobalStats] = useState<GlobalStatsPayload | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const myPlayerIdRef = useRef<string | null>(null);
  const reconnectAttemptedRef = useRef(false);

  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);


      // This guarantees the server has a deviceToken bound to this socket BEFORE the
      // user clicks Create/Join, so stats always record (and fixes any race where the
      // user clicks too fast after a page reload).
      const savedName = getSavedPlayerName();
      if (savedName) {
        const deviceToken = getOrCreateDeviceToken();
        ws.send(JSON.stringify({
          type: 'C2S_IDENTIFY',
          payload: { deviceToken, playerName: savedName }
        }));
      }

      const storedToken = getSessionToken();
      if (storedToken && !reconnectAttemptedRef.current) {
        reconnectAttemptedRef.current = true;
        setReconnecting(true);
        ws.send(JSON.stringify({
          type: 'C2S_RECONNECT',
          payload: { sessionToken: storedToken }
        }));
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectAttemptedRef.current = false;
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
    // Handle side effects that cannot live in the pure reducer
    if (msg.type === 'S2C_GAME_CREATED' || msg.type === 'S2C_GAME_JOINED') {
      const p = msg.payload as { playerId: string; sessionToken: string };
      myPlayerIdRef.current = p.playerId;
      saveSessionToken(p.sessionToken);
    }

    if (msg.type === 'S2C_RECONNECTED') {
      const p = msg.payload as { playerId: string };
      myPlayerIdRef.current = p.playerId;
      setReconnecting(false);
    }

    if (msg.type === 'S2C_YOU_WERE_REMOVED') {
      const p = msg.payload as { message: string };
      clearSessionToken();
      setReconnecting(false);
      setGameState(null);
      setError(p.message);
      setTimeout(() => setError(null), 6000);
      return;
    }

    if (msg.type === 'S2C_ERROR') {
      const p = msg.payload as { message: string };
      setError(p.message);
      if (p.message.includes('session') || p.message.includes('token')) {
        clearSessionToken();
        setReconnecting(false);
      }
      setTimeout(() => setError(null), 5000);
      return;
    }


    if (msg.type === 'S2C_IDENTITY_CONFIRMED') {
      const p = msg.payload as unknown as IdentityState;
      setIdentity(p);
      setIdentifyError(null);
      return;
    }
    if (msg.type === 'S2C_IDENTITY_ERROR') {
      const p = msg.payload as { message: string };
      setIdentifyError(p.message);
      return;
    }


    // Also dispatched as window CustomEvents so detached components (ProfileDrawer)
    // mounted in any subtree can react without prop-drilling.
    if (msg.type === 'S2C_PLAYER_STATS') {
      const payload = msg.payload as unknown as PlayerStatsPayload;
      setPlayerStats(payload);
      window.dispatchEvent(new CustomEvent('betrayal:player-stats', { detail: payload }));
      return;
    }
    if (msg.type === 'S2C_LEADERBOARD') {
      const payload = msg.payload as unknown as { metric: string; entries: LeaderboardEntryPayload[] };
      setLeaderboard(payload);
      window.dispatchEvent(new CustomEvent('betrayal:leaderboard', { detail: payload }));
      return;
    }
    if (msg.type === 'S2C_GLOBAL_STATS') {
      const payload = msg.payload as unknown as GlobalStatsPayload;
      setGlobalStats(payload);
      window.dispatchEvent(new CustomEvent('betrayal:global-stats', { detail: payload }));
      return;
    }

    // Delegate all state transitions to the pure reducer
    setGameState((prev) => gameStateReducer(prev, msg));
  }, []);

  const send = useCallback((event: C2SEvent) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
    }
  }, []);

  // Lets components apply CLIENT_* actions through the reducer.
  const dispatchLocal = useCallback((action: { type: string; payload?: Record<string, unknown> }) => {
    setGameState((prev) => gameStateReducer(prev, { type: action.type, payload: action.payload ?? {} }));
  }, []);

  const identify = useCallback((deviceToken: string, playerName: string) => {
    setIdentifyError(null);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'C2S_IDENTIFY',
        payload: { deviceToken, playerName }
      }));
    }
  }, []);

  return {
    connected, gameState, error, send, dispatchLocal,
    myPlayerId: myPlayerIdRef.current, reconnecting,
    identity, identifyError, identify,
    playerStats, leaderboard, globalStats,
  };
}
