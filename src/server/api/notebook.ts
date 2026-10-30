/**
 * Daily notebook stored as one Markdown file per day:
 *
 *   data/users/<userId>/notebook/<ISO year>-W<week>/<DD>-<MM>-<YYYY>.md
 *
 * The files are meant to be readable (and editable) outside the app, so the
 * format is plain Markdown with a small front-matter block. Anything the app
 * does not know about (extra `##` sections you add by hand) is preserved.
 */
import type { Mood, TodoItem } from './userData';
import { MOODS } from './userData';

export interface BookNote {
  bookId: number;
  /** Title at the time of writing, so the file stays readable if the book is removed. */
  title: string;
  text: string;
}

export interface NotebookEntry {
  date: string;
  todos: TodoItem[];
  mood: Mood | null;
  /** "How was my reading today?" */
  reflection: string;
  /** Free-form thoughts and learnings. */
  thoughts: string;
  /** One remark per book read (or touched) that day. */
  bookNotes: BookNote[];
  updatedAt: string;
}

/** Small per-day digest kept in R2 custom metadata so a month can be listed without reading every file. */
export interface NotebookSummary {
  date: string;
  todos: number;
  done: number;
  mood: Mood | null;
  books: number;
  hasText: boolean;
}

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const pad = (n: number) => String(n).padStart(2, '0');

/* -------------------------------- dates -------------------------------- */

function utcDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** ISO-8601 week (weeks start Monday; week 1 holds the year's first Thursday). */
export function isoWeek(date: string): { year: number; week: number } {
  const d = utcDate(date);
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { year, week };
}

export const weekFolder = (date: string): string => {
  const { year, week } = isoWeek(date);
  return `${year}-W${pad(week)}`;
};

/** `2026-10-28` → `28-10-2026` */
export const fileStem = (date: string): string => {
  const [y, m, d] = date.split('-');
  return `${d}-${m}-${y}`;
};

export const notebookPrefix = (userId: number) => `data/users/${userId}/notebook/`;

export const notebookKey = (userId: number, date: string): string =>
  `${notebookPrefix(userId)}${weekFolder(date)}/${fileStem(date)}.md`;

/** Recover the YYYY-MM-DD a notebook object key refers to, or null for foreign keys. */
export function dateFromKey(key: string): string | null {
  const match = key.match(/\/(\d{2})-(\d{2})-(\d{4})\.md$/);
  if (!match) return null;
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  return DATE_RE.test(date) ? date : null;
}

/** ISO week-years that touch a month (a January can start inside last year's W53). */
export function weekYearsOfMonth(month: string): number[] {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const last = `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
  return [...new Set([isoWeek(first).year, isoWeek(last).year])];
}

export function longDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(utcDate(date));
}

/* ------------------------------- Markdown ------------------------------ */

const SECTION = {
  todo: 'To-do',
  reflection: 'Reading reflection',
  books: 'Books',
  thoughts: 'Thoughts & learnings'
} as const;

const KNOWN = new Map<string, keyof typeof SECTION>(
  (Object.entries(SECTION) as [keyof typeof SECTION, string][]).map(([key, title]) => [title.toLowerCase(), key])
);

/** Keep a user's text from being read as structure: escape lines that start with `#`. */
export const escapeBody = (text: string): string => text.replace(/^(\\*)#/gm, '$1\\#');
export const unescapeBody = (text: string): string => text.replace(/^\\(\\*)#/gm, '$1#');

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const safeTitle = (text: string) => oneLine(text).replace(/-->/g, '→').replace(/[<>]/g, '');

export function isEmptyEntry(entry: NotebookEntry): boolean {
  return (
    entry.todos.length === 0 &&
    !entry.mood &&
    !entry.reflection.trim() &&
    !entry.thoughts.trim() &&
    entry.bookNotes.every(note => !note.text.trim())
  );
}

export function summarize(entry: NotebookEntry): NotebookSummary {
  return {
    date: entry.date,
    todos: entry.todos.length,
    done: entry.todos.filter(t => t.done).length,
    mood: entry.mood,
    books: entry.bookNotes.filter(n => n.text.trim()).length,
    hasText: Boolean(entry.reflection.trim() || entry.thoughts.trim())
  };
}

export const summaryToMetadata = (s: NotebookSummary): Record<string, string> => ({
  todos: String(s.todos),
  done: String(s.done),
  mood: s.mood ?? '',
  books: String(s.books),
  hasText: s.hasText ? '1' : '0'
});

export function summaryFromMetadata(date: string, meta: Record<string, string> | undefined): NotebookSummary | null {
  if (!meta || meta.todos === undefined) return null;
  const mood = (MOODS as readonly string[]).includes(meta.mood) ? (meta.mood as Mood) : null;
  return {
    date,
    todos: Number(meta.todos) || 0,
    done: Number(meta.done) || 0,
    mood,
    books: Number(meta.books) || 0,
    hasText: meta.hasText === '1'
  };
}

/** Render one day. `extra` is preserved hand-written markdown (unknown sections). */
export function serializeEntry(entry: NotebookEntry, extra = ''): string {
  const out: string[] = [];
  const books = entry.bookNotes.filter(n => n.text.trim());

  out.push('---');
  out.push(`date: ${entry.date}`);
  out.push(`week: ${weekFolder(entry.date)}`);
  if (entry.mood) out.push(`mood: ${entry.mood}`);
  if (books.length > 0) out.push(`books: [${books.map(b => b.bookId).join(', ')}]`);
  out.push('---', '', `# ${longDate(entry.date)}`, '');

  out.push(`## ${SECTION.todo}`, '');
  if (entry.todos.length === 0) out.push('_Nothing planned._');
  for (const todo of entry.todos) out.push(`- [${todo.done ? 'x' : ' '}] ${oneLine(todo.text)}`);
  out.push('');

  if (entry.reflection.trim()) out.push(`## ${SECTION.reflection}`, '', escapeBody(entry.reflection.trim()), '');

  if (books.length > 0) {
    out.push(`## ${SECTION.books}`, '');
    for (const note of books) {
      out.push(`### ${safeTitle(note.title) || `Book ${note.bookId}`} <!-- book:${note.bookId} -->`, '');
      out.push(escapeBody(note.text.trim()), '');
    }
  }

  if (entry.thoughts.trim()) out.push(`## ${SECTION.thoughts}`, '', escapeBody(entry.thoughts.trim()), '');

  if (extra.trim()) out.push(extra.trim(), '');

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export interface ParsedEntry {
  entry: NotebookEntry;
  /** Unknown `##` sections, verbatim, to be written back untouched. */
  extra: string;
}

const body = (lines: string[]) => unescapeBody(lines.join('\n')).trim();

/** Parse a day file. Tolerant: missing sections are empty, unknown sections go to `extra`. */
export function parseEntry(date: string, markdown: string, updatedAt = ''): ParsedEntry {
  const text = markdown.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  let cursor = 0;

  const front: Record<string, string> = {};
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const match = line.match(/^([A-Za-z_]+):\s*(.*)$/);
        if (match) front[match[1].toLowerCase()] = match[2].trim();
      }
      cursor = end + 1;
    }
  }

  type Block = { kind: keyof typeof SECTION | 'extra' | 'preamble'; heading: string; lines: string[] };
  const blocks: Block[] = [{ kind: 'preamble', heading: '', lines: [] }];
  for (const line of lines.slice(cursor)) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      const known = KNOWN.get(h2[1].toLowerCase());
      blocks.push({ kind: known ?? 'extra', heading: line, lines: [] });
    } else {
      blocks[blocks.length - 1].lines.push(line);
    }
  }

  const entry: NotebookEntry = {
    date,
    todos: [],
    mood: (MOODS as readonly string[]).includes(front.mood) ? (front.mood as Mood) : null,
    reflection: '',
    thoughts: '',
    bookNotes: [],
    updatedAt
  };
  const extras: string[] = [];

  for (const block of blocks) {
    if (block.kind === 'todo') {
      for (const line of block.lines) {
        const item = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
        if (item && item[2].trim()) {
          entry.todos.push({ id: `t${entry.todos.length}`, text: item[2].trim(), done: item[1] !== ' ' });
        }
      }
    } else if (block.kind === 'reflection') {
      entry.reflection = body(block.lines);
    } else if (block.kind === 'thoughts') {
      entry.thoughts = body(block.lines);
    } else if (block.kind === 'books') {
      let current: { bookId: number; title: string; lines: string[] } | null = null;
      const flush = () => {
        if (current) entry.bookNotes.push({ bookId: current.bookId, title: current.title, text: body(current.lines) });
        current = null;
      };
      for (const line of block.lines) {
        const h3 = line.match(/^###\s+(.*?)\s*<!--\s*book:(\d+)\s*-->\s*$/);
        if (h3) {
          flush();
          current = { bookId: Number(h3[2]), title: h3[1].trim(), lines: [] };
        } else if (current) {
          current.lines.push(line);
        }
      }
      flush();
    } else if (block.kind === 'extra') {
      extras.push([block.heading, ...block.lines].join('\n').trim());
    }
  }

  return { entry, extra: extras.join('\n\n') };
}
