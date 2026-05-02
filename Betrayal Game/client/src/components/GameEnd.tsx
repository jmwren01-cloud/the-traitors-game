import { useEffect, useRef } from 'react';
import type { Player, RoundRecord } from '../types';
import styles from './GameEnd.module.css';
import { useSoundContext } from '../contexts/SoundContext';
import { vibrate } from '../utils/haptics';

interface GameEndProps {
  winner?: 'TRAITORS' | 'FAITHFUL';
  players: Player[];
  myRole?: string;
  history?: RoundRecord[];
}

function RolePill({ role }: { role: 'TRAITOR' | 'FAITHFUL' }) {
  return (
    <span className={role === 'TRAITOR' ? styles.pillTraitor : styles.pillFaithful}>
      {role === 'TRAITOR' ? 'Traitor' : 'Faithful'}
    </span>
  );
}

function RoundCard({ record, index }: { record: RoundRecord; index: number }) {
  const hasVotes = record.votes.length > 0;

  return (
    <div
      className={styles.roundCard}
      style={{ animationDelay: `${0.1 + index * 0.12}s` }}
    >
      <div className={styles.roundLabel}>Round {record.round}</div>

      {/* Voting breakdown */}
      {hasVotes ? (
        <div className={styles.voteSection}>
          <div className={styles.voteSectionTitle}>Roundtable vote</div>
          <div className={styles.voteTable}>
            {record.votes.map((v, i) => (
              <div key={i} className={`${styles.voteRow} ${v.isAutoVote ? styles.autoVoteRow : ''}`}>
                <div className={styles.voteVoter}>
                  <span className={styles.voterName}>{v.voterName}</span>
                  <RolePill role={v.voterRole} />
                  {v.isAutoVote && <span className={styles.autoBadge}>Auto</span>}
                </div>
                <span className={styles.voteArrow}>&#8594;</span>
                <div className={styles.voteTarget}>
                  <span className={styles.targetName}>{v.targetName}</span>
                  <RolePill role={v.targetRole} />
                </div>
                {v.reasonText && (
                  <div className={styles.voteReason}>&ldquo;{v.reasonText}&rdquo;</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.noVoteNote}>Discussion only — no banishment vote</div>
      )}

      {/* Banishment */}
      <div className={styles.outcomeRow}>
        {record.banishedName ? (
          <div className={styles.banishOutcome}>
            <span className={styles.outcomeIcon}>🪄</span>
            <span className={styles.outcomeText}>
              <strong>{record.banishedName}</strong> was banished
              {record.banishedRole && (
                <> &mdash; <RolePill role={record.banishedRole} /></>
              )}
            </span>
          </div>
        ) : (
          <div className={styles.outcomeNeutral}>
            <span className={styles.outcomeIcon}>💬</span>
            <span>No one was banished this round</span>
          </div>
        )}
      </div>

      {/* Murder / Shield */}
      <div className={styles.outcomeRow}>
        {record.murderBlocked ? (
          <div className={styles.shieldOutcome}>
            <span className={styles.outcomeIcon}>🛡️</span>
            <span className={styles.outcomeText}>
              Murder attempt blocked &mdash; <strong>{record.shieldedName}</strong>
              {record.shieldedRole && <> <RolePill role={record.shieldedRole} /></>} used their shield
            </span>
          </div>
        ) : record.murderedName ? (
          <div className={styles.murderOutcome}>
            <span className={styles.outcomeIcon}>🔪</span>
            <span className={styles.outcomeText}>
              <strong>{record.murderedName}</strong>
              {record.murderedRole && <> <RolePill role={record.murderedRole} /></>} was murdered in the night
            </span>
          </div>
        ) : (
          <div className={styles.outcomeNeutral}>
            <span className={styles.outcomeIcon}>🌙</span>
            <span>No murder this night</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function GameEnd({ winner, players, myRole, history }: GameEndProps) {
  const traitors = players.filter((p) => p.role === 'TRAITOR');
  const faithful = players.filter((p) => p.role === 'FAITHFUL');
  const { play } = useSoundContext();
  const soundPlayedRef = useRef(false);

  useEffect(() => {
    if (winner && !soundPlayedRef.current) {
      soundPlayedRef.current = true;
      play(winner === 'TRAITORS' ? 'traitorWin' : 'faithfulWin');
      vibrate('success');
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

      {/* Round-by-round timeline */}
      {history && history.length > 0 && (
        <div className={styles.timeline}>
          <h3 className={styles.timelineTitle}>How It Happened</h3>
          <div className={styles.timelineList}>
            {history.map((record, i) => (
              <RoundCard key={record.round} record={record} index={i} />
            ))}
          </div>
        </div>
      )}

      <button className={styles.playAgainBtn} onClick={() => window.location.reload()}>
        Play Again
      </button>
    </div>
  );
}
