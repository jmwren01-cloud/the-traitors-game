import { useState } from 'react';
import type { Player, C2SEvent, Vote, VoteTally } from '../types';
import { getColorHex, getAvatarEmoji } from '../avatarConstants';
import styles from './HostDashboard.module.css';

interface HostDashboardProps {
  players: Player[];
  myPlayerId?: string;
  phase: string;
  votes?: Vote[];
  revealedVotes?: Vote[];
  currentTally?: VoteTally[];
  voteCount?: { received: number; needed: number };
  murderVoteProgress?: { received: number; needed: number };
  murderVoterIds?: string[];
  traitorIds?: string[];
  currentRound?: number;
  tiedPlayerIds?: string[];
  onSend: (event: C2SEvent) => void;
}

const VOTING_PHASES = ['VOTING', 'VOTE_REVEAL', 'REVOTE'];
const NIGHT_PHASES = ['NIGHT'];

export function HostDashboard({
  players,
  myPlayerId,
  phase,
  votes,
  revealedVotes,
  currentTally,
  voteCount,
  murderVoteProgress,
  murderVoterIds,
  traitorIds,
  currentRound,
  tiedPlayerIds,
  onSend,
}: HostDashboardProps) {
  const [open, setOpen] = useState(false);

  const isHost = players.find((p) => p.id === myPlayerId)?.isHost;
  if (!isHost) return null;

  const isRound1 = currentRound === 1;
  const showVotePanel = VOTING_PHASES.includes(phase);
  const showNightPanel = NIGHT_PHASES.includes(phase);

  // Phases where the host MUST press a button to advance the game.
  // VOTING/REVOTE/CHALLENGE are excluded — those buttons are optional
  // (force-resolve / end-early) and don't actually block progress.
  const ALWAYS_ACTION_PHASES = new Set([
    'ROLE_ASSIGN',
    'ROLE_REVEAL',
    'ROUNDTABLE',
    'TIE_DETECTED',
    'TIEBREAKER_REVEAL',
    'BANISH_REVEAL',
    'MORNING',
    'CHALLENGE_RESULT',
  ]);
  const voteRevealComplete =
    phase === 'VOTE_REVEAL' &&
    !!voteCount &&
    (revealedVotes?.length ?? 0) >= voteCount.needed;
  const actionRequired =
    !open && (ALWAYS_ACTION_PHASES.has(phase) || voteRevealComplete);

  const getPlayerName = (id: string) => players.find((p) => p.id === id)?.name ?? id;

  const activeVotes = revealedVotes && revealedVotes.length > 0 ? revealedVotes : (votes ?? []);
  const sortedTally = currentTally ? [...currentTally].sort((a, b) => b.voteCount - a.voteCount) : [];

  const renderControls = () => {
    switch (phase) {
      case 'ROLE_ASSIGN':
        return (
          <button className={styles.controlBtn} onClick={() => onSend({ type: 'C2S_ASSIGN_ROLES', payload: {} })}>
            Assign Roles
          </button>
        );
      case 'ROLE_REVEAL':
        return (
          <button className={styles.controlBtn} onClick={() => onSend({ type: 'C2S_START_ROUNDTABLE', payload: {} })}>
            Continue to Roundtable
          </button>
        );
      case 'ROUNDTABLE':
        return isRound1 ? (
          <button className={styles.controlBtn} onClick={() => onSend({ type: 'C2S_START_NIGHT', payload: {} })}>
            Proceed to Night
          </button>
        ) : (
          <button className={styles.controlBtn} onClick={() => onSend({ type: 'C2S_START_VOTING', payload: {} })}>
            Start Voting
          </button>
        );
      case 'VOTING':
      case 'REVOTE':
        return voteCount && voteCount.received < voteCount.needed ? (
          <button className={styles.controlBtnDanger} onClick={() => onSend({ type: 'C2S_FORCE_RESOLVE_VOTING', payload: {} })}>
            Force Resolve ({voteCount.needed - voteCount.received} auto-votes)
          </button>
        ) : null;
      case 'VOTE_REVEAL': {
        const totalVotes = revealedVotes?.length ?? 0;
        const revealComplete = totalVotes > 0 && voteCount && totalVotes >= voteCount.needed;
        if (!revealComplete) return <p className={styles.controlHint}>Votes are being revealed…</p>;
        const topCount = sortedTally[0]?.voteCount ?? 0;
        const isTie = sortedTally.filter((t) => t.voteCount === topCount && topCount > 0).length > 1;
        return (
          <button className={styles.controlBtnDanger} onClick={() => onSend({ type: 'C2S_BANISH_PLAYER', payload: {} })}>
            {isTie ? 'Proceed to Revote' : 'Banish Player'}
          </button>
        );
      }
      case 'TIE_DETECTED':
        return (
          <button className={styles.controlBtn} onClick={() => onSend({ type: 'C2S_START_REVOTE', payload: {} })}>
            Start Revote
          </button>
        );
      case 'TIEBREAKER_REVEAL':
      case 'BANISH_REVEAL':
        return (
          <button className={styles.controlBtn} onClick={() => onSend({ type: 'C2S_CHECK_WIN', payload: {} })}>
            Continue
          </button>
        );
      case 'MORNING':
        return (
          <button className={styles.controlBtn} onClick={() => onSend({ type: 'C2S_CONTINUE_TO_DAY', payload: {} })}>
            Continue to Roundtable
          </button>
        );
      case 'CHALLENGE':
        return (
          <button className={styles.controlBtnSecondary} onClick={() => onSend({ type: 'C2S_CONTINUE_TO_ROUNDTABLE', payload: {} })}>
            End Challenge
          </button>
        );
      case 'CHALLENGE_RESULT':
        return (
          <button className={styles.controlBtn} onClick={() => onSend({ type: 'C2S_CONTINUE_TO_ROUNDTABLE', payload: {} })}>
            Continue to Discussion
          </button>
        );
      default:
        return <p className={styles.controlHint}>No actions available</p>;
    }
  };

  return (
    <>
      <button
        className={`${styles.toggleBtn} ${open ? styles.toggleBtnOpen : ''} ${actionRequired ? styles.toggleBtnAttention : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={actionRequired ? 'Host action required — open dashboard' : 'Toggle host dashboard'}
      >
        {open ? '✕' : '📋'}
        <span className={styles.toggleLabel}>{open ? 'Close' : 'Host'}</span>
      </button>

      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)} />
      )}

      <div className={`${styles.panel} ${open ? styles.panelOpen : ''}`}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Host Dashboard</h2>
          <button className={styles.closeBtn} onClick={() => setOpen(false)}>✕</button>
        </div>

        <div className={styles.panelBody}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Controls</h3>
            <div className={styles.controlsGroup}>
              {renderControls()}
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Players ({players.length})</h3>
            <div className={styles.rosterList}>
              {players.map((player) => {
                const colorHex = getColorHex(player.color);
                const avatarEmoji = getAvatarEmoji(player.avatar);
                const isTraitor = player.role === 'TRAITOR' || (traitorIds?.includes(player.id));
                return (
                  <div
                    key={player.id}
                    className={`${styles.rosterRow} ${!player.isAlive ? styles.rosterDead : ''}`}
                    style={{ borderLeftColor: colorHex }}
                  >
                    <div className={styles.rosterAvatar} style={{ background: colorHex, color: '#000' }}>
                      {avatarEmoji}
                    </div>
                    <div className={styles.rosterInfo}>
                      <span className={styles.rosterName}>
                        {player.name}
                        {player.id === myPlayerId && <span className={styles.youTag}>YOU</span>}
                      </span>
                      <div className={styles.rosterBadges}>
                        {player.role ? (
                          <span className={`${styles.roleBadge} ${isTraitor ? styles.traitorBadge : styles.faithfulBadge}`}>
                            {isTraitor ? 'TRAITOR' : 'FAITHFUL'}
                          </span>
                        ) : traitorIds?.includes(player.id) ? (
                          <span className={`${styles.roleBadge} ${styles.traitorBadge}`}>TRAITOR</span>
                        ) : null}
                        {!player.isAlive && <span className={styles.deadBadge}>DEAD</span>}
                        {player.hasShield && <span className={styles.shieldBadge}>🛡️</span>}
                        {player.isConnected === false && <span className={styles.disconnBadge}>AWAY</span>}
                      </div>
                    </div>
                    <div className={`${styles.connDot} ${player.isConnected === false ? styles.connDotOff : styles.connDotOn}`} />
                  </div>
                );
              })}
            </div>
          </section>

          {showVotePanel && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>
                Vote Breakdown
                {voteCount && (
                  <span className={styles.sectionMeta}>{voteCount.received}/{voteCount.needed}</span>
                )}
              </h3>

              {activeVotes.length > 0 ? (
                <div className={styles.voteMatrix}>
                  {activeVotes.map((vote, i) => {
                    const voterName = getPlayerName(vote.voterId);
                    const targetName = getPlayerName(vote.targetId);
                    const voterPlayer = players.find((p) => p.id === vote.voterId);
                    const targetPlayer = players.find((p) => p.id === vote.targetId);
                    return (
                      <div key={i} className={`${styles.voteRow} ${vote.isAutoVote ? styles.autoVoteRow : ''}`}>
                        <div className={styles.voteAvatar} style={{ background: getColorHex(voterPlayer?.color), color: '#000' }}>
                          {getAvatarEmoji(voterPlayer?.avatar)}
                        </div>
                        <span className={styles.voteName}>{voterName}</span>
                        <span className={styles.voteArrow}>→</span>
                        <div className={styles.voteAvatar} style={{ background: getColorHex(targetPlayer?.color), color: '#000' }}>
                          {getAvatarEmoji(targetPlayer?.avatar)}
                        </div>
                        <span className={styles.voteName}>{targetName}</span>
                        {vote.isAutoVote && <span className={styles.autoTag}>AUTO</span>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.emptyText}>No votes yet</p>
              )}

              {sortedTally.length > 0 && (
                <div className={styles.tallySection}>
                  <h4 className={styles.tallyTitle}>Running Tally</h4>
                  {sortedTally.map((t) => {
                    const p = players.find((pl) => pl.id === t.playerId);
                    const colorHex = getColorHex(p?.color);
                    const total = sortedTally.reduce((acc, x) => acc + x.voteCount, 0) || 1;
                    return (
                      <div key={t.playerId} className={styles.tallyRow}>
                        <div className={styles.voteAvatar} style={{ background: colorHex, color: '#000' }}>
                          {getAvatarEmoji(p?.avatar)}
                        </div>
                        <span className={styles.tallyName}>{t.playerName}</span>
                        <div className={styles.tallyBar}>
                          <div
                            className={styles.tallyFill}
                            style={{ width: `${(t.voteCount / total) * 100}%`, background: colorHex }}
                          />
                        </div>
                        <span className={styles.tallyCount}>{t.voteCount}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {tiedPlayerIds && tiedPlayerIds.length > 0 && phase === 'REVOTE' && (
                <div className={styles.tieBanner}>
                  Revote between: {tiedPlayerIds.map(getPlayerName).join(', ')}
                </div>
              )}
            </section>
          )}

          {showNightPanel && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>
                Murder Votes
                {murderVoteProgress && (
                  <span className={styles.sectionMeta}>{murderVoteProgress.received}/{murderVoteProgress.needed}</span>
                )}
              </h3>
              {traitorIds && traitorIds.length > 0 ? (
                <div className={styles.murderList}>
                  {traitorIds.map((tid) => {
                    const traitor = players.find((p) => p.id === tid);
                    if (!traitor) return null;
                    const hasVoted = murderVoterIds?.includes(tid) ?? false;
                    const colorHex = getColorHex(traitor.color);
                    return (
                      <div key={tid} className={`${styles.murderRow} ${hasVoted ? styles.murderVoted : ''}`}>
                        <div className={styles.voteAvatar} style={{ background: colorHex, color: '#000' }}>
                          {getAvatarEmoji(traitor.avatar)}
                        </div>
                        <span className={styles.voteName}>{traitor.name}</span>
                        <span className={styles.murderStatus}>{hasVoted ? '✓ Voted' : '⏳ Waiting'}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.emptyText}>No traitor data</p>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
