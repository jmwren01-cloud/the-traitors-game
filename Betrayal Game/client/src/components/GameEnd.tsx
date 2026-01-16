import { useEffect, useRef } from 'react';
import type { Player } from '../types';
import styles from './GameEnd.module.css';
import { useSoundContext } from '../contexts/SoundContext';

interface GameEndProps {
  winner?: 'TRAITORS' | 'FAITHFUL';
  players: Player[];
  myRole?: string;
}

export function GameEnd({ winner, players, myRole }: GameEndProps) {
  const traitors = players.filter((p) => p.role === 'TRAITOR');
  const faithful = players.filter((p) => p.role === 'FAITHFUL');
  const { play } = useSoundContext();
  const soundPlayedRef = useRef(false);

  useEffect(() => {
    if (winner && !soundPlayedRef.current) {
      soundPlayedRef.current = true;
      play(winner === 'TRAITORS' ? 'traitorWin' : 'faithfulWin');
    }
  }, [winner, play]);
  const isWinner =
    (winner === 'TRAITORS' && myRole === 'TRAITOR') ||
    (winner === 'FAITHFUL' && myRole === 'FAITHFUL');

  return (
    <div className={`${styles.container} ${winner === 'TRAITORS' ? styles.traitorWin : styles.faithfulWin}`}>
      <h1 className={styles.title}>Game Over</h1>

      <div className={styles.winnerBanner}>
        <h2>{winner === 'TRAITORS' ? 'The Traitors Win!' : 'The Faithful Win!'}</h2>
        <p className={styles.winnerSubtitle}>
          {winner === 'TRAITORS'
            ? 'Deception prevails. The traitors have eliminated the faithful.'
            : 'Justice prevails. The traitors have been exposed.'}
        </p>
      </div>

      <div className={isWinner ? styles.victoryMessage : styles.defeatMessage}>
        <p>{isWinner ? 'Congratulations! You won!' : 'Better luck next time...'}</p>
      </div>

      <div className={styles.rolesReveal}>
        <div className={styles.teamSection}>
          <h3 className={styles.traitorHeader}>Traitors</h3>
          <div className={styles.playerList}>
            {traitors.map((p) => (
              <div key={p.id} className={`${styles.playerCard} ${styles.traitorCard}`}>
                <div className={styles.avatar}>{p.name[0]?.toUpperCase()}</div>
                <span>{p.name}</span>
                {!p.isAlive && <span className={styles.eliminated}>Eliminated</span>}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.teamSection}>
          <h3 className={styles.faithfulHeader}>Faithful</h3>
          <div className={styles.playerList}>
            {faithful.map((p) => (
              <div key={p.id} className={`${styles.playerCard} ${styles.faithfulCard}`}>
                <div className={styles.avatar}>{p.name[0]?.toUpperCase()}</div>
                <span>{p.name}</span>
                {!p.isAlive && <span className={styles.eliminated}>Eliminated</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <button className={styles.playAgainBtn} onClick={() => window.location.reload()}>
        Play Again
      </button>
    </div>
  );
}
