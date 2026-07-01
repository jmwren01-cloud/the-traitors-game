import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { handleConnection, cleanupSessionTimers } from './router.js';
import type { WsContext } from './router.js';
import type { GameState } from '../game/types.js';

// A fake socket that behaves enough like a ws.WebSocket for the router.
class FakeWs extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  sent: any[] = [];
  send(data: string) {
    try { this.sent.push(JSON.parse(data)); } catch { this.sent.push(data); }
  }
  close() { this.readyState = 3; this.emit('close'); }
  recv(event: any) { this.emit('message', JSON.stringify(event)); }
}

function makeCtx(): { ctx: WsContext; games: Map<string, GameState> } {
  const games = new Map<string, GameState>();
  const playerConnections = new Map<string, any>();
  const sessionTokens = new Map<string, { playerId: string; sessionId: string }>();
  const disconnectedPlayers = new Map<string, any>();
  const ctx: WsContext = {
    games,
    playerConnections,
    sessionTokens,
    disconnectedPlayers,
    setGame: (state) => { games.set(state.sessionId, state); },
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

interface Client { ws: FakeWs; id: string; name: string; }

function drainTimers() {
  // Advance enough for any scheduled window/reveal timers to fire.
  // Booth = 60s, token placement = 45s, token reveal = 5s,
  // vote reveal interval = 4s * n, challenge = 60s.
  vi.advanceTimersByTime(70_000);
}

// Play a full game with `n` players; returns the final phase + winner.
function playGame(n: number, seedOffset: number): { phase: string; winner: string | undefined; rounds: number; log: string[] } {
  const { ctx, games } = makeCtx();
  const log: string[] = [];

  // deterministic-ish RNG replacement so games actually terminate.
  const clients: Client[] = [];

  // Host creates game.
  const hostWs = new FakeWs();
  handleConnection(hostWs as any, ctx);
  hostWs.recv({ type: 'C2S_CREATE_GAME', payload: { playerName: 'Host' } });
  const created = hostWs.sent.find((m) => m.type === 'S2C_GAME_CREATED');
  const sessionId = created.payload.sessionId;
  clients.push({ ws: hostWs, id: created.payload.playerId, name: 'Host' });

  for (let i = 1; i < n; i++) {
    const ws = new FakeWs();
    handleConnection(ws as any, ctx);
    ws.recv({ type: 'C2S_JOIN_GAME', payload: { sessionId, playerName: `P${i}` } });
    const joined = ws.sent.find((m) => m.type === 'S2C_GAME_JOINED');
    clients.push({ ws, id: joined.payload.playerId, name: `P${i}` });
  }

  const state = () => games.get(sessionId)!;
  const hostId = () => state().hostId;
  const hostClient = () => clients.find((c) => c.id === hostId())!;
  const alive = () => state().players.filter((p) => p.isAlive);
  const clientOf = (id: string) => clients.find((c) => c.id === id)!;

  let lastPhase = '';
  let guard = 0;
  const MAX = 2000;

  while (guard++ < MAX) {
    const s = state();
    if (s.phase !== lastPhase) {
      log.push(`R${s.currentRound}:${s.phase}${s.confessionPhase ? '/' + s.confessionPhase : ''}${s.tokenPhase ? '/tok:' + s.tokenPhase : ''}`);
      lastPhase = s.phase + (s.confessionPhase ?? '') + (s.tokenPhase ?? '');
    }
    if (s.phase === 'GAME_END') {
      return { phase: s.phase, winner: s.winner, rounds: s.currentRound, log };
    }

    switch (s.phase) {
      case 'LOBBY':
        hostClient().ws.recv({ type: 'C2S_START_GAME', payload: {} });
        break;
      case 'ROLE_ASSIGN':
        hostClient().ws.recv({ type: 'C2S_ASSIGN_ROLES', payload: {} });
        break;
      case 'ROLE_REVEAL':
        hostClient().ws.recv({ type: 'C2S_START_ROUNDTABLE', payload: {} });
        break;
      case 'ROUNDTABLE': {
        if (s.confessionPhase === 'BOOTH') {
          // every alive player confesses -> early resolve
          for (const p of alive()) {
            clientOf(p.id).ws.recv({ type: 'C2S_SUBMIT_CONFESSION', payload: { content: 'I have nothing to hide here.' } });
          }
          // if some couldn't (already?), drain the 60s booth timer
          if (state().confessionPhase === 'BOOTH') drainTimers();
          break;
        }
        // discussion open. round1DiscussionOnly -> go to night, else voting
        const round1Only = s.currentRound === 1 && s.settings.round1DiscussionOnly;
        if (round1Only) {
          hostClient().ws.recv({ type: 'C2S_START_NIGHT', payload: {} });
          break;
        }
        if (s.tokenPhase === undefined) {
          hostClient().ws.recv({ type: 'C2S_START_VOTING', payload: {} });
          break;
        }
        // token phase in progress -> place tokens then drain
        if (s.tokenPhase === 'PLACEMENT') {
          for (const p of alive()) {
            const target = alive().find((q) => q.id !== p.id)!;
            clientOf(p.id).ws.recv({ type: 'C2S_PLACE_SUSPICION_TOKEN', payload: { targetId: target.id } });
          }
        }
        drainTimers(); // resolve placement -> reveal -> voting
        break;
      }
      case 'VOTING':
      case 'REVOTE': {
        // Everyone votes for a chosen banish target: to make the game
        // progress toward an end, faithful target a traitor when known,
        // else the first alive non-self. In REVOTE only tied candidates.
        const voters = alive();
        for (const p of voters) {
          let candidates = alive().filter((q) => q.id !== p.id);
          if (s.phase === 'REVOTE' && s.tiedPlayerIds) {
            candidates = candidates.filter((q) => s.tiedPlayerIds!.includes(q.id));
          }
          if (candidates.length === 0) continue;
          // Bias: vote out a traitor if this game state exposes one alive.
          const traitorTarget = candidates.find((q) => q.role === 'TRAITOR');
          const target = traitorTarget ?? candidates[0]!;
          const evt = s.phase === 'REVOTE'
            ? { type: 'C2S_SUBMIT_REVOTE', payload: { targetId: target.id } }
            : { type: 'C2S_SUBMIT_VOTE', payload: { targetId: target.id } };
          clientOf(p.id).ws.recv(evt as any);
        }
        // advance vote reveal sequence timers
        drainTimers();
        break;
      }
      case 'VOTE_REVEAL': {
        // Handle shield gate: any top candidate holding a shield declines it.
        drainTimers(); // ensure reveal complete
        const s2 = state();
        // Decline shields for anyone who might block banishment.
        for (const p of s2.players.filter((p) => p.isAlive && p.hasShield && !p.shieldRevealed)) {
          clientOf(p.id).ws.recv({ type: 'C2S_DECLINE_SHIELD', payload: {} });
        }
        if (state().phase === 'VOTE_REVEAL') {
          hostClient().ws.recv({ type: 'C2S_BANISH_PLAYER', payload: {} });
        }
        break;
      }
      case 'TIE_DETECTED':
        hostClient().ws.recv({ type: 'C2S_START_REVOTE', payload: {} });
        break;
      case 'BANISH_REVEAL':
        hostClient().ws.recv({ type: 'C2S_CHECK_WIN', payload: {} });
        break;
      case 'TIEBREAKER_REVEAL':
        hostClient().ws.recv({ type: 'C2S_CHECK_WIN', payload: {} });
        break;
      case 'NIGHT': {
        const traitors = alive().filter((p) => p.role === 'TRAITOR');
        const victim = alive().find((p) => p.role !== 'TRAITOR');
        if (!victim) { drainTimers(); break; }
        for (const t of traitors) {
          clientOf(t.id).ws.recv({ type: 'C2S_SUBMIT_MURDER', payload: { targetId: victim.id } });
        }
        break;
      }
      case 'MORNING':
        hostClient().ws.recv({ type: 'C2S_CONTINUE_TO_DAY', payload: {} });
        break;
      case 'CHALLENGE': {
        for (const p of alive()) {
          clientOf(p.id).ws.recv({ type: 'C2S_SUBMIT_CHALLENGE_ANSWER', payload: { answer: '5' } });
        }
        if (state().phase === 'CHALLENGE') {
          // TIME_ESTIMATE won't auto-resolve to winner; drain timer.
          drainTimers();
          if (state().phase === 'CHALLENGE') {
            hostClient().ws.recv({ type: 'C2S_CONTINUE_TO_ROUNDTABLE', payload: {} });
          }
        }
        break;
      }
      case 'CHALLENGE_RESULT':
        hostClient().ws.recv({ type: 'C2S_CONTINUE_TO_ROUNDTABLE', payload: {} });
        break;
      default:
        throw new Error(`Unhandled phase ${s.phase}; log:\n${log.join('\n')}`);
    }
  }

  cleanupSessionTimers(sessionId);
  return { phase: 'STALLED', winner: undefined, rounds: state().currentRound, log };
}

describe('full game end-to-end simulation', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  for (const n of [5, 6, 7, 8, 9, 10, 12, 15]) {
    it(`completes a full game with ${n} players`, () => {
      const result = playGame(n, n);
      // eslint-disable-next-line no-console
      if (result.phase !== 'GAME_END') {
        console.log(`\n=== ${n} players: ${result.phase} ===\n` + result.log.join('\n'));
      }
      expect(result.phase, `game with ${n} players did not reach GAME_END. Log:\n${result.log.join('\n')}`).toBe('GAME_END');
      expect(['TRAITORS', 'FAITHFUL']).toContain(result.winner);
    });
  }
});
