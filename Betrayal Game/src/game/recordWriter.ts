

import crypto from 'crypto';
import type { GameState, Player, RoundRecord } from './types.js';
import type { GameRecord, PlayerGameRecord } from '../db/store.js';

/**
 * Build a GameRecord (game-level row + per-player rows) from a finished game.
 * Returns null if the game is missing required data (no winner, no startedAt, etc.).
 *
 * Per-player aggregates are computed by walking gameState.history:
 *   - votesCast      = number of VoteEntry where voterName == player.name
 *   - votesReceived  = number of VoteEntry where targetName == player.name
 *   - roundsPlayed   = number of rounds in history (player counts for all rounds
 *                      they were alive at the START of)
 *   - wasBanished    = any RoundRecord.banishedName matches this player
 *   - wasMurdered    = any RoundRecord.murderedName matches and !murderBlocked
 *   - survived       = player.isAlive at game end
 *   - outcome        = WON if player.role wins, otherwise LOST
 *
 * Players who never identified (no deviceToken) are skipped — stats only track
 * persistent identities.
 */
export function buildGameRecord(state: GameState): GameRecord | null {
  if (!state.winner || !state.startedAt) return null;

  const gameId = crypto.randomUUID();
  const totalRounds = state.history?.length ?? 0;
  const traitorCount = state.players.filter((p) => p.role === 'TRAITOR').length;

  const history: RoundRecord[] = state.history ?? [];

  const playerRecords: PlayerGameRecord[] = [];
  for (const p of state.players) {
    if (!p.deviceToken) continue;
    if (!p.role) continue;

    const banishedRound = history.find((r) => r.banishedName === p.name);
    const murderedRound = history.find(
      (r) => r.murderedName === p.name && !r.murderBlocked
    );

    let votesCast = 0;
    let votesReceived = 0;
    for (const r of history) {
      for (const v of r.votes ?? []) {
        if (v.voterName === p.name) votesCast++;
        if (v.targetName === p.name) votesReceived++;
      }
    }

    // Wave 4: Sheriff/Medic/Seer all share the Faithful win condition.
    // Their persisted role is normalized to 'FAITHFUL' for stats so the
    // existing schema and aggregates keep working unchanged.
    const isTraitor = p.role === 'TRAITOR';
    const won = (state.winner === 'TRAITORS' && isTraitor)
             || (state.winner === 'FAITHFUL' && !isTraitor);
    const persistedRole: 'TRAITOR' | 'FAITHFUL' = isTraitor ? 'TRAITOR' : 'FAITHFUL';

    playerRecords.push({
      id: crypto.randomUUID(),
      gameId,
      deviceToken: p.deviceToken,
      playerName: p.name,
      role: persistedRole,
      outcome: won ? 'WON' : 'LOST',
      survived: p.isAlive,
      wasBanished: !!banishedRound,
      wasMurdered: !!murderedRound,
      votesCast,
      votesReceived,
      roundsPlayed: totalRounds,
    });
  }

  return {
    id: gameId,
    sessionId: state.sessionId,
    startedAt: state.startedAt,
    endedAt: Date.now(),
    winner: state.winner,
    totalRounds,
    playerCount: state.players.length,
    traitorCount,
    historyJson: JSON.stringify(history),
    playerRecords,
  };
}
