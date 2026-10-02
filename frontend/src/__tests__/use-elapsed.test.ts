import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useElapsed } from '@/hooks/use-elapsed';

describe('useElapsed', () => {
  beforeEach(() => {
    // The hook ticks on requestAnimationFrame and throttles on the frame
    // timestamp, which Vitest does not fake by default.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('increments elapsed seconds as time passes', () => {
    const start = new Date('2026-04-17T12:00:00Z');
    vi.setSystemTime(start);

    const startedAt = start.toISOString();
    const { result } = renderHook(() => useElapsed(startedAt));

    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(3_500);
    });

    expect(result.current).toBe(3);

    act(() => {
      vi.advanceTimersByTime(7_000);
    });

    expect(result.current).toBe(10);
  });

  it('returns 0 when startedAt is null', () => {
    const { result } = renderHook(() => useElapsed(null));
    expect(result.current).toBe(0);
  });
});
