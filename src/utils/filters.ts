import type { Book, ReadStatus } from '../api/types';
import { READ_STATUS_LABELS } from './format';

export type FilterType =
  | 'author'
  | 'category'
  | 'series'
  | 'bookType'
  | 'readStatus'
  | 'personalRating'
  | 'publisher'
  | 'shelf'
  | 'shelfStatus'
  | 'tag'
  | 'publishedDate'
  | 'fileSize'
  | 'language'
  | 'pageCount';

export interface FilterValue {
  id: string | number;
  name: string;
  sortIndex?: number;
}

export interface Facet {
  type: FilterType;
  values: (FilterValue & { bookCount: number })[];
}

export const FILTER_LABELS: Record<FilterType, string> = {
  author: 'Author',
  category: 'Genre',
  series: 'Series',
  bookType: 'File Format',
  readStatus: 'Read Status',
  personalRating: 'Personal Rating',
  publisher: 'Publisher',
  shelf: 'Shelf',
  shelfStatus: 'Shelf Status',
  tag: 'Tag',
  publishedDate: 'Published Year',
  fileSize: 'File Size',
  language: 'Language',
  pageCount: 'Page Count'
};

interface RangeConfig {
  id: number;
  label: string;
  min: number;
  max: number;
  sortIndex: number;
}

const RATING_OPTIONS: RangeConfig[] = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  label: `${i + 1}`,
  min: i + 1,
  max: i + 2,
  sortIndex: i
}));

const FILE_SIZE_RANGES: RangeConfig[] = [
  { id: 0, label: '< 1 MB', min: 0, max: 1024, sortIndex: 0 },
  { id: 1, label: '1–10 MB', min: 1024, max: 10240, sortIndex: 1 },
  { id: 2, label: '10–50 MB', min: 10240, max: 51200, sortIndex: 2 },
  { id: 3, label: '50–100 MB', min: 51200, max: 102400, sortIndex: 3 },
  { id: 4, label: '100–500 MB', min: 102400, max: 512000, sortIndex: 4 },
  { id: 5, label: '500 MB+', min: 512000, max: Infinity, sortIndex: 5 }
];

const PAGE_COUNT_RANGES: RangeConfig[] = [
  { id: 0, label: '< 50 pages', min: 0, max: 50, sortIndex: 0 },
  { id: 1, label: '50–200 pages', min: 50, max: 200, sortIndex: 1 },
  { id: 2, label: '200–400 pages', min: 200, max: 400, sortIndex: 2 },
  { id: 3, label: '400–1000 pages', min: 400, max: 1000, sortIndex: 3 },
  { id: 4, label: '1000+ pages', min: 1000, max: Infinity, sortIndex: 4 }
];

const findInRange = (value: number | null | undefined, ranges: RangeConfig[]): FilterValue[] => {
  if (value == null) return [];
  const match = ranges.find(r => value >= r.min && value < r.max);
  return match ? [{ id: match.id, name: match.label, sortIndex: match.sortIndex }] : [];
};

const strings = (values: string[] | undefined): FilterValue[] =>
  values?.map(name => ({ id: name, name })) ?? [];

const single = (value: string | undefined | null): FilterValue[] => (value ? [{ id: value, name: value }] : []);

/** Extracts the filter values a single book contributes to, per filter type. */
const EXTRACTORS: Record<FilterType, (book: Book) => FilterValue[]> = {
  author: book => strings(book.metadata.authors),
  category: book => strings(book.metadata.categories),
  series: book => single(book.metadata.seriesName?.trim()),
  bookType: book => single(book.primaryFile?.bookType),
  readStatus: book => {
    const status: ReadStatus = book.readStatus ?? 'UNSET';
    return [{ id: status, name: READ_STATUS_LABELS[status] ?? status }];
  },
  personalRating: book => findInRange(book.personalRating ?? undefined, RATING_OPTIONS),
  publisher: book => single(book.metadata.publisher),
  shelf: book => (book.shelves ?? []).map(s => ({ id: s.id, name: s.name })),
  shelfStatus: book => {
    const shelved = (book.shelves?.length ?? 0) > 0;
    return [{ id: shelved ? 'shelved' : 'unshelved', name: shelved ? 'Shelved' : 'Unshelved' }];
  },
  tag: book => strings(book.metadata.tags),
  publishedDate: book => {
    const date = book.metadata.publishedDate;
    if (!date) return [];
    const year = new Date(date).getFullYear();
    return Number.isNaN(year) ? [] : [{ id: String(year), name: String(year) }];
  },
  fileSize: book => findInRange(book.fileSizeKb, FILE_SIZE_RANGES),
  language: book => single(book.metadata.language),
  pageCount: book => findInRange(book.metadata.pageCount, PAGE_COUNT_RANGES)
};

const COUNT_DESC: Record<FilterType, boolean> = {
  author: true,
  category: true,
  series: true,
  bookType: true,
  readStatus: true,
  personalRating: false,
  publisher: true,
  shelf: true,
  shelfStatus: true,
  tag: true,
  publishedDate: true,
  fileSize: false,
  language: true,
  pageCount: false
};

export type FilterSelection = Partial<Record<FilterType, (string | number)[]>>;

export function isFilterActive(selection: FilterSelection): boolean {
  return Object.values(selection).some(values => (values?.length ?? 0) > 0);
}

/** Builds the facet lists (values + counts) shown in the filter sidebar. */
export function buildFacets(scope: Book[], selection: FilterSelection): Facet[] {
  return (Object.keys(EXTRACTORS) as FilterType[]).map(type => {
    const counts = new Map<string | number, { value: FilterValue; count: number }>();
    for (const book of scope) {
      for (const value of EXTRACTORS[type](book)) {
        const entry = counts.get(value.id) ?? { value, count: 0 };
        entry.count++;
        counts.set(value.id, entry);
      }
    }
    const selected = selection[type] ?? [];
    const values = [...counts.values()]
      .map(({ value, count }) => ({ ...value, bookCount: count }))
      .filter(entry => entry.bookCount > 0 || selected.includes(entry.id));

    // Selected values stay visible even when the current scope has no matches,
    // so they can be deselected. Recover a readable label where possible.
    for (const id of selected) {
      if (counts.has(id)) continue;
      const shelfBook =
        typeof id === 'number' ? scope.find(b => b.shelves?.some(shelf => shelf.id === id)) : undefined;
      const name =
        typeof id === 'string'
          ? READ_STATUS_LABELS[id as ReadStatus] ?? id
          : (shelfBook?.shelves.find(shelf => shelf.id === id)?.name ?? String(id));
      values.push({ id, name, bookCount: 0 });
    }

    values.sort((a, b) => {
        const byIndex = (a.sortIndex ?? 0) - (b.sortIndex ?? 0);
        if (byIndex !== 0) return byIndex;
      if (COUNT_DESC[type] && b.bookCount !== a.bookCount) return b.bookCount - a.bookCount;
      return a.name.localeCompare(b.name);
    });
    return { type, values };
  });
}

/** Applies the filter selection; each selected type acts as an AND across types, OR within a type. */
export function applyFilters(books: Book[], selection: FilterSelection): Book[] {
  const active = (Object.keys(selection) as FilterType[]).filter(type => (selection[type]?.length ?? 0) > 0);
  if (active.length === 0) return books;
  return books.filter(book =>
    active.every(type => {
      const selected = selection[type]!;
      const values = EXTRACTORS[type](book);
      return values.some(value => selected.includes(value.id));
    })
  );
}

export function matchesSearch(book: Book, term: string): boolean {
  if (!term.trim()) return true;
  const needle = term.trim().toLowerCase();
  const haystack = [
    book.metadata.title,
    book.fileName,
    ...(book.metadata.authors ?? []),
    book.metadata.seriesName,
    book.metadata.isbn13,
    book.metadata.isbn10
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}
