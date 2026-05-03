import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type { Player, SuspicionToken } from '../types';
import styles from './SuspicionTokens.module.css';

// Static SVG directed graph: players on a circle, arrows from placer
// -> target. Auto-backfill arrows are dashed + amber. Shared by the
// in-game Suspicion Token reveal, the in-game past-suspicions panel,
// and the post-game replay so all three views look identical.
export function RevealGraph(props: { players: Player[]; tokens: SuspicionToken[] }): ReactElement {
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
