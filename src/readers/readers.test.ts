import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EPUB_THEMES, generateEpubCss } from './epubStyles';
import {
  alignSpreadStart,
  clampPage,
  formatPercent,
  pagePercentage,
  preloadablePages,
  stepPage,
  visiblePages
} from './readerUtils';
import { DEFAULT_READER_SETTINGS, loadReaderSettings } from './settings';

describe('pagePercentage', () => {
  it('computes a one-decimal percentage', () => {
    expect(pagePercentage(1, 3)).toBe(33.3);
    expect(pagePercentage(2, 4)).toBe(50);
    expect(pagePercentage(3, 3)).toBe(100);
  });

  it('guards against empty or bogus inputs', () => {
    expect(pagePercentage(5, 0)).toBe(0);
    expect(pagePercentage(0, 10)).toBe(0);
    expect(pagePercentage(-4, 10)).toBe(0);
    expect(pagePercentage(50, 10)).toBe(100); // clamped
  });
});

describe('formatPercent', () => {
  it('drops trailing zeros', () => {
    expect(formatPercent(42)).toBe('42%');
    expect(formatPercent(42.5)).toBe('42.5%');
    expect(formatPercent(42.54)).toBe('42.5%');
  });
});

describe('clampPage', () => {
  it('clamps into 1..total', () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(99, 10)).toBe(10);
    expect(clampPage(4.6, 10)).toBe(5);
    expect(clampPage(5, 0)).toBe(1);
  });
});

describe('alignSpreadStart', () => {
  it('aligns LTR spreads to odd pages', () => {
    expect(alignSpreadStart(1, false)).toBe(1);
    expect(alignSpreadStart(2, false)).toBe(1);
    expect(alignSpreadStart(3, false)).toBe(3);
    expect(alignSpreadStart(4, false)).toBe(3);
  });

  it('aligns RTL spreads to even pages but keeps the cover alone', () => {
    expect(alignSpreadStart(1, true)).toBe(1);
    expect(alignSpreadStart(2, true)).toBe(2);
    expect(alignSpreadStart(3, true)).toBe(2);
    expect(alignSpreadStart(4, true)).toBe(4);
    expect(alignSpreadStart(5, true)).toBe(4);
  });
});

describe('visiblePages', () => {
  it('returns a single page in single mode', () => {
    expect(visiblePages(3, 10, false, false)).toEqual([3]);
    expect(visiblePages(99, 10, false, true)).toEqual([10]);
  });

  it('pairs pages left-to-right', () => {
    expect(visiblePages(1, 10, true, false)).toEqual([1, 2]);
    expect(visiblePages(4, 10, true, false)).toEqual([3, 4]);
  });

  it('pairs pages right-to-left with a solo cover', () => {
    expect(visiblePages(1, 10, true, true)).toEqual([1]);
    expect(visiblePages(2, 10, true, true)).toEqual([3, 2]);
    expect(visiblePages(3, 10, true, true)).toEqual([3, 2]);
    expect(visiblePages(4, 10, true, true)).toEqual([5, 4]);
  });

  it('drops the missing partner on the last spread', () => {
    expect(visiblePages(11, 11, true, false)).toEqual([11]);
    expect(visiblePages(10, 11, true, false)).toEqual([9, 10]);
  });

  it('returns nothing for an empty book', () => {
    expect(visiblePages(1, 0, true, false)).toEqual([]);
  });
});

describe('stepPage', () => {
  it('steps by one in single mode', () => {
    expect(stepPage(1, 1, 10, false, false)).toBe(2);
    expect(stepPage(1, -1, 10, false, false)).toBe(1);
    expect(stepPage(10, 1, 10, false, false)).toBe(10);
  });

  it('steps by two across spreads keeping parity', () => {
    expect(stepPage(1, 1, 20, true, false)).toBe(3);
    expect(stepPage(3, -1, 20, true, false)).toBe(1);
    expect(stepPage(1, 1, 20, true, true)).toBe(3); // cover -> pair (2,3)
    expect(stepPage(2, 1, 20, true, true)).toBe(4);
    expect(stepPage(1, -1, 20, true, true)).toBe(1);
  });

  it('never walks off the end of the book', () => {
    expect(stepPage(9, 1, 10, true, false)).toBe(10);
    expect(stepPage(10, 1, 10, true, false)).toBe(10);
  });
});

describe('preloadablePages', () => {
  it('suggests nearby pages without repeating the visible ones', () => {
    const pages = preloadablePages(5, 10, false, false, 2);
    expect(pages).toEqual([3, 4, 6, 7]);
  });

  it('stays inside the book', () => {
    const pages = preloadablePages(1, 4, false, false, 3);
    expect(pages.every(page => page >= 1 && page <= 4)).toBe(true);
    expect(pages).not.toContain(1);
  });
});

describe('generateEpubCss', () => {
  it('injects the selected theme colors and font size', () => {
    const css = generateEpubCss({ theme: 'sepia', fontSize: 18, flow: 'paginated', justify: false });
    expect(css).toContain(EPUB_THEMES.sepia.bg);
    expect(css).toContain(EPUB_THEMES.sepia.fg);
    expect(css).toContain('font-size: 18px');
  });

  it('toggles justification', () => {
    const justified = generateEpubCss({
      theme: 'dark',
      fontSize: 16,
      flow: 'paginated',
      justify: true
    });
    expect(justified).toContain('text-align: justify !important');
    expect(justified).toContain(EPUB_THEMES.dark.bg);

    const left = generateEpubCss({
      theme: 'dark',
      fontSize: 16,
      flow: 'paginated',
      justify: false
    });
    expect(left).toContain('text-align: start !important');
  });

  it('clamps absurd font sizes', () => {
    const css = generateEpubCss({
      theme: 'light',
      fontSize: 999,
      flow: 'paginated',
      justify: false
    });
    expect(css).toContain('font-size: 32px');
  });
});

describe('loadReaderSettings', () => {
  const store = new Map<string, string>();
  let original: Storage | undefined;

  beforeEach(() => {
    store.clear();
    original = (globalThis as { localStorage?: Storage }).localStorage;
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: key => void store.delete(key),
      clear: () => store.clear(),
      key: index => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      }
    } as Storage;
  });

  afterEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = original;
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadReaderSettings()).toEqual(DEFAULT_READER_SETTINGS);
  });

  it('merges stored preferences over defaults', () => {
    store.set(
      'booklore.reader.settings.v1',
      JSON.stringify({ epub: { theme: 'night' }, nonsense: true })
    );
    const settings = loadReaderSettings();
    expect(settings.epub.theme).toBe('night');
    expect(settings.epub.fontSize).toBe(DEFAULT_READER_SETTINGS.epub.fontSize);
    expect(settings.cbx).toEqual(DEFAULT_READER_SETTINGS.cbx);
  });

  it('falls back to defaults on corrupt JSON', () => {
    store.set('booklore.reader.settings.v1', '{not json');
    expect(loadReaderSettings()).toEqual(DEFAULT_READER_SETTINGS);
  });
});
