import {
  buildMonthRange,
  computeLateMinutes,
  LATE_GRACE_MINUTES,
  lastNMonths,
  punctualityScore,
} from './analytics.helpers';

/**
 * These helpers are all pure — no DB, no clock — so tests stay deterministic
 * and fast. If one of them regresses, every analytics rollup silently breaks,
 * so we cover every branch / boundary we depend on downstream.
 */

describe('analytics.helpers', () => {
  describe('buildMonthRange', () => {
    it('returns inclusive start and end-of-month for a valid YYYY-MM', () => {
      const range = buildMonthRange('2025-03');
      expect(range.start.getFullYear()).toBe(2025);
      expect(range.start.getMonth()).toBe(2); // March = 2 (0-indexed)
      expect(range.start.getDate()).toBe(1);
      expect(range.end.getMonth()).toBe(2);
      // March has 31 days.
      expect(range.end.getDate()).toBe(31);
    });

    it('throws on a malformed month string', () => {
      expect(() => buildMonthRange('2025-3')).toThrow();
      expect(() => buildMonthRange('not-a-month')).toThrow();
      expect(() => buildMonthRange('')).toThrow();
    });
  });

  describe('lastNMonths', () => {
    it('returns N months ending with the given one, oldest-first', () => {
      expect(lastNMonths('2025-03', 3)).toEqual(['2025-01', '2025-02', '2025-03']);
    });

    it('handles a single-month request', () => {
      expect(lastNMonths('2025-12', 1)).toEqual(['2025-12']);
    });
  });

  describe('computeLateMinutes', () => {
    it('is 0 when the employee arrives before the start-of-day cutoff', () => {
      // 8:30, work starts 9:00 — arrived early, not late.
      expect(computeLateMinutes(8, 30, 9)).toBe(0);
    });

    it('is 0 within the grace window (default 5 minutes)', () => {
      // 9:04 with 9:00 start and 5-minute grace = not yet late.
      expect(computeLateMinutes(9, 4, 9)).toBe(0);
      // 9:05 is the boundary (grace minute inclusive).
      expect(computeLateMinutes(9, LATE_GRACE_MINUTES, 9)).toBe(0);
    });

    it('counts minutes past the grace window', () => {
      // 9:15 with 9:00 start + 5min grace = 10 minutes late.
      expect(computeLateMinutes(9, 15, 9)).toBe(10);
    });

    it('honours a custom grace value', () => {
      // Zero grace: 9:01 is already 1 minute late.
      expect(computeLateMinutes(9, 1, 9, 0)).toBe(1);
    });
  });

  describe('punctualityScore', () => {
    it('is 100 for perfect punctuality', () => {
      expect(punctualityScore(0)).toBe(100);
    });

    it('penalises 2 points per average late minute', () => {
      expect(punctualityScore(5)).toBe(90);
      expect(punctualityScore(10)).toBe(80);
    });

    it('clamps at 0 for extreme lateness', () => {
      expect(punctualityScore(1000)).toBe(0);
    });
  });
});
