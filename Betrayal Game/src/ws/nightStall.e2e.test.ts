import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { handleConnection } from './router.js';
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

// Drive a game to its first NIGHT with challenges/special roles/round1-only
// disabled and a forced 2-traitor count so we can reliably reach NIGHT and
// exercise the "one traitor never votes" case.
function driveToNight(n: number) {
  const { ctx, games } = makeCtx();
  const clients: { ws: FakeWs; id: string }[] = [];
  const host = new FakeWs();
  handleConnection(host as any, ctx);
  host.recv({ type: 'C2S_CREATE_GAME', payload: { playerName: 'Host' } });
  const sessionId = games.keys().next().value as string;
  const hostId = (host.sent.find((m) => m.type === 'S2C_GAME_CREATED')).payload.playerId;
  clients.push({ ws: host, id: hostId });

  for (let i = 1; i < n; i++) {
    const ws = new FakeWs();
    handleConnection(ws as any, ctx);
    ws.recv({ type: 'C2S_JOIN_GAME', payload: { sessionId, playerName: `P${i}` } });
    const id = (ws.sent.find((m) => m.type === 'S2C_GAME_JOINED')).payload.playerId;
    clients.push({ ws, id });
  }

  // Turn off challenges / special roles / round1-only, force 2 traitors.
  host.recv({ type: 'C2S_UPDATE_SETTINGS', payload: { settings: {
    challengesEnabled: false, enableSpecialRoles: false, round1DiscussionOnly: false,
    traitorMode: 'fixed', traitorCount: 2,
  } } });

  const state = () => games.get(sessionId)!;
  const clientOf = (id: string) => clients.find((c) => c.id === id)!;
  const hostClient = () => clientOf(state().hostId);
  const alive = () => state().players.filter((p) => p.isAlive);

  host.recv({ type: 'C2S_START_GAME', payload: {} });
  host.recv({ type: 'C2S_ASSIGN_ROLES', payload: {} });
  host.recv({ type: 'C2S_START_ROUNDTABLE', payload: {} });
  // Confession booth: everyone confesses -> early resolve.
  for (const p of alive()) clientOf(p.id).ws.recv({ type: 'C2S_SUBMIT_CONFESSION', payload: { content: 'nothing to hide here' } });
  // Discussion open -> start voting (opens suspicion token placement).
  hostClient().ws.recv({ type: 'C2S_START_VOTING', payload: {} });
  for (const p of alive()) {
    const t = alive().find((q) => q.id !== p.id)!;
    clientOf(p.id).ws.recv({ type: 'C2S_PLACE_SUSPICION_TOKEN', payload: { targetId: t.id } });
  }
  vi.advanceTimersByTime(60_000); // resolve token placement + reveal -> VOTING
  // Vote: everyone votes the first alive non-self (creates a banishment).
  for (const p of alive()) {
    const t = alive().find((q) => q.id !== p.id)!;
    clientOf(p.id).ws.recv({ type: 'C2S_SUBMIT_VOTE', payload: { targetId: t.id } });
  }
  vi.advanceTimersByTime(60_000); // vote reveal sequence
  // Decline any shields, then banish.
  for (const p of state().players.filter((p) => p.isAlive && p.hasShield && !p.shieldRevealed)) {
    clientOf(p.id).ws.recv({ type: 'C2S_DECLINE_SHIELD', payload: {} });
  }
  if (state().phase === 'VOTE_REVEAL') hostClient().ws.recv({ type: 'C2S_BANISH_PLAYER', payload: {} });
  // Banish -> check win -> NIGHT (round 1, currentRound===1 -> NIGHT).
  if (state().phase === 'BANISH_REVEAL') hostClient().ws.recv({ type: 'C2S_CHECK_WIN', payload: {} });
  return { ctx, games, sessionId, state, clientOf, hostClient, alive };
}

describe('NIGHT phase must not stall when a traitor never votes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('auto-resolves the murder once the night timer expires (no traitor votes)', () => {
    const h = driveToNight(9);
    // We should be in NIGHT with at least one alive traitor.
    expect(h.state().phase).toBe('NIGHT');
    const traitors = h.alive().filter((p) => p.role === 'TRAITOR');
    expect(traitors.length).toBeGreaterThanOrEqual(1);

    // Simulate every alive traitor being AFK / disconnected: nobody submits a
    // murder vote. Today this freezes the game forever in NIGHT.
    expect(h.state().phase).toBe('NIGHT');

    // Advance well past the 90s night timer. A robust game must resolve.
    vi.advanceTimersByTime(120_000);

    expect(h.state().phase, 'Night should auto-resolve after the timer expires').toBe('MORNING');
  });

  it('auto-resolves when only some (not all) alive traitors vote', () => {
    const h = driveToNight(12);
    expect(h.state().phase).toBe('NIGHT');
    const traitors = h.alive().filter((p) => p.role === 'TRAITOR');
    if (traitors.length >= 2) {
      const victim = h.alive().find((p) => p.role !== 'TRAITOR')!;
      // Only the first traitor votes; the rest are AFK.
      h.clientOf(traitors[0]!.id).ws.recv({ type: 'C2S_SUBMIT_MURDER', payload: { targetId: victim.id } });
      expect(h.state().phase).toBe('NIGHT');
    }
    vi.advanceTimersByTime(120_000);
    expect(h.state().phase, 'Night should auto-resolve after the timer expires').toBe('MORNING');
  });
});
