import { useState, useEffect } from 'react';
import styles from './ConnectionStatus.module.css';

interface ConnectionStatusProps {
  connected: boolean;
  reconnecting?: boolean;
}

export function ConnectionStatus({ connected, reconnecting }: ConnectionStatusProps) {
  const [showBanner, setShowBanner] = useState(false);
  const [wasDisconnected, setWasDisconnected] = useState(false);

  useEffect(() => {
    if (!connected && !reconnecting) {
      setShowBanner(true);
      setWasDisconnected(true);
    } else if (reconnecting) {
      setShowBanner(true);
    } else if (connected && wasDisconnected) {
      setShowBanner(true);
      const timer = setTimeout(() => {
        setShowBanner(false);
        setWasDisconnected(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [connected, reconnecting, wasDisconnected]);

  if (!showBanner) return null;

  let message = '';
  let statusClass = '';

  if (!connected && !reconnecting) {
    message = 'Connection lost. Trying to reconnect...';
    statusClass = styles.disconnected;
  } else if (reconnecting) {
    message = 'Reconnecting...';
    statusClass = styles.reconnecting;
  } else if (connected && wasDisconnected) {
    message = 'Connected!';
    statusClass = styles.connected;
  }

  return (
    <div className={`${styles.banner} ${statusClass}`}>
      <span className={styles.icon}>
        {!connected ? '⚠️' : reconnecting ? '🔄' : '✓'}
      </span>
      <span>{message}</span>
    </div>
  );
}
