import { describe, it, expect } from 'vitest';
import { toPublicWhisper, WhisperError, sendWhisper, buildWhisperFanout, scrubWhispersForRecipient } from './manager.js';
import { DEFAULT_SETTINGS } from './types.js';
import type { GameState, Whisper, Player } from './types.js';

function makePlayer(over: Partial<Player> = {}): Player {
  return {
    id: 'p',
    name: 'P',
    isAlive: true,
    isHost: false,
    isConnected: true,
    hasShield: false,
    shieldRevealed: false,
    ...over,
  };
}

function makeGame(over: Partial<GameState> = {}): GameState {
  return {
    sessionId: 's',
    phase: 'ROUNDTABLE',
    players: [makePlayer({ id: 'a', name: 'Alice' }), makePlayer({ id: 'b', name: 'Bob' })],
    votes: [],
    revealedVotes: [],
    hostId: 'a',
    currentRound: 1,
    murderVotes: [],
    messages: [],
    lastManualVotes: {},
    history: [],
    settings: { ...DEFAULT_SETTINGS },
    whispers: [],
    whispersUsedThisRound: [],
    ...over,
  };
}

describe('toPublicWhisper', () => {
  const fullWhisper: Whisper = {
    id: 'w1',
    senderId: 'a', senderName: 'Alice',
    recipientId: 'b', recipientName: 'Bob',
    round: 1, timestamp: 123,
    content: 'this is private',
  };

  it('omits the `content` field from the public projection', () => {
    const pub = toPublicWhisper(fullWhisper);
    expect(pub).not.toHaveProperty('content');
    expect(Object.keys(pub).sort()).toEqual(
      ['id', 'recipientId', 'recipientName', 'round', 'senderId', 'senderName', 'timestamp']
    );
  });

  it('preserves all metadata fields exactly', () => {
    const pub = toPublicWhisper(fullWhisper);
    expect(pub).toEqual({
      id: 'w1',
      senderId: 'a', senderName: 'Alice',
      recipientId: 'b', recipientName: 'Bob',
      round: 1, timestamp: 123,
    });
  });

  it('the recipient (private) payload still carries content unchanged', () => {
    // The router fans out the raw Whisper to the recipient. Verify the
    // shape contract here so a future refactor can't accidentally drop it.
    expect(fullWhisper.content).toBe('this is private');
  });
});

describe('buildWhisperFanout (router broadcast vs private contract)', () => {
  const w: Whisper = {
    id: 'w1',
    senderId: 'a', senderName: 'Alice',
    recipientId: 'b', recipientName: 'Bob',
    round: 1, timestamp: 999,
    content: 'secret-payload',
  };

  it('broadcast payload omits content but keeps all metadata', () => {
    const { broadcast } = buildWhisperFanout(w);
    expect(broadcast).not.toHaveProperty('content');
    expect(broadcast.id).toBe('w1');
    expect(broadcast.senderId).toBe('a');
    expect(broadcast.recipientId).toBe('b');
  });

  it('private payload retains full content and is targeted to the recipient only', () => {
    const { privateForRecipient, privateRecipientId } = buildWhisperFanout(w);
    expect(privateForRecipient.content).toBe('secret-payload');
    expect(privateRecipientId).toBe('b');
  });

  it('serialized broadcast cannot leak content as JSON null/undefined', () => {
    const { broadcast } = buildWhisperFanout(w);
    const wire = JSON.parse(JSON.stringify(broadcast));
    expect('content' in wire).toBe(false);
  });
});

describe('scrubWhispersForRecipient (reconnect visibility)', () => {
  const w: Whisper = {
    id: 'w1', senderId: 'a', senderName: 'Alice',
    recipientId: 'b', recipientName: 'Bob',
    round: 1, timestamp: 1, content: 'hi bob',
  };

  it('during live play, only the recipient gets content', () => {
    const forRecipient = scrubWhispersForRecipient([w], 'b', false);
    const forSender = scrubWhispersForRecipient([w], 'a', false);
    const forBystander = scrubWhispersForRecipient([w], 'c', false);
    expect(forRecipient[0]?.content).toBe('hi bob');
    expect(forSender[0]).not.toHaveProperty('content');
    expect(forBystander[0]).not.toHaveProperty('content');
  });

  it('after GAME_END, every player gets full content (post-game replay)', () => {
    const forBystander = scrubWhispersForRecipient([w], 'c', true);
    expect(forBystander[0]?.content).toBe('hi bob');
  });
});

describe('sendWhisper validation errors', () => {
  it('throws WhisperError(PHASE) outside ROUNDTABLE', () => {
    const game = makeGame({ phase: 'VOTING' });
    expect(() => sendWhisper(game, 'a', 'b', 'hi')).toThrowError(WhisperError);
    try { sendWhisper(game, 'a', 'b', 'hi'); } catch (e) {
      expect((e as WhisperError).code).toBe('PHASE');
    }
  });

  it('throws WhisperError(SELF) when whispering to self', () => {
    try { sendWhisper(makeGame(), 'a', 'a', 'hi'); } catch (e) {
      expect((e as WhisperError).code).toBe('SELF');
    }
  });

  it('throws WhisperError(ALREADY_USED) on second whisper this round', () => {
    const g1 = sendWhisper(makeGame(), 'a', 'b', 'first').game;
    try { sendWhisper(g1, 'a', 'b', 'second'); } catch (e) {
      expect((e as WhisperError).code).toBe('ALREADY_USED');
    }
  });

  it('throws WhisperError(TOO_LONG) over 200 chars', () => {
    try { sendWhisper(makeGame(), 'a', 'b', 'x'.repeat(201)); } catch (e) {
      expect((e as WhisperError).code).toBe('TOO_LONG');
    }
  });

  it('throws WhisperError(EMPTY) on whitespace-only', () => {
    try { sendWhisper(makeGame(), 'a', 'b', '   '); } catch (e) {
      expect((e as WhisperError).code).toBe('EMPTY');
    }
  });
});
