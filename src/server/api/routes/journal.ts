import { Hono } from 'hono';
import { AppEnv, canSeeLibrary } from '../context';
import { HttpError } from '../types';
import { DATE_RE, notebookKey, type BookNote, type NotebookEntry } from '../notebook';
import { listMonth, readDay, writeDay } from '../notebookStore';
import {
  MOODS,
  NOTE_COLORS,
  activityDoc,
  notesDoc,
  sourceKey,
  type Mood,
  type NoteColor,
  type NoteRecord,
  type NoteType,
  type TodoItem
} from '../userData';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const MAX_QUOTE = 5000;
const MAX_TEXT = 5000;
const MAX_TODOS = 100;
const MAX_TODO_TEXT = 300;
const MAX_LONG_TEXT = 20000;
const MAX_BOOK_NOTES = 50;

const asString = (value: unknown, max: number, field: string): string => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`);
  if (value.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  return value;
};

function parseTodos(value: unknown): TodoItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'todos must be an array');
  if (value.length > MAX_TODOS) throw new HttpError(400, `At most ${MAX_TODOS} to-dos per day`);
  return value.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const text = asString(item.text, MAX_TODO_TEXT, 'todo text').trim();
    if (!text) throw new HttpError(400, 'to-do text cannot be empty');
    const id = typeof item.id === 'string' && item.id.length <= 64 && item.id ? item.id : `t${index}-${Date.now()}`;
    return { id, text, done: item.done === true };
  });
}

function parseBookNotes(
  value: unknown,
  books: { id: number; libraryId: number; metadata: { title?: string }; fileName: string }[],
  canSee: (libraryId: number) => boolean
): BookNote[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'bookNotes must be an array');
  if (value.length > MAX_BOOK_NOTES) throw new HttpError(400, `At most ${MAX_BOOK_NOTES} book notes per day`);
  const seen = new Set<number>();
  const notes: BookNote[] = [];
  for (const raw of value) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const bookId = Number(item.bookId);
    if (!Number.isInteger(bookId) || bookId <= 0) throw new HttpError(400, 'bookNotes[].bookId is required');
    if (seen.has(bookId)) continue;
    seen.add(bookId);
    const book = books.find(b => b.id === bookId);
    if (book && !canSee(book.libraryId)) throw new HttpError(404, 'Book not found');
    // A removed book keeps the title it had when the remark was written.
    const title = book
      ? (book.metadata.title ?? book.fileName)
      : asString(item.title, 300, 'bookNotes[].title').trim();
    notes.push({ bookId, title, text: asString(item.text, MAX_LONG_TEXT, 'bookNotes[].text') });
  }
  return notes;
}

export function registerJournalRoutes(app: Hono<AppEnv>): void {
  /* ----------------------------- notes & highlights ----------------------------- */

  app.get('/api/v1/notes', async c => {
    const user = c.get('user');
    const { index } = await c.get('store').read();
    const visible = new Set(index.books.filter(b => canSeeLibrary(user, b.libraryId)).map(b => b.id));
    const bookId = c.req.query('bookId') ? Number(c.req.query('bookId')) : undefined;
    const type = c.req.query('type');
    const { value } = await notesDoc(c.env.Library, user.id).read();
    const items = value.items
      .filter(n => visible.has(n.bookId))
      .filter(n => bookId === undefined || n.bookId === bookId)
      .filter(n => !type || n.type === type)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return c.json(items);
  });

  app.post('/api/v1/notes', async c => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const bookId = Number(body.bookId);
    if (!Number.isInteger(bookId)) throw new HttpError(400, 'bookId is required');
    const { index } = await c.get('store').read();
    const book = index.books.find(b => b.id === bookId);
    if (!book || !canSeeLibrary(user, book.libraryId)) throw new HttpError(404, 'Book not found');

    const type: NoteType = body.type === 'highlight' ? 'highlight' : 'note';
    const quote = asString(body.quote, MAX_QUOTE, 'quote').trim();
    const text = asString(body.text, MAX_TEXT, 'text').trim();
    if (!quote && !text) throw new HttpError(400, 'Provide a quote or a note');
    if (type === 'highlight' && !quote) throw new HttpError(400, 'A highlight needs the highlighted text');
    const color = (NOTE_COLORS as readonly string[]).includes(body.color) ? (body.color as NoteColor) : 'yellow';
    const percentage =
      typeof body.percentage === 'number' && Number.isFinite(body.percentage)
        ? Math.min(100, Math.max(0, body.percentage))
        : undefined;
    const now = new Date().toISOString();

    const created = await notesDoc(c.env.Library, user.id).update(doc => {
      const note: NoteRecord = {
        id: doc.nextId++,
        bookId,
        type,
        quote,
        text,
        color,
        location: typeof body.location === 'string' ? body.location.slice(0, 500) : undefined,
        chapter: typeof body.chapter === 'string' ? body.chapter.slice(0, 300) : undefined,
        percentage,
        createdAt: now,
        updatedAt: now
      };
      doc.items.push(note);
      return note;
    });
    return c.json(created, 201);
  });

  app.put('/api/v1/notes/:id', async c => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    const updated = await notesDoc(c.env.Library, user.id).update(doc => {
      const note = doc.items.find(n => n.id === id);
      if (!note) throw new HttpError(404, 'Note not found');
      if (body.quote !== undefined) note.quote = asString(body.quote, MAX_QUOTE, 'quote').trim();
      if (body.text !== undefined) note.text = asString(body.text, MAX_TEXT, 'text').trim();
      if ((NOTE_COLORS as readonly string[]).includes(body.color)) note.color = body.color;
      if (!note.quote && !note.text) throw new HttpError(400, 'A note cannot be empty');
      note.updatedAt = new Date().toISOString();
      return note;
    });
    return c.json(updated);
  });

  app.delete('/api/v1/notes/:id', async c => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    await notesDoc(c.env.Library, user.id).update(doc => {
      const note = doc.items.find(n => n.id === id);
      if (!note) throw new HttpError(404, 'Note not found');
      // Remember imported notes that were deleted so the next import doesn't revive them.
      if (note.source) doc.dismissed = [...new Set([...(doc.dismissed ?? []), sourceKey(note.bookId, note.source.annotationId)])];
      doc.items = doc.items.filter(n => n.id !== id);
    });
    return c.body(null, 204);
  });

  /* --------------------------------- notebook ---------------------------------- */

  // Days with a note in a month, as light summaries (one R2 listing, no file reads).
  app.get('/api/v1/notebook', async c => {
    const user = c.get('user');
    const month = c.req.query('month') ?? '';
    if (!MONTH_RE.test(month)) throw new HttpError(400, 'month must be YYYY-MM');
    return c.json({ month, days: await listMonth(c.env.Library, user.id, month) });
  });

  app.get('/api/v1/notebook/:date', async c => {
    const user = c.get('user');
    const date = c.req.param('date');
    if (!DATE_RE.test(date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
    const { entry } = await readDay(c.env.Library, user.id, date);
    return c.json(entry);
  });

  // The stored Markdown itself, for "Download .md".
  app.get('/api/v1/notebook/:date/markdown', async c => {
    const user = c.get('user');
    const date = c.req.param('date');
    if (!DATE_RE.test(date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
    const { markdown } = await readDay(c.env.Library, user.id, date);
    if (markdown === null) throw new HttpError(404, 'No notebook entry for this day');
    return new Response(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${notebookKey(user.id, date).split('/').pop()}"`
      }
    });
  });

  app.put('/api/v1/notebook/:date', async c => {
    const user = c.get('user');
    const date = c.req.param('date');
    if (!DATE_RE.test(date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
    const body = await c.req.json().catch(() => ({}));
    const { index } = await c.get('store').read();
    const entry: NotebookEntry = {
      date,
      todos: parseTodos(body.todos),
      mood: (MOODS as readonly string[]).includes(body.mood) ? (body.mood as Mood) : null,
      reflection: asString(body.reflection, MAX_LONG_TEXT, 'reflection'),
      thoughts: asString(body.thoughts, MAX_LONG_TEXT, 'thoughts'),
      bookNotes: parseBookNotes(body.bookNotes, index.books, id => canSeeLibrary(user, id)),
      updatedAt: new Date().toISOString()
    };
    await writeDay(c.env.Library, user.id, entry);
    return c.json(entry);
  });

  /* --------------------------------- activity ---------------------------------- */

  app.get('/api/v1/activity', async c => {
    const user = c.get('user');
    const { value } = await activityDoc(c.env.Library, user.id).read();
    return c.json({ days: value.days });
  });
}
