import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { GameState, ChallengeState } from '../game/types.js';

export interface SessionTokenRow {
  playerId: string;
  sessionId: string;
}

export interface PlayerProfile {
  deviceToken: string;
  playerName: string;
  createdAt: number;
  lastSeenAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  session_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_updated_at ON games(updated_at);

CREATE TABLE IF NOT EXISTS session_tokens (
  token TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_tokens_session_id ON session_tokens(session_id);

CREATE TABLE IF NOT EXISTS player_profiles (
  device_token TEXT PRIMARY KEY,
  player_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_player_profiles_name ON player_profiles(player_name);

CREATE TABLE IF NOT EXISTS game_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  winner TEXT NOT NULL,
  total_rounds INTEGER NOT NULL,
  player_count INTEGER NOT NULL,
  traitor_count INTEGER NOT NULL,
  history_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_records_ended_at ON game_records(ended_at);
-- Backfill UNIQUE constraint for existing DBs that pre-date Wave 2 idempotency fix
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_records_session_id ON game_records(session_id);

CREATE TABLE IF NOT EXISTS player_game_records (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES game_records(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL,
  player_name TEXT NOT NULL,
  role TEXT NOT NULL,
  outcome TEXT NOT NULL,
  survived INTEGER NOT NULL,
  was_banished INTEGER NOT NULL,
  was_murdered INTEGER NOT NULL,
  votes_cast INTEGER NOT NULL,
  votes_received INTEGER NOT NULL,
  rounds_played INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pgr_device_token ON player_game_records(device_token);
CREATE INDEX IF NOT EXISTS idx_pgr_game_id ON player_game_records(game_id);
`;

export function initDb(dbPath: string): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

function serializeGame(state: GameState): string {
  let challenge: unknown = undefined;
  if (state.challenge) {
    const c = state.challenge;
    challenge = {
      ...c,
      answers: Array.from(c.answers.entries()),
    };
  }
  const plain = { ...state, challenge };
  return JSON.stringify(plain);
}

function deserializeGame(json: string): GameState {
  const parsed = JSON.parse(json) as GameState & { challenge?: ChallengeState & { answers: unknown } };
  if (parsed.challenge) {
    const rawAnswers = parsed.challenge.answers;
    const entries = Array.isArray(rawAnswers) ? (rawAnswers as Array<[string, { answer: string | number; timestamp: number }]>) : [];
    parsed.challenge.answers = new Map(entries);
  }
  // Backfill defaults for fields added after games were persisted
  if (parsed.settings && parsed.settings.challengeTimerSeconds === undefined) {
    parsed.settings.challengeTimerSeconds = 60;
  }
  return parsed as GameState;
}

export function saveGame(db: Database.Database, state: GameState): void {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO games (session_id, data, updated_at) VALUES (?, ?, ?)'
  );
  stmt.run(state.sessionId, serializeGame(state), Date.now());
}

export function loadGame(db: Database.Database, sessionId: string): GameState | null {
  const row = db.prepare('SELECT data FROM games WHERE session_id = ?').get(sessionId) as { data: string } | undefined;
  if (!row) return null;
  return deserializeGame(row.data);
}

export function deleteGame(db: Database.Database, sessionId: string): void {
  db.prepare('DELETE FROM games WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM session_tokens WHERE session_id = ?').run(sessionId);
}

export function loadAllGames(db: Database.Database): GameState[] {
  const rows = db.prepare('SELECT data FROM games').all() as Array<{ data: string }>;
  return rows.map((r) => deserializeGame(r.data));
}

export function cleanupOldGames(db: Database.Database, maxAgeMs: number): number {
  const cutoff = Date.now() - maxAgeMs;
  const result = db.prepare('DELETE FROM games WHERE updated_at < ?').run(cutoff);
  db.prepare('DELETE FROM session_tokens WHERE session_id NOT IN (SELECT session_id FROM games)').run();
  return result.changes;
}

export function saveToken(db: Database.Database, token: string, data: SessionTokenRow): void {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO session_tokens (token, player_id, session_id, created_at) VALUES (?, ?, ?, ?)'
  );
  stmt.run(token, data.playerId, data.sessionId, Date.now());
}

export function loadToken(db: Database.Database, token: string): SessionTokenRow | null {
  const row = db.prepare(
    'SELECT player_id as playerId, session_id as sessionId FROM session_tokens WHERE token = ?'
  ).get(token) as SessionTokenRow | undefined;
  return row ?? null;
}

export function deleteToken(db: Database.Database, token: string): void {
  db.prepare('DELETE FROM session_tokens WHERE token = ?').run(token);
}

export function loadAllTokens(db: Database.Database): Map<string, SessionTokenRow> {
  const rows = db.prepare(
    'SELECT token, player_id as playerId, session_id as sessionId FROM session_tokens'
  ).all() as Array<{ token: string; playerId: string; sessionId: string }>;
  const map = new Map<string, SessionTokenRow>();
  for (const row of rows) {
    map.set(row.token, { playerId: row.playerId, sessionId: row.sessionId });
  }
  return map;
}

// ============= Player Profiles  =============

export function upsertPlayerProfile(
  db: Database.Database,
  deviceToken: string,
  playerName: string
): { isReturning: boolean } {
  const now = Date.now();
  const existing = db.prepare('SELECT 1 FROM player_profiles WHERE device_token = ?').get(deviceToken);
  if (existing) {
    db.prepare('UPDATE player_profiles SET player_name = ?, last_seen_at = ? WHERE device_token = ?')
      .run(playerName, now, deviceToken);
    return { isReturning: true };
  }
  db.prepare('INSERT INTO player_profiles (device_token, player_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
    .run(deviceToken, playerName, now, now);
  return { isReturning: false };
}

export function getPlayerProfile(db: Database.Database, deviceToken: string): PlayerProfile | null {
  const row = db.prepare(
    'SELECT device_token as deviceToken, player_name as playerName, created_at as createdAt, last_seen_at as lastSeenAt FROM player_profiles WHERE device_token = ?'
  ).get(deviceToken) as PlayerProfile | undefined;
  return row ?? null;
}

export function getPlayerProfileByName(db: Database.Database, playerName: string): PlayerProfile | null {
  const row = db.prepare(
    'SELECT device_token as deviceToken, player_name as playerName, created_at as createdAt, last_seen_at as lastSeenAt FROM player_profiles WHERE player_name = ? LIMIT 1'
  ).get(playerName) as PlayerProfile | undefined;
  return row ?? null;
}

// ============= Game Records & Stats  =============

export interface PlayerGameRecord {
  id: string;
  gameId: string;
  deviceToken: string;
  playerName: string;
  role: 'TRAITOR' | 'FAITHFUL';
  outcome: 'WON' | 'LOST';
  survived: boolean;
  wasBanished: boolean;
  wasMurdered: boolean;
  votesCast: number;
  votesReceived: number;
  roundsPlayed: number;
}

export interface GameRecord {
  id: string;
  sessionId: string;
  startedAt: number;
  endedAt: number;
  winner: 'TRAITORS' | 'FAITHFUL';
  totalRounds: number;
  playerCount: number;
  traitorCount: number;
  historyJson: string;
  playerRecords: PlayerGameRecord[];
}

export interface PlayerStats {
  gamesPlayed: number;
  winsAsTraitor: number;
  lossesAsTraitor: number;
  winsAsFaithful: number;
  lossesAsFaithful: number;
  totalSurvived: number;
  totalBanished: number;
  totalMurdered: number;
  totalVotesCast: number;
  totalVotesReceived: number;
  winRate: number;
  traitorWinRate: number;
  faithfulWinRate: number;
  averageRoundsPlayed: number;
}

export interface GameSummary {
  gameId: string;
  sessionId: string;
  endedAt: number;
  winner: 'TRAITORS' | 'FAITHFUL';
  role: 'TRAITOR' | 'FAITHFUL';
  outcome: 'WON' | 'LOST';
  playerCount: number;
  totalRounds: number;
}

export interface LeaderboardEntry {
  rankId: string;
  playerName: string;
  value: number;
  gamesPlayed: number;
}

export interface GlobalStats {
  totalGamesPlayed: number;
  totalPlayersEver: number;
  faithfulWinRate: number;
  traitorWinRate: number;
  averageGameLength: number;
}

export function saveGameRecord(db: Database.Database, record: GameRecord): void {
  // INSERT OR IGNORE on the (session_id UNIQUE) game row makes write idempotent across:
  //   - server restarts that re-trigger end-of-game
  //   - duplicate end-game broadcasts from CHECK_WIN + CONTINUE_TO_DAY paths
  // If the parent row is skipped, no player rows are inserted (transactional all-or-nothing).
  const insertGame = db.prepare(
    'INSERT OR IGNORE INTO game_records (id, session_id, started_at, ended_at, winner, total_rounds, player_count, traitor_count, history_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertPlayer = db.prepare(
    'INSERT INTO player_game_records (id, game_id, device_token, player_name, role, outcome, survived, was_banished, was_murdered, votes_cast, votes_received, rounds_played) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const tx = db.transaction(() => {
    const result = insertGame.run(
      record.id,
      record.sessionId,
      record.startedAt,
      record.endedAt,
      record.winner,
      record.totalRounds,
      record.playerCount,
      record.traitorCount,
      record.historyJson
    );
    // Skip per-player inserts if the game row was a duplicate (already recorded).
    if (result.changes === 0) return;
    for (const pr of record.playerRecords) {
      insertPlayer.run(
        pr.id,
        pr.gameId,
        pr.deviceToken,
        pr.playerName,
        pr.role,
        pr.outcome,
        pr.survived ? 1 : 0,
        pr.wasBanished ? 1 : 0,
        pr.wasMurdered ? 1 : 0,
        pr.votesCast,
        pr.votesReceived,
        pr.roundsPlayed
      );
    }
  });
  tx();
}

export function getPlayerStats(db: Database.Database, deviceToken: string): PlayerStats | null {
  const rows = db.prepare(
    'SELECT role, outcome, survived, was_banished, was_murdered, votes_cast, votes_received, rounds_played FROM player_game_records WHERE device_token = ?'
  ).all(deviceToken) as Array<{
    role: 'TRAITOR' | 'FAITHFUL';
    outcome: 'WON' | 'LOST';
    survived: number;
    was_banished: number;
    was_murdered: number;
    votes_cast: number;
    votes_received: number;
    rounds_played: number;
  }>;

  if (rows.length === 0) return null;

  let winsAsTraitor = 0;
  let lossesAsTraitor = 0;
  let winsAsFaithful = 0;
  let lossesAsFaithful = 0;
  let totalSurvived = 0;
  let totalBanished = 0;
  let totalMurdered = 0;
  let totalVotesCast = 0;
  let totalVotesReceived = 0;
  let totalRoundsPlayed = 0;

  for (const r of rows) {
    if (r.role === 'TRAITOR') {
      if (r.outcome === 'WON') winsAsTraitor++; else lossesAsTraitor++;
    } else {
      if (r.outcome === 'WON') winsAsFaithful++; else lossesAsFaithful++;
    }
    totalSurvived += r.survived;
    totalBanished += r.was_banished;
    totalMurdered += r.was_murdered;
    totalVotesCast += r.votes_cast;
    totalVotesReceived += r.votes_received;
    totalRoundsPlayed += r.rounds_played;
  }

  const gamesPlayed = rows.length;
  const totalWins = winsAsTraitor + winsAsFaithful;
  const traitorGames = winsAsTraitor + lossesAsTraitor;
  const faithfulGames = winsAsFaithful + lossesAsFaithful;

  return {
    gamesPlayed,
    winsAsTraitor,
    lossesAsTraitor,
    winsAsFaithful,
    lossesAsFaithful,
    totalSurvived,
    totalBanished,
    totalMurdered,
    totalVotesCast,
    totalVotesReceived,
    winRate: gamesPlayed > 0 ? totalWins / gamesPlayed : 0,
    traitorWinRate: traitorGames > 0 ? winsAsTraitor / traitorGames : 0,
    faithfulWinRate: faithfulGames > 0 ? winsAsFaithful / faithfulGames : 0,
    averageRoundsPlayed: gamesPlayed > 0 ? totalRoundsPlayed / gamesPlayed : 0,
  };
}

export function getRecentGames(db: Database.Database, deviceToken: string, limit: number): GameSummary[] {
  const rows = db.prepare(
    `SELECT g.id as gameId, g.session_id as sessionId, g.ended_at as endedAt, g.winner as winner,
            p.role as role, p.outcome as outcome, g.player_count as playerCount, g.total_rounds as totalRounds
     FROM player_game_records p
     JOIN game_records g ON g.id = p.game_id
     WHERE p.device_token = ?
     ORDER BY g.ended_at DESC
     LIMIT ?`
  ).all(deviceToken, limit) as GameSummary[];
  return rows;
}

export function getLeaderboard(
  db: Database.Database,
  metric: 'winRate' | 'gamesPlayed' | 'traitorWins'
): LeaderboardEntry[] {
  const minGames = 3;

  // SECURITY: never expose the persistent device_token outside the server.
  // We use ROW_NUMBER as the opaque list key (stable for one query, not a
  // persistent identifier).
  if (metric === 'gamesPlayed') {
    const rows = db.prepare(
      `SELECT CAST(ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS TEXT) as rankId,
              COALESCE(pp.player_name, p.player_name) as playerName,
              COUNT(*) as value, COUNT(*) as gamesPlayed
       FROM player_game_records p
       LEFT JOIN player_profiles pp ON pp.device_token = p.device_token
       GROUP BY p.device_token
       HAVING COUNT(*) >= ?
       ORDER BY value DESC
       LIMIT 20`
    ).all(minGames) as LeaderboardEntry[];
    return rows;
  }

  if (metric === 'traitorWins') {
    const rows = db.prepare(
      `SELECT CAST(ROW_NUMBER() OVER (ORDER BY SUM(CASE WHEN p.role = 'TRAITOR' AND p.outcome = 'WON' THEN 1 ELSE 0 END) DESC) AS TEXT) as rankId,
              COALESCE(pp.player_name, MAX(p.player_name)) as playerName,
              SUM(CASE WHEN p.role = 'TRAITOR' AND p.outcome = 'WON' THEN 1 ELSE 0 END) as value,
              COUNT(*) as gamesPlayed
       FROM player_game_records p
       LEFT JOIN player_profiles pp ON pp.device_token = p.device_token
       GROUP BY p.device_token
       HAVING COUNT(*) >= ?
       ORDER BY value DESC
       LIMIT 20`
    ).all(minGames) as LeaderboardEntry[];
    return rows;
  }

  // winRate
  const rows = db.prepare(
    `SELECT CAST(ROW_NUMBER() OVER (ORDER BY CAST(SUM(CASE WHEN p.outcome = 'WON' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) DESC, COUNT(*) DESC) AS TEXT) as rankId,
            COALESCE(pp.player_name, MAX(p.player_name)) as playerName,
            CAST(SUM(CASE WHEN p.outcome = 'WON' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as value,
            COUNT(*) as gamesPlayed
     FROM player_game_records p
     LEFT JOIN player_profiles pp ON pp.device_token = p.device_token
     GROUP BY p.device_token
     HAVING COUNT(*) >= ?
     ORDER BY value DESC, gamesPlayed DESC
     LIMIT 20`
  ).all(minGames) as LeaderboardEntry[];
  return rows;
}

export function getGlobalStats(db: Database.Database): GlobalStats {
  const totals = db.prepare(
    `SELECT COUNT(*) as totalGamesPlayed,
            COALESCE(AVG(total_rounds), 0) as averageGameLength,
            COALESCE(SUM(CASE WHEN winner = 'FAITHFUL' THEN 1 ELSE 0 END), 0) as faithfulWins,
            COALESCE(SUM(CASE WHEN winner = 'TRAITORS' THEN 1 ELSE 0 END), 0) as traitorWins
     FROM game_records`
  ).get() as { totalGamesPlayed: number; averageGameLength: number; faithfulWins: number; traitorWins: number };

  const playersRow = db.prepare(
    'SELECT COUNT(DISTINCT device_token) as n FROM player_profiles'
  ).get() as { n: number };

  const total = totals.totalGamesPlayed;
  return {
    totalGamesPlayed: total,
    totalPlayersEver: playersRow.n,
    faithfulWinRate: total > 0 ? totals.faithfulWins / total : 0,
    traitorWinRate: total > 0 ? totals.traitorWins / total : 0,
    averageGameLength: totals.averageGameLength,
  };
}
