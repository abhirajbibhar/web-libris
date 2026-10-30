/** Pure helpers shared by the readers (kept free of DOM for testing). */

/** Reading progress as a 0-100 number with one decimal, never out of range. */
export function pagePercentage(page: number, total: number): number {
  if (total <= 0 || page <= 0) return 0;
  const raw = (page / total) * 100;
  return Math.min(100, Math.max(0, Math.round(raw * 10) / 10));
}

/** e.g. 42 -> '42%', 42.5 -> '42.5%'. */
export function formatPercent(percentage: number): string {
  const rounded = Math.round(percentage * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

export function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.round(page)), Math.max(1, total));
}

/**
 * First page of the spread `page` belongs to.
 *
 * LTR spreads pair (1,2), (3,4)… so the start is odd. RTL (manga) pairs
 * (1), (2,3), (4,5)… so the start is even, except the cover which stands
 * alone. When the computed start would fall before page 1 it stays at 1.
 */
export function alignSpreadStart(page: number, rtl: boolean): number {
  const clamped = Math.max(1, Math.round(page));
  if (!rtl) return clamped % 2 === 1 ? clamped : clamped - 1;
  const start = clamped % 2 === 0 ? clamped : clamped - 1;
  return start < 1 ? 1 : start;
}

/**
 * Pages visible for the current position, in **visual left-to-right
 * order** (RTL spreads show the higher page on the left).
 */
export function visiblePages(
  page: number,
  total: number,
  spread: boolean,
  rtl: boolean
): number[] {
  if (total <= 0) return [];
  const current = clampPage(page, total);
  if (!spread) return [current];
  const start = alignSpreadStart(current, rtl);
  // In RTL the cover (page 1) stands alone; there is no page 0 to pair it with.
  if (rtl && start === 1) return [1];
  const second = start + 1;
  if (second > total) return [start];
  return rtl ? [second, start] : [start, second];
}

/** Page shown after stepping `direction` (1 = forward through the book). */
export function stepPage(
  page: number,
  direction: 1 | -1,
  total: number,
  spread: boolean,
  rtl: boolean
): number {
  if (total <= 0) return 1;
  const current = clampPage(page, total);
  const base = spread ? alignSpreadStart(current, rtl) : current;
  const step = spread ? 2 : 1;
  return clampPage(base + direction * step, total);
}

/** Pages to warm the HTTP cache for around the current position. */
export function preloadablePages(
  page: number,
  total: number,
  spread: boolean,
  rtl: boolean,
  radius = 3
): number[] {
  const current = clampPage(page, total);
  const out = new Set<number>();
  for (let delta = -radius; delta <= radius; delta++) {
    for (const candidate of visiblePages(current + delta, total, spread, rtl)) {
      if (candidate >= 1 && candidate <= total) out.add(candidate);
    }
  }
  out.delete(current);
  for (const shown of visiblePages(current, total, spread, rtl)) out.delete(shown);
  return [...out];
}
