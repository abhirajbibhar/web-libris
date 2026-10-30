import { Hono } from 'hono';
import { AppEnv, canSeeLibrary } from '../context';
import { toCsv } from '../csv';
import { HttpError } from '../types';
import { notesDoc, quotesDoc, type QuoteRecord } from '../userData';

const MAX_TEXT = 5000;
const str = (v: unknown, max: number, field: string): string => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be a string`);
  if (v.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  return v.trim();
};
const tagsOf = (v: unknown): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, 'tags must be an array');
  return [...new Set(v.filter((t): t is string => typeof t === 'string').map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
};

export function registerQuoteRoutes(app: Hono<AppEnv>): void {
  app.get('/api/v1/quotes', async c => {
    const { value } = await quotesDoc(c.env.Library, c.get('user').id).read();
    return c.json([...value.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });

  // Download the whole collection. JSON is the stored form; CSV opens in any spreadsheet.
  app.get('/api/v1/quotes/export', async c => {
    const user = c.get('user');
    const format = c.req.query('format') === 'json' ? 'json' : 'csv';
    const { value } = await quotesDoc(c.env.Library, user.id).read();
    const { index } = await c.get('store').read();
    const titles = new Map(index.books.map(b => [b.id, b.metadata.title ?? b.fileName]));
    const items = [...value.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (format === 'json') {
      return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), quotes: items }, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="quotes.json"' }
      });
    }
    const csv = toCsv(
      ['id', 'quote', 'author', 'source', 'book', 'location', 'tags', 'favorite', 'added'],
      items.map(q => [q.id, q.text, q.author, q.source, q.bookId ? titles.get(q.bookId) : '', q.location, q.tags.join('; '), q.favorite, q.createdAt])
    );
    return new Response('\ufeff' + csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="quotes.csv"' }
    });
  });

  app.post('/api/v1/quotes', async c => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const text = str(body.text, MAX_TEXT, 'text');
    if (!text) throw new HttpError(400, 'A quote needs some text');
    let bookId: number | undefined;
    if (body.bookId !== undefined && body.bookId !== null) {
      bookId = Number(body.bookId);
      const { index } = await c.get('store').read();
      const book = index.books.find(b => b.id === bookId);
      if (!book || !canSeeLibrary(user, book.libraryId)) throw new HttpError(404, 'Book not found');
    }
    const now = new Date().toISOString();
    const created = await quotesDoc(c.env.Library, user.id).update(doc => {
      const quote: QuoteRecord = {
        id: doc.nextId++,
        text,
        author: str(body.author, 300, 'author'),
        source: str(body.source, 300, 'source'),
        bookId,
        location: str(body.location, 100, 'location') || undefined,
        tags: tagsOf(body.tags),
        favorite: body.favorite === true,
        origin: 'manual',
        createdAt: now,
        updatedAt: now
      };
      doc.items.push(quote);
      return quote;
    });
    return c.json(created, 201);
  });

  /** Add highlights/notes from the Notes page as quotes. Without `noteIds`, every highlight not yet quoted. */
  app.post('/api/v1/quotes/from-notes', async c => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const wanted = Array.isArray(body.noteIds) ? new Set<number>(body.noteIds.map(Number)) : null;
    const { index } = await c.get('store').read();
    const books = new Map(index.books.filter(b => canSeeLibrary(user, b.libraryId)).map(b => [b.id, b]));
    const { value: notes } = await notesDoc(c.env.Library, user.id).read();
    const now = new Date().toISOString();

    const result = await quotesDoc(c.env.Library, user.id).update(doc => {
      const have = new Set(doc.items.filter(q => q.noteId !== undefined).map(q => q.noteId));
      let added = 0;
      let skipped = 0;
      for (const note of notes.items) {
        if (wanted ? !wanted.has(note.id) : note.type !== 'highlight') continue;
        const book = books.get(note.bookId);
        if (!book || !note.quote.trim() || have.has(note.id)) {
          skipped++;
          continue;
        }
        have.add(note.id);
        doc.items.push({
          id: doc.nextId++,
          text: note.quote.trim(),
          author: book.metadata.authors?.[0] ?? '',
          source: book.metadata.title ?? book.fileName,
          bookId: book.id,
          location: note.location,
          tags: [],
          favorite: false,
          origin: 'note',
          noteId: note.id,
          createdAt: now,
          updatedAt: now
        });
        added++;
      }
      return { added, skipped };
    });
    return c.json(result);
  });

  app.put('/api/v1/quotes/:id', async c => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    let bookId: number | null | undefined;
    if (body.bookId === null) bookId = null;
    else if (body.bookId !== undefined) {
      bookId = Number(body.bookId);
      const { index } = await c.get('store').read();
      const book = index.books.find(b => b.id === bookId);
      if (!book || !canSeeLibrary(user, book.libraryId)) throw new HttpError(404, 'Book not found');
    }
    const updated = await quotesDoc(c.env.Library, user.id).update(doc => {
      const q = doc.items.find(x => x.id === id);
      if (!q) throw new HttpError(404, 'Quote not found');
      if (body.text !== undefined) q.text = str(body.text, MAX_TEXT, 'text');
      if (!q.text) throw new HttpError(400, 'A quote needs some text');
      if (body.author !== undefined) q.author = str(body.author, 300, 'author');
      if (body.source !== undefined) q.source = str(body.source, 300, 'source');
      if (body.location !== undefined) q.location = str(body.location, 100, 'location') || undefined;
      if (body.tags !== undefined) q.tags = tagsOf(body.tags);
      if (bookId !== undefined) q.bookId = bookId ?? undefined;
      if (typeof body.favorite === 'boolean') q.favorite = body.favorite;
      q.updatedAt = new Date().toISOString();
      return q;
    });
    return c.json(updated);
  });

  app.delete('/api/v1/quotes/:id', async c => {
    const id = Number(c.req.param('id'));
    await quotesDoc(c.env.Library, c.get('user').id).update(doc => {
      if (!doc.items.some(q => q.id === id)) throw new HttpError(404, 'Quote not found');
      doc.items = doc.items.filter(q => q.id !== id);
    });
    return c.body(null, 204);
  });
}
