import { useState, useEffect, useRef } from 'react';
import type { Role, Player, C2SEvent } from '../types';
import styles from './RoleReveal.module.css';
import { useSoundContext } from '../contexts/SoundContext';
import { vibrate } from '../utils/haptics';

interface RoleRevealProps {
  myRole?: Role;
  traitorIds?: string[];
  players: Player[];
  myPlayerId?: string;
  phase: string;
  onSend: (event: C2SEvent) => void;
}

export function RoleReveal({ myRole, traitorIds, players, myPlayerId, phase }: RoleRevealProps) {
  const [revealed, setRevealed] = useState(false);
  const [showTraitors, setShowTraitors] = useState(false);
  const isHost = players.find((p) => p.id === myPlayerId)?.isHost;
  const { play } = useSoundContext();
  const soundPlayedRef = useRef(false);

  useEffect(() => {
    if (phase === 'ROLE_REVEAL' && myRole) {
      const timer = setTimeout(() => setRevealed(true), 500);
      return () => clearTimeout(timer);
    }
  }, [phase, myRole]);

  useEffect(() => {
    if (revealed && myRole && !soundPlayedRef.current) {
      soundPlayedRef.current = true;
      play('roleReveal');
      vibrate(myRole === 'TRAITOR' ? 'warning' : 'success');
      setTimeout(() => {
        play(myRole === 'TRAITOR' ? 'traitorReveal' : 'faithfulReveal');
      }, 600);
    }
  }, [revealed, myRole, play]);

  useEffect(() => {
    if (revealed && myRole === 'TRAITOR' && traitorIds) {
      const timer = setTimeout(() => setShowTraitors(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [revealed, myRole, traitorIds]);

  if (phase === 'ROLE_ASSIGN') {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Prepare Yourselves...</h1>
        <p className={styles.subtitle}>Roles are about to be assigned</p>
        {!isHost && <p className={styles.waiting}>Waiting for host...</p>}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={`${styles.card} ${revealed ? styles.revealed : ''}`}>
        <div className={styles.cardInner}>
          <div className={styles.cardBack}>
            <span>?</span>
          </div>
          <div className={`${styles.cardFront} ${myRole === 'TRAITOR' ? styles.traitor : styles.faithful}`}>
            <h2>{myRole === 'TRAITOR' ? 'TRAITOR' : 'FAITHFUL'}</h2>
            <p>
              {myRole === 'TRAITOR'
                ? 'Eliminate the Faithful. Stay hidden.'
                : 'Find the Traitors. Survive.'}
            </p>
          </div>
        </div>
      </div>

      {showTraitors && traitorIds && traitorIds.length > 1 && (
        <div className={styles.traitorList}>
          <h3>Your Fellow Traitors:</h3>
          <div className={styles.traitorNames}>
            {traitorIds
              .filter((id) => id !== myPlayerId)
              .map((id) => {
                const player = players.find((p) => p.id === id);
                return player ? (
                  <span key={id} className={styles.traitorName}>
                    {player.name}
                  </span>
                ) : null;
              })}
          </div>
        </div>
      )}

      {revealed && !isHost && (
        <p className={styles.waiting}>Waiting for host to continue...</p>
      )}
    </div>
  );
}
