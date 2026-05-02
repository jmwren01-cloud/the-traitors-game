import { useEffect, useState } from 'react';
import type {
  C2SEvent, PlayerStatsPayload, LeaderboardEntryPayload, GlobalStatsPayload, GameSummaryPayload
} from '../types';
import { getOrCreateDeviceToken, getSavedPlayerName } from '../utils/identity';
import styles from './ProfileDrawer.module.css';

type LeaderboardMetric = 'winRate' | 'gamesPlayed' | 'traitorWins';

interface ProfileDrawerProps {
  onClose: () => void;
  onSend: (event: C2SEvent) => void;
  // Optional injected data (when GameEnd reuses this component, it may pass these in)
  initialStats?: PlayerStatsPayload | null;
  initialLeaderboard?: { metric: string; entries: LeaderboardEntryPayload[] } | null;
  initialGlobal?: GlobalStatsPayload | null;
}

/**
 * Wave 2 Prompt 4 — Profile Drawer & Hall of Fame.
 *
 * Slide-in drawer with three tabs: My Stats, Hall of Fame, Global.
 * Listens to S2C_PLAYER_STATS / S2C_LEADERBOARD / S2C_GLOBAL_STATS via window events
 * dispatched from useWebSocket... but for now we render from props the parent passes
 * after running its own queries through useWebSocket's local state.
 */
export function ProfileDrawer({ onClose, onSend, initialStats, initialLeaderboard, initialGlobal }: ProfileDrawerProps) {
  const [tab, setTab] = useState<'me' | 'hof' | 'global'>('me');
  const [metric, setMetric] = useState<LeaderboardMetric>('winRate');
  const [stats, setStats] = useState<PlayerStatsPayload | null>(initialStats ?? null);
  const [leaderboard, setLeaderboard] = useState(initialLeaderboard ?? null);
  const [global, setGlobal] = useState(initialGlobal ?? null);

  const deviceToken = getOrCreateDeviceToken();
  const savedName = getSavedPlayerName();

  // Listen for stats events on the window (broadcast by useWebSocket via custom events).
  useEffect(() => {
    const onStats = (e: Event) => setStats((e as CustomEvent).detail);
    const onLb = (e: Event) => setLeaderboard((e as CustomEvent).detail);
    const onGl = (e: Event) => setGlobal((e as CustomEvent).detail);
    window.addEventListener('betrayal:player-stats', onStats);
    window.addEventListener('betrayal:leaderboard', onLb);
    window.addEventListener('betrayal:global-stats', onGl);
    return () => {
      window.removeEventListener('betrayal:player-stats', onStats);
      window.removeEventListener('betrayal:leaderboard', onLb);
      window.removeEventListener('betrayal:global-stats', onGl);
    };
  }, []);

  // Initial fetches on mount.
  useEffect(() => {
    onSend({ type: 'C2S_GET_PLAYER_STATS', payload: { deviceToken } });
    onSend({ type: 'C2S_GET_LEADERBOARD', payload: { metric: 'winRate' } });
    onSend({ type: 'C2S_GET_GLOBAL_STATS', payload: {} });
    // Intentionally only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchMetric = (m: LeaderboardMetric) => {
    setMetric(m);
    onSend({ type: 'C2S_GET_LEADERBOARD', payload: { metric: m } });
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div>
            <h2 className={styles.title}>Profile</h2>
            {savedName && <p className={styles.subtitle}>Playing as {savedName}</p>}
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className={styles.tabs} role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'me'}
            className={`${styles.tab} ${tab === 'me' ? styles.tabActive : ''}`}
            onClick={() => setTab('me')}
          >
            My Stats
          </button>
          <button
            role="tab"
            aria-selected={tab === 'hof'}
            className={`${styles.tab} ${tab === 'hof' ? styles.tabActive : ''}`}
            onClick={() => setTab('hof')}
          >
            Hall of Fame
          </button>
          <button
            role="tab"
            aria-selected={tab === 'global'}
            className={`${styles.tab} ${tab === 'global' ? styles.tabActive : ''}`}
            onClick={() => setTab('global')}
          >
            Global
          </button>
        </div>

        <div className={styles.content}>
          {tab === 'me' && <MyStatsPanel stats={stats} />}
          {tab === 'hof' && (
            <HallOfFamePanel
              leaderboard={leaderboard}
              metric={metric}
              onMetricChange={switchMetric}
            />
          )}
          {tab === 'global' && <GlobalPanel global={global} />}
        </div>
      </div>
    </div>
  );
}

function MyStatsPanel({ stats }: { stats: PlayerStatsPayload | null }) {
  if (!stats) return <p className={styles.empty}>Loading stats…</p>;
  if (stats.gamesPlayed === 0) {
    return (
      <p className={styles.empty}>
        You haven't finished a game yet. Play one to start building your record!
      </p>
    );
  }
  return (
    <div>
      <div className={styles.statGrid}>
        <Stat label="Games" value={stats.gamesPlayed} />
        <Stat label="Win Rate" value={`${(stats.winRate * 100).toFixed(0)}%`} highlight />
        <Stat label="As Traitor" value={`${stats.winsAsTraitor}–${stats.lossesAsTraitor}`} />
        <Stat label="As Faithful" value={`${stats.winsAsFaithful}–${stats.lossesAsFaithful}`} />
        <Stat label="Survived" value={stats.totalSurvived} />
        <Stat label="Banished" value={stats.totalBanished} />
        <Stat label="Murdered" value={stats.totalMurdered} />
        <Stat label="Avg Rounds" value={stats.averageRoundsPlayed.toFixed(1)} />
      </div>

      {stats.recentGames.length > 0 && (
        <div className={styles.recent}>
          <h3 className={styles.sectionHeader}>Recent Games</h3>
          <ul className={styles.recentList}>
            {stats.recentGames.map((g) => (
              <RecentGameRow key={g.gameId} game={g} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RecentGameRow({ game }: { game: GameSummaryPayload }) {
  const date = new Date(game.endedAt);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
  return (
    <li className={`${styles.recentItem} ${game.outcome === 'WON' ? styles.win : styles.loss}`}>
      <span className={styles.recentDate}>{dateStr}</span>
      <span className={styles.recentRole}>{game.role === 'TRAITOR' ? '🗡️ Traitor' : '🛡️ Faithful'}</span>
      <span className={styles.recentOutcome}>{game.outcome === 'WON' ? 'WON' : 'LOST'}</span>
      <span className={styles.recentMeta}>{game.playerCount}p • {game.totalRounds}r</span>
    </li>
  );
}

function HallOfFamePanel({
  leaderboard, metric, onMetricChange,
}: {
  leaderboard: { metric: string; entries: LeaderboardEntryPayload[] } | null;
  metric: LeaderboardMetric;
  onMetricChange: (m: LeaderboardMetric) => void;
}) {
  const formatValue = (m: string, v: number) => {
    if (m === 'winRate') return `${(v * 100).toFixed(0)}%`;
    return String(v);
  };

  return (
    <div>
      <div className={styles.metricToggle}>
        <button
          className={`${styles.metricBtn} ${metric === 'winRate' ? styles.metricActive : ''}`}
          onClick={() => onMetricChange('winRate')}
        >
          Win Rate
        </button>
        <button
          className={`${styles.metricBtn} ${metric === 'gamesPlayed' ? styles.metricActive : ''}`}
          onClick={() => onMetricChange('gamesPlayed')}
        >
          Games Played
        </button>
        <button
          className={`${styles.metricBtn} ${metric === 'traitorWins' ? styles.metricActive : ''}`}
          onClick={() => onMetricChange('traitorWins')}
        >
          Traitor Wins
        </button>
      </div>

      {!leaderboard || leaderboard.entries.length === 0 ? (
        <p className={styles.empty}>
          No qualifying players yet. {metric === 'winRate' && '(Min 3 games for win rate.)'}
        </p>
      ) : (
        <ol className={styles.leaderboard}>
          {leaderboard.entries.map((entry, i) => (
            <li key={entry.deviceToken} className={styles.lbItem}>
              <span className={styles.lbRank}>{rankEmoji(i)}</span>
              <span className={styles.lbName}>{entry.playerName}</span>
              <span className={styles.lbValue}>{formatValue(leaderboard.metric, entry.value)}</span>
              <span className={styles.lbGames}>{entry.gamesPlayed} game{entry.gamesPlayed === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GlobalPanel({ global }: { global: GlobalStatsPayload | null }) {
  if (!global) return <p className={styles.empty}>Loading…</p>;
  return (
    <div className={styles.statGrid}>
      <Stat label="Total Games" value={global.totalGamesPlayed} />
      <Stat label="Total Players" value={global.totalPlayersEver} />
      <Stat label="Faithful Win %" value={`${(global.faithfulWinRate * 100).toFixed(0)}%`} />
      <Stat label="Traitor Win %" value={`${(global.traitorWinRate * 100).toFixed(0)}%`} />
      <Stat label="Avg Rounds / Game" value={global.averageGameLength.toFixed(1)} />
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`${styles.stat} ${highlight ? styles.statHighlight : ''}`}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function rankEmoji(i: number): string {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `#${i + 1}`;
}
