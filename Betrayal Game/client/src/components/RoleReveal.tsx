import { useState, useEffect } from 'react';
import type { Role, Player, C2SEvent } from '../types';
import styles from './RoleReveal.module.css';

interface RoleRevealProps {
  myRole?: Role;
  traitorIds?: string[];
  players: Player[];
  myPlayerId?: string;
  phase: string;
  onSend: (event: C2SEvent) => void;
}

export function RoleReveal({ myRole, traitorIds, players, myPlayerId, phase, onSend }: RoleRevealProps) {
  const [revealed, setRevealed] = useState(false);
  const [showTraitors, setShowTraitors] = useState(false);
  const isHost = players.find((p) => p.id === myPlayerId)?.isHost;

  useEffect(() => {
    if (phase === 'ROLE_REVEAL' && myRole) {
      const timer = setTimeout(() => setRevealed(true), 500);
      return () => clearTimeout(timer);
    }
  }, [phase, myRole]);

  useEffect(() => {
    if (revealed && myRole === 'TRAITOR' && traitorIds) {
      const timer = setTimeout(() => setShowTraitors(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [revealed, myRole, traitorIds]);

  const handleAssignRoles = () => {
    onSend({ type: 'C2S_ASSIGN_ROLES', payload: {} });
  };

  const handleStartVoting = () => {
    onSend({ type: 'C2S_START_VOTING', payload: {} });
  };

  if (phase === 'ROLE_ASSIGN') {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Prepare Yourselves...</h1>
        <p className={styles.subtitle}>Roles are about to be assigned</p>
        {isHost && (
          <button className={styles.primaryBtn} onClick={handleAssignRoles}>
            Assign Roles
          </button>
        )}
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

      {revealed && isHost && (
        <button className={styles.continueBtn} onClick={handleStartVoting}>
          Continue to Roundtable
        </button>
      )}

      {revealed && !isHost && (
        <p className={styles.waiting}>Waiting for host to continue...</p>
      )}
    </div>
  );
}
