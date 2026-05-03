import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { handleConnection, cleanupSessionTimers } from './router.js';
import type {
  GameState,
  S2CEvent,
  C2SEvent,
} from '../game/types.js';
import {
  TOKEN_PLACEMENT_WINDOW_MS,
  TOKEN_REVEAL_DURATION_MS,
} from '../game/types.js';

// =================== TEST HARNESS ===================
//
// End-to-end coverage for the Suspicion Token sub-phase as it is driven
// over the WebSocket router. We don't open a real socket — instead we
// stand up minimal in-memory WsContext + fake ws peers, capture every
// outbound broadcast per recipient, and replay client events through
// the router's `message` handler. This exercises the same code paths
// production uses (`handleConnection` → `placeSuspicionToken` /
// `fireTokenResolution` / `proceedToVotingFromTokens`) and lets us
// assert privacy rules from the consumer side, not just the producer's.

interface FakeSocket {
  readyState: number;
  send: (data: string) => void;
  on: (ev: string, cb: (...args: unknown[]) => void) => void;
  close: () => void;
}

interface Peer {
  name: string;
  socket: FakeSocket;
  received: S2CEvent[];
  send: (event: C2SEvent) => void;
  ofType: <T extends S2CEvent['type']>(type: T) => Extract<S2CEvent, { type: T }>[];
  lastOfType: <T extends S2CEvent['type']>(type: T) => Extract<S2CEvent, { type: T }> | undefined;
  clear: () => void;
  playerId?: string;
}

type Ctx = ReturnType<typeof makeContext>;

function makeContext() {
  const games = new Map<string, GameState>();
  const playerConnections = new Map<string, WebSocket>();
  const sessionTokens = new Map<string, { playerId: string; sessionId: string }>();
  const disconnectedPlayers = new Map<string, { playerId: string; sessionId: string; disconnectedAt: number }>();

  return {
    games,
    playerConnections,
    sessionTokens,
    disconnectedPlayers,
    setGame: (s: GameState) => games.set(s.sessionId, s),
    removeGame: (id: string) => games.delete(id),
    setToken: (t: string, d: { playerId: string; sessionId: string }) => sessionTokens.set(t, d),
    removeToken: (t: string) => sessionTokens.delete(t),
    upsertPlayerProfile: () => ({ isReturning: false }),
    writeGameRecordIfNeeded: () => {},
    // Stats endpoints aren't exercised by the token flow; minimal stubs.
    getPlayerStatsBundle: () => ({} as never),
    getLeaderboardEntries: () => [],
    getGlobalStats: () => ({} as never),
  };
}

function makePeer(name: string, ctx: Ctx): Peer {
  let onMessage: (data: string) => void = () => {};
  const received: S2CEvent[] = [];
  const socket: FakeSocket = {
    readyState: WebSocket.OPEN,
    send: (data) => {
      received.push(JSON.parse(data));
    },
    on: (ev, cb) => {
      if (ev === 'message') onMessage = cb as (data: string) => void;
    },
    close: () => {},
  };
  handleConnection(socket as unknown as WebSocket, ctx);
  return {
    name,
    socket,
    received,
    send: (event) => onMessage(JSON.stringify(event)),
    ofType: (type) => received.filter((e) => e.type === type) as never,
    lastOfType: (type) => {
      for (let i = received.length - 1; i >= 0; i--) {
        const e = received[i]!;
        if (e.type === type) return e as never;
      }
      return undefined;
    },
    clear: () => {
      received.length = 0;
    },
  };
}

/**
 * Drive a fresh game from LOBBY to ROUNDTABLE/PLACEMENT (Suspicion Token
 * placement window open). Returns peers in seat order, with the host at
 * index 0. Confession Booth is short-circuited by having every alive
 * player submit a confession (early-resolves the booth instantly).
 */
function setupGameInPlacement(ctx: Ctx, opts: { numPlayers?: number } = {}): {
  peers: Peer[];
  sessionId: string;
} {
  const numPlayers = opts.numPlayers ?? 5;
  const peers: Peer[] = [];

  const host = makePeer('Host', ctx);
  host.send({ type: 'C2S_CREATE_GAME', payload: { playerName: 'Host' } });
  peers.push(host);

  const created = host.lastOfType('S2C_GAME_CREATED');
  expect(created).toBeDefined();
  const sessionId = created!.payload.sessionId;
  host.playerId = created!.payload.playerId;

  for (let i = 1; i < numPlayers; i++) {
    const p = makePeer(`P${i}`, ctx);
    p.send({ type: 'C2S_JOIN_GAME', payload: { sessionId, playerName: `P${i}` } });
    const joined = p.lastOfType('S2C_GAME_JOINED');
    expect(joined).toBeDefined();
    p.playerId = joined!.payload.playerId;
    peers.push(p);
  }

  // Disable specials so role assignment is purely TRAITOR/FAITHFUL.
  const cur = ctx.games.get(sessionId)!;
  ctx.setGame({
    ...cur,
    settings: { ...cur.settings, enableSpecialRoles: false },
  });

  host.send({ type: 'C2S_START_GAME', payload: {} });
  host.send({ type: 'C2S_ASSIGN_ROLES', payload: {} });
  host.send({ type: 'C2S_START_ROUNDTABLE', payload: {} });

  // Booth opens automatically; submit for every alive player to early-resolve.
  for (const p of peers) {
    p.send({
      type: 'C2S_SUBMIT_CONFESSION',
      payload: { content: `Confession from ${p.name}` },
    });
  }
  // Booth should now be DISCUSSION; clearing per-peer noise so the rest of
  // the test only sees Suspicion-Token-related broadcasts.
  for (const p of peers) p.clear();

  host.send({ type: 'C2S_START_VOTING', payload: {} });

  // Sanity: PLACEMENT is open and every peer was notified.
  const game = ctx.games.get(sessionId)!;
  expect(game.phase).toBe('ROUNDTABLE');
  expect(game.tokenPhase).toBe('PLACEMENT');
  for (const p of peers) {
    expect(p.lastOfType('S2C_TOKEN_PHASE_STARTED')).toBeDefined();
  }

  return { peers, sessionId };
}

// =================== TESTS ===================

describe('Suspicion Token router e2e', () => {
  let ctx: Ctx;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = makeContext();
  });

  afterEach(() => {
    // Drop any pending placement / reveal / voting timers the router may
    // have scheduled so they don't bleed into the next test.
    for (const id of ctx.games.keys()) cleanupSessionTimers(id);
    vi.useRealTimers();
  });

  it('happy path: every alive placement is privacy-preserved and revealed atomically', () => {
    const { peers, sessionId } = setupGameInPlacement(ctx);

    // Each player picks the next seat clockwise so the resulting graph
    // has no self-loops and is fully deterministic.
    for (let i = 0; i < peers.length; i++) {
      const placer = peers[i]!;
      const target = peers[(i + 1) % peers.length]!;
      placer.send({
        type: 'C2S_PLACE_SUSPICION_TOKEN',
        payload: { targetId: target.playerId! },
      });
    }

    // Privacy invariant: while the window is open, the only public
    // information about placements is the count. No payload should ever
    // carry a `placerId` / `targetId` / `tokens` array.
    for (const p of peers) {
      const publicEvents = p.ofType('S2C_TOKEN_PLACED');
      expect(publicEvents.length).toBe(peers.length);
      for (const ev of publicEvents) {
        expect(Object.keys(ev.payload).sort()).toEqual(['needed', 'received']);
        expect(ev.payload.needed).toBe(peers.length);
      }
    }

    // Privacy invariant: each placer (and ONLY that placer) receives a
    // private echo confirming their target. Concretely: for every
    // placer P with target T, no OTHER peer's private-echo stream may
    // contain an entry with targetId === T (that would be a leak of
    // P's pick). Each peer's own echo carries only their own target.
    for (let i = 0; i < peers.length; i++) {
      const placer = peers[i]!;
      const expectedTarget = peers[(i + 1) % peers.length]!.playerId!;
      const echoes = placer.ofType('S2C_TOKEN_PLACED_PRIVATE');
      expect(echoes).toHaveLength(1);
      expect(echoes[0]!.payload.targetId).toBe(expectedTarget);

      const ownTarget = peers[(i + 1) % peers.length]!.playerId!;
      for (let j = 0; j < peers.length; j++) {
        if (j === i) continue;
        const other = peers[j]!;
        const otherEchoes = other.ofType('S2C_TOKEN_PLACED_PRIVATE');
        // Other peer must have exactly their OWN single echo …
        expect(otherEchoes).toHaveLength(1);
        // … and that echo must reveal only their own target — never
        // anything that would expose placer P's pick.
        const otherOwnTarget = peers[(j + 1) % peers.length]!.playerId!;
        expect(otherEchoes[0]!.payload.targetId).toBe(otherOwnTarget);
        // Direct leak check: P's targetId must never appear in any
        // OTHER peer's private echo (unless they happen to share the
        // same clockwise neighbor, which by construction they don't
        // for adjacent placers — but assert it generally).
        if (otherOwnTarget !== ownTarget) {
          for (const e of otherEchoes) {
            expect(e.payload.targetId).not.toBe(expectedTarget);
          }
        }
      }
    }

    // Pre-reveal: no one has the public graph yet.
    for (const p of peers) {
      expect(p.ofType('S2C_TOKENS_REVEALED')).toHaveLength(0);
    }

    // Fire the placement-window timeout. (The window stays open even
    // after all-alive submitted so upserts remain possible — only the
    // 45s deadline triggers the resolve.)
    vi.advanceTimersByTime(TOKEN_PLACEMENT_WINDOW_MS);

    // Every connected client must receive the same reveal payload.
    const reveals = peers.map((p) => p.lastOfType('S2C_TOKENS_REVEALED'));
    expect(reveals.every((r) => r !== undefined)).toBe(true);
    const first = reveals[0]!.payload;
    expect(first.round).toBe(1);
    expect(first.tokens).toHaveLength(peers.length);
    for (const r of reveals) {
      expect(r!.payload.tokens).toEqual(first.tokens);
      expect(r!.payload.round).toBe(first.round);
      expect(r!.payload.revealEndsAt).toBe(first.revealEndsAt);
    }

    // Reveal mirrors the actual placements (no auto-fills).
    for (let i = 0; i < peers.length; i++) {
      const placerId = peers[i]!.playerId!;
      const expectedTargetId = peers[(i + 1) % peers.length]!.playerId!;
      const t = first.tokens.find((x) => x.placerId === placerId);
      expect(t).toBeDefined();
      expect(t!.targetId).toBe(expectedTargetId);
      expect(t!.round).toBe(1);
      expect(t!.isAuto).toBeUndefined();
    }

    // Round archive (consumed by the in-game past-suspicions panel and
    // copied onto each RoundRecord at end-of-round) is populated.
    const game = ctx.games.get(sessionId)!;
    expect(game.tokenPhase).toBe('REVEAL');
    expect(game.suspicionTokensByRound?.[1]).toEqual(first.tokens);

    // Reveal hold elapses → VOTING starts for everyone.
    vi.advanceTimersByTime(TOKEN_REVEAL_DURATION_MS);
    for (const p of peers) {
      expect(p.lastOfType('S2C_VOTING_STARTED')).toBeDefined();
    }
    expect(ctx.games.get(sessionId)!.phase).toBe('VOTING');
  });

  it('backfills auto-tokens for non-submitters at window timeout', () => {
    const { peers, sessionId } = setupGameInPlacement(ctx);

    // Only the host places a real token; everyone else stays silent.
    peers[0]!.send({
      type: 'C2S_PLACE_SUSPICION_TOKEN',
      payload: { targetId: peers[1]!.playerId! },
    });

    vi.advanceTimersByTime(TOKEN_PLACEMENT_WINDOW_MS);

    const reveal = peers[0]!.lastOfType('S2C_TOKENS_REVEALED')!;
    expect(reveal.payload.tokens).toHaveLength(peers.length);

    const auto = reveal.payload.tokens.filter((t) => t.isAuto);
    expect(auto).toHaveLength(peers.length - 1);

    // Auto-backfilled tokens must respect the same constraints as
    // human placements: alive, non-self target.
    const game = ctx.games.get(sessionId)!;
    for (const t of reveal.payload.tokens) {
      expect(t.placerId).not.toBe(t.targetId);
      const target = game.players.find((p) => p.id === t.targetId);
      expect(target?.isAlive).toBe(true);
    }
  });

  describe('validation rejections', () => {
    it('rejects self-placement', () => {
      const { peers } = setupGameInPlacement(ctx);
      peers[0]!.send({
        type: 'C2S_PLACE_SUSPICION_TOKEN',
        payload: { targetId: peers[0]!.playerId! },
      });
      const err = peers[0]!.lastOfType('S2C_TOKEN_ERROR');
      expect(err).toBeDefined();
      expect(err!.payload.code).toBe('SELF');
      // No public broadcast leaks from a rejected placement.
      expect(peers[1]!.ofType('S2C_TOKEN_PLACED')).toHaveLength(0);
    });

    it('rejects placement on a dead target', () => {
      const { peers, sessionId } = setupGameInPlacement(ctx);
      // Mutate a player to "dead" directly on the in-memory game state to
      // simulate a corpse from a prior round without driving a full
      // night cycle.
      const cur = ctx.games.get(sessionId)!;
      ctx.setGame({
        ...cur,
        players: cur.players.map((p) =>
          p.id === peers[1]!.playerId ? { ...p, isAlive: false } : p
        ),
      });
      peers[0]!.send({
        type: 'C2S_PLACE_SUSPICION_TOKEN',
        payload: { targetId: peers[1]!.playerId! },
      });
      const err = peers[0]!.lastOfType('S2C_TOKEN_ERROR');
      expect(err).toBeDefined();
      expect(err!.payload.code).toBe('INVALID_TARGET');
    });

    it('rejects placement from a dead placer', () => {
      const { peers, sessionId } = setupGameInPlacement(ctx);
      const cur = ctx.games.get(sessionId)!;
      ctx.setGame({
        ...cur,
        players: cur.players.map((p) =>
          p.id === peers[0]!.playerId ? { ...p, isAlive: false } : p
        ),
      });
      peers[0]!.send({
        type: 'C2S_PLACE_SUSPICION_TOKEN',
        payload: { targetId: peers[1]!.playerId! },
      });
      const err = peers[0]!.lastOfType('S2C_TOKEN_ERROR');
      expect(err).toBeDefined();
      expect(err!.payload.code).toBe('DEAD');
    });

    it('rejects placement on an unknown player', () => {
      const { peers } = setupGameInPlacement(ctx);
      peers[0]!.send({
        type: 'C2S_PLACE_SUSPICION_TOKEN',
        payload: { targetId: 'no-such-player' },
      });
      const err = peers[0]!.lastOfType('S2C_TOKEN_ERROR');
      expect(err).toBeDefined();
      expect(err!.payload.code).toBe('INVALID_TARGET');
    });

    it('rejects placement after the window has resolved (wrong phase)', () => {
      const { peers, sessionId } = setupGameInPlacement(ctx);
      // Drive the window to REVEAL by firing the placement timeout.
      vi.advanceTimersByTime(TOKEN_PLACEMENT_WINDOW_MS);
      expect(ctx.games.get(sessionId)!.tokenPhase).toBe('REVEAL');

      peers[0]!.clear();
      peers[0]!.send({
        type: 'C2S_PLACE_SUSPICION_TOKEN',
        payload: { targetId: peers[1]!.playerId! },
      });
      const err = peers[0]!.lastOfType('S2C_TOKEN_ERROR');
      expect(err).toBeDefined();
      expect(err!.payload.code).toBe('PHASE');

      // Drive past the reveal hold into VOTING — placements there should
      // also be rejected with PHASE.
      vi.advanceTimersByTime(TOKEN_REVEAL_DURATION_MS);
      expect(ctx.games.get(sessionId)!.phase).toBe('VOTING');
      peers[0]!.clear();
      peers[0]!.send({
        type: 'C2S_PLACE_SUSPICION_TOKEN',
        payload: { targetId: peers[1]!.playerId! },
      });
      const err2 = peers[0]!.lastOfType('S2C_TOKEN_ERROR');
      expect(err2).toBeDefined();
      expect(err2!.payload.code).toBe('PHASE');
    });

    it('rejects placement from a socket not bound to the session (unauthorized)', () => {
      const { peers } = setupGameInPlacement(ctx);

      // Stranger socket: connected to the router but never sent
      // C2S_CREATE_GAME / C2S_JOIN_GAME / C2S_RECONNECT, so the router
      // has no `currentSessionId` / `currentPlayerId` for it. Any
      // placement attempt MUST be rejected before it can mutate game
      // state or fan out to other peers.
      const stranger = makePeer('Stranger', ctx);
      stranger.send({
        type: 'C2S_PLACE_SUSPICION_TOKEN',
        payload: { targetId: peers[1]!.playerId! },
      });

      const err = stranger.lastOfType('S2C_ERROR');
      expect(err).toBeDefined();
      expect(err!.payload.message).toMatch(/not in a game session/i);
      expect(stranger.ofType('S2C_TOKEN_PLACED_PRIVATE')).toHaveLength(0);

      // No leak to the real session: nobody saw a public progress event.
      for (const p of peers) {
        expect(p.ofType('S2C_TOKEN_PLACED')).toHaveLength(0);
      }
    });

    it('duplicate / re-placement is upsert per spec — same placer never inflates the count', () => {
      // Spec: a player may change their suspect at any point while the
      // 45s window is open. Re-placement REPLACES the prior entry and
      // leaves both the public progress count AND the server-side token
      // list with exactly one entry per placer (set semantics on
      // `tokensSubmittedIds`). This is the "duplicates" guard called
      // out in the task brief — duplicates from the same placer must
      // not stack.
      const { peers, sessionId } = setupGameInPlacement(ctx);

      peers[0]!.send({
        type: 'C2S_PLACE_SUSPICION_TOKEN',
        payload: { targetId: peers[1]!.playerId! },
      });
      peers[0]!.send({
        type: 'C2S_PLACE_SUSPICION_TOKEN',
        payload: { targetId: peers[2]!.playerId! },
      });

      // Two private echoes (one per placement attempt), both successful.
      const echoes = peers[0]!.ofType('S2C_TOKEN_PLACED_PRIVATE');
      expect(echoes).toHaveLength(2);
      expect(echoes[1]!.payload.targetId).toBe(peers[2]!.playerId);

      // Public progress count never exceeds 1 for the host's two
      // placements (upsert, not append).
      const lastProgress = peers[1]!.lastOfType('S2C_TOKEN_PLACED');
      expect(lastProgress!.payload.received).toBe(1);

      // Server state reflects the latest pick only.
      const game = ctx.games.get(sessionId)!;
      expect(game.suspicionTokensCurrent).toHaveLength(1);
      expect(game.suspicionTokensCurrent![0]!.targetId).toBe(peers[2]!.playerId);
    });
  });

  it('archive: completed round appends suspicionTokens onto game.history', () => {
    // The Suspicion Token graph powers two consumers:
    //   1) the in-game past-suspicions panel (reads `suspicionTokensByRound`)
    //   2) the post-game replay (reads `RoundRecord.suspicionTokens`,
    //      copied onto each round by `buildRoundRecord` at end-of-round)
    // Drive a full round through PLACEMENT → REVEAL → VOTING → BANISH
    // → CHECK_WIN (game ends because the lone Traitor is banished),
    // then assert the graph is on the persisted round record.
    const { peers, sessionId } = setupGameInPlacement(ctx);

    // Clockwise placements — fully deterministic.
    for (let i = 0; i < peers.length; i++) {
      peers[i]!.send({
        type: 'C2S_PLACE_SUSPICION_TOKEN',
        payload: { targetId: peers[(i + 1) % peers.length]!.playerId! },
      });
    }
    vi.advanceTimersByTime(TOKEN_PLACEMENT_WINDOW_MS);
    vi.advanceTimersByTime(TOKEN_REVEAL_DURATION_MS);

    let game = ctx.games.get(sessionId)!;
    expect(game.phase).toBe('VOTING');

    // In-game archive is populated immediately after reveal.
    expect(game.suspicionTokensByRound?.[1]).toBeDefined();
    expect(game.suspicionTokensByRound![1]).toHaveLength(peers.length);
    const expectedGraph = game.suspicionTokensByRound![1]!;

    // suspicionTokensCurrent is intentionally preserved through
    // `startVoting` so `buildRoundRecord` can copy it onto the
    // RoundRecord pushed into game.history.
    expect(game.suspicionTokensCurrent).toEqual(expectedGraph);
    expect(game.tokenPhase).toBeUndefined();
    expect(game.tokenWindowEndsAt).toBeUndefined();

    // Find the Traitor and have everyone vote them out so the lone
    // Traitor is banished → FAITHFUL win → checkWinCondition runs
    // buildRoundRecord and appends to game.history.
    const traitor = game.players.find((p) => p.role === 'TRAITOR');
    expect(traitor).toBeDefined();
    for (const p of peers) {
      p.send({
        type: 'C2S_SUBMIT_VOTE',
        payload: { targetId: traitor!.id },
      });
    }

    // Router auto-fires the vote-reveal sequence after the last vote:
    // 1s initial setTimeout + 4s setInterval per vote.
    vi.advanceTimersByTime(1_000 + 4_000 * (peers.length + 1));

    // Host banishes (the lone top candidate is the Traitor).
    peers[0]!.send({ type: 'C2S_BANISH_PLAYER', payload: {} });
    game = ctx.games.get(sessionId)!;
    expect(game.phase).toBe('BANISH_REVEAL');
    expect(game.banishedPlayerId).toBe(traitor!.id);

    // Host triggers win check → FAITHFUL victory → history populated.
    peers[0]!.send({ type: 'C2S_CHECK_WIN', payload: {} });
    game = ctx.games.get(sessionId)!;
    expect(game.phase).toBe('GAME_END');
    expect(game.winner).toBe('FAITHFUL');

    // The completed round was appended to game.history with the
    // exact suspicion token graph the reveal payload broadcast.
    expect(game.history).toHaveLength(1);
    const record = game.history[0]!;
    expect(record.round).toBe(1);
    expect(record.suspicionTokens).toBeDefined();
    expect(record.suspicionTokens).toEqual(expectedGraph);

    // Every connected client received the GAME_END payload that carries
    // history (the replay's source of truth).
    for (const p of peers) {
      const end = p.lastOfType('S2C_GAME_END');
      expect(end).toBeDefined();
      expect(end!.payload.history).toHaveLength(1);
      expect(end!.payload.history[0]!.suspicionTokens).toEqual(expectedGraph);
    }
  });
});
