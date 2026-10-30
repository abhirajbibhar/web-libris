import type { ActivityDay, ActivityDays } from '../api/journal';
import { addDays } from './dates';

/** A day counts as a reading day when there was real reading, not just opening a book. */
export function isReadDay(day: ActivityDay | undefined): boolean {
  if (!day) return false;
  if (day.seconds >= 60) return true;
  return Object.values(day.books).some(book => Math.abs(book.endPct - book.startPct) > 0);
}

export interface StreakStats {
  /** Consecutive reading days up to today (or yesterday, if today is still open). */
  current: number;
  longest: number;
  totalDays: number;
  readToday: boolean;
}

export function computeStreaks(days: ActivityDays, today: string): StreakStats {
  const readDays = Object.keys(days)
    .filter(key => isReadDay(days[key]))
    .sort();
  const set = new Set(readDays);

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of readDays) {
    run = previous && addDays(previous, 1) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }

  // The streak stays alive through today: it only breaks once a whole day is missed.
  const readToday = set.has(today);
  let cursor = readToday ? today : addDays(today, -1);
  let current = 0;
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  return { current, longest, totalDays: readDays.length, readToday };
}

/** Last `count` calendar days ending today, oldest first. */
export function lastDays(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(today, i - (count - 1)));
}
