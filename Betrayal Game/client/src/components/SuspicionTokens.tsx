import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Player, SuspicionToken, SuspicionTokenPhase, SuspicionTokenErrorCode, C2SEvent } from '../types';
import { TOKEN_PLACEMENT_WINDOW_MS } from '../types';
import styles from './SuspicionTokens.module.css';

interface Props {
  phase: SuspicionTokenPhase;
  players: Player[];
  myPlayerId?: string;
  isAlive: boolean;
  windowEndsAt?: number;
  revealEndsAt?: number;
  submittedCount?: number;
  totalCount?: number;
  myTokenTargetId?: string;
  tokens?: SuspicionToken[];
  pastRounds?: Record<number, SuspicionToken[]>;
  tokenError?: { code: SuspicionTokenErrorCode; message: string };
  onSend: (event: C2SEvent) => void;
  onClearError: () => void;
}

// Suspicion Token overlay shown between Roundtable discussion and
// Voting. PLACEMENT (45s): alive players pick — and may re-pick — one
// alive non-self target. REVEAL (5s): server-resolved directed graph.
// Spectators see a read-only view.
export function SuspicionTokens(props: Props): ReactElement {
  const {
    phase, players, myPlayerId, isAlive,
    windowEndsAt, revealEndsAt, submittedCount, totalCount,
    myTokenTargetId, tokens, pastRounds, tokenError, onSend, onClearError,
  } = props;

  const [now, setNow] = useState(Date.now);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const alive = useMemo(() => players.filter((p) => p.isAlive), [players]);

  const placement = phase === 'PLACEMENT';
  const endsAt = placement ? windowEndsAt : revealEndsAt;
  const totalDuration = placement ? TOKEN_PLACEMENT_WINDOW_MS : 5_000;
  const remaining = endsAt ? Math.max(0, endsAt - now) : 0;
  const fillPct = endsAt ? Math.max(0, Math.min(100, (remaining / totalDuration) * 100)) : 0;

  const handlePick = (targetId: string): void => {
    if (!placement || !isAlive) return;
    if (targetId === myPlayerId) return;
    if (targetId === myTokenTargetId) return;
    onClearError();
    onSend({ type: 'C2S_PLACE_SUSPICION_TOKEN', payload: { targetId } });
  };

  const pastRoundNumbers = useMemo(() => {
    if (!pastRounds) return [];
    return Object.keys(pastRounds)
      .map((k) => Number(k))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => b - a);
  }, [pastRounds]);

  return (
    <div className={styles.overlay} role="dialog" aria-label="Suspicion Tokens">
      <div className={styles.card}>
        <h2 className={styles.title}>
          {placement ? 'Place Your Suspicion Token' : 'Suspicion Tokens'}
        </h2>
        <p className={styles.subtitle}>
          {placement
            ? 'One token. One suspect. You may change your pick until time runs out.'
            : 'The chamber sees who you suspect.'}
        </p>

        <div className={styles.timerBar} aria-hidden>
          <div className={styles.timerFill} style={{ width: `${fillPct}%` }} />
        </div>

        {placement && (
          <>
            <div className={styles.progress}>
              {(submittedCount ?? 0)} of {(totalCount ?? alive.length)} placed
              {' • '}
              {Math.ceil(remaining / 1000)}s left
            </div>

            <div className={styles.targets}>
              {alive.map((p) => {
                const isSelf = p.id === myPlayerId;
                const selected = myTokenTargetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.target} ${selected ? styles.targetSelected : ''}`}
                    onClick={() => handlePick(p.id)}
                    disabled={!isAlive || isSelf}
                    aria-pressed={selected}
                  >
                    {p.name}{isSelf ? ' (you)' : ''}
                  </button>
                );
              })}
            </div>

            {tokenError && (
              <div className={styles.error} role="alert">{tokenError.message}</div>
            )}

            {myTokenTargetId !== undefined && isAlive && (
              <div className={styles.locked}>
                Token cast on {alive.find((p) => p.id === myTokenTargetId)?.name ?? '...'}.
                Tap another suspect to change your pick.
              </div>
            )}
            {!isAlive && (
              <div className={styles.locked}>
                Spectator — you cannot cast a Suspicion Token.
              </div>
            )}
          </>
        )}

        {phase === 'REVEAL' && (
          <RevealGraph players={alive} tokens={tokens ?? []} />
        )}

        {pastRoundNumbers.length > 0 && (
          <div className={styles.history}>
            <button
              type="button"
              className={styles.historyToggle}
              onClick={() => setHistoryOpen((v) => !v)}
              aria-expanded={historyOpen}
            >
              {historyOpen ? '▾' : '▸'} Past Suspicions ({pastRoundNumbers.length})
            </button>
            {historyOpen && (
              <div className={styles.historyList}>
                {pastRoundNumbers.map((round) => {
                  const roundTokens = pastRounds?.[round] ?? [];
                  return (
                    <div key={round} className={styles.historyRound}>
                      <div className={styles.historyRoundLabel}>Round {round}</div>
                      <ul className={styles.historyEdges}>
                        {roundTokens.map((t, i) => {
                          const placerName = players.find((p) => p.id === t.placerId)?.name ?? '?';
                          const targetName = players.find((p) => p.id === t.targetId)?.name ?? '?';
                          return (
                            <li key={`${t.placerId}-${t.targetId}-${i}`}>
                              {placerName} → {targetName}
                              {t.isAuto && <span className={styles.autoNote}> (auto)</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Static SVG directed graph: alive players on a circle, arrows from
// placer -> target. Auto-backfill arrows are dashed + amber.
function RevealGraph(props: { players: Player[]; tokens: SuspicionToken[] }): ReactElement {
  const { players, tokens } = props;
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 44;

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; name: string }>();
    const n = players.length;
    players.forEach((p, i) => {
      const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / Math.max(1, n);
      map.set(p.id, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        name: p.name,
      });
    });
    return map;
  }, [players, cx, cy, radius]);

  const autoCount = tokens.filter((t) => t.isAuto).length;

  return (
    <div className={styles.graphWrap}>
      <svg
        className={styles.graphSvg}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Suspicion Token graph"
      >
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5"
                  orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L10,5 L0,10 z" fill="#d9b6ff" />
          </marker>
          <marker id="arrowAuto" markerWidth="10" markerHeight="10" refX="8" refY="5"
                  orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L10,5 L0,10 z" fill="#ffb84d" />
          </marker>
        </defs>
        {tokens.map((t, i) => {
          const a = positions.get(t.placerId);
          const b = positions.get(t.targetId);
          if (!a || !b) return null;
          const stroke = t.isAuto ? '#ffb84d' : '#d9b6ff';
          const dash = t.isAuto ? '4 4' : undefined;
          return (
            <line
              key={`${t.placerId}-${t.targetId}-${i}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={stroke}
              strokeWidth={2}
              strokeOpacity={0.85}
              strokeDasharray={dash}
              markerEnd={t.isAuto ? 'url(#arrowAuto)' : 'url(#arrow)'}
            />
          );
        })}
        {[...positions.entries()].map(([id, p]) => (
          <g key={id}>
            <circle cx={p.x} cy={p.y} r={18} fill="#34245a" stroke="#7a4dc2" strokeWidth={2} />
            <text
              x={p.x} y={p.y + 32}
              fill="#f0e6ff" fontSize={11} textAnchor="middle"
              fontFamily="system-ui, sans-serif"
            >
              {p.name.length > 10 ? p.name.slice(0, 10) + '…' : p.name}
            </text>
          </g>
        ))}
      </svg>
      {autoCount > 0 && (
        <div className={styles.legend}>
          <span className={styles.autoNote}>Dashed amber arrows</span> = auto-assigned (no pick in time)
        </div>
      )}
    </div>
  );
}
