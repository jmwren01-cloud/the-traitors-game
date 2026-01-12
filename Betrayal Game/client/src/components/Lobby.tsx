import { useState } from 'react';
import type { Player, C2SEvent } from '../types';
import styles from './Lobby.module.css';

interface LobbyProps {
  sessionId?: string;
  players: Player[];
  myPlayerId?: string;
  onSend: (event: C2SEvent) => void;
}

export function Lobby({ sessionId, players, myPlayerId, onSend }: LobbyProps) {
  const [playerName, setPlayerName] = useState('');
  const [joinSessionId, setJoinSessionId] = useState('');
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');

  const isHost = players.find((p) => p.id === myPlayerId)?.isHost;
  const canStart = players.length >= 5;

  const handleCreate = () => {
    if (playerName.trim()) {
      onSend({ type: 'C2S_CREATE_GAME', payload: { playerName: playerName.trim() } });
    }
  };

  const handleJoin = () => {
    if (playerName.trim() && joinSessionId.trim()) {
      onSend({ type: 'C2S_JOIN_GAME', payload: { sessionId: joinSessionId.trim(), playerName: playerName.trim() } });
    }
  };

  const handleStart = () => {
    onSend({ type: 'C2S_START_GAME', payload: {} });
  };

  if (!sessionId) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>The Traitors</h1>
        <p className={styles.subtitle}>A Game of Deception</p>

        {mode === 'menu' && (
          <div className={styles.menu}>
            <button className={styles.primaryBtn} onClick={() => setMode('create')}>
              Create Game
            </button>
            <button className={styles.secondaryBtn} onClick={() => setMode('join')}>
              Join Game
            </button>
          </div>
        )}

        {mode === 'create' && (
          <div className={styles.form}>
            <input
              type="text"
              placeholder="Your name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className={styles.input}
              maxLength={20}
            />
            <button className={styles.primaryBtn} onClick={handleCreate} disabled={!playerName.trim()}>
              Create Game
            </button>
            <button className={styles.backBtn} onClick={() => setMode('menu')}>
              Back
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div className={styles.form}>
            <input
              type="text"
              placeholder="Session ID"
              value={joinSessionId}
              onChange={(e) => setJoinSessionId(e.target.value.toUpperCase())}
              className={styles.input}
              maxLength={8}
            />
            <input
              type="text"
              placeholder="Your name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className={styles.input}
              maxLength={20}
            />
            <button
              className={styles.primaryBtn}
              onClick={handleJoin}
              disabled={!playerName.trim() || !joinSessionId.trim()}
            >
              Join Game
            </button>
            <button className={styles.backBtn} onClick={() => setMode('menu')}>
              Back
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Game Lobby</h1>
      
      <div className={styles.sessionInfo}>
        <span>Session ID:</span>
        <code className={styles.sessionId}>{sessionId}</code>
      </div>

      <div className={styles.playerList}>
        <h2>Players ({players.length}/22)</h2>
        {players.map((player) => (
          <div key={player.id} className={`${styles.playerCard} ${player.id === myPlayerId ? styles.me : ''}`}>
            <span className={styles.playerName}>
              {player.name}
              {player.isHost && <span className={styles.hostBadge}>HOST</span>}
              {player.id === myPlayerId && <span className={styles.youBadge}>YOU</span>}
            </span>
          </div>
        ))}
      </div>

      {!canStart && (
        <p className={styles.waitingText}>Waiting for more players... (need at least 5)</p>
      )}

      {isHost && canStart && (
        <button className={styles.startBtn} onClick={handleStart}>
          Start Game
        </button>
      )}

      {!isHost && canStart && (
        <p className={styles.waitingText}>Waiting for host to start...</p>
      )}
    </div>
  );
}
