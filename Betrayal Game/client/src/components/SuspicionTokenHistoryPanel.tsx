import { useMemo, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import type { Player, SuspicionToken } from '../types';
import { RevealGraph } from './RevealGraph';
import styles from './SuspicionTokenHistoryPanel.module.css';

interface Props {
  players: Player[];
  byRound?: Record<number, SuspicionToken[]>;
}

export function SuspicionTokenHistoryPanel(props: Props): ReactElement | null {
  const { players, byRound } = props;
  const [open, setOpen] = useState(false);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [hideAuto, setHideAuto] = useState(false);
  const [focusPlayerId, setFocusPlayerId] = useState<string>('');

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

  const filteredTokens = activeTokens.filter((t) => {
    if (hideAuto && t.isAuto) return false;
    if (focusPlayerId && t.placerId !== focusPlayerId && t.targetId !== focusPlayerId) {
      return false;
    }
    return true;
  });

  const nameOf = (id: string): string =>
    players.find((p) => p.id === id)?.name ?? '?';

  const onFocusChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    setFocusPlayerId(e.target.value);
  };

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

          <div className={styles.filters}>
            <label className={styles.filterCheck}>
              <input
                type="checkbox"
                checked={hideAuto}
                onChange={(e) => setHideAuto(e.target.checked)}
              />
              Hide auto-assigned
            </label>
            <label className={styles.filterSelect}>
              Focus:
              <select value={focusPlayerId} onChange={onFocusChange}>
                <option value="">Everyone</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            {(hideAuto || focusPlayerId) && (
              <button
                type="button"
                className={styles.filterClear}
                onClick={() => { setHideAuto(false); setFocusPlayerId(''); }}
              >
                Clear
              </button>
            )}
          </div>

          {filteredTokens.length === 0 ? (
            <div className={styles.diffEmpty}>No arrows match the current filters.</div>
          ) : (
            <RevealGraph
              players={players.filter((p) => filteredTokens.some(
                (t) => t.placerId === p.id || t.targetId === p.id,
              ))}
              tokens={filteredTokens}
            />
          )}

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
