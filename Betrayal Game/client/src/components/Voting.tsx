import { useState } from 'react';
import type { Player, C2SEvent, Role, Vote } from '../types';
import styles from './Voting.module.css';

interface VotingProps {
  players: Player[];
  myPlayerId?: string;
  phase: string;
  votes?: Vote[];
  banishedPlayer?: { id: string; name: string; role: Role };
  onSend: (event: C2SEvent) => void;
}

export function Voting({ players, myPlayerId, phase, votes, banishedPlayer, onSend }: VotingProps) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);

  const isHost = players.find((p) => p.id === myPlayerId)?.isHost;
  const alivePlayers = players.filter((p) => p.isAlive);
  const myPlayer = players.find((p) => p.id === myPlayerId);
  const canVote = myPlayer?.isAlive && !hasVoted && phase === 'VOTING';

  const handleVote = () => {
    if (selectedTarget) {
      onSend({ type: 'C2S_SUBMIT_VOTE', payload: { targetId: selectedTarget } });
      setHasVoted(true);
    }
  };

  const handleRevealVotes = () => {
    onSend({ type: 'C2S_REVEAL_VOTES', payload: {} });
  };

  const handleBanish = () => {
    onSend({ type: 'C2S_BANISH_PLAYER', payload: {} });
  };

  const handleCheckWin = () => {
    onSend({ type: 'C2S_CHECK_WIN', payload: {} });
  };

  const getVoteCount = (playerId: string) => {
    if (!votes) return 0;
    return votes.filter((v) => v.targetId === playerId).length;
  };

  if (phase === 'ROUNDTABLE') {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>The Roundtable</h1>
        <p className={styles.subtitle}>Discuss amongst yourselves...</p>

        <div className={styles.playerGrid}>
          {alivePlayers.map((player) => (
            <div key={player.id} className={`${styles.playerCard} ${player.id === myPlayerId ? styles.me : ''}`}>
              <div className={styles.avatar}>{player.name[0]?.toUpperCase()}</div>
              <span className={styles.name}>{player.name}</span>
            </div>
          ))}
        </div>

        {isHost && (
          <button className={styles.primaryBtn} onClick={() => onSend({ type: 'C2S_START_VOTING', payload: {} })}>
            Start Voting
          </button>
        )}
        {!isHost && <p className={styles.waiting}>Waiting for host to start voting...</p>}
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

        {canVote && (
          <button className={styles.voteBtn} onClick={handleVote} disabled={!selectedTarget}>
            Cast Vote
          </button>
        )}

        {hasVoted && <p className={styles.votedText}>Vote submitted. Waiting for others...</p>}

        {isHost && (
          <button className={styles.secondaryBtn} onClick={handleRevealVotes}>
            Reveal Votes
          </button>
        )}
      </div>
    );
  }

  if (phase === 'VOTE_REVEAL' && votes) {
    const voteCounts = alivePlayers.map((p) => ({
      player: p,
      count: getVoteCount(p.id),
    }));
    const maxVotes = Math.max(...voteCounts.map((vc) => vc.count));
    const mostVoted = voteCounts.filter((vc) => vc.count === maxVotes);

    return (
      <div className={styles.container}>
        <h1 className={styles.title}>The Votes Are In</h1>

        <div className={styles.voteResults}>
          {voteCounts
            .sort((a, b) => b.count - a.count)
            .map(({ player, count }) => (
              <div
                key={player.id}
                className={`${styles.voteResult} ${count === maxVotes && count > 0 ? styles.topVote : ''}`}
              >
                <div className={styles.avatar}>{player.name[0]?.toUpperCase()}</div>
                <span className={styles.name}>{player.name}</span>
                <span className={styles.voteCount}>{count} vote{count !== 1 ? 's' : ''}</span>
              </div>
            ))}
        </div>

        {mostVoted.length === 1 && mostVoted[0] && maxVotes > 0 && (
          <p className={styles.banishMessage}>
            <strong>{mostVoted[0].player.name}</strong> will be banished!
          </p>
        )}

        {isHost && (
          <button className={styles.dangerBtn} onClick={handleBanish}>
            Banish Player
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
