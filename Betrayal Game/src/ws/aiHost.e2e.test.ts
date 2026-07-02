import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { handleConnection, cleanupSessionTimers } from './router.js';
import type { WsContext } from './router.js';
import type { GameState } from '../game/types.js';

class FakeWs extends EventEmitter {
  readyState = 1;
  sent: any[] = [];
  send(data: string) { try { this.sent.push(JSON.parse(data)); } catch { this.sent.push(data); } }
  close() { this.readyState = 3; this.emit('close'); }
  recv(event: any) { this.emit('message', JSON.stringify(event)); }
}

function makeCtx() {
  const games = new Map<string, GameState>();
  const playerConnections = new Map<string, any>();
  const sessionTokens = new Map<string, any>();
  const disconnectedPlayers = new Map<string, any>();
  const ctx: WsContext = {
    games, playerConnections, sessionTokens, disconnectedPlayers,
    setGame: (s) => { games.set(s.sessionId, s); },
    removeGame: (id) => { games.delete(id); },
    setToken: (t, d) => { sessionTokens.set(t, d); },
    removeToken: (t) => { sessionTokens.delete(t); },
    upsertPlayerProfile: () => ({ isReturning: false }),
    writeGameRecordIfNeeded: () => {},
    getPlayerStatsBundle: () => ({} as any),
    getLeaderboardEntries: () => [],
    getGlobalStats: () => ({} as any),
  };
  return { ctx, games };
}

/**
 * Run an AI-Host game with n players where NO player and NO human host ever
 * presses anything after "Start Game". Everything — role assignment, ending
 * discussion, resolving votes, banishing, night murder, morning, next round —
 * must be driven purely by the server-side director as we advance fake timers.
 */
function runHandsFree(n: number) {
  const { ctx, games } = makeCtx();
  const clients: FakeWs[] = [];
  const host = new FakeWs();
  handleConnection(host as any, ctx);
  host.recv({ type: 'C2S_CREATE_GAME', payload: { playerName: 'Host' } });
  const sessionId = games.keys().next().value as string;
  clients.push(host);
  for (let i = 1; i < n; i++) {
    const ws = new FakeWs();
    handleConnection(ws as any, ctx);
    ws.recv({ type: 'C2S_JOIN_GAME', payload: { sessionId, playerName: `P${i}` } });
    clients.push(ws);
  }

  // Enable AI Host, then start. After this, we send NOTHING else.
  host.recv({ type: 'C2S_UPDATE_SETTINGS', payload: { settings: { aiHost: true } } });
  host.recv({ type: 'C2S_START_GAME', payload: {} });

  const state = () => games.get(sessionId)!;
  const seen = new Set<string>();
  // Advance fake time in chunks; the director's self-rescheduling timer plus
  // the booth/token/night/vote-reveal sub-timers all fire as we go.
  for (let i = 0; i < 4000 && state().phase !== 'GAME_END'; i++) {
    vi.advanceTimersByTime(5_000);
    seen.add(state().phase);
  }

  const narrations = clients[0]!.sent.filter((m) => m.type === 'S2C_HOST_NARRATION');
  cleanupSessionTimers(sessionId);
  return { state: state(), phasesSeen: seen, narrations };
}

describe('AI Host drives a full game with zero human input', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  for (const n of [5, 7, 9, 12]) {
    it(`reaches GAME_END hands-free with ${n} players`, () => {
      const { state, phasesSeen, narrations } = runHandsFree(n);
      expect(state.phase, `AI Host game (${n}) did not finish; last phase ${state.phase}`).toBe('GAME_END');
      expect(['TRAITORS', 'FAITHFUL']).toContain(state.winner);
      // It actually played rounds, not just insta-ended.
      expect(phasesSeen.has('NIGHT')).toBe(true);
      expect(phasesSeen.has('VOTE_REVEAL') || phasesSeen.has('BANISH_REVEAL')).toBe(true);
      // The host narrated along the way.
      expect(narrations.length).toBeGreaterThan(0);
    });
  }

  it('auto-disables challenges when AI Host is enabled', () => {
    const { ctx, games } = makeCtx();
    const host = new FakeWs();
    handleConnection(host as any, ctx);
    host.recv({ type: 'C2S_CREATE_GAME', payload: { playerName: 'Host' } });
    const sessionId = games.keys().next().value as string;
    host.recv({ type: 'C2S_UPDATE_SETTINGS', payload: { settings: { aiHost: true, challengesEnabled: true } } });
    expect(games.get(sessionId)!.settings.aiHost).toBe(true);
    expect(games.get(sessionId)!.settings.challengesEnabled).toBe(false);
  });
});
