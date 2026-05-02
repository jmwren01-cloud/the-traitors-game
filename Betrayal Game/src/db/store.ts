import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { GameState, ChallengeState } from '../game/types.js';

export interface SessionTokenRow {
  playerId: string;
  sessionId: string;
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
