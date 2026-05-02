import { useState, useEffect, useRef } from 'react';
import type { Player, C2SEvent, Role, Vote, VoteTally } from '../types';
import { getColorHex, getAvatarEmoji } from '../avatarConstants';
import styles from './Voting.module.css';
import { useSoundContext } from '../contexts/SoundContext';
import { vibrate } from '../utils/haptics';

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
  onSend: (event: C2SEvent) => void;
}

const REASON_MAX_LENGTH = 120;

export function Voting({ players, myPlayerId, phase, votes: _votes, banishedPlayer, currentRound, voteCount, tiedPlayerIds, tiedPlayerNames, randomlySelectedPlayer, revealIndex, currentTally, revealedVotes, totalVotes: serverTotalVotes, currentReveal, onSend }: VotingProps) {
  void _votes;
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [hasVoted, setHasVoted] = useState(false);
  const prevPhaseRef = useRef(phase);
  const prevRevealIndexRef = useRef<number | undefined>(undefined);
  const banishSoundPlayedRef = useRef(false);
  const tieSoundPlayedRef = useRef(false);
  const { play } = useSoundContext();

  useEffect(() => {
    if ((phase === 'VOTING' || phase === 'REVOTE') && prevPhaseRef.current !== phase) {
      setHasVoted(false);
      setSelectedTarget(null);
      setReasonText('');
      banishSoundPlayedRef.current = false;
      tieSoundPlayedRef.current = false;
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (phase === 'VOTE_REVEAL' && revealIndex !== undefined && revealIndex !== prevRevealIndexRef.current) {
      if (revealIndex > 0) {
        play('voteReveal');
      }
      prevRevealIndexRef.current = revealIndex;
    }
  }, [phase, revealIndex, play]);

  useEffect(() => {
    if (phase === 'BANISH_REVEAL' && banishedPlayer && !banishSoundPlayedRef.current) {
      banishSoundPlayedRef.current = true;
      play('banishment');
    }
  }, [phase, banishedPlayer, play]);

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

  const handleVote = () => {
    if (selectedTarget) {
      play('voteSubmit');
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

  if (phase === 'ROUNDTABLE') {
    const deadPlayers = players.filter((p) => !p.isAlive);
    
    return (
      <div className={styles.container}>
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
            return (
              <div key={player.id} className={`${styles.playerCard} ${player.id === myPlayerId ? styles.me : ''}`} style={{ borderColor: colorHex }}>
                <div className={styles.avatar} style={{ background: colorHex, color: '#000' }}>{avatarEmoji}</div>
                <span className={styles.name}>{player.name}</span>
              </div>
            );
          })}
        </div>

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
        <h1 className={styles.title}>Vote to Banish</h1>
        <p className={styles.subtitle}>Who is the traitor among you?</p>

        <div className={styles.playerGrid}>
          {alivePlayers.map((player) => {
            const colorHex = getColorHex(player.color);
            const avatarEmoji = getAvatarEmoji(player.avatar);
            const isDisabled = player.id === myPlayerId;
            const isSelected = selectedTarget === player.id;
            return (
              <div
                key={player.id}
                className={`${styles.voteCard} ${isSelected ? styles.selected : ''} ${isDisabled ? styles.disabled : ''}`}
                style={{ borderColor: isSelected ? colorHex : undefined, '--player-color': colorHex } as React.CSSProperties}
                onClick={() => !isDisabled && canVote && setSelectedTarget(player.id)}
              >
                <div className={styles.avatar} style={{ background: colorHex, color: '#000' }}>{avatarEmoji}</div>
                <span className={styles.name}>{player.name}</span>
                {player.id === myPlayerId && <span className={styles.youLabel}>You</span>}
              </div>
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
          <button className={styles.voteBtn} onClick={handleVote} disabled={!selectedTarget}>
            Cast Vote
          </button>
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
        <h1 className={styles.title}>Revote</h1>
        <div className={styles.tieBanner}>
          Vote only for the tied candidates
        </div>

        <div className={styles.playerGrid}>
          {tiedPlayers.map((player) => {
            const colorHex = getColorHex(player.color);
            const avatarEmoji = getAvatarEmoji(player.avatar);
            const isDisabled = player.id === myPlayerId;
            const isSelected = selectedTarget === player.id;
            return (
              <div
                key={player.id}
                className={`${styles.voteCard} ${isSelected ? styles.selected : ''} ${isDisabled ? styles.disabled : ''}`}
                style={{ borderColor: isSelected ? colorHex : undefined }}
                onClick={() => !isDisabled && canVote && setSelectedTarget(player.id)}
              >
                <div className={styles.avatar} style={{ background: colorHex, color: '#000' }}>{avatarEmoji}</div>
                <span className={styles.name}>{player.name}</span>
                {player.id === myPlayerId && <span className={styles.youLabel}>You</span>}
              </div>
            );
          })}
        </div>

        {canVote && (
          <button className={styles.voteBtn} onClick={handleVote} disabled={!selectedTarget}>
            Cast Revote
          </button>
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
