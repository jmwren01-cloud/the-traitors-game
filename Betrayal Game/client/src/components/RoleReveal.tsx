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
  const [readyEnabled, setReadyEnabled] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const isHost = players.find((p) => p.id === myPlayerId)?.isHost;
  const { play } = useSoundContext();
  const soundPlayedRef = useRef(false);

  useEffect(() => {
    if (phase === 'ROLE_REVEAL' && myRole) {
      const timer = setTimeout(() => setRevealed(true), 500);
      return () => clearTimeout(timer);
    }
  }, [phase, myRole]);

  // Enable the "I'm ready" button after the 8-second CSS countdown bar drains.
  // A single setTimeout is used (not a setInterval counter) per the spec.
  useEffect(() => {
    if (!revealed) return;
    const t = window.setTimeout(() => setReadyEnabled(true), 8000);
    return () => window.clearTimeout(t);
  }, [revealed]);

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

      {revealed && !acknowledged && (
        <div className={`${styles.briefing} ${myRole === 'TRAITOR' ? styles.briefingTraitor : styles.briefingFaithful}`}>
          {myRole === 'TRAITOR' ? (
            <>
              <h3 className={styles.briefingTitle}>Your charge as a Traitor</h3>
              <p className={styles.briefingBody}>
                You answer to no one. Blend in. Sound shocked at the murders. Vote convincingly to
                banish the Faithful — or each other when it suits you. Each night you and your
                fellow Traitors choose one Faithful to silence.
              </p>
              <p className={styles.briefingTip}>If you survive long enough, you win.</p>
            </>
          ) : (
            <>
              <h3 className={styles.briefingTitle}>Your charge as a Faithful</h3>
              <p className={styles.briefingBody}>
                You are loyal to the castle. Watch your fellow players carefully. Use the
                roundtable to share suspicions and vote together to banish the Traitors before
                they pick you off one by one.
              </p>
              <p className={styles.briefingTip}>Trust is earned. Deception is everywhere.</p>
            </>
          )}

          <div className={styles.countdownTrack} aria-hidden>
            <span className={styles.countdownBar} />
          </div>

          <button
            type="button"
            className={`${styles.readyBtn} ${readyEnabled ? styles.readyBtnEnabled : ''}`}
            onClick={() => setAcknowledged(true)}
            disabled={!readyEnabled}
            aria-disabled={!readyEnabled}
          >
            I'm Ready
          </button>
        </div>
      )}

      {revealed && acknowledged && !isHost && (
        <p className={styles.waiting}>✓ Ready — waiting for host to continue...</p>
      )}

      {revealed && acknowledged && isHost && (
        <p className={styles.waiting}>✓ Ready — open the Host panel to continue.</p>
      )}
    </div>
  );
}
