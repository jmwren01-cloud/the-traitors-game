import { useState, useEffect, useCallback, useRef } from 'react';
import type { GameState, C2SEvent } from '../types';
import { gameStateReducer } from './gameStateReducer';

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

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const myPlayerIdRef = useRef<string | null>(null);
  const reconnectAttemptedRef = useRef(false);

  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);

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

    // Delegate all state transitions to the pure reducer
    setGameState((prev) => gameStateReducer(prev, msg));
  }, []);

  const send = useCallback((event: C2SEvent) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
    }
  }, []);

  return { connected, gameState, error, send, myPlayerId: myPlayerIdRef.current, reconnecting };
}
