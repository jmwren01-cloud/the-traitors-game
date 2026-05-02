import { useEffect, useRef, useState } from 'react';
import type {
  Player, RoundRecord, C2SEvent,
  PlayerStatsPayload, LeaderboardEntryPayload, GlobalStatsPayload
} from '../types';
import { getColorHex, getAvatarEmoji } from '../avatarConstants';
import { getOrCreateDeviceToken } from '../utils/identity';
import { useSoundContext } from '../contexts/SoundContext';
import { vibrate } from '../utils/haptics';
import { ProfileDrawer } from './ProfileDrawer';
import styles from './GameEnd.module.css';

interface GameEndProps {
  winner?: 'TRAITORS' | 'FAITHFUL';
  endReason?: 'HOST_ENDED';
  players: Player[];
  myRole?: string;
  history?: RoundRecord[];

  myPlayerId?: string;
  playerStats?: PlayerStatsPayload | null;
  leaderboard?: { metric: string; entries: LeaderboardEntryPayload[] } | null;
  globalStats?: GlobalStatsPayload | null;
  onSend?: (event: C2SEvent) => void;
}

/**
 * Cinematic 5-stage post-game summary.
 *
 * Stage 0 (0–1.5s): black fade-in + "Game Over"
 * Stage 1 (1.5–4s): winner banner reveal (drum-roll feel)
 * Stage 2 (4–6s):   personal "You Won/Lost" verdict
 * Stage 3 (6–9s):   roles revealed for both teams
 * Stage 4 (9s+):    timeline + per-player stats + actions
 *
 * Host (or anyone) can press "Skip cinematic" to jump to stage 4 immediately.
 */

const STAGE_TIMINGS_MS = [0, 1500, 4000, 6000, 9000];

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
    <div className={styles.roundCard} style={{ animationDelay: `${0.1 + index * 0.12}s` }}>
      <div className={styles.roundLabel}>Round {record.round}</div>

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

      <div className={styles.outcomeRow}>
        {record.banishedName ? (
          <div className={styles.banishOutcome}>
            <span className={styles.outcomeIcon}>🪄</span>
            <span className={styles.outcomeText}>
              <strong>{record.banishedName}</strong> was banished
              {record.banishedRole && (<> &mdash; <RolePill role={record.banishedRole} /></>)}
            </span>
          </div>
        ) : (
          <div className={styles.outcomeNeutral}>
            <span className={styles.outcomeIcon}>💬</span>
            <span>No one was banished this round</span>
          </div>
        )}
      </div>

      <div className={styles.outcomeRow}>
        {record.murderBlocked ? (
          <div className={styles.shieldOutcome}>
            <span className={styles.outcomeIcon}>🛡️</span>
            <span className={styles.outcomeText}>
              Murder attempt blocked &mdash; <strong>{record.shieldedName}</strong>
              {record.shieldedRole && (<> <RolePill role={record.shieldedRole} /></>)} used their shield
            </span>
          </div>
        ) : record.murderedName ? (
          <div className={styles.murderOutcome}>
            <span className={styles.outcomeIcon}>🔪</span>
            <span className={styles.outcomeText}>
              <strong>{record.murderedName}</strong>
              {record.murderedRole && (<> <RolePill role={record.murderedRole} /></>)} was murdered in the night
            </span>
          </div>
        ) : (
          <div className={styles.outcomeNeutral}>
            <span className={styles.outcomeIcon}>🌙</span>
            <span>No murder this night</span>
          </div>
        )}
      </div>

      {record.recruitedName && (
        <div className={styles.outcomeRow}>
          <div className={styles.recruitedOutcome}>
            <span className={styles.outcomeIcon}>🤝</span>
            <span className={styles.outcomeText}>
              <strong>{record.recruitedName}</strong> was recruited and joined the Traitors
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function GameEnd({
  winner, endReason, players, myRole, history,
  myPlayerId: _myPlayerId, playerStats, leaderboard, globalStats, onSend,
}: GameEndProps) {
  const hostEnded = endReason === 'HOST_ENDED' || !winner;
  const traitors = players.filter((p) => p.role === 'TRAITOR');
  const faithful = players.filter((p) => p.role === 'FAITHFUL');
  const { play } = useSoundContext();
  const soundPlayedRef = useRef(false);
  const [stage, setStage] = useState(0);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);

  // Drive cinematic stages on mount.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < STAGE_TIMINGS_MS.length; i++) {
      timers.push(setTimeout(() => setStage((s) => Math.max(s, i)), STAGE_TIMINGS_MS[i]));
    }
    return () => { timers.forEach(clearTimeout); };
  }, []);

  // Win sound at stage 1 (winner reveal).
  useEffect(() => {
    if (stage >= 1 && winner && !soundPlayedRef.current) {
      soundPlayedRef.current = true;
      play(winner === 'TRAITORS' ? 'traitorWin' : 'faithfulWin');
      vibrate('success');
    }
  }, [stage, winner, play]);

  // Once the cinematic ends (stage 4), fetch this player's stats so we can show them.
  useEffect(() => {
    if (stage >= 4 && onSend) {
      void getOrCreateDeviceToken();
      onSend({ type: 'C2S_GET_PLAYER_STATS', payload: {} });
    }
  }, [stage, onSend]);

  const skip = () => setStage(4);

  const isWinner =
    (winner === 'TRAITORS' && myRole === 'TRAITOR') ||
    (winner === 'FAITHFUL' && myRole === 'FAITHFUL');

  return (
    <div className={`${styles.container} ${winner === 'TRAITORS' ? styles.traitorWin : winner === 'FAITHFUL' ? styles.faithfulWin : ''}`}>
      {/* Cinematic skip control — visible until stage 4 */}
      {stage < 4 && (
        <button className={styles.skipBtn} onClick={skip} aria-label="Skip cinematic">
          Skip ▸
        </button>
      )}

      {/* Stage 0+ — title */}
      <h1 key="title" className={`${styles.title} ${styles.stageEnter}`}>Game Over</h1>

      {/* Stage 1+ — winner banner */}
      {stage >= 1 && (
        <div key="banner" className={`${styles.winnerBanner} ${styles.stageEnter}`}>
          <h2>
            {hostEnded
              ? 'Game Ended Early'
              : winner === 'TRAITORS' ? 'The Traitors Win!' : 'The Faithful Win!'}
          </h2>
          <p className={styles.winnerSubtitle}>
            {hostEnded
              ? 'The host called the game early. No winner was recorded.'
              : winner === 'TRAITORS'
              ? 'Deception prevails. The Traitors have outwitted the castle.'
              : 'Justice prevails. The Traitors have been exposed.'}
          </p>
        </div>
      )}

      {/* Stage 2+ — personal verdict (skipped when game was ended early) */}
      {stage >= 2 && !hostEnded && (
        <div key="verdict" className={`${isWinner ? styles.victoryMessage : styles.defeatMessage} ${styles.stageEnter}`}>
          <p>{isWinner ? '🏆 Congratulations — you survived the deception.' : '💀 Better luck next time…'}</p>
        </div>
      )}

      {/* Stage 3+ — role reveal */}
      {stage >= 3 && (
        <div key="roles" className={`${styles.rolesReveal} ${styles.stageEnter}`}>
          <div className={styles.teamSection}>
            <h3 className={styles.traitorHeader}>Traitors</h3>
            <div className={styles.playerList}>
              {traitors.map((p) => (
                <div key={p.id} className={`${styles.playerCard} ${styles.traitorCard}`}>
                  <div className={styles.avatar} style={{ background: getColorHex(p.color), color: '#000' }}>{getAvatarEmoji(p.avatar)}</div>
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
                  <div className={styles.avatar} style={{ background: getColorHex(p.color), color: '#000' }}>{getAvatarEmoji(p.avatar)}</div>
                  <span>{p.name}</span>
                  {!p.isAlive && <span className={styles.eliminated}>Eliminated</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stage 4+ — stats summary + timeline + actions */}
      {stage >= 4 && (
        <>
          {playerStats && playerStats.gamesPlayed > 0 && (
            <div className={`${styles.statsPanel} ${styles.stageEnter}`}>
              <h3 className={styles.timelineTitle}>Your Lifetime Stats</h3>
              <div className={styles.statsRow}>
                <Stat label="Games" value={playerStats.gamesPlayed} />
                <Stat label="Win Rate" value={`${(playerStats.winRate * 100).toFixed(0)}%`} />
                <Stat label="Traitor W-L" value={`${playerStats.winsAsTraitor}–${playerStats.lossesAsTraitor}`} />
                <Stat label="Faithful W-L" value={`${playerStats.winsAsFaithful}–${playerStats.lossesAsFaithful}`} />
                <Stat label="Survived" value={playerStats.totalSurvived} />
              </div>
            </div>
          )}

          {history && history.length > 0 && (
            <div className={`${styles.timeline} ${styles.stageEnter}`}>
              <h3 className={styles.timelineTitle}>How It Happened</h3>
              <div className={styles.timelineList}>
                {history.map((record, i) => (
                  <RoundCard key={record.round} record={record} index={i} />
                ))}
              </div>
            </div>
          )}

          <div className={`${styles.actionRow} ${styles.stageEnter}`}>
            {onSend && (
              <button className={styles.statsBtn} onClick={() => setShowProfileDrawer(true)}>
                View Profile & Hall of Fame
              </button>
            )}
            <button className={styles.playAgainBtn} onClick={() => window.location.reload()}>
              Play Again
            </button>
          </div>
        </>
      )}

      {showProfileDrawer && onSend && (
        <ProfileDrawer
          onClose={() => setShowProfileDrawer(false)}
          onSend={onSend}
          initialStats={playerStats ?? null}
          initialLeaderboard={leaderboard ?? null}
          initialGlobal={globalStats ?? null}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.statBlock}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}
