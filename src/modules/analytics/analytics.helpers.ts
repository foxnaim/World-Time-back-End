import { startOfMonth, endOfMonth, parse, addMonths, format } from 'date-fns';

/**
 * Pure helper utilities used by AnalyticsService.
 *
 * All of these are side-effect free so they can be unit-tested in isolation
 * without a database.
 */

export const LATE_GRACE_MINUTES = 5;

export interface MonthRange {
  start: Date;
  end: Date;
}

/**
 * Parse a `YYYY-MM` string and return inclusive start / exclusive end of the
 * calendar month. Throws if the format is invalid.
 */
export function buildMonthRange(month: string): MonthRange {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Invalid month format: "${month}" (expected YYYY-MM)`);
  }
  const parsed = parse(`${month}-01`, 'yyyy-MM-dd', new Date());
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid month: "${month}"`);
  }
  return {
    start: startOfMonth(parsed),
    end: endOfMonth(parsed),
  };
}

/**
 * Return the previous N months (including the given month) as `YYYY-MM`
 * strings, ordered oldest-first.
 */
export function lastNMonths(month: string, n: number): string[] {
  const { start } = buildMonthRange(month);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addMonths(start, -i);
    out.push(format(d, 'yyyy-MM'));
  }
  return out;
}

/**
 * Compute how many minutes late an IN check-in was relative to the configured
 * start-of-day. Returns 0 if within grace or before the cutoff.
 *
 * `checkInDate` should already be in the company's local timezone (the caller
 * is responsible for shifting raw UTC timestamps).
 */
export function computeLateMinutes(
  checkInLocalHour: number,
  checkInLocalMinute: number,
  workStartHour: number,
  graceMinutes: number = LATE_GRACE_MINUTES,
): number {
  const actual = checkInLocalHour * 60 + checkInLocalMinute;
  const cutoff = workStartHour * 60 + graceMinutes;
  return Math.max(0, actual - cutoff);
}

/**
 * Given the *last* OUT check-in of a working day and the configured end hour,
 * compute overtime hours for that day. Weekends are treated as fully-overtime
 * (whole shift counts) when `isWeekend` is true.
 */
export function computeOvertime(
  lastOutLocalHour: number,
  lastOutLocalMinute: number,
  firstInLocalHour: number,
  firstInLocalMinute: number,
  workEndHour: number,
  isWeekend: boolean,
): number {
  const outMin = lastOutLocalHour * 60 + lastOutLocalMinute;
  if (isWeekend) {
    const inMin = firstInLocalHour * 60 + firstInLocalMinute;
    return Math.max(0, (outMin - inMin) / 60);
  }
  const cutoff = workEndHour * 60;
  return Math.max(0, (outMin - cutoff) / 60);
}

/**
 * Derive a 0-100 punctuality score from an average-late-minutes figure.
 * Two minutes late per day eats one point.
 */
export function punctualityScore(avgLateMinutes: number): number {
  const penalty = Math.min(100, Math.max(0, avgLateMinutes * 2));
  return Math.round((100 - penalty) * 100) / 100;
}

/**
 * Group an array by a key selector, preserving insertion order of keys.
 */
export function groupBy<T, K extends string | number>(
  items: T[],
  keyOf: (item: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = out.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      out.set(key, [item]);
    }
  }
  return out;
}

export function groupByEmployee<T extends { employeeId: string }>(items: T[]): Map<string, T[]> {
  return groupBy(items, (i) => i.employeeId);
}

/**
 * Group items by `YYYY-MM-DD` in a specific timezone. We use
 * `Intl.DateTimeFormat` because we don't want to pull in a full tz library —
 * Node's ICU build is enough for this purpose.
 */
export function groupByDay<T extends { timestamp: Date }>(
  items: T[],
  timezone: string,
): Map<string, T[]> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return groupBy(items, (i) => fmt.format(i.timestamp));
}

/**
 * Return `{ hour, minute, weekday }` for a Date as observed in the given
 * timezone. `weekday` follows JS convention (0 = Sunday, 6 = Saturday).
 */
export function localParts(
  date: Date,
  timezone: string,
): { hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  let hour = 0;
  let minute = 0;
  let weekdayStr = 'Mon';
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10) % 24;
    else if (p.type === 'minute') minute = parseInt(p.value, 10);
    else if (p.type === 'weekday') weekdayStr = p.value;
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return { hour, minute, weekday: weekdayMap[weekdayStr] ?? 1 };
}

export function isWeekend(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}
