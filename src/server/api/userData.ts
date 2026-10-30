/**
 * Per-user documents (notes, notebook, reading activity). They live in their
 * own R2 objects instead of the shared library index so years of journal
 * entries never bloat the file every request has to read.
 */
const MAX_CAS_RETRIES = 5;

export class JsonDoc<T> {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly key: string,
    private readonly empty: () => T
  ) {}

  async read(): Promise<{ value: T; etag: string | null }> {
    const object = await this.bucket.get(this.key);
    if (!object) return { value: this.empty(), etag: null };
    return { value: (await object.json<T>()) ?? this.empty(), etag: object.etag };
  }

  /** Apply `mutate` to a copy and persist with compare-and-swap, retrying on conflicts. */
  async update<R>(mutate: (draft: T) => R): Promise<R> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const { value, etag } = await this.read();
      const draft = structuredClone(value);
      const result = mutate(draft);
      const body = JSON.stringify(draft);
      const written = etag
        ? await this.bucket.put(this.key, body, { onlyIf: { etagMatches: etag } })
        : await this.bucket.put(this.key, body, { onlyIf: { etagDoesNotMatch: '*' } });
      if (written) return result;
    }
    throw new Error('Could not save, please try again');
  }
}

export type NoteType = 'highlight' | 'note';
export const NOTE_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface NoteRecord {
  id: number;
  bookId: number;
  type: NoteType;
  /** Highlighted passage (for highlights) or a quote attached to a note. */
  quote: string;
  /** The reader's own comment. */
  text: string;
  color: NoteColor;
  /** Reader position: EPUB CFI or page number as text. */
  location?: string;
  chapter?: string;
  /** 0-100 position in the book when the note was made. */
  percentage?: number;
  /** Set when the note was imported from a PDF annotation (dedup key). */
  source?: { kind: 'pdf'; annotationId: string };
  createdAt: string;
  updatedAt: string;
}

export interface NotesDoc {
  nextId: number;
  items: NoteRecord[];
  /** Import keys of notes the reader deleted, so re-importing doesn't bring them back. */
  dismissed?: string[];
}

export const sourceKey = (bookId: number, annotationId: string) => `pdf:${bookId}:${annotationId}`;

export interface QuoteRecord {
  id: number;
  text: string;
  author: string;
  /** Free-text origin (book title, article, speech…). */
  source: string;
  bookId?: number;
  location?: string;
  tags: string[];
  favorite: boolean;
  origin: 'manual' | 'note';
  noteId?: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuotesDoc {
  nextId: number;
  items: QuoteRecord[];
}

export type Mood = 'great' | 'good' | 'okay' | 'low';
export const MOODS: readonly Mood[] = ['great', 'good', 'okay', 'low'];

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

/**
 * Pre-Markdown notebook format (one JSON doc per month). Only read, to migrate
 * old entries into per-day `.md` files — see notebookStore.ts.
 */
export interface LegacyNotebookEntry {
  date: string;
  todos: TodoItem[];
  mood: Mood | null;
  reflection: string;
  thoughts: string;
  updatedAt: string;
}

export interface LegacyNotebookMonthDoc {
  days: Record<string, LegacyNotebookEntry>;
}

export interface BookDayActivity {
  /** Estimated active reading time that day on this book. */
  seconds: number;
  /** Position (0-100) the first and latest saves of the day landed on. */
  startPct: number;
  endPct: number;
}

export interface ActivityDay {
  seconds: number;
  books: Record<string, BookDayActivity>;
}

export interface ActivityDoc {
  days: Record<string, ActivityDay>;
  /** Last progress save, used to estimate time between saves. */
  last?: { bookId: number; at: number };
}

const base = (userId: number) => `data/users/${userId}`;
export const notesDoc = (bucket: R2Bucket, userId: number) =>
  new JsonDoc<NotesDoc>(bucket, `${base(userId)}/notes.json`, () => ({ nextId: 1, items: [] }));
export const quotesDoc = (bucket: R2Bucket, userId: number) =>
  new JsonDoc<QuotesDoc>(bucket, `${base(userId)}/quotes.json`, () => ({ nextId: 1, items: [] }));
export const activityDoc = (bucket: R2Bucket, userId: number) =>
  new JsonDoc<ActivityDoc>(bucket, `${base(userId)}/activity.json`, () => ({ days: {} }));
export const legacyNotebookKey = (userId: number, month: string) => `${base(userId)}/notebook/${month}.json`;

/** Resolve a usable IANA time zone from the client header, then Cloudflare's guess. */
export function resolveTimeZone(...candidates: (string | undefined | null)[]): string {
  for (const tz of candidates) {
    if (!tz) continue;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    } catch {
      // try the next candidate
    }
  }
  return 'UTC';
}

/** YYYY-MM-DD for an instant in the given time zone. */
export function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(ms);
}

/** Longest gap between two saves that still counts as continuous reading. */
const MAX_GAP_SECONDS = 5 * 60;

/** Record one progress save in the user's activity log. */
export async function recordReading(
  bucket: R2Bucket,
  userId: number,
  bookId: number,
  percentage: number,
  timeZone: string,
  now: number = Date.now()
): Promise<void> {
  const date = localDate(now, timeZone);
  await activityDoc(bucket, userId).update(doc => {
    const day = (doc.days[date] ??= { seconds: 0, books: {} });
    const key = String(bookId);
    const entry = day.books[key];
    let elapsed = 0;
    if (doc.last && doc.last.bookId === bookId) {
      const gap = Math.round((now - doc.last.at) / 1000);
      if (gap > 0) elapsed = Math.min(gap, MAX_GAP_SECONDS);
    }
    if (entry) {
      entry.seconds += elapsed;
      entry.endPct = percentage;
    } else {
      day.books[key] = { seconds: elapsed, startPct: percentage, endPct: percentage };
    }
    day.seconds += elapsed;
    doc.last = { bookId, at: now };
  });
}
