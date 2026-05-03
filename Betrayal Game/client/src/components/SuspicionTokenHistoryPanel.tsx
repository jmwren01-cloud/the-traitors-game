import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Player, SuspicionToken } from '../types';
import { RevealGraph } from './SuspicionTokens';
import styles from './SuspicionTokenHistoryPanel.module.css';

interface Props {
  players: Player[];
  byRound?: Record<number, SuspicionToken[]>;
}

export function SuspicionTokenHistoryPanel(props: Props): ReactElement | null {
  const { players, byRound } = props;
  const [open, setOpen] = useState(false);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

  const rounds = useMemo(() => {
    if (!byRound) return [];
    return Object.keys(byRound)
      .map((k) => Number(k))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => b - a);
  }, [byRound]);

  if (rounds.length === 0) return null;

  const activeRound = selectedRound ?? rounds[0]!;
  const activeTokens = byRound?.[activeRound] ?? [];
  const prevRound = rounds.find((r) => r < activeRound);
  const prevTokens = prevRound !== undefined ? (byRound?.[prevRound] ?? []) : [];

  const prevTargetByPlacer = new Map(prevTokens.map((t) => [t.placerId, t.targetId]));
  const diffs = activeTokens
    .map((t) => {
      const prev = prevTargetByPlacer.get(t.placerId);
      if (prev === undefined || prev === t.targetId) return null;
      return { placerId: t.placerId, fromId: prev, toId: t.targetId };
    })
    .filter((d): d is { placerId: string; fromId: string; toId: string } => d !== null);

  const nameOf = (id: string): string =>
    players.find((p) => p.id === id)?.name ?? '?';

  return (
    <div className={styles.panel}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} Past Suspicions ({rounds.length})
      </button>
      {open && (
        <div className={styles.body}>
          <div className={styles.tabs} role="tablist">
            {rounds.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={r === activeRound}
                className={`${styles.tab} ${r === activeRound ? styles.tabActive : ''}`}
                onClick={() => setSelectedRound(r)}
              >
                R{r}
              </button>
            ))}
          </div>

          <RevealGraph
            players={players.filter((p) => activeTokens.some(
              (t) => t.placerId === p.id || t.targetId === p.id,
            ))}
            tokens={activeTokens}
          />

          {prevRound !== undefined && (
            <div className={styles.diffSection}>
              <div className={styles.diffTitle}>
                Changes vs Round {prevRound}
              </div>
              {diffs.length === 0 ? (
                <div className={styles.diffEmpty}>No one shifted suspicion.</div>
              ) : (
                <ul className={styles.diffList}>
                  {diffs.map((d) => (
                    <li key={d.placerId}>
                      <strong>{nameOf(d.placerId)}</strong>
                      {' shifted: '}
                      <span className={styles.diffFrom}>{nameOf(d.fromId)}</span>
                      {' → '}
                      <span className={styles.diffTo}>{nameOf(d.toId)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
