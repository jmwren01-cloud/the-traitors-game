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
  | 'chat';

interface SoundConfig {
  frequency: number;
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
  tieDetected: [
    { frequency: 400, duration: 0.15, type: 'triangle', volume: 0.25 },
    { frequency: 400, duration: 0.15, type: 'triangle', volume: 0.25, delay: 0.2 },
    { frequency: 300, duration: 0.3, type: 'triangle', volume: 0.3, delay: 0.4 },
  ],
  chat: [
    { frequency: 700, duration: 0.05, type: 'sine', volume: 0.1 },
  ],
};

export function useSounds() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const enabledRef = useRef(true);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const playTone = useCallback((config: SoundConfig, ctx: AudioContext, startTime: number) => {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = config.type;
    oscillator.frequency.value = config.frequency;

    const delay = config.delay || 0;
    const toneStart = startTime + delay;
    const toneEnd = toneStart + config.duration;

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

    oscillator.start(toneStart);
    oscillator.stop(toneEnd + 0.1);
  }, []);

  const play = useCallback((sound: SoundType) => {
    if (!enabledRef.current) return;

    try {
      const ctx = getAudioContext();
      const configs = SOUND_CONFIGS[sound];
      const startTime = ctx.currentTime;

      configs.forEach(config => {
        playTone(config, ctx, startTime);
      });
    } catch (e) {
      console.warn('Failed to play sound:', e);
    }
  }, [getAudioContext, playTone]);

  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
  }, []);

  const isEnabled = useCallback(() => enabledRef.current, []);

  return { play, setEnabled, isEnabled };
}

export type { SoundType };
