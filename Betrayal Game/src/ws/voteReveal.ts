import { WebSocket } from 'ws';
import type { GameState } from '../game/types.js';
import { broadcastToSession } from './utils.js';

const activeRevealSequences = new Map<string, NodeJS.Timeout>();

export function startVoteRevealSequence(
  sessionId: string,
  games: Map<string, GameState>,
  playerConnections: Map<string, WebSocket>
): void {
  if (activeRevealSequences.has(sessionId)) {
    return;
  }

  const gameState = games.get(sessionId);
  if (!gameState || gameState.phase !== 'VOTE_REVEAL') {
    return;
  }

  const revealOrder = gameState.players
    .filter((p) => p.isAlive)
    .map((p) => p.id);

  const votes = [...gameState.votes];
  let revealIndex = 0;
  const currentTally = new Map<string, number>();

  broadcastToSession(sessionId, {
    type: 'S2C_VOTE_REVEAL_STARTED',
    payload: {
      phase: 'VOTE_REVEAL',
      revealOrder,
      totalVotes: votes.length
    }
  }, games, playerConnections);

  const revealNextVote = () => {
    const currentGameState = games.get(sessionId);
    if (!currentGameState || currentGameState.phase !== 'VOTE_REVEAL') {
      const timeout = activeRevealSequences.get(sessionId);
      if (timeout) clearInterval(timeout);
      activeRevealSequences.delete(sessionId);
      return;
    }

    if (revealIndex >= votes.length) {
      const timeout = activeRevealSequences.get(sessionId);
      if (timeout) clearInterval(timeout);
      activeRevealSequences.delete(sessionId);

      const finalTally = Array.from(currentTally.entries()).map(([playerId, count]) => {
        const player = currentGameState.players.find((p) => p.id === playerId);
        return {
          playerId,
          playerName: player?.name ?? 'Unknown',
          voteCount: count
        };
      }).sort((a, b) => b.voteCount - a.voteCount);

      broadcastToSession(sessionId, {
        type: 'S2C_VOTE_REVEAL_COMPLETE',
        payload: {
          allVotes: votes,
          finalTally,
        }
      }, games, playerConnections);
      return;
    }

    const vote = votes[revealIndex];
    if (!vote) {
      revealIndex++;
      return;
    }

    currentTally.set(vote.targetId, (currentTally.get(vote.targetId) ?? 0) + 1);

    const voter = currentGameState.players.find((p) => p.id === vote.voterId);
    const target = currentGameState.players.find((p) => p.id === vote.targetId);

    const tallyArray = Array.from(currentTally.entries()).map(([playerId, count]) => {
      const player = currentGameState.players.find((p) => p.id === playerId);
      return {
        playerId,
        playerName: player?.name ?? 'Unknown',
        voteCount: count
      };
    }).sort((a, b) => b.voteCount - a.voteCount);

    broadcastToSession(sessionId, {
      type: 'S2C_VOTE_REVEAL_STEP',
      payload: {
        revealIndex,
        vote,
        voterName: voter?.name ?? 'Unknown',
        targetName: target?.name ?? 'Unknown',
        currentTally: tallyArray
      }
    }, games, playerConnections);

    const updatedGame = {
      ...currentGameState,
      revealIndex: revealIndex + 1,
      revealedVotes: votes.slice(0, revealIndex + 1),
      currentTally: tallyArray
    };
    games.set(sessionId, updatedGame);

    revealIndex++;
  };

  setTimeout(revealNextVote, 1000);

  const interval = setInterval(revealNextVote, 4000);
  activeRevealSequences.set(sessionId, interval);
}
