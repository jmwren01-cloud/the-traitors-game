import { useState, useEffect } from 'react';
import type { Player, C2SEvent, GamePhase, TimerState, Vote } from '../types';
import styles from './HostPanel.module.css';

interface HostPanelProps {
  players: Player[];
  myPlayerId?: string;
  phase: GamePhase;
  currentRound?: number;
  voteCount?: { received: number; needed: number };
  votes?: Vote[];
  revealedVotes?: Vote[];
  murderVoteProgress?: { received: number; needed: number };
  murderVoterIds?: string[];
  traitorIds?: string[];
  timer?: TimerState;
  tiedPlayerIds?: string[];
  canStartGame?: boolean;
  minPlayers?: number;
  round1DiscussionOnly?: boolean;
  onSend: (event: C2SEvent) => void;
}

type ConfirmKey =
  | 'force_resolve_voting'
  | 'transfer_host'
  | 'end_game';

const PHASE_LABELS: Record<GamePhase, string> = {
  LOBBY: 'Lobby',
  ROLE_ASSIGN: 'Assigning Roles',
  ROLE_REVEAL: 'Role Reveal',
  CHALLENGE: 'Shield Challenge',
  CHALLENGE_RESULT: 'Challenge Result',
  ROUNDTABLE: 'Roundtable',
  VOTING: 'Voting',
  VOTE_REVEAL: 'Vote Reveal',
  TIE_DETECTED: 'Tie Detected',
  REVOTE: 'Revote',
  TIEBREAKER_REVEAL: 'Tiebreaker',
  BANISH_REVEAL: 'Banishment',
  CHECK_WIN: 'Checking Win',
  NIGHT: 'Night',
  MORNING: 'Morning',
  GAME_END: 'Game Over',
};

function useTimerSeconds(timer: TimerState | undefined, phase: GamePhase): number | null {
  const [now, setNow] = useState(Date.now());
  const active = !!timer && timer.phase === phase;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [active]);
  if (!active || !timer) return null;
  return Math.max(0, Math.ceil((timer.endTime - now) / 1000));
}

export function HostPanel(props: HostPanelProps) {
  const {
    players, myPlayerId, phase, currentRound,
    voteCount, votes, revealedVotes, murderVoteProgress, murderVoterIds, traitorIds,
    timer, canStartGame, minPlayers, round1DiscussionOnly,
    onSend,
  } = props;

  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmKey | null>(null);
  const [transferTarget, setTransferTarget] = useState<string>('');
  const [dangerOpen, setDangerOpen] = useState(false);
  const remainingSeconds = useTimerSeconds(timer, phase);

  // Close drawer + reset confirms when phase changes so stale prompts don't linger.
  useEffect(() => {
    setConfirm(null);
  }, [phase]);

  const isHost = players.find((p) => p.id === myPlayerId)?.isHost ?? false;
  if (!isHost) return null;

  const alivePlayers = players.filter((p) => p.isAlive);
  const aliveCount = alivePlayers.length;
  const totalCount = players.length;

  const voterSet = new Set((votes ?? []).map((v) => v.voterId));
  const unvotedPlayers = (phase === 'VOTING' || phase === 'REVOTE')
    ? alivePlayers.filter((p) => !voterSet.has(p.id))
    : [];

  const murderVoterSet = new Set(murderVoterIds ?? []);
  const unvotedTraitors = (phase === 'NIGHT' && traitorIds)
    ? players.filter((p) => p.isAlive && traitorIds.includes(p.id) && !murderVoterSet.has(p.id))
    : [];

  const transferTargets = players.filter((p) => p.id !== myPlayerId);

  const actionNeeded = (() => {
    switch (phase) {
      case 'LOBBY': return !!canStartGame;
      case 'ROLE_ASSIGN':
      case 'ROLE_REVEAL':
      case 'ROUNDTABLE':
      case 'TIE_DETECTED':
      case 'BANISH_REVEAL':
      case 'TIEBREAKER_REVEAL':
      case 'MORNING':
      case 'CHALLENGE_RESULT':
        return true;
      // Once every vote has been revealed in VOTE_REVEAL the host
      // must advance to banishment — until the reveal stream finishes
      // we don't pulse. Falls back to comparing against `votes.length`
      // when `voteCount` isn't in the reconnect payload.
      case 'VOTE_REVEAL': {
        const revealed = revealedVotes?.length ?? 0;
        const needed = voteCount?.needed ?? votes?.length ?? 0;
        return needed > 0 && revealed >= needed;
      }
      default: return false;
    }
  })();

  const sendEvent = (e: C2SEvent) => {
    onSend(e);
    setConfirm(null);
  };

  const renderConfirm = (key: ConfirmKey, label: string, onYes: () => void) => {
    if (confirm !== key) return null;
    return (
      <div className={styles.confirmRow} role="alert">
        <span className={styles.confirmText}>{label}</span>
        <div className={styles.confirmBtns}>
          <button className={styles.confirmYes} onClick={onYes}>Confirm</button>
          <button className={styles.confirmNo} onClick={() => setConfirm(null)}>Cancel</button>
        </div>
      </div>
    );
  };

  const renderControls = () => {
    switch (phase) {
      case 'LOBBY':
        return canStartGame ? (
          <button className={styles.controlBtn} onClick={() => sendEvent({ type: 'C2S_START_GAME', payload: {} })}>
            Start Game
          </button>
        ) : (
          <p className={styles.hint}>Need at least {minPlayers ?? 5} players to start.</p>
        );
      case 'ROLE_ASSIGN':
        return (
          <button className={styles.controlBtn} onClick={() => sendEvent({ type: 'C2S_ASSIGN_ROLES', payload: {} })}>
            Assign Roles
          </button>
        );
      case 'ROLE_REVEAL':
        return (
          <button className={styles.controlBtn} onClick={() => sendEvent({ type: 'C2S_START_ROUNDTABLE', payload: {} })}>
            Continue to Roundtable
          </button>
        );
      case 'ROUNDTABLE': {
        const round1Only = currentRound === 1 && round1DiscussionOnly;
        return (
          <button
            className={styles.controlBtn}
            onClick={() =>
              sendEvent(round1Only
                ? { type: 'C2S_START_NIGHT', payload: {} }
                : { type: 'C2S_START_VOTING', payload: {} })
            }
          >
            {round1Only ? 'End Discussion → Night' : 'End Discussion → Voting'}
          </button>
        );
      }
      case 'VOTING':
      case 'REVOTE': {
        const remaining = voteCount ? voteCount.needed - voteCount.received : 0;
        return (
          <>
            <p className={styles.statusLine}>
              {voteCount
                ? `${voteCount.received} / ${voteCount.needed} votes in`
                : 'Waiting for votes…'}
            </p>
            {unvotedPlayers.length > 0 && (
              <div className={styles.unvotedList}>
                <span className={styles.unvotedLabel}>Still to vote</span>
                <span className={styles.unvotedNames}>
                  {unvotedPlayers.map((p) => p.name).join(', ')}
                </span>
              </div>
            )}
            {remaining > 0 && (
              <>
                <button
                  className={styles.controlBtnDanger}
                  onClick={() => setConfirm('force_resolve_voting')}
                >
                  Force Resolve ({remaining} auto-vote{remaining !== 1 ? 's' : ''})
                </button>
                {renderConfirm(
                  'force_resolve_voting',
                  `Auto-vote for ${remaining} missing player${remaining !== 1 ? 's' : ''}?`,
                  () => sendEvent({ type: 'C2S_FORCE_RESOLVE_VOTING', payload: {} })
                )}
              </>
            )}
          </>
        );
      }
      case 'VOTE_REVEAL': {
        const revealed = revealedVotes?.length ?? 0;
        const needed = voteCount?.needed ?? votes?.length ?? 0;
        const revealComplete = needed > 0 && revealed >= needed;
        if (!revealComplete) {
          return <p className={styles.hint}>Votes are revealing… banish prompt will appear when complete.</p>;
        }
        return (
          <button className={styles.controlBtnDanger} onClick={() => sendEvent({ type: 'C2S_BANISH_PLAYER', payload: {} })}>
            Banish Player
          </button>
        );
      }
      case 'TIE_DETECTED':
        return (
          <button className={styles.controlBtn} onClick={() => sendEvent({ type: 'C2S_START_REVOTE', payload: {} })}>
            Start Revote
          </button>
        );
      case 'BANISH_REVEAL':
        return (
          <button className={styles.controlBtn} onClick={() => sendEvent({ type: 'C2S_CHECK_WIN', payload: {} })}>
            Continue to Night
          </button>
        );
      case 'TIEBREAKER_REVEAL':
        return (
          <button className={styles.controlBtn} onClick={() => sendEvent({ type: 'C2S_CHECK_WIN', payload: {} })}>
            Continue
          </button>
        );
      case 'NIGHT': {
        const remaining = murderVoteProgress ? murderVoteProgress.needed - murderVoteProgress.received : 0;
        return (
          <>
            <p className={styles.statusLine}>
              {murderVoteProgress
                ? `${murderVoteProgress.received} / ${murderVoteProgress.needed} murder votes in`
                : 'Waiting for the traitors…'}
            </p>
            {unvotedTraitors.length > 0 && (
              <div className={styles.unvotedList}>
                <span className={styles.unvotedLabel}>Traitors still to vote</span>
                <span className={styles.unvotedNames}>
                  {unvotedTraitors.map((p) => p.name).join(', ')}
                </span>
              </div>
            )}
            {remaining > 0 && (
              <p className={styles.hint}>Murder auto-resolves once all traitors vote.</p>
            )}
          </>
        );
      }
      case 'MORNING':
        return (
          <button className={styles.controlBtn} onClick={() => sendEvent({ type: 'C2S_CONTINUE_TO_DAY', payload: {} })}>
            Continue to Roundtable
          </button>
        );
      case 'CHALLENGE':
        return (
          <button className={styles.controlBtnSecondary} onClick={() => sendEvent({ type: 'C2S_CONTINUE_TO_ROUNDTABLE', payload: {} })}>
            End Challenge Early
          </button>
        );
      case 'CHALLENGE_RESULT':
        return (
          <button className={styles.controlBtn} onClick={() => sendEvent({ type: 'C2S_CONTINUE_TO_ROUNDTABLE', payload: {} })}>
            Continue to Discussion
          </button>
        );
      case 'GAME_END':
        return <p className={styles.hint}>The game is over.</p>;
      default:
        return <p className={styles.hint}>No host actions for this phase.</p>;
    }
  };

  return (
    <>
      <button
        className={`${styles.toggleBtn} ${actionNeeded && !open ? styles.toggleBtnPulse : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close host panel' : 'Open host panel'}
        aria-expanded={open}
      >
        <span className={styles.toggleIcon} aria-hidden>👑</span>
        <span>Host</span>
        {actionNeeded && !open && <span className={styles.redDot} aria-label="Action needed" />}
      </button>

      {open && <div className={styles.backdrop} onClick={() => setOpen(false)} aria-hidden />}

      <div
        className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}
        role="dialog"
        aria-label="Host control panel"
        aria-hidden={!open}
      >
        <div className={styles.drawerHandle} aria-hidden />
        <div className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>Host Controls</h2>
          <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Close panel">✕</button>
        </div>
        <div className={styles.drawerBody}>
          <div className={styles.statusGrid}>
            <div className={styles.statusItem}>
              <span className={styles.statusLabel}>Phase</span>
              <span className={styles.statusValue}>{PHASE_LABELS[phase] ?? phase}</span>
            </div>
            <div className={styles.statusItem}>
              <span className={styles.statusLabel}>Round</span>
              <span className={styles.statusValue}>{currentRound ?? '—'}</span>
            </div>
            <div className={styles.statusItem}>
              <span className={styles.statusLabel}>Alive</span>
              <span className={styles.statusValue}>{aliveCount}/{totalCount}</span>
            </div>
            <div className={styles.statusItem}>
              <span className={styles.statusLabel}>Timer</span>
              <span className={styles.statusValue}>
                {remainingSeconds !== null ? `${remainingSeconds}s` : '—'}
              </span>
            </div>
          </div>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Phase Controls</h3>
            <div className={styles.controlsGroup}>
              {renderControls()}
            </div>
          </section>

          <section className={styles.section}>
            <button
              type="button"
              className={styles.dangerToggle}
              onClick={() => setDangerOpen((v) => !v)}
              aria-expanded={dangerOpen}
            >
              ⚠ Danger Zone {dangerOpen ? '▾' : '▸'}
            </button>
            {dangerOpen && (
              <div className={styles.dangerBody}>
                <div className={styles.dangerItem}>
                  <label className={styles.dangerLabel} htmlFor="hp-transfer">Transfer Host</label>
                  <select
                    id="hp-transfer"
                    className={styles.dangerSelect}
                    value={transferTarget}
                    onChange={(e) => setTransferTarget(e.target.value)}
                  >
                    <option value="">Select a player…</option>
                    {transferTargets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.isConnected === false ? ' (away)' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    className={styles.dangerBtnSecondary}
                    disabled={!transferTarget}
                    onClick={() => setConfirm('transfer_host')}
                  >
                    Transfer Host
                  </button>
                  {renderConfirm(
                    'transfer_host',
                    `Hand off host to ${players.find((p) => p.id === transferTarget)?.name ?? 'this player'}?`,
                    () => {
                      sendEvent({ type: 'C2S_TRANSFER_HOST', payload: { targetPlayerId: transferTarget } });
                      setTransferTarget('');
                    }
                  )}
                </div>
                {phase !== 'LOBBY' && phase !== 'GAME_END' && (
                  <div className={styles.dangerItem}>
                    <button
                      className={styles.dangerBtn}
                      onClick={() => setConfirm('end_game')}
                    >
                      End Game Early
                    </button>
                    {renderConfirm(
                      'end_game',
                      'End the game now for everyone? No winner will be recorded.',
                      () => sendEvent({ type: 'C2S_END_GAME_EARLY', payload: {} })
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
