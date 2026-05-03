import { useEffect, useRef, useState } from 'react';
import styles from './HowToPlayModal.module.css';

interface HowToPlayModalProps {
  onClose: () => void;
}

interface Page {
  title: string;
  body: string;
  illoClass: string;
  illoContent?: React.ReactNode;
}

const PAGES: Page[] = [
  {
    title: 'Setup',
    body:
      '5 to 22 players. Most are Faithful — loyal to the castle. A small group are secretly Traitors. The host can configure how many Traitors before the game begins.',
    illoClass: 'illoSetup',
    illoContent: (
      <>
        <span className={styles.dotFaithful} />
        <span className={styles.dotFaithful} />
        <span className={styles.dotTraitor} />
        <span className={styles.dotFaithful} />
        <span className={styles.dotFaithful} />
      </>
    ),
  },
  {
    title: 'The Roundtable',
    body:
      'Each round opens with discussion. Talk, accuse, defend, lie. Read the room. The host ends the discussion when ready.',
    illoClass: 'illoRound',
    illoContent: (
      <>
        <span className={`${styles.ringDot} ${styles.ringDot1}`} />
        <span className={`${styles.ringDot} ${styles.ringDot2}`} />
        <span className={`${styles.ringDot} ${styles.ringDot3}`} />
        <span className={`${styles.ringDot} ${styles.ringDot4}`} />
        <span className={`${styles.ringDot} ${styles.ringDot5}`} />
        <span className={`${styles.ringDot} ${styles.ringDot6}`} />
      </>
    ),
  },
  {
    title: 'The Vote',
    body:
      'Every player votes privately to banish someone. The player with the most votes is banished and their role revealed. A tie triggers a revote between the tied candidates.',
    illoClass: 'illoVote',
    illoContent: (
      <>
        <span className={styles.ballotSlot} />
        <span className={styles.ballotPaper} />
      </>
    ),
  },
  {
    title: 'Night Falls',
    body:
      'After voting, the Faithful sleep. The Traitors meet in secret and choose one Faithful to murder. Daybreak reveals the body.',
    illoClass: 'illoNight',
    illoContent: (
      <>
        <span className={styles.moon} />
        <span className={styles.star1} />
        <span className={styles.star2} />
        <span className={styles.star3} />
      </>
    ),
  },
  {
    title: 'False Evidence',
    body:
      'During the night, the Traitors can secretly agree to plant ONE piece of false evidence — a Frame that taints a Sheriff read, a Fake Whisper "from" their target, or an Anonymous Tip. Used wisely, it can turn the castle against an innocent.',
    illoClass: 'illoNight',
    illoContent: <span className={styles.crown} />,
  },
  {
    title: 'How to Win',
    body:
      'Faithful win when every Traitor is banished. Traitors win the moment they equal or outnumber the Faithful. Trust no one.',
    illoClass: 'illoWin',
    illoContent: <span className={styles.crown} />,
  },
];

export function HowToPlayModal({ onClose }: HowToPlayModalProps) {
  const [page, setPage] = useState(0);
  const total = PAGES.length;
  const modalRef = useRef<HTMLDivElement>(null);

  // Lock background scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && page < total - 1) setPage(page + 1);
      else if (e.key === 'ArrowLeft' && page > 0) setPage(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, total, onClose]);

  // Focus management: focus the modal on mount, trap Tab inside it, restore
  // focus on close. Re-query focusables on page change since Back becomes
  // enabled/disabled.
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = Array.from(
      modal.querySelectorAll<HTMLElement>('button:not([disabled])')
    );
    if (focusables.length > 0) focusables[0].focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const current = Array.from(
        modal.querySelectorAll<HTMLElement>('button:not([disabled])')
      );
      if (current.length === 0) return;
      const first = current[0];
      const last = current[current.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    modal.addEventListener('keydown', trap);
    return () => {
      modal.removeEventListener('keydown', trap);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [page]);

  const current = PAGES[page];
  const onFirst = page === 0;
  const onLast = page === total - 1;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="htp-title"
      onClick={onClose}
    >
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
        tabIndex={-1}
      >
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close how to play"
        >
          ✕
        </button>

        <div className={styles.pageContent}>
          <div className={`${styles.illo} ${styles[current.illoClass]}`} aria-hidden>
            {current.illoContent}
          </div>
          <h2 id="htp-title" className={styles.title}>
            {current.title}
          </h2>
          <p className={styles.body}>{current.body}</p>
        </div>

        <div className={styles.dots} aria-hidden>
          {PAGES.map((_, i) => (
            <span
              key={i}
              className={`${styles.dot} ${i === page ? styles.dotActive : ''}`}
            />
          ))}
        </div>

        <div className={styles.nav}>
          <button
            type="button"
            className={styles.navBtnSecondary}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={onFirst}
          >
            ← Back
          </button>
          {onLast ? (
            <button
              type="button"
              className={styles.navBtnPrimary}
              onClick={onClose}
            >
              Got it
            </button>
          ) : (
            <button
              type="button"
              className={styles.navBtnPrimary}
              onClick={() => setPage((p) => Math.min(total - 1, p + 1))}
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
