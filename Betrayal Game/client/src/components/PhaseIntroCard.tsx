import { useEffect, useRef } from 'react';
import type { GamePhase } from '../types';
import styles from './PhaseIntroCard.module.css';

interface PhaseIntroCardProps {
  phase: GamePhase | null;
  onDismiss: () => void;
}

const COPY: Partial<Record<GamePhase, { title: string; body: string }>> = {
  VOTING: {
    title: 'Time to Vote',
    body: 'Pick the player you suspect most. Your vote stays private until the reveal.',
  },
  NIGHT: {
    title: 'Night Falls',
    body: 'The castle sleeps. Only the Traitors are awake — they will choose someone to silence.',
  },
  REVOTE: {
    title: 'Revote',
    body: 'The first vote tied. Decide between the tied players to break the deadlock.',
  },
  CHALLENGE: {
    title: 'Shield Challenge',
    body: 'Win this mini-game to earn a one-time shield against banishment or murder.',
  },
  MORNING: {
    title: 'Morning Comes',
    body: 'The castle wakes. See who survived the night.',
  },
};

export function PhaseIntroCard({ phase, onDismiss }: PhaseIntroCardProps) {
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (!phase) return;
    dismissedRef.current = false;
    const t = window.setTimeout(() => {
      if (!dismissedRef.current) {
        dismissedRef.current = true;
        onDismiss();
      }
    }, 3000);
    return () => window.clearTimeout(t);
  }, [phase, onDismiss]);

  if (!phase || !COPY[phase]) return null;
  const { title, body } = COPY[phase]!;

  const handleDismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onDismiss();
  };

  return (
    <div
      className={styles.backdrop}
      onClick={handleDismiss}
      role="alertdialog"
      aria-label={title}
    >
      <div className={styles.card}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>
        <span className={styles.tap} aria-hidden>
          Tap anywhere to dismiss
        </span>
        <span className={styles.progressBar} aria-hidden />
      </div>
    </div>
  );
}
