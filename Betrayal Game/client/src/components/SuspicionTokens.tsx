import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { SuspicionToken, SuspicionTokenPhase, SuspicionTokenErrorCode, C2SEvent, Player } from '../types';
import { TOKEN_PLACEMENT_WINDOW_MS } from '../types';
import { RevealGraph } from './RevealGraph';
import { SuspicionTokenHistoryPanel } from './SuspicionTokenHistoryPanel';
import { useRovingFocus } from '../hooks/useRovingFocus';
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

  const [announcement, setAnnouncement] = useState('');

  const placement = phase === 'PLACEMENT';

  const candidateIds =
    placement && isAlive
      ? alive.filter((p) => p.id !== myPlayerId).map((p) => p.id)
      : [];
  const playerName = (id: string): string =>
    alive.find((p) => p.id === id)?.name ?? 'player';
  const roving = useRovingFocus({
    itemIds: candidateIds,
    preferredId: myTokenTargetId ?? null,
    onActivate: (id) => {
      handlePick(id);
      setAnnouncement(`Token cast on ${playerName(id)}.`);
    },
    onCancel: () => {
      // The Suspicion Token is committed to the server on activation, so
      // there is no pending state to drop. Confirm the current cast (or
      // the lack of one) so keyboard users get audible feedback.
      if (myTokenTargetId) {
        setAnnouncement(
          `Suspicion Token still cast on ${playerName(myTokenTargetId)}. Pick another suspect to change it.`,
        );
      } else {
        setAnnouncement('No Suspicion Token cast yet.');
      }
    },
  });

  useEffect(() => {
    if (placement && isAlive) {
      setAnnouncement(
        'Place your Suspicion Token. Use arrow keys to move, Enter or Space to cast on a suspect.',
      );
    } else if (placement && !isAlive) {
      setAnnouncement('Spectator — you cannot cast a Suspicion Token.');
    } else {
      setAnnouncement('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placement, isAlive]);
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
        <div role="status" aria-live="polite" className={styles.srOnly}>
          {announcement}
        </div>
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

            <div
              className={styles.targets}
              role="radiogroup"
              aria-label="Suspicion Token targets"
            >
              {alive.map((p) => {
                const isSelf = p.id === myPlayerId;
                const selected = myTokenTargetId === p.id;
                const disabled = !isAlive || isSelf;
                const itemProps = !disabled ? roving.getItemProps(p.id) : null;
                const accessibleName = isSelf
                  ? `${p.name} (you, cannot vote for yourself)`
                  : p.name;
                return (
                  <button
                    {...(itemProps ?? {})}
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={accessibleName}
                    className={`${styles.target} ${selected ? styles.targetSelected : ''}`}
                    onClick={() => handlePick(p.id)}
                    disabled={disabled}
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
