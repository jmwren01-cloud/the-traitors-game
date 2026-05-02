import { useEffect, useState } from 'react';
import type { Player, Role, GamePhase, Vote } from '../types';
import styles from './HUD.module.css';

interface HUDProps {
  phase: GamePhase;
  myPlayerId?: string;
  myRole?: Role;
  players: Player[];
  traitorIds?: string[];
  currentRound?: number;
  voteCount?: { received: number; needed: number };
  votes?: Vote[];
  banishedName?: string;
}

function phaseLabel(phase: string, currentRound?: number): string {
  switch (phase) {
    case 'ROUNDTABLE':
      return `Round ${currentRound ?? 1} — Discussion`;
    case 'VOTING':
      return `Round ${currentRound ?? 1} — Vote`;
    case 'REVOTE':
      return `Round ${currentRound ?? 1} — Revote`;
    case 'VOTE_REVEAL':
      return 'Revealing Votes…';
    case 'TIE_DETECTED':
      return "It's a Tie";
    case 'TIEBREAKER_REVEAL':
      return 'Tiebreaker';
    case 'BANISH_REVEAL':
      return 'Banishment';
    case 'CHECK_WIN':
      return 'Resolving…';
    case 'NIGHT':
      return `Night ${currentRound ?? 1}`;
    case 'MORNING':
      return `Morning ${currentRound ?? 1}`;
    case 'CHALLENGE':
      return 'Challenge';
    case 'CHALLENGE_RESULT':
      return 'Challenge Result';
    default:
      return phase;
  }
}

interface PromptOpts {
  phase: string;
  isAlive: boolean;
  isTraitor: boolean;
  hasMyVote: boolean;
  voteCount?: { received: number; needed: number };
  banishedName?: string;
}

function actionPrompt(opts: PromptOpts): string {
  const { phase, isAlive, isTraitor, hasMyVote, voteCount, banishedName } = opts;
  switch (phase) {
    case 'ROUNDTABLE':
      return isAlive
        ? 'Discuss. Who do you suspect?'
        : 'You have been eliminated. Watch silently.';
    case 'VOTING':
      if (!isAlive) return 'You cannot vote.';
      if (hasMyVote) {
        return voteCount
          ? `Vote cast. Waiting for others… (${voteCount.received}/${voteCount.needed} voted)`
          : 'Vote cast. Waiting for others…';
      }
      return 'Cast your vote — who is a Traitor?';
    case 'REVOTE':
      if (!isAlive) return 'You cannot vote.';
      if (hasMyVote) {
        return voteCount
          ? `Vote cast. Waiting for others… (${voteCount.received}/${voteCount.needed} voted)`
          : 'Vote cast. Waiting for others…';
      }
      return 'Tied vote — choose between the tied players.';
    case 'VOTE_REVEAL':
    case 'TIE_DETECTED':
    case 'TIEBREAKER_REVEAL':
      return 'Votes are being revealed…';
    case 'BANISH_REVEAL':
      return banishedName
        ? `${banishedName} has been banished.`
        : 'A decision has been made.';
    case 'CHECK_WIN':
      return 'Tallying the outcome…';
    case 'NIGHT':
      if (!isAlive) return 'You watch from the shadows.';
      return isTraitor
        ? 'Choose your victim.'
        : 'The Traitors are choosing their victim. Sleep well.';
    case 'MORNING':
      return 'A new day begins.';
    case 'CHALLENGE':
      return 'Complete the challenge before time runs out.';
    case 'CHALLENGE_RESULT':
      return 'Challenge complete.';
    default:
      return '';
  }
}

export function HUD({
  phase,
  myPlayerId,
  myRole,
  players,
  traitorIds,
  currentRound,
  voteCount,
  votes,
  banishedName,
}: HUDProps) {
  const [rosterOpen, setRosterOpen] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  // Auto-close roster on phase transition; never let a stale drawer leak
  // into a different phase where the visible info would be wrong.
  useEffect(() => {
    setRosterOpen(false);
  }, [phase]);

  // Trigger the gold action-prompt flash for ~600ms whenever the phase
  // changes. We toggle a class instead of remounting so the surrounding
  // DOM is stable.
  useEffect(() => {
    setFlashOn(true);
    const t = window.setTimeout(() => setFlashOn(false), 650);
    return () => window.clearTimeout(t);
  }, [phase]);

  const me = players.find((p) => p.id === myPlayerId);
  const isAlive = me?.isAlive ?? true;
  const isTraitor = myRole === 'TRAITOR';
  const aliveCount = players.filter((p) => p.isAlive).length;
  const hasMyVote =
    !!myPlayerId && (votes ?? []).some((v) => v.voterId === myPlayerId);

  const label = phaseLabel(phase, currentRound);
  const prompt = actionPrompt({
    phase,
    isAlive,
    isTraitor,
    hasMyVote,
    ...(voteCount !== undefined ? { voteCount } : {}),
    ...(banishedName !== undefined ? { banishedName } : {}),
  });

  // Only Traitors see daggers next to fellow Traitors. Faithful must never
  // be able to glean role info from the roster — we render no role tag for
  // any player except the local one.
  const traitorIdSet = new Set(traitorIds ?? []);
  const isFellowTraitor = (id: string) =>
    isTraitor && id !== myPlayerId && traitorIdSet.has(id);

  return (
    <>
      <div className={styles.hud} role="banner">
        <div className={styles.left}>
          <span
            className={`${styles.name} ${!isAlive ? styles.deadName : ''}`}
            title={me?.name}
          >
            {me?.name ?? 'You'}
          </span>
          {myRole && (
            <span
              className={`${styles.roleBadge} ${
                myRole === 'TRAITOR' ? styles.traitorBadge : styles.faithfulBadge
              }`}
            >
              {myRole}
            </span>
          )}
        </div>
        <div className={styles.center}>
          <span className={styles.phaseLabel}>{label}</span>
        </div>
        <button
          type="button"
          className={styles.aliveBtn}
          onClick={() => setRosterOpen((o) => !o)}
          aria-expanded={rosterOpen}
          aria-controls="hud-roster"
          aria-label={`${aliveCount} alive — ${rosterOpen ? 'hide' : 'show'} player list`}
        >
          <span className={styles.aliveIcon} aria-hidden>👥</span>
          <span className={styles.aliveCount}>{aliveCount} alive</span>
          <span className={styles.aliveChevron} aria-hidden>{rosterOpen ? '▴' : '▾'}</span>
        </button>
      </div>

      <div
        className={`${styles.promptBar} ${flashOn ? styles.flashOn : ''}`}
        aria-live="polite"
      >
        <span className={styles.promptText}>{prompt}</span>
      </div>

      {rosterOpen && (
        <>
          <div
            className={styles.rosterBackdrop}
            onClick={() => setRosterOpen(false)}
            aria-hidden
          />
          <div
            id="hud-roster"
            className={styles.rosterPanel}
            role="dialog"
            aria-label="Player roster"
          >
            <div className={styles.rosterHeader}>
              <span>Players ({aliveCount} alive)</span>
              <button
                type="button"
                className={styles.rosterClose}
                onClick={() => setRosterOpen(false)}
                aria-label="Close roster"
              >
                ✕
              </button>
            </div>
            <ul className={styles.rosterList}>
              {players.map((p) => {
                const fellow = isFellowTraitor(p.id);
                return (
                  <li
                    key={p.id}
                    className={`${styles.rosterRow} ${!p.isAlive ? styles.rosterDead : ''}`}
                  >
                    <span className={styles.rosterName}>
                      {p.name}
                      {p.id === myPlayerId && (
                        <span className={styles.youTag}> (you)</span>
                      )}
                    </span>
                    {fellow && (
                      <span
                        className={styles.daggerIcon}
                        title="Fellow Traitor"
                        aria-label="Fellow Traitor"
                      >
                        🗡️
                      </span>
                    )}
                    {!p.isAlive && (
                      <span className={styles.deadTag}>Eliminated</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
