import { useState } from 'react';
import type { Player, C2SEvent, Role } from '../types';
import styles from './NightPhase.module.css';

interface NightPhaseProps {
  players: Player[];
  myPlayerId?: string;
  myRole?: Role;
  phase: string;
  currentRound?: number;
  aliveTraitorCount?: number;
  murderVoteProgress?: { received: number; needed: number };
  murderedPlayer?: { id: string; name: string };
  onSend: (event: C2SEvent) => void;
}

export function NightPhase({
  players,
  myPlayerId,
  myRole,
  phase,
  currentRound,
  aliveTraitorCount,
  murderVoteProgress,
  murderedPlayer,
  onSend,
}: NightPhaseProps) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);

  const isHost = players.find((p) => p.id === myPlayerId)?.isHost;
  const isTraitor = myRole === 'TRAITOR';
  const aliveFaithful = players.filter((p) => p.isAlive && p.role !== 'TRAITOR');

  const handleSubmitMurder = () => {
    if (selectedTarget) {
      onSend({ type: 'C2S_SUBMIT_MURDER', payload: { targetId: selectedTarget } });
      setHasVoted(true);
    }
  };

  const handleResolveMurder = () => {
    onSend({ type: 'C2S_RESOLVE_MURDER', payload: {} });
  };

  const handleStartMorning = () => {
    onSend({ type: 'C2S_START_MORNING', payload: {} });
  };

  const handleContinueToDay = () => {
    onSend({ type: 'C2S_CONTINUE_TO_DAY', payload: {} });
  };

  if (phase === 'NIGHT') {
    if (isTraitor) {
      return (
        <div className={styles.container}>
          <div className={styles.nightOverlay}>
            <h1 className={styles.title}>Night Falls</h1>
            <p className={styles.subtitle}>Round {currentRound}</p>
            <p className={styles.traitorInfo}>
              {aliveTraitorCount && aliveTraitorCount > 1
                ? `You have ${aliveTraitorCount - 1} fellow traitor(s)`
                : 'You are the only traitor'}
            </p>

            <h2 className={styles.sectionTitle}>Choose Your Victim</h2>

            <div className={styles.targetGrid}>
              {aliveFaithful.map((player) => (
                <div
                  key={player.id}
                  className={`${styles.targetCard} ${selectedTarget === player.id ? styles.selected : ''}`}
                  onClick={() => !hasVoted && setSelectedTarget(player.id)}
                >
                  <div className={styles.avatar}>{player.name[0]?.toUpperCase()}</div>
                  <span className={styles.name}>{player.name}</span>
                </div>
              ))}
            </div>

            {murderVoteProgress && (
              <div className={styles.voteProgress}>
                <p>
                  Murder votes: {murderVoteProgress.received} / {murderVoteProgress.needed}
                </p>
              </div>
            )}

            {!hasVoted && (
              <button className={styles.murderBtn} onClick={handleSubmitMurder} disabled={!selectedTarget}>
                Vote to Murder
              </button>
            )}

            {hasVoted && <p className={styles.waiting}>Waiting for other traitors...</p>}

            {isHost && (
              <button className={styles.secondaryBtn} onClick={handleResolveMurder}>
                Resolve Murder
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className={styles.container}>
        <div className={styles.nightOverlay}>
          <h1 className={styles.title}>Night Falls</h1>
          <p className={styles.subtitle}>Round {currentRound}</p>

          <div className={styles.sleepingIcon}>
            <span>💤</span>
          </div>

          <p className={styles.faithfulMessage}>
            Close your eyes and wait...<br />
            The traitors are choosing their victim.
          </p>

          {isHost && (
            <button className={styles.secondaryBtn} onClick={handleStartMorning}>
              Dawn Approaches
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'MORNING') {
    return (
      <div className={styles.container}>
        <div className={styles.morningOverlay}>
          <h1 className={styles.title}>Morning</h1>

          {murderedPlayer ? (
            <div className={styles.deathReveal}>
              <div className={styles.bigAvatar}>{murderedPlayer.name[0]?.toUpperCase()}</div>
              <h2>{murderedPlayer.name}</h2>
              <p className={styles.deathMessage}>was found dead this morning...</p>
            </div>
          ) : (
            <div className={styles.noDeathMessage}>
              <p>No one was murdered last night.</p>
            </div>
          )}

          {isHost && (
            <button className={styles.primaryBtn} onClick={handleContinueToDay}>
              Continue to Roundtable
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
