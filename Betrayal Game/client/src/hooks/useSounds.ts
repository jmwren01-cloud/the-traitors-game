import { useCallback, useRef, useEffect } from 'react';

type SoundType =
  | 'roleReveal'
  | 'traitorReveal'
  | 'faithfulReveal'
  | 'voteSubmit'
  | 'voteReveal'
  | 'banishment'
  | 'murder'
  | 'timerWarning'
  | 'timerEnd'
  | 'traitorWin'
  | 'faithfulWin'
  | 'nightStart'
  | 'morningStart'
  | 'tieDetected'
  | 'chat'
  // Wave 3 #5 additions — synth primitives the game uses for systematic
  // event coverage. See spec at .local/tasks/wave3-sound-and-haptic-overhaul.md
  | 'softDrum'
  | 'hardDrum'
  | 'lowChime'
  | 'riserShort'
  | 'riserLong'
  | 'stab'
  | 'heartbeat';

interface SoundConfig {
  frequency: number;
  // Optional sweep target. If provided, frequency linearly ramps from
  // `frequency` → `endFrequency` across the tone's duration.
  endFrequency?: number;
  duration: number;
  type: OscillatorType;
  volume: number;
  ramp?: 'up' | 'down' | 'none';
  delay?: number;
}

const SOUND_CONFIGS: Record<SoundType, SoundConfig[]> = {
  roleReveal: [
    { frequency: 440, duration: 0.15, type: 'sine', volume: 0.3, ramp: 'up' },
    { frequency: 554, duration: 0.15, type: 'sine', volume: 0.3, delay: 0.15 },
    { frequency: 659, duration: 0.3, type: 'sine', volume: 0.4, delay: 0.3 },
  ],
  traitorReveal: [
    { frequency: 220, duration: 0.2, type: 'sawtooth', volume: 0.25, ramp: 'up' },
    { frequency: 185, duration: 0.3, type: 'sawtooth', volume: 0.3, delay: 0.2 },
    { frequency: 147, duration: 0.5, type: 'sawtooth', volume: 0.35, delay: 0.5, ramp: 'down' },
  ],
  faithfulReveal: [
    { frequency: 523, duration: 0.15, type: 'sine', volume: 0.3 },
    { frequency: 659, duration: 0.15, type: 'sine', volume: 0.3, delay: 0.15 },
    { frequency: 784, duration: 0.4, type: 'sine', volume: 0.35, delay: 0.3 },
  ],
  voteSubmit: [
    { frequency: 600, duration: 0.1, type: 'sine', volume: 0.2 },
  ],
  voteReveal: [
    { frequency: 350, duration: 0.15, type: 'triangle', volume: 0.25, ramp: 'up' },
    { frequency: 500, duration: 0.2, type: 'triangle', volume: 0.3, delay: 0.1 },
  ],
  banishment: [
    { frequency: 300, duration: 0.3, type: 'sawtooth', volume: 0.2 },
    { frequency: 250, duration: 0.3, type: 'sawtooth', volume: 0.25, delay: 0.25 },
    { frequency: 200, duration: 0.4, type: 'sawtooth', volume: 0.3, delay: 0.5 },
    { frequency: 150, duration: 0.6, type: 'sawtooth', volume: 0.25, delay: 0.8, ramp: 'down' },
  ],
  murder: [
    { frequency: 180, duration: 0.5, type: 'sawtooth', volume: 0.2, ramp: 'up' },
    { frequency: 120, duration: 0.8, type: 'sawtooth', volume: 0.3, delay: 0.4, ramp: 'down' },
  ],
  timerWarning: [
    { frequency: 800, duration: 0.1, type: 'square', volume: 0.15 },
  ],
  timerEnd: [
    { frequency: 600, duration: 0.15, type: 'square', volume: 0.2 },
    { frequency: 600, duration: 0.15, type: 'square', volume: 0.2, delay: 0.2 },
    { frequency: 600, duration: 0.3, type: 'square', volume: 0.25, delay: 0.4 },
  ],
  traitorWin: [
    { frequency: 220, duration: 0.3, type: 'sawtooth', volume: 0.25 },
    { frequency: 277, duration: 0.3, type: 'sawtooth', volume: 0.3, delay: 0.3 },
    { frequency: 330, duration: 0.5, type: 'sawtooth', volume: 0.35, delay: 0.6 },
    { frequency: 440, duration: 0.8, type: 'sawtooth', volume: 0.3, delay: 1.0, ramp: 'down' },
  ],
  faithfulWin: [
    { frequency: 523, duration: 0.2, type: 'sine', volume: 0.3 },
    { frequency: 659, duration: 0.2, type: 'sine', volume: 0.3, delay: 0.2 },
    { frequency: 784, duration: 0.2, type: 'sine', volume: 0.35, delay: 0.4 },
    { frequency: 1047, duration: 0.6, type: 'sine', volume: 0.4, delay: 0.6 },
  ],
  nightStart: [
    { frequency: 200, duration: 0.4, type: 'sine', volume: 0.2, ramp: 'up' },
    { frequency: 150, duration: 0.6, type: 'sine', volume: 0.25, delay: 0.3, ramp: 'down' },
  ],
  morningStart: [
    { frequency: 400, duration: 0.2, type: 'sine', volume: 0.2 },
    { frequency: 500, duration: 0.2, type: 'sine', volume: 0.25, delay: 0.15 },
    { frequency: 600, duration: 0.3, type: 'sine', volume: 0.3, delay: 0.3 },
  ],
  // Spec change: ties play three soft drums at 200ms intervals.
  tieDetected: [
    { frequency: 90, duration: 0.18, type: 'sine', volume: 0.32, ramp: 'down' },
    { frequency: 90, duration: 0.18, type: 'sine', volume: 0.32, delay: 0.2, ramp: 'down' },
    { frequency: 90, duration: 0.18, type: 'sine', volume: 0.32, delay: 0.4, ramp: 'down' },
  ],
  chat: [
    { frequency: 700, duration: 0.05, type: 'sine', volume: 0.1 },
  ],

  // ---------- Wave 3 #5 spec primitives ----------
  // Soft drum: low subtle thump for "another player did a thing".
  softDrum: [
    { frequency: 95, duration: 0.16, type: 'sine', volume: 0.32, ramp: 'down' },
  ],
  // Hard drum: louder, lower, longer — used for traitor murder votes and
  // the final vote-reveal step.
  hardDrum: [
    { frequency: 65, duration: 0.28, type: 'sine', volume: 0.5, ramp: 'down' },
    { frequency: 130, duration: 0.12, type: 'sine', volume: 0.18, ramp: 'down' },
  ],
  // Low warm chime: feedback for the player's own vote. Two-tone.
  lowChime: [
    { frequency: 330, duration: 0.18, type: 'sine', volume: 0.22, ramp: 'down' },
    { frequency: 440, duration: 0.28, type: 'sine', volume: 0.18, delay: 0.05, ramp: 'down' },
  ],
  // Short riser: ~400ms upward sweep.
  riserShort: [
    { frequency: 220, endFrequency: 660, duration: 0.4, type: 'sawtooth', volume: 0.18, ramp: 'up' },
  ],
  // Long riser: ~1s upward sweep — used when all required votes are in
  // (vote phase or murder vote) and right after the final vote reveal.
  riserLong: [
    { frequency: 180, endFrequency: 880, duration: 1.0, type: 'sawtooth', volume: 0.22, ramp: 'up' },
  ],
  // Stab: sharp dissonant hit for banishment moment.
  stab: [
    { frequency: 220, duration: 0.09, type: 'sawtooth', volume: 0.35, ramp: 'down' },
    { frequency: 311, duration: 0.16, type: 'sawtooth', volume: 0.28, ramp: 'down' },
  ],
  // Heartbeat: lub-dub played once per second when ≤10s on the clock.
  // Internal pulse spacing is ~125ms (≈ 120bpm pair) per spec.
  heartbeat: [
    { frequency: 60, duration: 0.09, type: 'sine', volume: 0.32, ramp: 'down' },
    { frequency: 50, duration: 0.12, type: 'sine', volume: 0.28, delay: 0.13, ramp: 'down' },
  ],
};

const MUTED_KEY = 'betrayal_muted';

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTED_KEY, '1');
    else localStorage.removeItem(MUTED_KEY);
  } catch {
    // localStorage unavailable — silently no-op so audio still works.
  }
}

export function useSounds() {
  const audioContextRef = useRef<AudioContext | null>(null);
  // Initialise from persisted mute state so a refresh remembers the choice.
  const enabledRef = useRef<boolean>(!readMuted());
  // Track every active oscillator so stopAll() (and mute) can hard-cut them.
  const activeOscRef = useRef<Set<OscillatorNode>>(new Set());

  useEffect(() => {
    return () => {
      // Best-effort cleanup on unmount (provider lives for app lifetime).
      for (const osc of activeOscRef.current) {
        try { osc.stop(); } catch { /* already stopped */ }
      }
      activeOscRef.current.clear();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const getAudioContext = useCallback((): AudioContext | null => {
    // Lazy singleton + autoplay-policy safety: no AudioContext is created
    // before the first call from a user-gesture handler.
    const Ctor: typeof AudioContext | undefined =
      (typeof window !== 'undefined' && (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) || undefined;
    if (!Ctor) return null;

    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      try {
        audioContextRef.current = new Ctor();
      } catch {
        return null;
      }
    }
    if (audioContextRef.current.state === 'suspended') {
      // Some browsers leave the context suspended until a user gesture
      // resumes it; this resolves asynchronously and we don't need to await.
      audioContextRef.current.resume().catch(() => { /* ignore */ });
    }
    return audioContextRef.current;
  }, []);

  const playTone = useCallback((config: SoundConfig, ctx: AudioContext, startTime: number) => {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = config.type;

    const delay = config.delay || 0;
    const toneStart = startTime + delay;
    const toneEnd = toneStart + config.duration;

    oscillator.frequency.setValueAtTime(config.frequency, toneStart);
    if (config.endFrequency !== undefined) {
      oscillator.frequency.linearRampToValueAtTime(config.endFrequency, toneEnd);
    }

    if (config.ramp === 'up') {
      gainNode.gain.setValueAtTime(0, toneStart);
      gainNode.gain.linearRampToValueAtTime(config.volume, toneStart + config.duration * 0.3);
      gainNode.gain.linearRampToValueAtTime(config.volume * 0.8, toneEnd);
    } else if (config.ramp === 'down') {
      gainNode.gain.setValueAtTime(config.volume, toneStart);
      gainNode.gain.linearRampToValueAtTime(0, toneEnd);
    } else {
      gainNode.gain.setValueAtTime(config.volume, toneStart);
      gainNode.gain.linearRampToValueAtTime(0, toneEnd - 0.02);
    }

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    activeOscRef.current.add(oscillator);
    oscillator.onended = () => {
      activeOscRef.current.delete(oscillator);
    };

    oscillator.start(toneStart);
    oscillator.stop(toneEnd + 0.1);
  }, []);

  const play = useCallback((sound: SoundType) => {
    if (!enabledRef.current) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return; // Web Audio unavailable — graceful no-op.
      const configs = SOUND_CONFIGS[sound];
      if (!configs) return;
      const startTime = ctx.currentTime;

      for (const config of configs) {
        playTone(config, ctx, startTime);
      }
    } catch (e) {
      console.warn('Failed to play sound:', e);
    }
  }, [getAudioContext, playTone]);

  const stopAll = useCallback(() => {
    for (const osc of activeOscRef.current) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
    activeOscRef.current.clear();
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
    writeMuted(!enabled);
    if (!enabled) {
      // Hard-cut anything in flight so mute is instantaneous.
      for (const osc of activeOscRef.current) {
        try { osc.stop(); } catch { /* already stopped */ }
      }
      activeOscRef.current.clear();
    }
  }, []);

  const isEnabled = useCallback(() => enabledRef.current, []);

  return { play, setEnabled, isEnabled, stopAll };
}

export type { SoundType };
