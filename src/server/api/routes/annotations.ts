import { Hono } from 'hono';
import { AppEnv, canSeeLibrary } from '../context';
import {
  MAX_SIDECAR_BYTES,
  cleanHighlight,
  emptySidecar,
  nearestNoteColor,
  type AnnotationSidecar,
  type SidecarHighlight
} from '../annotations';
import { annotationKey } from '../store';
import { BookRecord, HttpError } from '../types';
import { notesDoc, sourceKey, type NoteRecord } from '../userData';

async function visibleBook(c: { get: (k: 'user' | 'store') => any }, id: number): Promise<BookRecord> {
  const { index } = await c.get('store').read();
  const record = index.books.find((b: BookRecord) => b.id === id);
  if (!record || !canSeeLibrary(c.get('user'), record.libraryId)) throw new HttpError(404, 'Book not found');
  return record;
}

async function readSidecar(bucket: R2Bucket, record: BookRecord) {
  const object = await bucket.get(annotationKey(record));
  if (!object) return { sidecar: emptySidecar(record.id, record.fileName), etag: null as string | null };
  const sidecar = (await object.json<AnnotationSidecar>().catch(() => null)) ?? emptySidecar(record.id, record.fileName);
  return { sidecar, etag: object.etag as string | null };
}

export function registerAnnotationRoutes(app: Hono<AppEnv>): void {
  app.get('/api/v1/books/:id/annotations', async c => {
    const record = await visibleBook(c, Number(c.req.param('id')));
    const { sidecar } = await readSidecar(c.env.Library, record);
    return c.json(sidecar);
  });

  /**
   * Save the book's annotations. `baseUpdatedAt` is the version the client
   * last loaded/saved; if the file has moved on (another device saved) the
   * write is refused with 409 and the current file, so nothing is lost silently.
   */
  app.put('/api/v1/books/:id/annotations', async c => {
    const record = await visibleBook(c, Number(c.req.param('id')));
    const text = await c.req.text();
    if (text.length > MAX_SIDECAR_BYTES) throw new HttpError(413, 'Annotations are too large to save');
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'Body must be JSON');
    }
    if (!Array.isArray(body.annotations)) throw new HttpError(400, 'annotations must be an array');
    const highlights = (Array.isArray(body.highlights) ? body.highlights : [])
      .map(cleanHighlight)
      .filter((h): h is SidecarHighlight => h !== null);

    const bucket = c.env.Library;
    const key = annotationKey(record);
    const { sidecar: current, etag } = await readSidecar(bucket, record);
    const base = typeof body.baseUpdatedAt === 'string' ? body.baseUpdatedAt : null;
    if (current.updatedAt !== base) {
      return c.json({ message: 'These annotations changed on another device', current }, 409);
    }

    // Never hand out a version token equal to the previous one.
    let updatedAt = new Date().toISOString();
    if (updatedAt === current.updatedAt) updatedAt = new Date(Date.now() + 1).toISOString();
    const next: AnnotationSidecar = {
      schemaVersion: 1,
      bookId: record.id,
      fileName: record.fileName,
      updatedAt,
      pageCount: Number.isInteger(body.pageCount) && (body.pageCount as number) > 0 ? (body.pageCount as number) : current.pageCount,
      annotations: body.annotations,
      highlights
    };
    const written = etag
      ? await bucket.put(key, JSON.stringify(next), { onlyIf: { etagMatches: etag }, httpMetadata: { contentType: 'application/json' } })
      : await bucket.put(key, JSON.stringify(next), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } });
    if (!written) return c.json({ message: 'These annotations changed on another device', current }, 409);

    // Cheap count on the book so the UI can show it without reading the sidecar.
    try {
      await c.get('store').update(index => {
        const r = index.books.find(b => b.id === record.id);
        if (r) r.annotationCount = highlights.length || undefined;
      });
    } catch (error) {
      console.error('Could not record annotation count:', error);
    }
    return c.json(next);
  });

  /**
   * Turn PDF highlights/notes into entries on the Notes page. Idempotent:
   * each annotation is imported once (keyed by book + annotation id), and
   * notes the reader deleted stay deleted.
   */
  app.post('/api/v1/notes/import-annotations', async c => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { index } = await c.get('store').read();
    const books: BookRecord[] =
      body.bookId !== undefined
        ? [await visibleBook(c, Number(body.bookId))]
        : index.books.filter(b => (b.annotationCount ?? 0) > 0 && canSeeLibrary(user, b.libraryId));

    const sidecars = await Promise.all(books.map(async book => ({ book, ...(await readSidecar(c.env.Library, book)) })));

    const result = await notesDoc(c.env.Library, user.id).update(doc => {
      const known = new Set<string>(doc.dismissed ?? []);
      for (const n of doc.items) if (n.source) known.add(sourceKey(n.bookId, n.source.annotationId));
      let imported = 0;
      let skipped = 0;
      const now = new Date().toISOString();
      for (const { book, sidecar } of sidecars) {
        for (const h of sidecar.highlights) {
          const key = sourceKey(book.id, h.id);
          const isMarkup = h.kind === 'highlight' || h.kind === 'underline' || h.kind === 'squiggly';
          const usable = isMarkup ? Boolean(h.text) : Boolean(h.comment || h.text);
          if (known.has(key) || !usable) {
            skipped++;
            continue;
          }
          known.add(key);
          const created = h.createdAt ?? now;
          const note: NoteRecord = {
            id: doc.nextId++,
            bookId: book.id,
            type: isMarkup ? 'highlight' : 'note',
            quote: isMarkup ? h.text : '',
            text: isMarkup ? h.comment : h.comment || h.text,
            color: nearestNoteColor(h.color),
            location: String(h.page),
            percentage: sidecar.pageCount ? Math.min(100, Math.round((h.page / sidecar.pageCount) * 1000) / 10) : undefined,
            source: { kind: 'pdf', annotationId: h.id },
            createdAt: created,
            updatedAt: created
          };
          doc.items.push(note);
          imported++;
        }
      }
      return { imported, skipped };
    });
    return c.json({ ...result, books: books.length });
  });
}
