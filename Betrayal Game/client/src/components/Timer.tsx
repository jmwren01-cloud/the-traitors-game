import { useState, useEffect } from 'react';
import styles from './Timer.module.css';

interface TimerProps {
  endTime: number;
  onExpired?: () => void;
}

export function Timer({ endTime, onExpired }: TimerProps) {
  const [timeLeft, setTimeLeft] = useState(0);
  const [hasExpired, setHasExpired] = useState(false);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
      return remaining;
    };

    setTimeLeft(calculateTimeLeft());
    setHasExpired(false);

    const interval = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);

      if (remaining === 0 && !hasExpired) {
        setHasExpired(true);
        onExpired?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [endTime, onExpired, hasExpired]);

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
