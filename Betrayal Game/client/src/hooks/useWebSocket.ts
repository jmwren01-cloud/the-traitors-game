import { useState, useEffect, useCallback, useRef } from 'react';
import type { GameState, C2SEvent, Player, Role, Vote, ChatMessage, TimerState, VoteTally, GameSettings } from '../types';

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

      // Try to reconnect with stored session token
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
    switch (msg.type) {
      case 'S2C_GAME_CREATED': {
        const payload = msg.payload as { sessionId: string; playerId: string; playerName: string; sessionToken: string; settings: GameSettings };
        myPlayerIdRef.current = payload.playerId;
        saveSessionToken(payload.sessionToken);
        setGameState({
          sessionId: payload.sessionId,
          phase: 'LOBBY',
          players: [],
          myPlayerId: payload.playerId,
          settings: payload.settings,
        });
        break;
      }

      case 'S2C_GAME_JOINED': {
        const payload = msg.payload as { sessionId: string; playerId: string; playerName: string; players: Player[]; sessionToken: string; settings: GameSettings };
        myPlayerIdRef.current = payload.playerId;
        saveSessionToken(payload.sessionToken);
        setGameState({
          sessionId: payload.sessionId,
          phase: 'LOBBY',
          players: payload.players,
          myPlayerId: payload.playerId,
          settings: payload.settings,
        });
        break;
      }

      case 'S2C_SETTINGS_UPDATED': {
        const payload = msg.payload as { settings: GameSettings };
        setGameState((prev) => prev ? { ...prev, settings: payload.settings } : null);
        break;
      }

      case 'S2C_RECONNECTED': {
        const payload = msg.payload as {
          sessionId: string;
          playerId: string;
          playerName: string;
          players: Player[];
          phase: GameState['phase'];
          role?: Role;
          traitorIds?: string[];
          currentRound: number;
          messages: ChatMessage[];
          votes: Vote[];
          murderVotes: Vote[];
          hostId: string;
          winner?: 'TRAITORS' | 'FAITHFUL';
          banishedPlayerId?: string;
          banishedPlayerName?: string;
          banishedPlayerRole?: Role;
          lastMurderedPlayerId?: string;
          lastMurderedPlayerName?: string;
          timer?: TimerState;
          tiedPlayerIds?: string[];
          tiedPlayerNames?: string[];
          voteCount?: { received: number; needed: number };
          murderVoteProgress?: { received: number; needed: number };
          aliveTraitorCount?: number;
          revealIndex?: number;
          revealOrder?: string[];
          currentTally?: VoteTally[];
          revealedVotes?: Vote[];
          remainingTraitors?: number;
          remainingFaithful?: number;
          tiebreakerResults?: { playerId: string; playerName: string; hasShield: boolean }[];
          randomlySelectedPlayerId?: string;
          randomlySelectedPlayerName?: string;
          randomlySelectedPlayerRole?: Role;
          totalVotes?: number;
          settings: GameSettings;
        };
        myPlayerIdRef.current = payload.playerId;
        setReconnecting(false);

        // Reconstruct currentReveal from last revealed vote if in progress
        let currentReveal = undefined;
        const revealedCount = payload.revealedVotes?.length || 0;
        const totalVoteCount = payload.totalVotes || payload.votes.length;
        // Use revealedVotes length to determine if reveal is in progress (more reliable than revealIndex)
        if (payload.revealedVotes && revealedCount > 0 && revealedCount < totalVoteCount) {
          const lastVote = payload.revealedVotes[revealedCount - 1];
          if (lastVote) {
            const voter = payload.players.find((p) => p.id === lastVote.voterId);
            const target = payload.players.find((p) => p.id === lastVote.targetId);
            currentReveal = {
              vote: lastVote,
              voterName: voter?.name || 'Unknown',
              targetName: target?.name || 'Unknown',
            };
          }
        }

        setGameState({
          sessionId: payload.sessionId,
          phase: payload.phase,
          players: payload.players,
          myPlayerId: payload.playerId,
          myRole: payload.role,
          traitorIds: payload.traitorIds,
          currentRound: payload.currentRound,
          messages: payload.messages,
          votes: payload.votes,
          winner: payload.winner,
          banishedPlayer: payload.banishedPlayerId && payload.banishedPlayerName && payload.banishedPlayerRole
            ? { id: payload.banishedPlayerId, name: payload.banishedPlayerName, role: payload.banishedPlayerRole }
            : undefined,
          murderedPlayer: payload.lastMurderedPlayerId && payload.lastMurderedPlayerName
            ? { id: payload.lastMurderedPlayerId, name: payload.lastMurderedPlayerName }
            : undefined,
          timer: payload.timer,
          tiedPlayerIds: payload.tiedPlayerIds,
          tiedPlayerNames: payload.tiedPlayerNames,
          voteCount: payload.voteCount,
          murderVoteProgress: payload.murderVoteProgress,
          aliveTraitorCount: payload.aliveTraitorCount,
          revealIndex: payload.revealIndex,
          revealOrder: payload.revealOrder,
          currentTally: payload.currentTally,
          revealedVotes: payload.revealedVotes,
          totalVotes: payload.totalVotes || payload.votes.length,
          remainingTraitors: payload.remainingTraitors,
          remainingFaithful: payload.remainingFaithful,
          tiebreakerResults: payload.tiebreakerResults,
          randomlySelectedPlayer: payload.randomlySelectedPlayerId && payload.randomlySelectedPlayerName && payload.randomlySelectedPlayerRole
            ? { id: payload.randomlySelectedPlayerId, name: payload.randomlySelectedPlayerName, role: payload.randomlySelectedPlayerRole }
            : undefined,
          currentReveal,
          settings: payload.settings,
        });
        break;
      }

      case 'S2C_PLAYER_DISCONNECTED': {
        const payload = msg.payload as { playerId: string; players: Player[] };
        setGameState((prev) => prev ? { ...prev, players: payload.players } : null);
        break;
      }

      case 'S2C_PLAYER_RECONNECTED': {
        const payload = msg.payload as { playerId: string; players: Player[] };
        setGameState((prev) => prev ? { ...prev, players: payload.players } : null);
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

      case 'S2C_ROUNDTABLE_STARTED': {
        const payload = msg.payload as { phase: string; currentRound?: number };
        setGameState((prev) => prev ? { 
          ...prev, 
          phase: payload.phase as GameState['phase'],
          currentRound: payload.currentRound ?? prev.currentRound
        } : null);
        break;
      }

      case 'S2C_VOTING_STARTED': {
        const payload = msg.payload as { phase: string };
        setGameState((prev) => prev ? { ...prev, phase: payload.phase as GameState['phase'], votes: [], voteCount: undefined } : null);
        break;
      }

      case 'S2C_REVOTE_STARTED': {
        const payload = msg.payload as { tiedPlayerIds: string[]; phase: string };
        setGameState((prev) => prev ? { 
          ...prev, 
          phase: payload.phase as GameState['phase'], 
          tiedPlayerIds: payload.tiedPlayerIds,
          votes: [], 
          voteCount: undefined 
        } : null);
        break;
      }

      case 'S2C_VOTE_SUBMITTED': {
        break;
      }

      case 'S2C_VOTE_COUNT_UPDATE': {
        const payload = msg.payload as { received: number; needed: number };
        setGameState((prev) => prev ? { ...prev, voteCount: payload } : null);
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

      case 'S2C_VOTE_REVEAL_STARTED': {
        const payload = msg.payload as { phase: string; revealOrder: string[]; totalVotes: number };
        setGameState((prev) => prev ? {
          ...prev,
          phase: payload.phase as GameState['phase'],
          revealOrder: payload.revealOrder,
          revealIndex: 0,
          revealedVotes: [],
          currentTally: [],
          currentReveal: undefined,
          totalVotes: payload.totalVotes,
        } : null);
        break;
      }

      case 'S2C_VOTE_REVEAL_STEP': {
        const payload = msg.payload as { 
          revealIndex: number; 
          vote: Vote; 
          voterName: string; 
          targetName: string; 
          currentTally: VoteTally[];
        };
        setGameState((prev) => {
          if (!prev) return null;
          const revealedVotes = [...(prev.revealedVotes || []), payload.vote];
          return {
            ...prev,
            revealIndex: payload.revealIndex + 1,
            revealedVotes,
            currentTally: payload.currentTally,
            currentReveal: {
              vote: payload.vote,
              voterName: payload.voterName,
              targetName: payload.targetName,
            },
          };
        });
        break;
      }

      case 'S2C_VOTE_REVEAL_COMPLETE': {
        const payload = msg.payload as { 
          allVotes: Vote[]; 
          finalTally: VoteTally[]; 
          totalVotes: number;
          revealIndex: number;
          phase: string;
        };
        setGameState((prev) => prev ? {
          ...prev,
          votes: payload.allVotes,
          currentTally: payload.finalTally,
          revealedVotes: payload.allVotes,
          revealIndex: payload.totalVotes,
          totalVotes: payload.totalVotes,
          phase: payload.phase as GameState['phase'],
          currentReveal: undefined,
        } : null);
        break;
      }

      case 'S2C_TIE_DETECTED': {
        const payload = msg.payload as { tiedPlayerIds: string[]; tiedPlayerNames: string[]; phase: string };
        setGameState((prev) => prev ? {
          ...prev,
          phase: payload.phase as GameState['phase'],
          tiedPlayerIds: payload.tiedPlayerIds,
          tiedPlayerNames: payload.tiedPlayerNames,
          voteCount: undefined
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
            tiedPlayerIds: undefined,
            tiedPlayerNames: undefined,
            randomlySelectedPlayer: undefined
          };
        });
        break;
      }

      case 'S2C_TIEBREAKER_RESOLVED': {
        const payload = msg.payload as { 
          selectedPlayerId: string; 
          selectedPlayerName: string; 
          selectedPlayerRole: Role; 
          tiedPlayerIds: string[];
          tiedPlayerNames: string[];
          phase: string 
        };
        setGameState((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            phase: payload.phase as GameState['phase'],
            randomlySelectedPlayer: {
              id: payload.selectedPlayerId,
              name: payload.selectedPlayerName,
              role: payload.selectedPlayerRole,
            },
            banishedPlayer: {
              id: payload.selectedPlayerId,
              name: payload.selectedPlayerName,
              role: payload.selectedPlayerRole,
            },
            tiedPlayerIds: payload.tiedPlayerIds,
            tiedPlayerNames: payload.tiedPlayerNames,
            players: prev.players.map((p) =>
              p.id === payload.selectedPlayerId ? { ...p, isAlive: false } : p
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
        const payload = msg.payload as { 
          phase: string; 
          lastMurderedPlayerId?: string; 
          lastMurderedPlayerName?: string;
          murderBlocked?: boolean;
          shieldedPlayerId?: string;
          shieldedPlayerName?: string;
        };
        setGameState((prev) => prev ? {
          ...prev,
          phase: payload.phase as GameState['phase'],
          murderedPlayer: payload.lastMurderedPlayerId
            ? { id: payload.lastMurderedPlayerId, name: payload.lastMurderedPlayerName || '' }
            : undefined,
          murderBlocked: payload.murderBlocked
            ? { shieldedPlayerId: payload.shieldedPlayerId!, shieldedPlayerName: payload.shieldedPlayerName! }
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
          murderBlocked: undefined,
          votes: undefined,
        } : null);
        break;
      }

      case 'S2C_CHALLENGE_STARTED': {
        const payload = msg.payload as { 
          phase: string; 
          challengeType: 'TIME_ESTIMATE' | 'MISSING_PLAYER' | 'WORD_SCRAMBLE';
          startTime: number;
          targetTime?: number;
          shownPlayerIds?: string[];
          scrambledWord?: string;
        };
        setGameState((prev) => prev ? {
          ...prev,
          phase: payload.phase as GameState['phase'],
          challenge: {
            type: payload.challengeType,
            startTime: payload.startTime,
            targetTime: payload.targetTime,
            shownPlayerIds: payload.shownPlayerIds,
            scrambledWord: payload.scrambledWord,
            completed: false
          }
        } : null);
        break;
      }

      case 'S2C_CHALLENGE_ANSWER_RECEIVED': {
        // Optional: could track who answered
        break;
      }

      case 'S2C_CHALLENGE_PHASE_UPDATE': {
        const payload = msg.payload as { hiddenPlayerId?: string };
        setGameState((prev) => {
          if (!prev || !prev.challenge) return prev;
          return {
            ...prev,
            challenge: {
              ...prev.challenge,
              hiddenPlayerId: payload.hiddenPlayerId
            }
          };
        });
        break;
      }

      case 'S2C_CHALLENGE_RESULT': {
        const payload = msg.payload as { 
          phase: string;
          winnerId?: string;
          winnerName?: string;
          correctAnswer?: string | number;
          shieldAwarded: boolean;
        };
        setGameState((prev) => {
          if (!prev) return null;
          // Update player shields if winner was awarded
          let updatedPlayers = prev.players;
          if (payload.winnerId && payload.shieldAwarded) {
            updatedPlayers = prev.players.map((p) =>
              p.id === payload.winnerId ? { ...p, hasShield: true } : p
            );
          }
          return {
            ...prev,
            phase: payload.phase as GameState['phase'],
            players: updatedPlayers,
            challenge: prev.challenge ? {
              ...prev.challenge,
              winnerId: payload.winnerId,
              winnerName: payload.winnerName,
              correctAnswer: payload.correctAnswer,
              shieldAwarded: payload.shieldAwarded,
              completed: true
            } : undefined
          };
        });
        break;
      }

      case 'S2C_SHIELD_REVEALED': {
        const payload = msg.payload as { playerId: string; playerName: string };
        setGameState((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            players: prev.players.map((p) =>
              p.id === payload.playerId ? { ...p, shieldRevealed: true } : p
            )
          };
        });
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

      case 'S2C_CHAT_MESSAGE': {
        const payload = msg.payload as unknown as ChatMessage;
        setGameState((prev) => {
          if (!prev) return null;
          const existingMessages = prev.messages || [];
          if (existingMessages.some(m => m.id === payload.id)) {
            return prev;
          }
          return {
            ...prev,
            messages: [...existingMessages, payload],
          };
        });
        break;
      }

      case 'S2C_TIMER_UPDATE': {
        const payload = msg.payload as { endTime: number; duration: number; phase: string };
        setGameState((prev) => prev ? {
          ...prev,
          timer: {
            endTime: payload.endTime,
            duration: payload.duration,
            phase: payload.phase as TimerState['phase'],
          },
        } : null);
        break;
      }

      case 'S2C_ERROR': {
        const payload = msg.payload as { message: string };
        setError(payload.message);
        // If reconnection failed, clear the token and stop reconnecting
        if (payload.message.includes('session') || payload.message.includes('token')) {
          clearSessionToken();
          setReconnecting(false);
        }
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

  return { connected, gameState, error, send, myPlayerId: myPlayerIdRef.current, reconnecting };
}
