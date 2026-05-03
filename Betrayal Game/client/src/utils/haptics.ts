type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

const patterns: Record<HapticPattern, number[]> = {
  light: [10],
  medium: [20],
  heavy: [30],
  success: [10, 50, 10],
  warning: [20, 30, 20],
  error: [30, 50, 30, 50, 30],
};

function reducedMotionPreferred(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function vibrate(pattern: HapticPattern = 'light'): void {
  if (!('vibrate' in navigator)) return;
  if (reducedMotionPreferred()) return;

  try {
    navigator.vibrate(patterns[pattern]);
  } catch {
    // Vibration not supported or blocked
  }
}

export function vibrateOnce(duration: number = 10): void {
  if (!('vibrate' in navigator)) return;
  if (reducedMotionPreferred()) return;

  try {
    navigator.vibrate(duration);
  } catch {
    // Vibration not supported or blocked
  }
}
