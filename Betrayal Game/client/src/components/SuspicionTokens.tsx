import { useEffect, useMemo, useState } from 'react';
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
  tokenError?: { code: SuspicionTokenErrorCode; message: string };
  onSend: (event: C2SEvent) => void;
  onClearError: () => void;
}

/**
 * Wave 4 / 5 — Suspicion Tokens overlay. Mounted between Roundtable
 * discussion and Voting. Two states:
 *   - PLACEMENT: 45s window. Alive players pick one alive non-self
 *     target. We send `C2S_PLACE_SUSPICION_TOKEN` and lock our pick on
 *     the private echo. Public progress is shown without identities.
 *   - REVEAL: 5s hold. Server-resolved directed graph (placer -> target)
 *     is rendered as an SVG with auto-backfill flagged.
 *
 * Spectators see the same overlay (read-only) so they aren't dropped
 * into a confusing blank screen.
 */
export function SuspicionTokens(props: Props): JSX.Element {
  const {
    phase, players, myPlayerId, isAlive,
    windowEndsAt, revealEndsAt, submittedCount, totalCount,
    myTokenTargetId, tokens, tokenError, onSend, onClearError,
  } = props;

  const [now, setNow] = useState(Date.now);
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
    if (!placement || !isAlive || myTokenTargetId !== undefined) return;
    if (targetId === myPlayerId) return;
    onClearError();
    onSend({ type: 'C2S_PLACE_SUSPICION_TOKEN', payload: { targetId } });
  };

  return (
    <div className={styles.overlay} role="dialog" aria-label="Suspicion Tokens">
      <div className={styles.card}>
        <h2 className={styles.title}>
          {placement ? 'Place Your Suspicion Token' : 'Suspicion Tokens'}
        </h2>
        <p className={styles.subtitle}>
          {placement
            ? 'One token. One suspect. Public to the table.'
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
                const disabled =
                  !isAlive || isSelf || (myTokenTargetId !== undefined && !selected);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.target} ${selected ? styles.targetSelected : ''}`}
                    onClick={() => handlePick(p.id)}
                    disabled={disabled}
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

            {myTokenTargetId !== undefined && (
              <div className={styles.locked}>
                Token cast. Awaiting the rest of the table…
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
      </div>
    </div>
  );
}

/**
 * Static SVG directed graph: alive players placed evenly around a
 * circle; arrows go from placer -> target. Auto-backfill arrows are
 * dashed + amber so the table can tell them apart from real picks.
 */
function RevealGraph(props: { players: Player[]; tokens: SuspicionToken[] }): JSX.Element {
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
