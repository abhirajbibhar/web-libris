import { describe, expect, it } from 'vitest';
import type { ActivityDays } from '../api/journal';
import { computeStreaks, isReadDay, lastDays } from './streak';

const day = (seconds: number, startPct = 0, endPct = 0): ActivityDays[string] => ({
  seconds,
  books: { '1': { seconds, startPct, endPct } }
});

describe('isReadDay', () => {
  it('needs real reading, not just opening a book', () => {
    expect(isReadDay(undefined)).toBe(false);
    expect(isReadDay(day(0, 10, 10))).toBe(false);
    expect(isReadDay(day(0, 10, 12))).toBe(true);
    expect(isReadDay(day(120, 10, 10))).toBe(true);
  });
});

describe('computeStreaks', () => {
  const days: ActivityDays = {
    '2026-10-20': day(300),
    '2026-10-21': day(300),
    '2026-10-22': day(300),
    '2026-10-24': day(300),
    '2026-10-25': day(300)
  };

  it('keeps the streak alive when today has not been read yet', () => {
    expect(computeStreaks(days, '2026-10-26')).toMatchObject({ current: 2, longest: 3, totalDays: 5, readToday: false });
  });

  it('includes today once it has been read', () => {
    expect(computeStreaks({ ...days, '2026-10-26': day(300) }, '2026-10-26')).toMatchObject({ current: 3, readToday: true });
  });

  it('resets after a missed day and handles empty history', () => {
    expect(computeStreaks(days, '2026-10-28').current).toBe(0);
    expect(computeStreaks({}, '2026-10-26')).toEqual({ current: 0, longest: 0, totalDays: 0, readToday: false });
  });

  it('crosses month and year boundaries', () => {
    const crossing: ActivityDays = { '2026-12-31': day(300), '2027-01-01': day(300) };
    expect(computeStreaks(crossing, '2027-01-01').current).toBe(2);
  });
});

describe('lastDays', () => {
  it('lists days ending today, oldest first', () => {
    expect(lastDays('2026-10-26', 3)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });
});
