import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vibrate, vibrateOnce } from './haptics';

interface TestableNavigator {
  vibrate?: (pattern: number | number[]) => boolean;
}

describe('haptics', () => {
  let vibrateSpy: ReturnType<typeof vi.fn>;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    vibrateSpy = vi.fn(() => true);
    (navigator as unknown as TestableNavigator).vibrate = vibrateSpy;
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    delete (navigator as unknown as TestableNavigator).vibrate;
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    } else {
      // jsdom installs matchMedia as undefined by default; restore that.
      // @ts-expect-error - intentionally clearing for test isolation
      delete window.matchMedia;
    }
  });

  function setReducedMotion(reduce: boolean): void {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }

  describe('vibrate', () => {
    it('forwards the pattern when reduced-motion is not requested', () => {
      setReducedMotion(false);
      vibrate('success');
      expect(vibrateSpy).toHaveBeenCalledTimes(1);
      expect(vibrateSpy).toHaveBeenCalledWith([10, 50, 10]);
    });

    it('is a no-op when prefers-reduced-motion: reduce matches', () => {
      setReducedMotion(true);
      vibrate('error');
      expect(vibrateSpy).not.toHaveBeenCalled();
    });

    it('defaults to the light pattern', () => {
      setReducedMotion(false);
      vibrate();
      expect(vibrateSpy).toHaveBeenCalledWith([10]);
    });

    it('does nothing when navigator.vibrate is unavailable', () => {
      setReducedMotion(false);
      delete (navigator as unknown as TestableNavigator).vibrate;
      expect(() => vibrate('medium')).not.toThrow();
    });
  });

  describe('vibrateOnce', () => {
    it('forwards the duration when reduced-motion is not requested', () => {
      setReducedMotion(false);
      vibrateOnce(42);
      expect(vibrateSpy).toHaveBeenCalledWith(42);
    });

    it('is a no-op under reduced motion', () => {
      setReducedMotion(true);
      vibrateOnce(42);
      expect(vibrateSpy).not.toHaveBeenCalled();
    });
  });
});
