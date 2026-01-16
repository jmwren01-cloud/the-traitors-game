import { useState, useEffect, useRef } from 'react';
import type { Player, C2SEvent, Role, Vote, VoteTally } from '../types';
import styles from './Voting.module.css';

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

  useEffect(() => {
    if ((phase === 'VOTING' || phase === 'REVOTE') && prevPhaseRef.current !== phase) {
      setHasVoted(false);
      setSelectedTarget(null);
      setReasonText('');
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  const isHost = players.find((p) => p.id === myPlayerId)?.isHost;
  const alivePlayers = players.filter((p) => p.isAlive);
  const myPlayer = players.find((p) => p.id === myPlayerId);
  const canVote = myPlayer?.isAlive && !hasVoted && (phase === 'VOTING' || phase === 'REVOTE');
  const isRound1 = currentRound === 1;
  const tiedPlayers = tiedPlayerIds ? alivePlayers.filter((p) => tiedPlayerIds.includes(p.id)) : [];

  const handleVote = () => {
    if (selectedTarget) {
      if (phase === 'REVOTE') {
        onSend({ type: 'C2S_SUBMIT_REVOTE', payload: { targetId: selectedTarget } });
      } else {
        const trimmedReason = reasonText.trim().slice(0, REASON_MAX_LENGTH);
        onSend({ type: 'C2S_SUBMIT_VOTE', payload: { targetId: selectedTarget, reasonText: trimmedReason || undefined } });
      }
      setHasVoted(true);
    }
  };

  const handleCheckWin = () => {
    onSend({ type: 'C2S_CHECK_WIN', payload: {} });
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
          {alivePlayers.map((player) => (
            <div key={player.id} className={`${styles.playerCard} ${player.id === myPlayerId ? styles.me : ''}`}>
              <div className={styles.avatar}>{player.name[0]?.toUpperCase()}</div>
              <span className={styles.name}>{player.name}</span>
            </div>
          ))}
        </div>

        {deadPlayers.length > 0 && (
          <div className={styles.deadPlayersSection}>
            <h3 className={styles.deadPlayersTitle}>Eliminated</h3>
            <div className={styles.deadPlayersList}>
              {deadPlayers.map((player) => (
                <div key={player.id} className={styles.deadPlayerCard}>
                  <div className={styles.deadAvatar}>
                    {player.name[0]?.toUpperCase()}
                    <span className={styles.crossMark}>✕</span>
                  </div>
                  <span className={styles.deadName}>{player.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isHost && isRound1 && (
          <button className={styles.primaryBtn} onClick={() => onSend({ type: 'C2S_START_NIGHT', payload: {} })}>
            Proceed to Night
          </button>
        )}
        {isHost && !isRound1 && (
          <button className={styles.primaryBtn} onClick={() => onSend({ type: 'C2S_START_VOTING', payload: {} })}>
            Start Voting
          </button>
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
          {alivePlayers.map((player) => (
            <div
              key={player.id}
              className={`${styles.voteCard} ${selectedTarget === player.id ? styles.selected : ''} ${player.id === myPlayerId ? styles.disabled : ''}`}
              onClick={() => player.id !== myPlayerId && canVote && setSelectedTarget(player.id)}
            >
              <div className={styles.avatar}>{player.name[0]?.toUpperCase()}</div>
              <span className={styles.name}>{player.name}</span>
              {player.id === myPlayerId && <span className={styles.youLabel}>You</span>}
            </div>
          ))}
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
        
        {isHost && voteCount && voteCount.received < voteCount.needed && (
          <button 
            className={styles.secondaryBtn} 
            onClick={() => onSend({ type: 'C2S_FORCE_RESOLVE_VOTING', payload: {} })}
          >
            Force Resolve ({voteCount.needed - voteCount.received} auto-votes)
          </button>
        )}
      </div>
    );
  }

  if (phase === 'VOTE_REVEAL') {
    const revealOrderLength = serverTotalVotes ?? players.filter((p) => p.isAlive).length;
    const currentIndex = revealIndex ?? 0;
    const isRevealing = currentIndex < revealOrderLength && revealOrderLength > 0;
    const revealComplete = currentIndex >= revealOrderLength && revealOrderLength > 0;
    const totalVotes = revealedVotes?.length || revealOrderLength;

    const sortedTally = currentTally ? [...currentTally].sort((a, b) => b.voteCount - a.voteCount) : [];
    const topVoteCount = sortedTally[0]?.voteCount || 0;
    const topCandidates = sortedTally.filter((t) => t.voteCount === topVoteCount && topVoteCount > 0);
    const isTie = topCandidates.length > 1;

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
                <div className={styles.avatar}>{currentReveal.voterName[0]?.toUpperCase()}</div>
                <span className={styles.voterName}>{currentReveal.voterName}</span>
                {currentReveal.vote.isAutoVote && <span className={styles.autoVoteTag}>Auto</span>}
              </div>
              <span className={styles.votedFor}>voted for</span>
              <div className={styles.targetSection}>
                <div className={styles.avatarTarget}>{currentReveal.targetName[0]?.toUpperCase()}</div>
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
              {sortedTally.map((tally) => (
                <div 
                  key={tally.playerId} 
                  className={`${styles.tallyItem} ${revealComplete && tally.voteCount === topVoteCount && topVoteCount > 0 ? styles.topTallyItem : ''}`}
                >
                  <span className={styles.tallyName}>{tally.playerName}</span>
                  <div className={styles.tallyBar}>
                    <div 
                      className={styles.tallyBarFill} 
                      style={{ width: `${Math.min((tally.voteCount / (totalVotes || 1)) * 100, 100)}%` }}
                    />
                  </div>
                  <span className={styles.tallyCount}>{tally.voteCount}</span>
                </div>
              ))}
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

        {revealComplete && isHost && (
          <button 
            className={styles.dangerBtn} 
            onClick={() => onSend({ type: 'C2S_BANISH_PLAYER', payload: {} })}
          >
            {isTie ? 'Proceed to Revote' : 'Banish Player'}
          </button>
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

        {isHost && (
          <button className={styles.primaryBtn} onClick={() => onSend({ type: 'C2S_START_REVOTE', payload: {} })}>
            Start Revote
          </button>
        )}
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
          {tiedPlayers.map((player) => (
            <div
              key={player.id}
              className={`${styles.voteCard} ${selectedTarget === player.id ? styles.selected : ''} ${player.id === myPlayerId ? styles.disabled : ''}`}
              onClick={() => player.id !== myPlayerId && canVote && setSelectedTarget(player.id)}
            >
              <div className={styles.avatar}>{player.name[0]?.toUpperCase()}</div>
              <span className={styles.name}>{player.name}</span>
              {player.id === myPlayerId && <span className={styles.youLabel}>You</span>}
            </div>
          ))}
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
        
        {isHost && voteCount && voteCount.received < voteCount.needed && (
          <button 
            className={styles.secondaryBtn} 
            onClick={() => onSend({ type: 'C2S_FORCE_RESOLVE_VOTING', payload: {} })}
          >
            Force Resolve ({voteCount.needed - voteCount.received} auto-votes)
          </button>
        )}
      </div>
    );
  }

  if (phase === 'TIEBREAKER_REVEAL' && randomlySelectedPlayer && tiedPlayerNames) {
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
          <div className={styles.bigAvatar}>{randomlySelectedPlayer.name[0]?.toUpperCase()}</div>
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

        {isHost && (
          <button className={styles.primaryBtn} onClick={handleCheckWin}>
            Continue
          </button>
        )}
      </div>
    );
  }

  if ((phase === 'BANISH_REVEAL' || phase === 'CHECK_WIN') && banishedPlayer) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>Banishment</h1>

        <div className={`${styles.revealCard} ${banishedPlayer.role === 'TRAITOR' ? styles.traitor : styles.faithful}`}>
          <div className={styles.bigAvatar}>{banishedPlayer.name[0]?.toUpperCase()}</div>
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

        {phase === 'BANISH_REVEAL' && isHost && (
          <button className={styles.primaryBtn} onClick={handleCheckWin}>
            Continue
          </button>
        )}

        {phase === 'CHECK_WIN' && (
          <p className={styles.waiting}>Checking game status...</p>
        )}
      </div>
    );
  }

  return null;
}
