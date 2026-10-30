import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/server/api/index';
import { nearestNoteColor } from '../src/server/api/annotations';
import { toCsv } from '../src/server/api/csv';
import { MockR2Bucket, asBucket } from './mock-r2';

let bucket: MockR2Bucket;
let env: Record<string, unknown>;

const call = (path: string, token: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  return app.request(path, { ...init, headers }, env);
};
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

async function login(): Promise<string> {
  const res = await app.request('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'password123' }) }, env);
  return ((await res.json()) as { accessToken: string }).accessToken;
}
async function uploadBook(token: string): Promise<number> {
  const form = new FormData();
  form.set('file', new File([new Uint8Array([1, 2, 3])], 'My Book.pdf', { type: 'application/pdf' }));
  form.set('libraryId', '1');
  form.set('metadata', JSON.stringify({ title: 'My Book', authors: ['Ann Author'] }));
  const res = await call('/api/v1/files/upload', token, { method: 'POST', body: form });
  return ((await res.json()) as { id: number }).id;
}

const hl = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'highlight', page: 3, text, comment: '', color: '#FFCD45', ...extra });

beforeEach(() => {
  bucket = new MockR2Bucket();
  env = {
    Library: asBucket(bucket),
    ENVIRONMENT: 'development',
    JWT_SECRET: 'test-jwt-secret',
    ADMIN_USER: 'admin',
    ADMIN_PASSWORD: 'password123'
  };
});

describe('annotation sidecar', () => {
  it('lives beside the book as "<file name>.annotation.json"', async () => {
    const token = await login();
    const id = await uploadBook(token);
    const empty = await (await call(`/api/v1/books/${id}/annotations`, token)).json();
    expect(empty).toMatchObject({ updatedAt: null, annotations: [], highlights: [] });

    const res = await call(`/api/v1/books/${id}/annotations`, token, json('PUT', { baseUpdatedAt: null, pageCount: 10, annotations: [{ annotation: { id: 'a1' } }], highlights: [hl('a1', 'Fear is the mind-killer')] }));
    expect(res.status).toBe(200);
    const saved = (await res.json()) as { updatedAt: string };
    expect(bucket.keys()).toContain(`files/${id}/My Book.annotation.json`);
    expect(bucket.keys()).toContain(`files/${id}/My Book.pdf`);

    const again = (await (await call(`/api/v1/books/${id}/annotations`, token)).json()) as { highlights: { text: string }[]; updatedAt: string };
    expect(again.highlights[0].text).toBe('Fear is the mind-killer');
    expect(again.updatedAt).toBe(saved.updatedAt);

    const book = (await (await call(`/api/v1/books/${id}`, token)).json()) as { annotationCount?: number };
    expect(book.annotationCount).toBe(1);
  });

  it('refuses a stale save with 409 and the current file (no silent overwrite)', async () => {
    const token = await login();
    const id = await uploadBook(token);
    const first = (await (await call(`/api/v1/books/${id}/annotations`, token, json('PUT', { baseUpdatedAt: null, annotations: [], highlights: [hl('a', 'one')] }))).json()) as { updatedAt: string };
    // Device B saves on top of the first version.
    await call(`/api/v1/books/${id}/annotations`, token, json('PUT', { baseUpdatedAt: first.updatedAt, annotations: [], highlights: [hl('a', 'one'), hl('b', 'two')] }));
    // Device A still holds the first version.
    const stale = await call(`/api/v1/books/${id}/annotations`, token, json('PUT', { baseUpdatedAt: first.updatedAt, annotations: [], highlights: [hl('a', 'one'), hl('c', 'three')] }));
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { current: { highlights: { id: string }[] } };
    expect(body.current.highlights.map(h => h.id)).toEqual(['a', 'b']);
    // A first-ever save against an existing file is also a conflict.
    expect((await call(`/api/v1/books/${id}/annotations`, token, json('PUT', { baseUpdatedAt: null, annotations: [], highlights: [] }))).status).toBe(409);
  });

  it('validates input, drops malformed highlights, and is removed with the book', async () => {
    const token = await login();
    const id = await uploadBook(token);
    expect((await call(`/api/v1/books/${id}/annotations`, token, json('PUT', { annotations: 'x' }))).status).toBe(400);
    expect((await call('/api/v1/books/999/annotations', token)).status).toBe(404);
    const res = await call(`/api/v1/books/${id}/annotations`, token, json('PUT', { baseUpdatedAt: null, annotations: [], highlights: [hl('ok', 'fine'), { id: 'bad', kind: 'nope', page: 1 }, hl('p0', 'x', { page: 0 })] }));
    expect(((await res.json()) as { highlights: unknown[] }).highlights).toHaveLength(1);
    expect((await call(`/api/v1/books?ids=${id}`, token, { method: 'DELETE' })).status).toBeLessThan(300);
    expect(bucket.keys().filter(k => k.startsWith(`files/${id}/`))).toEqual([]);
  });
});

describe('importing annotations into notes', () => {
  async function setup() {
    const token = await login();
    const id = await uploadBook(token);
    const save = (base: string | null, highlights: unknown[]) =>
      call(`/api/v1/books/${id}/annotations`, token, json('PUT', { baseUpdatedAt: base, pageCount: 10, annotations: [], highlights }));
    const notes = async () => (await (await call('/api/v1/notes', token)).json()) as { id: number; type: string; quote: string; text: string; color: string; location?: string; percentage?: number }[];
    const imp = async (body: unknown = {}) => (await (await call('/api/v1/notes/import-annotations', token, json('POST', body))).json()) as { imported: number; skipped: number };
    return { token, id, save, notes, imp };
  }

  it('creates notes once, maps colours/pages, and skips unusable annotations', async () => {
    const { save, notes, imp } = await setup();
    await save(null, [
      hl('h1', 'Highlighted text', { comment: 'my thought', color: '#4CAF50' }),
      { id: 'n1', kind: 'note', page: 5, text: '', comment: 'sticky note body' },
      hl('empty', ''),
      { id: 'n2', kind: 'note', page: 5, text: '', comment: '' }
    ]);
    expect(await imp()).toMatchObject({ imported: 2, skipped: 2 });
    const list = await notes();
    const h = list.find(n => n.quote === 'Highlighted text')!;
    expect(h).toMatchObject({ type: 'highlight', text: 'my thought', color: 'green', location: '3', percentage: 30 });
    expect(list.find(n => n.type === 'note')).toMatchObject({ text: 'sticky note body', quote: '' });
    // Running it again adds nothing.
    expect(await imp()).toMatchObject({ imported: 0 });
    expect(await notes()).toHaveLength(2);
  });

  it('does not bring back a deleted imported note, but imports new ones', async () => {
    const { token, save, notes, imp } = await setup();
    const first = (await (await save(null, [hl('h1', 'keep me'), hl('h2', 'delete me')])).json()) as { updatedAt: string };
    await imp();
    const doomed = (await notes()).find(n => n.quote === 'delete me')!;
    await call(`/api/v1/notes/${doomed.id}`, token, { method: 'DELETE' });
    await save(first.updatedAt, [hl('h1', 'keep me'), hl('h2', 'delete me'), hl('h3', 'brand new')]);
    expect(await imp()).toMatchObject({ imported: 1 });
    expect((await notes()).map(n => n.quote).sort()).toEqual(['brand new', 'keep me']);
  });

  it('imports across every annotated book when no book is given', async () => {
    const { token, id, save, imp } = await setup();
    await save(null, [hl('h1', 'only one')]);
    const other = await uploadBook(token); // never annotated
    expect(other).not.toBe(id);
    expect(await imp()).toMatchObject({ imported: 1, books: 1 });
  });
});

describe('quotes', () => {
  it('adds, edits, favourites and deletes quotes', async () => {
    const token = await login();
    const created = (await (await call('/api/v1/quotes', token, json('POST', { text: '  Know thyself. ', author: 'Socrates', tags: ['Greek', 'greek', ' self '] }))).json()) as { id: number; text: string; tags: string[]; origin: string };
    expect(created).toMatchObject({ text: 'Know thyself.', tags: ['greek', 'self'], origin: 'manual' });
    expect((await call('/api/v1/quotes', token, json('POST', { text: '   ' }))).status).toBe(400);
    const edited = await (await call(`/api/v1/quotes/${created.id}`, token, json('PUT', { favorite: true, source: 'Dialogues' }))).json();
    expect(edited).toMatchObject({ favorite: true, source: 'Dialogues', author: 'Socrates' });
    // A quote can be linked to a book, re-linked, and unlinked again.
    const bookId = await uploadBook(token);
    expect(await (await call(`/api/v1/quotes/${created.id}`, token, json('PUT', { bookId }))).json()).toMatchObject({ bookId });
    expect((await call(`/api/v1/quotes/${created.id}`, token, json('PUT', { bookId: 999 }))).status).toBe(404);
    expect(((await (await call(`/api/v1/quotes/${created.id}`, token, json('PUT', { bookId: null }))).json()) as { bookId?: number }).bookId).toBeUndefined();
    expect((await call(`/api/v1/quotes/${created.id}`, token, { method: 'DELETE' })).status).toBe(204);
    expect(await (await call('/api/v1/quotes', token)).json()).toEqual([]);
    expect((await call('/api/v1/quotes/77', token, { method: 'DELETE' })).status).toBe(404);
  });

  it('imports highlights from notes once, with book title and author filled in', async () => {
    const token = await login();
    const id = await uploadBook(token);
    await call(`/api/v1/books/${id}/annotations`, token, json('PUT', { baseUpdatedAt: null, annotations: [], highlights: [hl('h1', 'A quotable line'), { id: 'n', kind: 'note', page: 1, text: '', comment: 'just a note' }] }));
    await call('/api/v1/notes/import-annotations', token, json('POST', {}));
    const first = (await (await call('/api/v1/quotes/from-notes', token, json('POST', {}))).json()) as { added: number };
    expect(first.added).toBe(1); // only the highlight, not the plain note
    expect(((await (await call('/api/v1/quotes/from-notes', token, json('POST', {}))).json()) as { added: number }).added).toBe(0);
    const quotes = (await (await call('/api/v1/quotes', token)).json()) as { text: string; author: string; source: string; origin: string; location: string }[];
    expect(quotes).toEqual([expect.objectContaining({ text: 'A quotable line', author: 'Ann Author', source: 'My Book', origin: 'note', location: '3' })]);
  });

  it('exports CSV (escaped, formula-safe) and JSON', async () => {
    const token = await login();
    await call('/api/v1/quotes', token, json('POST', { text: 'He said, "hello"\nthen left', author: '=HYPERLINK("x")' }));
    const csv = await (await call('/api/v1/quotes/export?format=csv', token)).text();
    expect(csv).toContain('"He said, ""hello""\nthen left"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    const res = await call('/api/v1/quotes/export?format=json', token);
    expect(res.headers.get('Content-Disposition')).toContain('quotes.json');
    expect(((await res.json()) as { quotes: unknown[] }).quotes).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('snaps hex colours to the nearest note colour', () => {
    expect(nearestNoteColor('#FFCD45')).toBe('yellow');
    expect(nearestNoteColor('#4CAF50')).toBe('green');
    expect(nearestNoteColor('#2196F3')).toBe('blue');
    expect(nearestNoteColor('#E91E63')).toBe('pink');
    expect(nearestNoteColor('#9C27B0')).toBe('purple');
    expect(nearestNoteColor(undefined)).toBe('yellow');
    expect(nearestNoteColor('rgb(1,2,3)')).toBe('yellow');
  });
  it('writes CSV with CRLF rows', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});
