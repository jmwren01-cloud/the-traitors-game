import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { SuspicionToken, SuspicionTokenPhase, SuspicionTokenErrorCode, C2SEvent, Player } from '../types';
import { TOKEN_PLACEMENT_WINDOW_MS } from '../types';
import { RevealGraph } from './RevealGraph';
import { SuspicionTokenHistoryPanel } from './SuspicionTokenHistoryPanel';
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

        <SuspicionTokenHistoryPanel
          players={players}
          {...(pastRounds !== undefined ? { byRound: pastRounds } : {})}
        />
      </div>
    </div>
  );
}
