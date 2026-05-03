import { useState, useEffect, useRef } from 'react';
import type { Player, C2SEvent, Role, EvidenceType, EvidenceVote, FalseEvidence } from '../types';
import { FALSE_EVIDENCE_CONTENT_MAX } from '../types';
import { getColorHex, getAvatarEmoji } from '../avatarConstants';
import styles from './NightPhase.module.css';
import { useSoundContext } from '../contexts/SoundContext';
import { vibrate } from '../utils/haptics';
import { useRovingFocus } from '../hooks/useRovingFocus';

interface NightPhaseProps {
  players: Player[];
  myPlayerId?: string;
  myRole?: Role;
  phase: string;
  currentRound?: number;
  aliveTraitorCount?: number;
  murderVoteProgress?: { received: number; needed: number };
  murderedPlayer?: { id: string; name: string };
  murderBlocked?: { shieldedPlayerId: string; shieldedPlayerName: string };
  /** Wave 4 — true when the Medic silently saved the Traitors' target. */
  medicBlocked?: boolean;
  traitorIds?: string[];
  myPlayerRecruitmentUsed?: boolean;
  justRecruited?: boolean;
  recruitedPlayer?: { id: string; name: string };
  nightRecruitmentSubmittedBy?: string;
  nightRecruitmentTargetName?: string;
  /** Wave 4 / 3 — False Evidence (traitor-only state). */
  evidenceUsed?: boolean;
  falseEvidence?: FalseEvidence;
  evidenceVotes?: EvidenceVote[];
  evidenceVoteProgress?: { received: number; needed: number };
  evidenceWindowEndsAt?: number;
  evidenceLastFailure?: 'SKIPPED' | 'NO_AGREEMENT' | 'TIMEOUT';
  onSend: (event: C2SEvent) => void;
}

export function NightPhase({
  players,
  myPlayerId,
  myRole,
  phase,
  currentRound,
  aliveTraitorCount,
  murderVoteProgress,
  murderedPlayer,
  murderBlocked,
  medicBlocked,
  traitorIds,
  myPlayerRecruitmentUsed,
  justRecruited,
  recruitedPlayer,
  nightRecruitmentSubmittedBy,
  nightRecruitmentTargetName,
  evidenceUsed,
  falseEvidence,
  evidenceVotes,
  evidenceVoteProgress,
  evidenceWindowEndsAt,
  evidenceLastFailure,
  onSend,
}: NightPhaseProps) {
  // Wave 4 / 3 — 1Hz countdown for the 60s unanimity window.
  const [nowTick, setNowTick] = useState<number>(Date.now());
  useEffect(() => {
    if (evidenceWindowEndsAt === undefined) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [evidenceWindowEndsAt]);
  // Wave 4 / 3 — False Evidence local UI state.
  const [evidenceType, setEvidenceType] = useState<EvidenceType | 'SKIP' | null>(null);
  const [evidenceTarget, setEvidenceTarget] = useState<string | null>(null);
  const [evidenceContent, setEvidenceContent] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [selectedRecruitTarget, setSelectedRecruitTarget] = useState<string | null>(null);
  // Polite live-region content for screen readers covering the night pickers.
  const [announcement, setAnnouncement] = useState('');
  const { play } = useSoundContext();
  const nightSoundPlayedRef = useRef(false);
  const morningSoundPlayedRef = useRef(false);
  const prevPhaseRef = useRef(phase);
  // Murder-vote progress audio: traitors hear a hard drum each time a
  // fellow traitor submits, then a long riser when the last one is in.
  const prevMurderReceivedRef = useRef(0);
  const justSubmittedMurderRef = useRef(false);
  const allMurderVotesInPlayedRef = useRef(false);
  // Cancel any pending audio cues on unmount/phase change so a riser
  // cannot fire after the phase has already advanced.
  const audioTimeoutsRef = useRef<Set<number>>(new Set());
  const scheduleAudio = (cb: () => void, delay: number) => {
    const id = window.setTimeout(() => {
      audioTimeoutsRef.current.delete(id);
      cb();
    }, delay);
    audioTimeoutsRef.current.add(id);
  };
  useEffect(() => {
    const timeouts = audioTimeoutsRef.current;
    return () => {
      for (const id of timeouts) window.clearTimeout(id);
      timeouts.clear();
    };
  }, []);

  useEffect(() => {
    if (phase !== prevPhaseRef.current) {
      if (phase === 'NIGHT') {
        nightSoundPlayedRef.current = false;
        prevMurderReceivedRef.current = 0;
        justSubmittedMurderRef.current = false;
        allMurderVotesInPlayedRef.current = false;
      } else if (phase === 'MORNING') {
        morningSoundPlayedRef.current = false;
      }
      prevPhaseRef.current = phase;
    }
  }, [phase]);

  // Murder-vote progress feedback (traitors only — Faithful are asleep).
  useEffect(() => {
    if (phase !== 'NIGHT') return;
    if (myRole !== 'TRAITOR') return;
    if (!murderVoteProgress) return;
    const cur = murderVoteProgress.received;
    const prev = prevMurderReceivedRef.current;
    if (cur > prev) {
      if (justSubmittedMurderRef.current) {
        justSubmittedMurderRef.current = false;
      } else {
        play('hardDrum');
      }
      if (
        !allMurderVotesInPlayedRef.current &&
        murderVoteProgress.needed > 0 &&
        cur >= murderVoteProgress.needed
      ) {
        allMurderVotesInPlayedRef.current = true;
        scheduleAudio(() => play('riserLong'), 200);
      }
    }
    prevMurderReceivedRef.current = cur;
  }, [phase, myRole, murderVoteProgress?.received, murderVoteProgress?.needed, play]);

  useEffect(() => {
    if (phase === 'NIGHT' && !nightSoundPlayedRef.current) {
      nightSoundPlayedRef.current = true;
      play('nightStart');
    }
  }, [phase, play]);

  useEffect(() => {
    if (phase === 'MORNING' && !morningSoundPlayedRef.current) {
      morningSoundPlayedRef.current = true;
      play('morningStart');
      if (murderedPlayer) {
        scheduleAudio(() => play('murder'), 500);
      }
    }
  }, [phase, murderedPlayer, play]);

  const isHost = players.find((p) => p.id === myPlayerId)?.isHost;
  const isTraitor = myRole === 'TRAITOR';
  const aliveFaithful = players.filter((p) => {
    if (!p.isAlive || p.id === myPlayerId) return false;
    if (traitorIds && traitorIds.length > 0) {
      return !traitorIds.includes(p.id);
    }
    return p.role !== 'TRAITOR';
  });
  const fellowTraitors = traitorIds 
    ? players.filter((p) => traitorIds.includes(p.id) && p.id !== myPlayerId && p.isAlive)
    : [];

  // Traitors may only frame Faithful-aligned players (server enforces).
  const traitorIdSet = new Set(traitorIds ?? []);
  const evidenceCandidates = players.filter(
    (p) => p.isAlive && p.id !== myPlayerId && !traitorIdSet.has(p.id),
  );

  const isNightTraitor = phase === 'NIGHT' && isTraitor;
  const murderPickerOpen = isNightTraitor && !hasVoted;
  const recruitPickerOpen =
    isNightTraitor && !myPlayerRecruitmentUsed && !nightRecruitmentSubmittedBy;
  const evidencePickerOpen =
    isNightTraitor && !evidenceUsed && !falseEvidence
    && evidenceType !== null && evidenceType !== 'SKIP';

  const playerName = (id: string) => players.find((p) => p.id === id)?.name ?? 'player';
  const announce = (msg: string) => setAnnouncement(msg);

  const murderRoving = useRovingFocus({
    itemIds: murderPickerOpen ? aliveFaithful.map((p) => p.id) : [],
    preferredId: selectedTarget,
    onActivate: (id) => {
      setSelectedTarget(id);
      announce(`Selected as victim: ${playerName(id)}.`);
    },
    onCancel: () => {
      if (selectedTarget) {
        setSelectedTarget(null);
        announce('Victim selection cleared.');
      }
    },
  });

  const recruitRoving = useRovingFocus({
    itemIds: recruitPickerOpen ? aliveFaithful.map((p) => p.id) : [],
    preferredId: selectedRecruitTarget,
    onActivate: (id) => {
      setSelectedRecruitTarget(id);
      announce(`Selected to recruit: ${playerName(id)}.`);
    },
    onCancel: () => {
      if (selectedRecruitTarget) {
        setSelectedRecruitTarget(null);
        announce('Recruitment selection cleared.');
      }
    },
  });

  const evidenceRoving = useRovingFocus({
    itemIds: evidencePickerOpen ? evidenceCandidates.map((p) => p.id) : [],
    preferredId: evidenceTarget,
    onActivate: (id) => {
      setEvidenceTarget(id);
      announce(`Selected as false-evidence target: ${playerName(id)}.`);
    },
    onCancel: () => {
      if (evidenceType === null && !evidenceTarget && !evidenceContent) return;
      setEvidenceType(null);
      setEvidenceTarget(null);
      setEvidenceContent('');
      announce('False-evidence selection cleared.');
    },
  });

  useEffect(() => {
    if (phase !== 'NIGHT' || !isTraitor) {
      setAnnouncement('');
    } else if (hasVoted) {
      setAnnouncement('Murder vote submitted. Waiting for other traitors.');
    } else {
      setAnnouncement(
        'Choose your victim. Use arrow keys to move between players, Enter or Space to select, Escape to clear.',
      );
    }
  }, [phase, isTraitor, hasVoted]);

  useEffect(() => {
    if (recruitPickerOpen) {
      setAnnouncement(
        'Recruitment picker open. Choose a Faithful to recruit. Arrow keys to move, Enter to select, Escape to clear.',
      );
    }
  }, [recruitPickerOpen]);

  useEffect(() => {
    if (evidencePickerOpen) {
      setAnnouncement(
        'False-evidence target picker open. Choose a player to frame. Arrow keys to move, Enter to select, Escape to clear.',
      );
    }
  }, [evidencePickerOpen]);

  const handleSubmitMurder = () => {
    if (selectedTarget) {
      vibrate('heavy');
      // Suppress the next murder-progress drum so my own submission does
      // not double-fire alongside the host-side ack.
      justSubmittedMurderRef.current = true;
      play('hardDrum');
      const name = players.find((p) => p.id === selectedTarget)?.name ?? 'target';
      setAnnouncement(`Murder vote cast for ${name}.`);
      onSend({ type: 'C2S_SUBMIT_MURDER', payload: { targetId: selectedTarget } });
      setHasVoted(true);
    }
  };

  const handleSubmitRecruitment = () => {
    if (selectedRecruitTarget) {
      vibrate('medium');
      const name = players.find((p) => p.id === selectedRecruitTarget)?.name ?? 'target';
      setAnnouncement(`Recruitment submitted for ${name}.`);
      onSend({ type: 'C2S_SUBMIT_RECRUITMENT', payload: { targetId: selectedRecruitTarget } });
    }
  };

  if (phase === 'NIGHT') {
    if (isTraitor) {
      return (
        <div className={styles.container}>
          <div className={styles.nightOverlay}>
            <div role="status" aria-live="polite" className={styles.srOnly}>
              {announcement}
            </div>
            <h1 className={styles.title}>Night Falls</h1>
            <p className={styles.subtitle}>Round {currentRound}</p>
            
            {fellowTraitors.length > 0 && (
              <div className={styles.fellowTraitorsSection}>
                <h3 className={styles.fellowTraitorsTitle}>Your Fellow Traitors</h3>
                <div className={styles.fellowTraitorsList}>
                  {fellowTraitors.map((traitor) => {
                    const colorHex = getColorHex(traitor.color);
                    const avatarEmoji = getAvatarEmoji(traitor.avatar);
                    return (
                      <div key={traitor.id} className={styles.traitorBadge} style={{ borderColor: colorHex }}>
                        <div className={styles.traitorAvatar} style={{ background: colorHex, color: '#000' }}>{avatarEmoji}</div>
                        <span className={styles.traitorName}>{traitor.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            {aliveTraitorCount === 1 && (
              <p className={styles.loneTraitorInfo}>You are the only traitor remaining</p>
            )}

            <h2 id="murder-picker-label" className={styles.sectionTitle}>Choose Your Victim</h2>

            <div
              className={styles.targetGrid}
              role="radiogroup"
              aria-labelledby="murder-picker-label"
            >
              {aliveFaithful.map((player) => {
                const colorHex = getColorHex(player.color);
                const avatarEmoji = getAvatarEmoji(player.avatar);
                const selected = selectedTarget === player.id;
                const hasShieldVisible =
                  player.shieldRevealed || (player.id === myPlayerId && player.hasShield);
                const accessibleName = hasShieldVisible
                  ? `${player.name}, shielded`
                  : player.name;
                const itemProps = murderRoving.getItemProps(player.id);
                return (
                  <button
                    {...itemProps}
                    key={player.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={accessibleName}
                    disabled={hasVoted}
                    className={`${styles.targetCard} ${selected ? styles.selected : ''} ${player.shieldRevealed ? styles.hasShield : ''}`}
                    style={{ borderColor: selected ? colorHex : undefined }}
                    onClick={() => !hasVoted && setSelectedTarget(player.id)}
                  >
                    <div className={styles.avatar} style={{ background: colorHex, color: '#000' }}>
                      {avatarEmoji}
                      {hasShieldVisible && <span className={styles.shieldBadge} aria-hidden="true">🛡️</span>}
                    </div>
                    <span className={styles.name}>{player.name}</span>
                  </button>
                );
              })}
            </div>

            {murderVoteProgress && (
              <div className={styles.voteProgress}>
                <p>
                  Murder votes: {murderVoteProgress.received} / {murderVoteProgress.needed}
                </p>
              </div>
            )}

            {!hasVoted && (
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.murderBtn}
                  onClick={handleSubmitMurder}
                  disabled={!selectedTarget}
                  aria-label={
                    selectedTarget
                      ? `Vote to murder ${playerName(selectedTarget)}`
                      : 'Vote to murder (no target selected)'
                  }
                >
                  Vote to Murder
                </button>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => {
                    setSelectedTarget(null);
                    announce('Victim selection cleared.');
                  }}
                  disabled={!selectedTarget}
                  aria-label="Cancel victim selection"
                >
                  Cancel
                </button>
              </div>
            )}

            {hasVoted && <p className={styles.waiting}>Waiting for other traitors... Murder will auto-resolve when all votes are in.</p>}

            {(() => {
              const iSubmitted = myPlayerRecruitmentUsed && nightRecruitmentSubmittedBy === myPlayerId;
              const someoneElseSubmitted = !!nightRecruitmentSubmittedBy && nightRecruitmentSubmittedBy !== myPlayerId;
              const usedPreviously = myPlayerRecruitmentUsed && !nightRecruitmentSubmittedBy;

              if (iSubmitted) {
                return (
                  <div className={styles.recruitSection}>
                    <h2 className={styles.sectionTitle}>🤝 Recruit a Faithful</h2>
                    <p className={styles.waiting}>
                      ✅ Recruitment submitted
                      {nightRecruitmentTargetName ? <> — <strong>{nightRecruitmentTargetName}</strong> will join your ranks at dawn.</> : ' — they will join your ranks at dawn.'}
                    </p>
                  </div>
                );
              }
              if (someoneElseSubmitted) {
                return (
                  <div className={styles.recruitSection}>
                    <h2 className={styles.sectionTitle}>🤝 Recruit a Faithful</h2>
                    <p className={styles.waiting}>
                      {nightRecruitmentTargetName
                        ? <>A fellow Traitor has recruited <strong>{nightRecruitmentTargetName}</strong> — they will join your ranks at dawn.</>
                        : 'A fellow Traitor has already submitted a recruitment for this night.'}
                    </p>
                  </div>
                );
              }
              if (usedPreviously) {
                return (
                  <div className={styles.recruitUsed}>
                    <span>🤝 Recruitment ability already used</span>
                  </div>
                );
              }
              return (
                <div className={styles.recruitSection}>
                  <h2 id="recruit-picker-label" className={styles.sectionTitle}>🤝 Recruit a Faithful</h2>
                  <p className={styles.recruitSubtitle}>One-time ability — Convert a Faithful player to your side</p>
                  <div
                    className={styles.targetGrid}
                    role="radiogroup"
                    aria-labelledby="recruit-picker-label"
                  >
                    {aliveFaithful.map((player) => {
                      const colorHex = getColorHex(player.color);
                      const avatarEmoji = getAvatarEmoji(player.avatar);
                      const selected = selectedRecruitTarget === player.id;
                      const itemProps = recruitRoving.getItemProps(player.id);
                      return (
                        <button
                          {...itemProps}
                          key={player.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={player.name}
                          className={`${styles.targetCard} ${styles.recruitTarget} ${selected ? styles.recruitSelected : ''}`}
                          style={{ borderColor: selected ? colorHex : undefined }}
                          onClick={() => setSelectedRecruitTarget(player.id)}
                        >
                          <div className={styles.avatar} style={{ background: colorHex, color: '#000' }}>
                            {avatarEmoji}
                          </div>
                          <span className={styles.name}>{player.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className={styles.actionRow}>
                    <button
                      type="button"
                      className={styles.recruitBtn}
                      onClick={handleSubmitRecruitment}
                      disabled={!selectedRecruitTarget}
                      aria-label={
                        selectedRecruitTarget
                          ? `Recruit ${playerName(selectedRecruitTarget)}`
                          : 'Recruit player (no target selected)'
                      }
                    >
                      Recruit Player
                    </button>
                    <button
                      type="button"
                      className={styles.cancelBtn}
                      onClick={() => {
                        setSelectedRecruitTarget(null);
                        announce('Recruitment selection cleared.');
                      }}
                      disabled={!selectedRecruitTarget}
                      aria-label="Cancel recruitment selection"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Wave 4 / 3 — Plant False Evidence (one-time per game). */}
            {!evidenceUsed && !falseEvidence && (() => {
              const myVote = (evidenceVotes ?? []).find((v) => v.voterId === myPlayerId);
              // Only ANONYMOUS_TIP carries a body. WHISPER_FABRICATION is a
              // meta-only "X whispered to Y" lie — no content per spec.
              const needsContent = evidenceType === 'ANONYMOUS_TIP';
              const targetMissing =
                evidenceType !== null && evidenceType !== 'SKIP' && !evidenceTarget;
              const contentMissing = needsContent && evidenceContent.trim().length === 0;
              const windowExpired =
                evidenceWindowEndsAt !== undefined && nowTick > evidenceWindowEndsAt;
              const canSubmit =
                evidenceType !== null && !targetMissing && !contentMissing && !windowExpired;
              const submit = () => {
                if (!canSubmit || !evidenceType) return;
                const targetName = evidenceTarget
                  ? players.find((p) => p.id === evidenceTarget)?.name ?? 'target'
                  : null;
                if (evidenceType === 'SKIP') {
                  setAnnouncement('False-evidence vote cast: Skip.');
                } else if (targetName) {
                  setAnnouncement(`False-evidence vote cast for ${targetName}.`);
                }
                onSend({
                  type: 'C2S_CAST_EVIDENCE_VOTE',
                  payload: {
                    voteType: evidenceType,
                    ...(evidenceType !== 'SKIP' && evidenceTarget ? { targetId: evidenceTarget } : {}),
                    ...(needsContent && evidenceContent.trim() ? { content: evidenceContent.trim() } : {}),
                  },
                });
              };
              const aliveOthers = evidenceCandidates;
              const secondsLeft =
                evidenceWindowEndsAt !== undefined
                  ? Math.max(0, Math.ceil((evidenceWindowEndsAt - nowTick) / 1000))
                  : null;
              const failureCopy =
                evidenceLastFailure === 'TIMEOUT'
                  ? 'Time ran out — the plant failed.'
                  : evidenceLastFailure === 'NO_AGREEMENT'
                    ? 'Traitors disagreed — the plant failed.'
                    : evidenceLastFailure === 'SKIPPED'
                      ? 'All traitors chose to skip this round.'
                      : null;
              return (
                <div className={styles.recruitSection}>
                  <h2 className={styles.sectionTitle}>📜 Plant False Evidence</h2>
                  <p className={styles.recruitSubtitle}>
                    One-time ability — all traitors must agree on type + target within 60 seconds.
                  </p>
                  {secondsLeft !== null && (
                    <p className={styles.waiting}>
                      ⏱ {secondsLeft}s left to reach unanimity
                    </p>
                  )}
                  {failureCopy && (
                    <p className={styles.waiting} role="status">{failureCopy}</p>
                  )}

                  <div className={styles.evidenceTypeRow}>
                    {(['FRAME', 'WHISPER_FABRICATION', 'ANONYMOUS_TIP', 'SKIP'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`${styles.evidenceTypeBtn} ${evidenceType === t ? styles.evidenceTypeBtnActive : ''}`}
                        onClick={() => {
                          setEvidenceType(t);
                          if (t === 'SKIP') {
                            setEvidenceTarget(null);
                            setEvidenceContent('');
                          }
                        }}
                      >
                        {t === 'FRAME' && 'Frame'}
                        {t === 'WHISPER_FABRICATION' && 'Fake Whisper'}
                        {t === 'ANONYMOUS_TIP' && 'Anonymous Tip'}
                        {t === 'SKIP' && 'Skip'}
                      </button>
                    ))}
                  </div>

                  {evidenceType && evidenceType !== 'SKIP' && (
                    <div
                      className={styles.targetGrid}
                      role="radiogroup"
                      aria-label="Choose a target for the false evidence"
                    >
                      {aliveOthers.map((player) => {
                        const colorHex = getColorHex(player.color);
                        const avatarEmoji = getAvatarEmoji(player.avatar);
                        const selected = evidenceTarget === player.id;
                        const itemProps = evidenceRoving.getItemProps(player.id);
                        return (
                          <button
                            {...itemProps}
                            key={player.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={player.name}
                            className={`${styles.targetCard} ${selected ? styles.recruitSelected : ''}`}
                            style={{ borderColor: selected ? colorHex : undefined }}
                            onClick={() => setEvidenceTarget(player.id)}
                          >
                            <div className={styles.avatar} style={{ background: colorHex, color: '#000' }}>
                              {avatarEmoji}
                            </div>
                            <span className={styles.name}>{player.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {needsContent && (
                    <div className={styles.evidenceContentWrap}>
                      <textarea
                        className={styles.evidenceTextarea}
                        value={evidenceContent}
                        onChange={(e) =>
                          setEvidenceContent(e.target.value.slice(0, FALSE_EVIDENCE_CONTENT_MAX))
                        }
                        placeholder="Anonymous tip text…"
                        maxLength={FALSE_EVIDENCE_CONTENT_MAX}
                        rows={3}
                      />
                      <div className={styles.evidenceCharCount}>
                        {evidenceContent.length} / {FALSE_EVIDENCE_CONTENT_MAX}
                      </div>
                    </div>
                  )}

                  {evidenceVoteProgress && (
                    <p className={styles.waiting}>
                      Traitor votes: {evidenceVoteProgress.received} / {evidenceVoteProgress.needed}
                      {myVote && <> · You: {myVote.type === 'SKIP' ? 'Skip' : myVote.type}</>}
                    </p>
                  )}

                  <div className={styles.actionRow}>
                    <button
                      type="button"
                      className={styles.recruitBtn}
                      onClick={submit}
                      disabled={!canSubmit}
                      aria-label={(() => {
                        const tName = evidenceTarget ? playerName(evidenceTarget) : null;
                        const verb = myVote ? 'Update vote' : 'Cast evidence vote';
                        if (evidenceType === 'SKIP') return `${verb}: skip this round`;
                        if (tName) return `${verb} targeting ${tName}`;
                        return `${verb} (no target selected)`;
                      })()}
                    >
                      {myVote ? 'Update Vote' : 'Cast Evidence Vote'}
                    </button>
                    <button
                      type="button"
                      className={styles.cancelBtn}
                      onClick={() => {
                        setEvidenceType(null);
                        setEvidenceTarget(null);
                        setEvidenceContent('');
                        announce('False-evidence selection cleared.');
                      }}
                      disabled={evidenceType === null && !evidenceTarget && !evidenceContent}
                      aria-label="Cancel false-evidence selection"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })()}

            {!!falseEvidence && (
              <div className={styles.recruitUsed}>
                <span>
                  📜 False evidence planted ({falseEvidence.type === 'FRAME'
                    ? 'Frame'
                    : falseEvidence.type === 'WHISPER_FABRICATION'
                      ? 'Fake Whisper'
                      : 'Anonymous Tip'}
                  ) — target: <strong>{falseEvidence.targetName}</strong>
                </span>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className={styles.container}>
        <div className={styles.nightOverlay}>
          <h1 className={styles.title}>Night Falls</h1>
          <p className={styles.subtitle}>Round {currentRound}</p>

          <div className={styles.sleepingIcon}>
            <span>💤</span>
          </div>

          <p className={styles.faithfulMessage}>
            Close your eyes and wait...<br />
            The traitors are choosing their victim.
          </p>

          <p className={styles.waiting}>Waiting for traitors to decide...</p>
        </div>
      </div>
    );
  }

  if (phase === 'MORNING') {
    if (justRecruited) {
      return (
        <div className={styles.container}>
          <div className={`${styles.morningOverlay} ${styles.recruitedOverlay}`}>
            <div className={styles.recruitedBanner}>
              <div className={styles.recruitedIcon}>🔴</div>
              <h1 className={styles.recruitedTitle}>You Have Been Recruited!</h1>
              <p className={styles.recruitedMessage}>
                A Traitor approached you in the night...<br />
                You are now one of the <strong>Traitors</strong>.<br />
                Help eliminate the Faithful without being discovered.
              </p>
              <p className={styles.recruitedHint}>Your role has changed. Work with your fellow Traitors!</p>
            </div>
            {!isHost && <p className={styles.waiting}>Waiting for host to continue...</p>}
          </div>
        </div>
      );
    }

    const murderedPlayerObj = murderedPlayer ? players.find((p) => p.id === murderedPlayer.id) : undefined;
    return (
      <div className={styles.container}>
        <div className={styles.morningOverlay}>
          <h1 className={styles.title}>Morning</h1>

          {murderedPlayer ? (
            <div className={styles.deathReveal}>
              <div
                className={styles.bigAvatar}
                style={{ background: getColorHex(murderedPlayerObj?.color), color: '#000' }}
              >
                {getAvatarEmoji(murderedPlayerObj?.avatar)}
              </div>
              <h2>{murderedPlayer.name}</h2>
              <p className={styles.deathMessage}>was found dead this morning...</p>
            </div>
          ) : murderBlocked ? (
            <div className={styles.shieldBlockReveal}>
              <div className={styles.shieldIcon}>🛡️</div>
              <h2>{murderBlocked.shieldedPlayerName}</h2>
              <p className={styles.shieldMessage}>was protected by their Shield!</p>
              <p className={styles.noDeathText}>No one was murdered last night.</p>
            </div>
          ) : medicBlocked ? (
            <div className={styles.shieldBlockReveal}>
              <div className={styles.shieldIcon}>✨</div>
              <p className={styles.shieldMessage}>
                The Traitors struck, but their target survived.
              </p>
            </div>
          ) : (
            <div className={styles.noDeathMessage}>
              <p>No one was murdered last night.</p>
            </div>
          )}

          {recruitedPlayer && (
            <div className={styles.recruitReveal}>
              <div className={styles.recruitRevealIcon}>🤝</div>
              {isTraitor ? (
                <>
                  <h3 className={styles.recruitRevealTitle}>{recruitedPlayer.name} has joined your ranks!</h3>
                  <p className={styles.recruitRevealMessage}>They are now a Traitor.</p>
                </>
              ) : (
                <>
                  <h3 className={styles.recruitRevealTitle}>Someone was recruited...</h3>
                  <p className={styles.recruitRevealMessage}>A Faithful player secretly joined the Traitors last night.</p>
                </>
              )}
            </div>
          )}

          {!isHost && <p className={styles.waiting}>Waiting for host to continue...</p>}
        </div>
      </div>
    );
  }

  return null;
}
