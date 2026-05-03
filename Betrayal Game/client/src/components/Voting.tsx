import { useState, useEffect, useRef } from 'react';
import type { Player, C2SEvent, Role, Vote, VoteTally, Whisper, ConfessionReveal } from '../types';
import { WHISPER_MAX_LENGTH } from '../types';
import { getColorHex, getAvatarEmoji } from '../avatarConstants';
import styles from './Voting.module.css';
import { useSoundContext } from '../contexts/SoundContext';
import { vibrate } from '../utils/haptics';
import { useRovingFocus } from '../hooks/useRovingFocus';

interface VotingProps {
  players: Player[];
  myPlayerId?: string;
  phase: string;
  votes?: Vote[];
  banishedPlayer?: { id: string; name: string; role: Role };
  currentRound?: number;
  voteCount?: { received: number; needed: number };
  tiedPlayerIds?: string[];
  tiedPlayerNames?: string[];
  randomlySelectedPlayer?: { id: string; name: string; role: Role };
  revealIndex?: number;
  revealOrder?: string[];
  currentTally?: VoteTally[];
  revealedVotes?: Vote[];
  totalVotes?: number;
  currentReveal?: {
    vote: Vote;
    voterName: string;
    targetName: string;
  };
  shieldBlockedBanishment?: boolean;
  shieldBlockedBanishmentName?: string;
  /** Every whisper visible to me (meta-only for others). */
  whispers?: Whisper[];
  /** Id of the most recent whisper I received (drives toast). */
  lastWhisperReceivedId?: string;
  /** Ids of received whispers the player has already viewed. */
  whispersRead?: string[];
  /** Most recent server-side whisper validation error for this player. */
  whisperError?: { code: string; message: string };
  /** Anonymous confessions revealed for the current Roundtable. */
  confessions?: ConfessionReveal[];
  /** Local action dispatcher (not a server event). */
  onLocalAction?: (action: { type: string; payload?: Record<string, unknown> }) => void;
  onSend: (event: C2SEvent) => void;
}

const REASON_MAX_LENGTH = 120;

export function Voting({ players, myPlayerId, phase, votes: _votes, banishedPlayer, currentRound, voteCount, tiedPlayerIds, tiedPlayerNames, randomlySelectedPlayer, revealIndex, currentTally, revealedVotes, totalVotes: serverTotalVotes, currentReveal, shieldBlockedBanishment, shieldBlockedBanishmentName, whispers, lastWhisperReceivedId, whispersRead, whisperError, confessions, onLocalAction, onSend }: VotingProps) {
  void _votes;
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [hasVoted, setHasVoted] = useState(false);
  const [shieldToast, setShieldToast] = useState<string | null>(null);
  // Two-step shield reveal: first click opens this confirmation modal so the
  // shielded player has to consciously choose between burning the shield
  // (Reveal) and accepting the banishment (Decline). Reset whenever the phase
  // changes so a stale modal can never persist between rounds.
  const [shieldChoiceOpen, setShieldChoiceOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  // whisper UI state
  const [whisperTargetId, setWhisperTargetId] = useState<string | null>(null);
  const [whisperText, setWhisperText] = useState('');
  const [whisperToast, setWhisperToast] = useState<{ id: string; from: string; content: string } | null>(null);
  const [whisperInboxOpen, setWhisperInboxOpen] = useState(false);
  const lastWhisperToastIdRef = useRef<string | undefined>(undefined);
  const prevPhaseRef = useRef(phase);
  const prevRevealIndexRef = useRef<number | undefined>(undefined);
  const banishSoundPlayedRef = useRef(false);
  const tieSoundPlayedRef = useRef(false);
  const prevRevealedRef = useRef<Set<string>>(new Set());
  // Vote-progress audio bookkeeping. justVotedRef suppresses the "another
  // player voted" soft-drum cue on the increment caused by my own vote so
  // it doesn't double up with the lowChime.
  const prevVoteReceivedRef = useRef(0);
  const justVotedRef = useRef(false);
  const allVotesInPlayedRef = useRef(false);
  // Track every pending audio setTimeout so we can cancel them on unmount
  // or phase change — prevents riser/banishment cues firing post-unmount.
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
  const { play } = useSoundContext();

  // Detect newly revealed shields and show a toast
  useEffect(() => {
    const currentRevealed = new Set(players.filter((p) => p.shieldRevealed).map((p) => p.id));
    const prev = prevRevealedRef.current;
    for (const id of currentRevealed) {
      if (!prev.has(id)) {
        const player = players.find((p) => p.id === id);
        if (player) {
          setShieldToast(`🛡️ ${player.name} revealed a shield!`);
          play('roleReveal');
          window.setTimeout(() => setShieldToast(null), 4000);
        }
      }
    }
    prevRevealedRef.current = currentRevealed;
  }, [players, play]);

  useEffect(() => {
    if ((phase === 'VOTING' || phase === 'REVOTE') && prevPhaseRef.current !== phase) {
      setHasVoted(false);
      setSelectedTarget(null);
      setReasonText('');
      banishSoundPlayedRef.current = false;
      tieSoundPlayedRef.current = false;
      prevVoteReceivedRef.current = 0;
      justVotedRef.current = false;
      allVotesInPlayedRef.current = false;
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  // Vote-reveal sequence: each non-final reveal is a soft drum, the final
  // reveal is a hard drum followed by a 1s riser.
  useEffect(() => {
    if (phase === 'VOTE_REVEAL' && revealIndex !== undefined && revealIndex !== prevRevealIndexRef.current) {
      if (revealIndex > 0) {
        const total = serverTotalVotes ?? 0;
        if (total > 0 && revealIndex >= total) {
          play('hardDrum');
          scheduleAudio(() => play('riserLong'), 100);
        } else {
          play('softDrum');
        }
      }
      prevRevealIndexRef.current = revealIndex;
    }
  }, [phase, revealIndex, serverTotalVotes, play]);

  useEffect(() => {
    if (phase === 'BANISH_REVEAL' && banishedPlayer && !banishSoundPlayedRef.current) {
      banishSoundPlayedRef.current = true;
      // Spec: banishment plays a stab. Layer with the legacy banishment
      // cue so the existing dread-chord still lands underneath.
      play('stab');
      scheduleAudio(() => play('banishment'), 120);
    }
  }, [phase, banishedPlayer, play]);

  // Per-vote progress feedback. Plays a soft drum each time another player
  // submits a vote and a long riser the moment the count tops out. Skipped
  // on the increment caused by my own vote (lowChime already covers that).
  useEffect(() => {
    if (phase !== 'VOTING' && phase !== 'REVOTE') return;
    if (!voteCount) return;
    const cur = voteCount.received;
    const prev = prevVoteReceivedRef.current;
    if (cur > prev) {
      if (justVotedRef.current) {
        justVotedRef.current = false;
      } else {
        play('softDrum');
      }
      if (
        !allVotesInPlayedRef.current &&
        voteCount.needed > 0 &&
        cur >= voteCount.needed
      ) {
        allVotesInPlayedRef.current = true;
        scheduleAudio(() => play('riserLong'), 200);
      }
    }
    prevVoteReceivedRef.current = cur;
  }, [phase, voteCount?.received, voteCount?.needed, play]);

  useEffect(() => {
    if (phase === 'TIE_DETECTED' && !tieSoundPlayedRef.current) {
      tieSoundPlayedRef.current = true;
      play('tieDetected');
    }
  }, [phase, play]);

  const isHost = players.find((p) => p.id === myPlayerId)?.isHost;
  const alivePlayers = players.filter((p) => p.isAlive);
  const myPlayer = players.find((p) => p.id === myPlayerId);
  const canVote = myPlayer?.isAlive && !hasVoted && (phase === 'VOTING' || phase === 'REVOTE');
  const isRound1 = currentRound === 1;
  const tiedPlayers = tiedPlayerIds ? alivePlayers.filter((p) => tiedPlayerIds.includes(p.id)) : [];

  const playerNameById = (id: string): string =>
    players.find((p) => p.id === id)?.name ?? 'player';

  const voteCandidateIds =
    canVote && phase === 'VOTING'
      ? alivePlayers.filter((p) => p.id !== myPlayerId).map((p) => p.id)
      : [];
  const voteRoving = useRovingFocus({
    itemIds: voteCandidateIds,
    preferredId: selectedTarget,
    onActivate: (id) => {
      setSelectedTarget(id);
      setAnnouncement(`Selected to banish: ${playerNameById(id)}.`);
    },
    onCancel: () => {
      if (selectedTarget) {
        setSelectedTarget(null);
        setAnnouncement('Vote selection cleared.');
      }
    },
  });

  const revoteCandidateIds =
    canVote && phase === 'REVOTE' && tiedPlayerIds
      ? tiedPlayers.filter((p) => p.id !== myPlayerId).map((p) => p.id)
      : [];
  const revoteRoving = useRovingFocus({
    itemIds: revoteCandidateIds,
    preferredId: selectedTarget,
    onActivate: (id) => {
      setSelectedTarget(id);
      setAnnouncement(`Selected to banish: ${playerNameById(id)}.`);
    },
    onCancel: () => {
      if (selectedTarget) {
        setSelectedTarget(null);
        setAnnouncement('Revote selection cleared.');
      }
    },
  });

  useEffect(() => {
    if (phase === 'VOTING' || phase === 'REVOTE') {
      if (hasVoted) {
        setAnnouncement('Vote submitted. Waiting for other players.');
      } else if (myPlayer?.isAlive) {
        setAnnouncement(
          'Choose who to banish. Use arrow keys to move between players, Enter or Space to select, Escape to clear.',
        );
      }
    } else {
      setAnnouncement('');
    }
  }, [phase, hasVoted, myPlayer?.isAlive]);

  const handleVote = () => {
    if (selectedTarget) {
      // Spec: own vote is a low chime. Flag the next vote-progress
      // increment so it does not also fire the soft drum.
      justVotedRef.current = true;
      play('lowChime');
      vibrate('medium');
      if (phase === 'REVOTE') {
        onSend({ type: 'C2S_SUBMIT_REVOTE', payload: { targetId: selectedTarget } });
      } else {
        const trimmedReason = reasonText.trim().slice(0, REASON_MAX_LENGTH);
        onSend({ type: 'C2S_SUBMIT_VOTE', payload: { targetId: selectedTarget, reasonText: trimmedReason || undefined } });
      }
      setHasVoted(true);
    }
  };

  const renderShieldIndicator = (player: Player) => {
    const visible = (player.id === myPlayerId && player.hasShield) || player.shieldRevealed;
    if (!visible) return null;
    return <span className={styles.shieldBadge} title="Has Shield">🛡️</span>;
  };

  const shieldToastEl = shieldToast ? (
    <div className={styles.shieldToast}>{shieldToast}</div>
  ) : null;

  // Slide-in toast for newly received whispers (suppresses repeats).
  useEffect(() => {
    if (!lastWhisperReceivedId) return;
    if (lastWhisperReceivedId === lastWhisperToastIdRef.current) return;
    const w = (whispers ?? []).find((x) => x.id === lastWhisperReceivedId);
    if (!w || !w.content) return;
    lastWhisperToastIdRef.current = lastWhisperReceivedId;
    setWhisperToast({ id: w.id, from: w.senderName, content: w.content });
    const t = window.setTimeout(() => setWhisperToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [lastWhisperReceivedId, whispers]);

  const allWhispers = whispers ?? [];
  const myWhispersThisRound = currentRound !== undefined
    ? allWhispers.filter((w) => w.senderId === myPlayerId && w.round === currentRound)
    : [];
  const haveAlreadyWhisperedThisRound = myWhispersThisRound.length > 0;
  const myRecipientIdsThisRound = new Set(myWhispersThisRound.map((w) => w.recipientId));
  const inboxWhispers = allWhispers.filter((w) => w.recipientId === myPlayerId && !!w.content);
  const readIds = new Set(whispersRead ?? []);
  const unreadCount = inboxWhispers.filter((w) => !readIds.has(w.id)).length;

  const dismissWhisperToast = () => {
    if (whisperToast && onLocalAction) {
      onLocalAction({ type: 'CLIENT_MARK_WHISPER_READ', payload: { id: whisperToast.id } });
    }
    setWhisperToast(null);
  };

  const openInbox = () => {
    setWhisperInboxOpen((v) => {
      const next = !v;
      if (next && onLocalAction) {
        onLocalAction({ type: 'CLIENT_MARK_ALL_WHISPERS_READ' });
      }
      return next;
    });
  };

  const sendWhisper = () => {
    const content = whisperText.trim();
    if (!whisperTargetId || !content) return;
    onSend({ type: 'C2S_SEND_WHISPER', payload: { recipientId: whisperTargetId, content } });
    setWhisperTargetId(null);
    setWhisperText('');
  };

  // Auto-clear stale whisper errors after 4s.
  useEffect(() => {
    if (!whisperError || !onLocalAction) return;
    const t = window.setTimeout(() => onLocalAction({ type: 'CLIENT_CLEAR_WHISPER_ERROR' }), 4000);
    return () => window.clearTimeout(t);
  }, [whisperError, onLocalAction]);

  const renderWhisperFeed = (round: number) => {
    const items = allWhispers.filter((w) => w.round === round);
    if (items.length === 0) return null;
    return (
      <div style={{ marginTop: 16, padding: 12, border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8, background: 'rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 6, letterSpacing: 0.4 }}>WHISPERS THIS ROUND</div>
        {items.map((w) => (
          <div key={w.id} style={{ fontSize: 14, padding: '3px 0' }}>
            🤫 <strong>{w.senderName}</strong> whispered to <strong>{w.recipientName}</strong>
            {w.senderId === myPlayerId && w.content && (
              <span style={{ opacity: 0.65, marginLeft: 6 }}>— "{w.content}"</span>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderWhisperToast = () => whisperToast ? (
    <div
      role="status"
      onClick={dismissWhisperToast}
      title="Tap to dismiss"
      style={{
        position: 'fixed', top: 16, right: 16, zIndex: 1000,
        maxWidth: 320, padding: '10px 14px', borderRadius: 8,
        background: 'rgba(20,20,30,0.95)', border: '1px solid #6c4ab6',
        color: '#fff', boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
        cursor: 'pointer',
        animation: 'whisperSlide 0.25s ease-out',
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>🤫 Whisper from {whisperToast.from}</div>
      <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{whisperToast.content}</div>
      <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>Tap to dismiss</div>
    </div>
  ) : null;

  const renderWhisperModal = () => {
    if (!whisperTargetId) return null;
    const target = players.find((p) => p.id === whisperTargetId);
    if (!target) return null;
    const remaining = WHISPER_MAX_LENGTH - whisperText.length;
    return (
      <div
        role="dialog"
        aria-label={`Whisper to ${target.name}`}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}
        onClick={() => { setWhisperTargetId(null); setWhisperText(''); }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: '#15151f', border: '1px solid #6c4ab6', borderRadius: 12,
            padding: 18, width: '100%', maxWidth: 420, color: '#fff',
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>🤫 Whisper to {target.name}</h3>
          <p style={{ fontSize: 13, opacity: 0.75, marginTop: 0 }}>
            Only {target.name} will see the message. Everyone will see that you whispered to them.
          </p>
          <textarea
            autoFocus
            value={whisperText}
            onChange={(e) => setWhisperText(e.target.value.slice(0, WHISPER_MAX_LENGTH))}
            placeholder={`Say something to ${target.name}...`}
            maxLength={WHISPER_MAX_LENGTH}
            rows={4}
            style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 6, border: whisperError ? '1px solid #c0392b' : '1px solid #444', background: '#0c0c14', color: '#fff', resize: 'vertical' }}
          />
          {whisperError && (
            <div role="alert" style={{ marginTop: 6, color: '#ff8a80', fontSize: 13 }}>
              {whisperError.message}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 12, opacity: 0.6 }}>{remaining} characters left</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setWhisperTargetId(null); setWhisperText(''); }}
                style={{ padding: '6px 12px', background: 'transparent', border: '1px solid #555', color: '#fff', borderRadius: 6, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={sendWhisper}
                disabled={whisperText.trim().length === 0}
                style={{ padding: '6px 12px', background: '#6c4ab6', border: 'none', color: '#fff', borderRadius: 6, cursor: whisperText.trim() ? 'pointer' : 'not-allowed', opacity: whisperText.trim() ? 1 : 0.5 }}
              >
                Send Whisper
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderWhisperInboxButton = () => {
    if (inboxWhispers.length === 0) return null;
    return (
      <>
        <button
          onClick={openInbox}
          aria-label={`Whisper inbox, ${unreadCount} unread`}
          style={{
            position: 'fixed', top: 16, right: 16, zIndex: 998,
            padding: '8px 12px', borderRadius: 20, border: '1px solid #6c4ab6',
            background: '#1c1c2a', color: '#fff', cursor: 'pointer', fontSize: 13,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          🤫 Inbox
          {unreadCount > 0 && (
            <span
              aria-label={`${unreadCount} unread`}
              style={{
                background: '#c0392b', color: '#fff', fontSize: 11, fontWeight: 700,
                borderRadius: 10, padding: '1px 6px', minWidth: 16, textAlign: 'center',
              }}
            >
              {unreadCount}
            </span>
          )}
          <span style={{ opacity: 0.6 }}>({inboxWhispers.length})</span>
        </button>
        {whisperInboxOpen && (
          <div
            style={{
              position: 'fixed', top: 60, right: 16, zIndex: 998,
              width: 'min(92vw, 320px)', maxHeight: '60vh', overflowY: 'auto',
              background: '#15151f', border: '1px solid #6c4ab6', borderRadius: 10, padding: 12, color: '#fff',
            }}
          >
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 8 }}>YOUR WHISPERS</div>
            {inboxWhispers.map((w) => (
              <div key={w.id} style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '8px 0', fontSize: 14 }}>
                <div style={{ fontSize: 12, opacity: 0.65 }}>Round {w.round} · from {w.senderName}</div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{w.content}</div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  if (phase === 'ROUNDTABLE') {
    const deadPlayers = players.filter((p) => !p.isAlive);
    
    return (
      <div className={styles.container}>
        {shieldToastEl}
        {renderWhisperToast()}
        {renderWhisperModal()}
        {renderWhisperInboxButton()}
        <h1 className={styles.title}>The Roundtable</h1>
        {isRound1 && (
          <div className={styles.round1Banner}>
            Round 1 - Discussion Only, No Banishment
          </div>
        )}
        <p className={styles.subtitle}>Discuss amongst yourselves...</p>

        <div className={styles.playerGrid}>
          {alivePlayers.map((player) => {
            const colorHex = getColorHex(player.color);
            const avatarEmoji = getAvatarEmoji(player.avatar);
            const canWhisperThem =
              myPlayer?.isAlive &&
              player.id !== myPlayerId &&
              !haveAlreadyWhisperedThisRound;
            const alreadyWhisperedThem = myRecipientIdsThisRound.has(player.id);
            const buttonLabel = alreadyWhisperedThem ? '🤫 Whispered' : '🤫 Whisper';
            const buttonTitle = alreadyWhisperedThem
              ? `You whispered to ${player.name} this round`
              : haveAlreadyWhisperedThisRound
                ? 'You already whispered this round'
                : `Whisper to ${player.name}`;
            return (
              <div key={player.id} className={`${styles.playerCard} ${player.id === myPlayerId ? styles.me : ''}`} style={{ borderColor: colorHex }}>
                <div className={styles.avatar} style={{ background: colorHex, color: '#000' }}>{avatarEmoji}</div>
                <span className={styles.name}>{player.name}{renderShieldIndicator(player)}</span>
                {player.id !== myPlayerId && myPlayer?.isAlive && (
                  <button
                    onClick={() => canWhisperThem && setWhisperTargetId(player.id)}
                    disabled={!canWhisperThem}
                    title={buttonTitle}
                    style={{
                      marginTop: 6, padding: '4px 8px', fontSize: 12, borderRadius: 12,
                      border: alreadyWhisperedThem ? '1px solid #5fa563' : '1px solid #6c4ab6',
                      background: alreadyWhisperedThem
                        ? '#1d2a1d'
                        : canWhisperThem ? '#1c1c2a' : '#0c0c14',
                      color: alreadyWhisperedThem ? '#bfeeb6' : canWhisperThem ? '#fff' : '#666',
                      cursor: canWhisperThem ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {buttonLabel}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {currentRound !== undefined && renderWhisperFeed(currentRound)}

        {confessions && confessions.length > 0 && (
          <div style={{
            margin: '12px 0', padding: '10px 12px',
            border: '1px solid rgba(212,165,80,0.4)', borderRadius: 8,
            background: 'rgba(80,30,10,0.18)',
          }}>
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6, letterSpacing: 0.4, color: '#f7d896' }}>
              🕯️ ANONYMOUS CONFESSIONS
            </div>
            {confessions.map((c) => (
              <div key={c.id} style={{ fontSize: 13, padding: '4px 0', color: '#f0e2c4', fontStyle: 'italic' }}>
                — "{c.text}"
              </div>
            ))}
          </div>
        )}

        {deadPlayers.length > 0 && (
          <div className={styles.deadPlayersSection}>
            <h3 className={styles.deadPlayersTitle}>Eliminated</h3>
            <div className={styles.deadPlayersList}>
              {deadPlayers.map((player) => (
                <div key={player.id} className={styles.deadPlayerCard}>
                  <div className={styles.deadAvatar}>
                    {getAvatarEmoji(player.avatar)}
                    <span className={styles.crossMark}>✕</span>
                  </div>
                  <span className={styles.deadName}>{player.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isHost && isRound1 && <p className={styles.waiting}>Waiting for host to proceed to night...</p>}
        {!isHost && !isRound1 && <p className={styles.waiting}>Waiting for host to start voting...</p>}
      </div>
    );
  }

  if (phase === 'VOTING') {
    return (
      <div className={styles.container}>
        {shieldToastEl}
        {renderWhisperToast()}
        {renderWhisperInboxButton()}
        <div role="status" aria-live="polite" className={styles.srOnly}>
          {announcement}
        </div>
        <h1 className={styles.title}>Vote to Banish</h1>
        {currentRound !== undefined && renderWhisperFeed(currentRound)}
        <p id="vote-picker-label" className={styles.subtitle}>Who is the traitor among you?</p>

        <div
          className={styles.playerGrid}
          role="radiogroup"
          aria-labelledby="vote-picker-label"
        >
          {alivePlayers.map((player) => {
            const colorHex = getColorHex(player.color);
            const avatarEmoji = getAvatarEmoji(player.avatar);
            const isDisabled = player.id === myPlayerId || !canVote;
            const isSelected = selectedTarget === player.id;
            const itemProps = !isDisabled ? voteRoving.getItemProps(player.id) : null;
            const shieldVisible = (player.id === myPlayerId && player.hasShield) || player.shieldRevealed;
            const accessibleName = player.id === myPlayerId
              ? `${player.name} (you, cannot vote for yourself)`
              : shieldVisible
                ? `${player.name}, shielded`
                : player.name;
            return (
              <button
                {...(itemProps ?? {})}
                key={player.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={accessibleName}
                disabled={isDisabled}
                className={`${styles.voteCard} ${isSelected ? styles.selected : ''} ${player.id === myPlayerId ? styles.disabled : ''}`}
                style={{ borderColor: isSelected ? colorHex : undefined, '--player-color': colorHex } as React.CSSProperties}
                onClick={() => !isDisabled && setSelectedTarget(player.id)}
              >
                <div className={styles.avatar} style={{ background: colorHex, color: '#000' }}>{avatarEmoji}</div>
                <span className={styles.name}>{player.name}{renderShieldIndicator(player)}</span>
                {player.id === myPlayerId && <span className={styles.youLabel}>You</span>}
              </button>
            );
          })}
        </div>

        {canVote && selectedTarget && (
          <div className={styles.reasonSection}>
            <label className={styles.reasonLabel}>
              Why are you voting for them? (optional)
            </label>
            <textarea
              className={styles.reasonInput}
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value.slice(0, REASON_MAX_LENGTH))}
              placeholder="They seemed suspicious when..."
              maxLength={REASON_MAX_LENGTH}
              rows={2}
            />
            <div className={styles.reasonCounter}>
              {reasonText.length}/{REASON_MAX_LENGTH}
            </div>
          </div>
        )}

        {canVote && (
          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.voteBtn}
              onClick={handleVote}
              disabled={!selectedTarget}
              aria-label={
                selectedTarget
                  ? `Cast vote to banish ${playerNameById(selectedTarget)}`
                  : 'Cast vote (no target selected)'
              }
            >
              Cast Vote
            </button>
            <button
              type="button"
              className={styles.cancelSelectionBtn}
              onClick={() => {
                setSelectedTarget(null);
                setAnnouncement('Vote selection cleared.');
              }}
              disabled={!selectedTarget}
              aria-label="Clear vote selection"
            >
              Cancel
            </button>
          </div>
        )}

        {hasVoted && voteCount && (
          <p className={styles.votedText}>
            Vote submitted. Waiting for {voteCount.needed - voteCount.received} more vote{voteCount.needed - voteCount.received !== 1 ? 's' : ''}...
          </p>
        )}
        {hasVoted && !voteCount && <p className={styles.votedText}>Vote submitted. Waiting for others...</p>}
        
      </div>
    );
  }

  if (phase === 'VOTE_REVEAL') {
    const revealOrderLength = serverTotalVotes ?? players.filter((p) => p.isAlive).length;
    const currentIndex = revealIndex ?? 0;
    const isRevealing = currentIndex < revealOrderLength && revealOrderLength > 0;
    const revealComplete = currentIndex >= revealOrderLength && revealOrderLength > 0 && (revealedVotes?.length ?? 0) > 0;
    const totalVotes = revealedVotes?.length || revealOrderLength;

    const sortedTally = currentTally ? [...currentTally].sort((a, b) => b.voteCount - a.voteCount) : [];
    const topVoteCount = sortedTally[0]?.voteCount || 0;
    const topCandidates = sortedTally.filter((t) => t.voteCount === topVoteCount && topVoteCount > 0);
    const isTie = topCandidates.length > 1;

    const getPlayerForId = (id: string) => players.find((p) => p.id === id);

    return (
      <div className={styles.container}>
        {shieldToastEl}
        <h1 className={styles.title}>
          {revealComplete ? 'All Votes Revealed' : 'The Votes Are Being Revealed'}
        </h1>
        
        <div className={styles.progressBar}>
          <div 
            className={styles.progressFill} 
            style={{ width: `${(currentIndex / revealOrderLength) * 100}%` }}
          />
        </div>
        <p className={styles.progressText}>
          {currentIndex} of {revealOrderLength} votes revealed
        </p>

        {currentReveal && !revealComplete && (
          <div className={`${styles.currentRevealCard} ${currentReveal.vote.isAutoVote ? styles.autoVoteCard : ''}`}>
            <div className={styles.revealHeader}>
              <div className={styles.voterSection}>
                {(() => {
                  const vp = players.find((p) => p.name === currentReveal.voterName);
                  return <div className={styles.avatar} style={{ background: getColorHex(vp?.color), color: '#000' }}>{getAvatarEmoji(vp?.avatar)}</div>;
                })()}
                <span className={styles.voterName}>{currentReveal.voterName}</span>
                {currentReveal.vote.isAutoVote && <span className={styles.autoVoteTag}>Auto</span>}
              </div>
              <span className={styles.votedFor}>voted for</span>
              <div className={styles.targetSection}>
                {(() => {
                  const tp = players.find((p) => p.name === currentReveal.targetName);
                  return <div className={styles.avatarTarget} style={{ background: getColorHex(tp?.color), color: '#000' }}>{getAvatarEmoji(tp?.avatar)}</div>;
                })()}
                <span className={styles.targetName}>{currentReveal.targetName}</span>
              </div>
            </div>
            {currentReveal.vote.reasonText && !currentReveal.vote.isAutoVote && (
              <div className={styles.reasonReveal}>
                "{currentReveal.vote.reasonText}"
              </div>
            )}
            {currentReveal.vote.isAutoVote && (
              <div className={styles.autoVoteReason}>
                This vote was automatically assigned
              </div>
            )}
          </div>
        )}

        {sortedTally.length > 0 && (
          <div className={styles.tallySection}>
            <h3 className={styles.tallyTitle}>{revealComplete ? 'Final Tally' : 'Current Tally'}</h3>
            <div className={styles.tallyList}>
              {sortedTally.map((tally) => {
                const p = getPlayerForId(tally.playerId);
                const colorHex = getColorHex(p?.color);
                return (
                  <div 
                    key={tally.playerId} 
                    className={`${styles.tallyItem} ${revealComplete && tally.voteCount === topVoteCount && topVoteCount > 0 ? styles.topTallyItem : ''}`}
                  >
                    <div className={styles.tallyAvatar} style={{ background: colorHex, color: '#000' }}>{getAvatarEmoji(p?.avatar)}</div>
                    <span className={styles.tallyName}>{tally.playerName}</span>
                    <div className={styles.tallyBar}>
                      <div 
                        className={styles.tallyBarFill} 
                        style={{ width: `${Math.min((tally.voteCount / (totalVotes || 1)) * 100, 100)}%`, background: colorHex }}
                      />
                    </div>
                    <span className={styles.tallyCount}>{tally.voteCount}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {revealComplete && topCandidates.length === 1 && topCandidates[0] && (
          <p className={styles.banishMessage}>
            <strong>{topCandidates[0].playerName}</strong> will be banished!
          </p>
        )}

        {revealComplete && (() => {
          const me = players.find((p) => p.id === myPlayerId);
          const isTopCandidate = topCandidates.some((t) => t.playerId === myPlayerId);
          const canRevealShield = me?.isAlive && me?.hasShield && !me?.shieldRevealed && isTopCandidate;
          if (!canRevealShield) return null;
          if (!shieldChoiceOpen) {
            return (
              <button
                className={styles.shieldRevealBtn}
                onClick={() => setShieldChoiceOpen(true)}
              >
                🛡️ Reveal Your Shield?
              </button>
            );
          }
          // Confirmation card — explicit choice between burning the shield
          // and accepting the banishment. Closing this without a choice is
          // intentionally not allowed; the host's "Banish" is server-gated
          // until one of these two buttons is pressed.
          return (
            <div className={styles.shieldChoiceCard} role="dialog" aria-label="Shield decision">
              <p className={styles.shieldChoiceTitle}>You hold a shield.</p>
              <p className={styles.shieldChoiceBody}>
                The vote is going against you. Burn your shield to cancel the
                banishment, or accept the banishment and keep your shield secret.
              </p>
              <div className={styles.shieldChoiceButtons}>
                <button
                  className={styles.shieldRevealBtn}
                  onClick={() => {
                    setShieldChoiceOpen(false);
                    onSend({ type: 'C2S_REVEAL_SHIELD', payload: {} });
                  }}
                >
                  🛡️ Reveal Shield
                </button>
                <button
                  className={styles.shieldDeclineBtn}
                  onClick={() => {
                    setShieldChoiceOpen(false);
                    onSend({ type: 'C2S_DECLINE_SHIELD', payload: {} });
                  }}
                >
                  Accept Banishment
                </button>
              </div>
            </div>
          );
        })()}

        {revealComplete && isTie && (
          <p className={styles.tieMessage}>
            It's a tie! A revote will be required.
          </p>
        )}

        {revealComplete && !isHost && (
          <p className={styles.waiting}>Waiting for host to proceed...</p>
        )}

        {isRevealing && !revealComplete && (
          <p className={styles.waiting}>Revealing votes...</p>
        )}
      </div>
    );
  }

  if (phase === 'TIE_DETECTED' && tiedPlayerNames) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Tie Detected!</h1>
        <div className={styles.tieBanner}>
          A revote is required between the tied players
        </div>
        
        <div className={styles.tiedPlayersList}>
          {tiedPlayerNames.map((name, index) => (
            <span key={index} className={styles.tiedPlayerName}>{name}</span>
          ))}
        </div>

        {!isHost && <p className={styles.waiting}>Waiting for host to start revote...</p>}
      </div>
    );
  }

  if (phase === 'REVOTE' && tiedPlayerIds) {
    return (
      <div className={styles.container}>
        <div role="status" aria-live="polite" className={styles.srOnly}>
          {announcement}
        </div>
        <h1 className={styles.title}>Revote</h1>
        <div id="revote-picker-label" className={styles.tieBanner}>
          Vote only for the tied candidates
        </div>

        <div
          className={styles.playerGrid}
          role="radiogroup"
          aria-labelledby="revote-picker-label"
        >
          {tiedPlayers.map((player) => {
            const colorHex = getColorHex(player.color);
            const avatarEmoji = getAvatarEmoji(player.avatar);
            const isDisabled = player.id === myPlayerId || !canVote;
            const isSelected = selectedTarget === player.id;
            const itemProps = !isDisabled ? revoteRoving.getItemProps(player.id) : null;
            const accessibleName = player.id === myPlayerId
              ? `${player.name} (you, cannot vote for yourself)`
              : player.name;
            return (
              <button
                {...(itemProps ?? {})}
                key={player.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={accessibleName}
                disabled={isDisabled}
                className={`${styles.voteCard} ${isSelected ? styles.selected : ''} ${player.id === myPlayerId ? styles.disabled : ''}`}
                style={{ borderColor: isSelected ? colorHex : undefined }}
                onClick={() => !isDisabled && setSelectedTarget(player.id)}
              >
                <div className={styles.avatar} style={{ background: colorHex, color: '#000' }}>{avatarEmoji}</div>
                <span className={styles.name}>{player.name}</span>
                {player.id === myPlayerId && <span className={styles.youLabel}>You</span>}
              </button>
            );
          })}
        </div>

        {canVote && (
          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.voteBtn}
              onClick={handleVote}
              disabled={!selectedTarget}
              aria-label={
                selectedTarget
                  ? `Cast revote for ${playerNameById(selectedTarget)}`
                  : 'Cast revote (no target selected)'
              }
            >
              Cast Revote
            </button>
            <button
              type="button"
              className={styles.cancelSelectionBtn}
              onClick={() => {
                setSelectedTarget(null);
                setAnnouncement('Revote selection cleared.');
              }}
              disabled={!selectedTarget}
              aria-label="Clear revote selection"
            >
              Cancel
            </button>
          </div>
        )}

        {hasVoted && voteCount && (
          <p className={styles.votedText}>
            Vote submitted. Waiting for {voteCount.needed - voteCount.received} more vote{voteCount.needed - voteCount.received !== 1 ? 's' : ''}...
          </p>
        )}
        {hasVoted && !voteCount && <p className={styles.votedText}>Vote submitted. Waiting for others...</p>}
        
      </div>
    );
  }

  if (phase === 'TIEBREAKER_REVEAL' && randomlySelectedPlayer && tiedPlayerNames) {
    const rspPlayer = players.find((p) => p.id === randomlySelectedPlayer.id);
    const rspColorHex = getColorHex(rspPlayer?.color);
    const rspAvatarEmoji = getAvatarEmoji(rspPlayer?.avatar);
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Tiebreaker!</h1>
        <div className={styles.tiebreakerBanner}>
          The revote resulted in another tie. Fate has decided...
        </div>

        <div className={styles.tiedPlayersList}>
          {tiedPlayerNames.map((name, index) => (
            <span 
              key={index} 
              className={`${styles.tiedPlayerName} ${name === randomlySelectedPlayer.name ? styles.selectedTiedPlayer : ''}`}
            >
              {name}
            </span>
          ))}
        </div>

        <div className={`${styles.revealCard} ${randomlySelectedPlayer.role === 'TRAITOR' ? styles.traitor : styles.faithful}`}>
          <div className={styles.bigAvatar} style={{ background: rspColorHex, color: '#000' }}>{rspAvatarEmoji}</div>
          <h2>{randomlySelectedPlayer.name}</h2>
          <p className={styles.roleReveal}>
            was randomly selected and was a <strong>{randomlySelectedPlayer.role}</strong>
          </p>
        </div>

        {randomlySelectedPlayer.role === 'TRAITOR' ? (
          <p className={styles.successMessage}>A traitor has been eliminated!</p>
        ) : (
          <p className={styles.failMessage}>An innocent has been banished by fate...</p>
        )}

      </div>
    );
  }

  // Shield blocked the banishment — no one was banished this round.
  if ((phase === 'BANISH_REVEAL' || phase === 'CHECK_WIN') && !banishedPlayer && shieldBlockedBanishment) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Shield Revealed!</h1>
        <div className={styles.tieBanner}>
          🛡️ {shieldBlockedBanishmentName ?? 'The shielded player'} consumed their shield to block the banishment.
        </div>
        <p className={styles.banishMessage}>No one is banished this round.</p>
        {!isHost && (
          <p className={styles.waiting}>Waiting for host to continue...</p>
        )}
      </div>
    );
  }

  if ((phase === 'BANISH_REVEAL' || phase === 'CHECK_WIN') && banishedPlayer) {
    const bp = players.find((p) => p.id === banishedPlayer.id);
    const bpColorHex = getColorHex(bp?.color);
    const bpAvatarEmoji = getAvatarEmoji(bp?.avatar);
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Banishment</h1>

        <div className={`${styles.revealCard} ${banishedPlayer.role === 'TRAITOR' ? styles.traitor : styles.faithful}`}>
          <div className={styles.bigAvatar} style={{ background: bpColorHex, color: '#000' }}>{bpAvatarEmoji}</div>
          <h2>{banishedPlayer.name}</h2>
          <p className={styles.roleReveal}>
            was a <strong>{banishedPlayer.role}</strong>
          </p>
        </div>

        {banishedPlayer.role === 'TRAITOR' ? (
          <p className={styles.successMessage}>A traitor has been eliminated!</p>
        ) : (
          <p className={styles.failMessage}>An innocent has been banished...</p>
        )}

        {phase === 'CHECK_WIN' && (
          <p className={styles.waiting}>Checking game status...</p>
        )}
      </div>
    );
  }

  return null;
}
