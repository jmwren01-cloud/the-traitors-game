import { useEffect, useMemo, useState } from 'react';
import type { C2SEvent, ConfessionReveal } from '../types';
import { CONFESSION_MAX_LENGTH, CONFESSION_MIN_LENGTH, CONFESSION_WINDOW_MS } from '../types';
import styles from './ConfessionBooth.module.css';

interface Props {
  /** 'BOOTH' = compose; 'DISCUSSION' = reveal cards. */
  phase: 'BOOTH' | 'DISCUSSION';
  /** Reveal payload (only used in DISCUSSION). */
  reveals?: ConfessionReveal[];
  /** Unix-ms deadline for the booth countdown. */
  endsAt?: number;
  /** Public progress (compose phase). */
  submittedCount?: number;
  totalCount?: number;
  /** Whether the local player is alive (dead players don't compose). */
  isAlive: boolean;
  /** Whether the local player has already submitted. */
  hasSubmitted: boolean;
  onSubmit: (event: C2SEvent) => void;
  /** Dismiss the reveal overlay locally and begin discussion. */
  onBeginDiscussion: () => void;
  /** Notify parent that we just submitted (for local mySubmittedConfession). */
  onLocalSubmitted: () => void;
}

export function ConfessionBooth({
  phase, reveals, endsAt, submittedCount, totalCount,
  isAlive, hasSubmitted, onSubmit, onBeginDiscussion, onLocalSubmitted,
}: Props) {
  const [text, setText] = useState('');
  const [now, setNow] = useState(Date.now());

  // 10Hz tick while the booth is open — drives the countdown bar.
  useEffect(() => {
    if (phase !== 'BOOTH' || !endsAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [phase, endsAt]);

  const remainingMs = Math.max(0, (endsAt ?? now) - now);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const totalDuration = CONFESSION_WINDOW_MS;
  const drainPct = Math.min(100, Math.max(0, (remainingMs / totalDuration) * 100));

  const trimmed = text.trim();
  const charLen = trimmed.length;
  const canSubmit =
    !hasSubmitted &&
    isAlive &&
    charLen >= CONFESSION_MIN_LENGTH &&
    charLen <= CONFESSION_MAX_LENGTH;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ type: 'C2S_SUBMIT_CONFESSION', payload: { content: trimmed } });
    onLocalSubmitted();
  };

  const orderedReveals = useMemo(() => reveals ?? [], [reveals]);

  if (phase === 'BOOTH') {
    return (
      <div className={styles.overlay} role="dialog" aria-label="Confession Booth">
        <div className={styles.booth}>
          <div className={styles.flameRow} aria-hidden>
            <span className={styles.flame}>🕯️</span>
            <span className={styles.flame}>🕯️</span>
            <span className={styles.flame}>🕯️</span>
          </div>
          <h2 className={styles.title}>The Confession Booth</h2>
          <p className={styles.subtitle}>
            Whisper one anonymous statement. Every player will hear it — but no
            one will know it was you.
          </p>

          <div className={styles.timerBar} aria-label={`${remainingSec} seconds remaining`}>
            <div
              className={styles.timerFill}
              style={{ width: `${drainPct}%` }}
            />
            <div className={styles.timerLabel}>{remainingSec}s</div>
          </div>

          {isAlive ? (
            hasSubmitted ? (
              <div className={styles.recorded}>
                <div className={styles.recordedIcon}>✓</div>
                <div className={styles.recordedText}>Your confession has been recorded.</div>
                <div className={styles.recordedHint}>
                  Waiting for the others… ({submittedCount ?? 0} of {totalCount ?? 0})
                </div>
              </div>
            ) : (
              <>
                <textarea
                  className={styles.textarea}
                  placeholder="Speak your truth — or your lie…"
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, CONFESSION_MAX_LENGTH))}
                  maxLength={CONFESSION_MAX_LENGTH}
                  rows={4}
                  autoFocus
                />
                <div className={styles.counterRow}>
                  <span
                    className={
                      charLen < CONFESSION_MIN_LENGTH || charLen > CONFESSION_MAX_LENGTH
                        ? styles.counterBad
                        : styles.counter
                    }
                  >
                    {charLen}/{CONFESSION_MAX_LENGTH}
                  </span>
                  <span className={styles.progress}>
                    {submittedCount ?? 0} of {totalCount ?? 0} confessed
                  </span>
                </div>
                <button
                  className={styles.submitBtn}
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                >
                  Confess
                </button>
                {charLen > 0 && charLen < CONFESSION_MIN_LENGTH && (
                  <div className={styles.hint}>
                    At least {CONFESSION_MIN_LENGTH} characters.
                  </div>
                )}
              </>
            )
          ) : (
            <div className={styles.recorded}>
              <div className={styles.recordedText}>You are watching from beyond.</div>
              <div className={styles.recordedHint}>
                {submittedCount ?? 0} of {totalCount ?? 0} confessed
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // DISCUSSION — show reveal cards.
  return (
    <div className={styles.overlay} role="dialog" aria-label="Confessions revealed">
      <div className={styles.boothReveal}>
        <h2 className={styles.title}>Anonymous Confessions</h2>
        <p className={styles.subtitle}>
          {orderedReveals.length} statement{orderedReveals.length === 1 ? '' : 's'} from
          the booth, in random order.
        </p>
        <ol className={styles.cardList}>
          {orderedReveals.map((r, i) => (
            <li
              key={r.id}
              className={styles.card}
              style={{ animationDelay: `${0.12 * i}s` }}
            >
              <span className={styles.cardMark}>“</span>
              <span className={styles.cardText}>{r.text}</span>
            </li>
          ))}
        </ol>
        <button className={styles.submitBtn} onClick={onBeginDiscussion}>
          Begin Discussion
        </button>
      </div>
    </div>
  );
}
