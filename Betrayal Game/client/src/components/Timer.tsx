import { useState, useEffect, useRef } from 'react';
import { useSoundContext } from '../contexts/SoundContext';
import styles from './Timer.module.css';

interface TimerProps {
  endTime: number;
  onExpired?: () => void;
}

export function Timer({ endTime, onExpired }: TimerProps) {
  const [timeLeft, setTimeLeft] = useState(0);
  const [hasExpired, setHasExpired] = useState(false);
  const { play } = useSoundContext();
  // Track which seconds we've already heart-beated for so a re-render in the
  // same second cannot double-fire the cue. Cleared whenever endTime changes.
  const beatedSecondRef = useRef<number | null>(null);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
      return remaining;
    };

    setTimeLeft(calculateTimeLeft());
    setHasExpired(false);
    beatedSecondRef.current = null;

    const interval = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);

      // Heartbeat once per second across the final 10s window. The interval
      // is the only timer source; cleanup below cancels it on phase change
      // (component unmount) and on endTime change, so no orphaned intervals.
      if (remaining > 0 && remaining <= 10 && beatedSecondRef.current !== remaining) {
        beatedSecondRef.current = remaining;
        play('heartbeat');
      }

      if (remaining === 0 && !hasExpired) {
        setHasExpired(true);
        onExpired?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [endTime, onExpired, hasExpired, play]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const isUrgent = timeLeft <= 10 && timeLeft > 0;
  const isExpired = timeLeft === 0;

  return (
    <div className={`${styles.timer} ${isUrgent ? styles.urgent : ''} ${isExpired ? styles.expired : ''}`}>
      <span className={styles.icon}>⏱️</span>
      <span className={styles.time}>
        {minutes}:{seconds.toString().padStart(2, '0')}
      </span>
    </div>
  );
}
