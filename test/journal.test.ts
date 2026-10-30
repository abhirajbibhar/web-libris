import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/server/api/index';
import { weekFolder, type NotebookEntry } from '../src/server/api/notebook';
import { localDate, recordReading, resolveTimeZone } from '../src/server/api/userData';
import { MockR2Bucket, asBucket } from './mock-r2';

let bucket: MockR2Bucket;
let env: Record<string, unknown>;

const call = (path: string, token: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  return app.request(path, { ...init, headers }, env);
};

async function login(): Promise<string> {
  const res = await app.request(
    '/api/v1/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' })
    },
    env
  );
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function uploadBook(token: string): Promise<number> {
  const form = new FormData();
  form.set('file', new File([new Uint8Array([1, 2, 3])], 'Dune.epub', { type: 'application/epub+zip' }));
  form.set('libraryId', '1');
  form.set('metadata', JSON.stringify({ title: 'Dune' }));
  const res = await call('/api/v1/files/upload', token, { method: 'POST', body: form });
  return ((await res.json()) as { id: number }).id;
}

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

describe('notes and highlights', () => {
  it('creates, lists, edits and deletes notes', async () => {
    const token = await login();
    const bookId = await uploadBook(token);

    const created = await call('/api/v1/notes', token, {
      method: 'POST',
      body: JSON.stringify({ bookId, type: 'highlight', quote: 'Fear is the mind-killer.', color: 'pink', percentage: 12.5 })
    });
    expect(created.status).toBe(201);
    const note = (await created.json()) as { id: number; color: string; type: string };
    expect(note).toMatchObject({ id: 1, color: 'pink', type: 'highlight' });

    await call('/api/v1/notes', token, { method: 'POST', body: JSON.stringify({ bookId, text: 'Remember this' }) });
    const list = (await (await call(`/api/v1/notes?bookId=${bookId}`, token)).json()) as { id: number }[];
    expect(list.map(n => n.id)).toEqual([2, 1]); // newest first

    const only = (await (await call('/api/v1/notes?type=highlight', token)).json()) as unknown[];
    expect(only).toHaveLength(1);

    const edited = await call(`/api/v1/notes/${note.id}`, token, { method: 'PUT', body: JSON.stringify({ text: 'Litany against fear' }) });
    expect(((await edited.json()) as { text: string }).text).toBe('Litany against fear');

    expect((await call(`/api/v1/notes/${note.id}`, token, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/api/v1/notes/${note.id}`, token, { method: 'DELETE' })).status).toBe(404);
  });

  it('validates input and the book', async () => {
    const token = await login();
    const bookId = await uploadBook(token);
    const post = (body: unknown) => call('/api/v1/notes', token, { method: 'POST', body: JSON.stringify(body) });
    expect((await post({ bookId })).status).toBe(400); // empty
    expect((await post({ bookId, type: 'highlight', text: 'no quote' })).status).toBe(400);
    expect((await post({ bookId: 999, text: 'x' })).status).toBe(404);
    expect((await post({ text: 'x' })).status).toBe(400);
  });

  it('requires authentication', async () => {
    expect((await app.request('/api/v1/notes', {}, env)).status).toBe(401);
  });
});

describe('notebook markdown', () => {
  const put = (token: string, date: string, body: unknown) =>
    call(`/api/v1/notebook/${date}`, token, { method: 'PUT', body: JSON.stringify(body) });
  const getDay = async (token: string, date: string) =>
    (await (await call(`/api/v1/notebook/${date}`, token)).json()) as NotebookEntry;

  it('computes ISO weeks, including year-boundary edge cases', () => {
    expect(weekFolder('2026-10-28')).toBe('2026-W44');
    expect(weekFolder('2026-01-01')).toBe('2026-W01');
    expect(weekFolder('2027-01-01')).toBe('2026-W53'); // Friday: still last year's week 53
    expect(weekFolder('2024-12-30')).toBe('2025-W01'); // Monday: already next year's week 1
    expect(weekFolder('2026-10-26')).toBe(weekFolder('2026-11-01')); // Mon–Sun share a folder
    expect(weekFolder('2026-11-02')).toBe('2026-W45');
  });

  it('writes <week>/<DD-MM-YYYY>.md and reads it back', async () => {
    const token = await login();
    const res = await put(token, '2026-10-28', {
      todos: [{ id: 'a', text: 'Read 30 pages', done: true }, { id: 'b', text: 'Review notes', done: false }],
      mood: 'great',
      reflection: 'Good session',
      thoughts: 'Fear is the mind-killer'
    });
    expect(res.status).toBe(200);

    expect(bucket.keys()).toContain('data/users/1/notebook/2026-W44/28-10-2026.md');
    const object = await bucket.get('data/users/1/notebook/2026-W44/28-10-2026.md');
    const markdown = await object.text();
    expect(markdown).toContain('date: 2026-10-28');
    expect(markdown).toContain('week: 2026-W44');
    expect(markdown).toContain('mood: great');
    expect(markdown).toContain('# Wednesday, 28 October 2026');
    expect(markdown).toContain('- [x] Read 30 pages');
    expect(markdown).toContain('- [ ] Review notes');
    expect(object.httpMetadata?.contentType).toContain('text/markdown');

    const day = await getDay(token, '2026-10-28');
    expect(day).toMatchObject({ date: '2026-10-28', mood: 'great', reflection: 'Good session', thoughts: 'Fear is the mind-killer' });
    expect(day.todos.map(t => [t.text, t.done])).toEqual([['Read 30 pages', true], ['Review notes', false]]);
  });

  it('lists a month as summaries without reading each file', async () => {
    const token = await login();
    await put(token, '2026-10-26', { todos: [{ text: 'a', done: true }, { text: 'b' }], mood: 'good', reflection: 'x' });
    await put(token, '2026-10-30', { mood: 'low' });
    await put(token, '2026-11-02', { mood: 'okay' }); // another month, another week folder

    const month = (await (await call('/api/v1/notebook?month=2026-10', token)).json()) as {
      days: Record<string, { todos: number; done: number; mood: string | null; hasText: boolean }>;
    };
    expect(Object.keys(month.days)).toEqual(['2026-10-26', '2026-10-30']);
    expect(month.days['2026-10-26']).toMatchObject({ todos: 2, done: 1, mood: 'good', hasText: true });
    expect(month.days['2026-10-30']).toMatchObject({ todos: 0, mood: 'low', hasText: false });
  });

  it('finds days that sit in the previous ISO year\u2019s last week', async () => {
    const token = await login();
    await put(token, '2027-01-01', { mood: 'good' });
    expect(bucket.keys()).toContain('data/users/1/notebook/2026-W53/01-01-2027.md');
    const month = (await (await call('/api/v1/notebook?month=2027-01', token)).json()) as { days: Record<string, unknown> };
    expect(Object.keys(month.days)).toEqual(['2027-01-01']);
  });

  it('round-trips text that looks like Markdown structure', async () => {
    const token = await login();
    const nasty = '## Not a heading\n\\# literal backslash\n### x <!-- book:9 -->\n---\n# Title-ish\n- [ ] not a todo';
    await put(token, '2026-10-28', {
      todos: [{ text: 'line one\nline two' }],
      reflection: nasty,
      thoughts: nasty,
      bookNotes: []
    });
    const day = await getDay(token, '2026-10-28');
    expect(day.reflection).toBe(nasty);
    expect(day.thoughts).toBe(nasty);
    expect(day.todos).toHaveLength(1);
    expect(day.todos[0].text).toBe('line one line two');
    expect(day.bookNotes).toEqual([]);
  });

  it('keeps sections you added by hand', async () => {
    const token = await login();
    await put(token, '2026-10-28', { reflection: 'mine' });
    const key = 'data/users/1/notebook/2026-W44/28-10-2026.md';
    const current = await (await bucket.get(key)).text();
    await bucket.put(key, `${current}\n## Gratitude\n\nA quiet evening.\n`);

    await put(token, '2026-10-28', { reflection: 'mine, edited', mood: 'good' });
    const after = await (await bucket.get(key)).text();
    expect(after).toContain('mine, edited');
    expect(after).toContain('## Gratitude');
    expect(after).toContain('A quiet evening.');
  });

  it('removes the file when a day is cleared, and lists hand-made files without metadata', async () => {
    const token = await login();
    await put(token, '2026-10-28', { reflection: 'temp' });
    await put(token, '2026-10-28', {});
    expect(bucket.keys().filter(k => k.endsWith('.md'))).toEqual([]);

    // A file created outside the app has no custom metadata but should still show up.
    await bucket.put(
      'data/users/1/notebook/2026-W44/29-10-2026.md',
      '---\ndate: 2026-10-29\nmood: okay\n---\n\n## To-do\n\n- [x] one\n- [ ] two\n'
    );
    const month = (await (await call('/api/v1/notebook?month=2026-10', token)).json()) as {
      days: Record<string, { todos: number; done: number; mood: string | null }>;
    };
    expect(month.days['2026-10-29']).toMatchObject({ todos: 2, done: 1, mood: 'okay' });
  });

  it('links remarks to books and keeps the title when a book is later removed', async () => {
    const token = await login();
    const bookId = await uploadBook(token); // "Dune"
    await put(token, '2026-10-28', {
      bookNotes: [
        { bookId, title: 'ignored, server uses the real title', text: 'Chapter 3 hit hard.' },
        { bookId: 999, title: 'Gone Book', text: 'Orphan remark' },
        { bookId, text: 'duplicate id is dropped' }
      ]
    });
    const markdown = await (await bucket.get('data/users/1/notebook/2026-W44/28-10-2026.md')).text();
    expect(markdown).toContain(`### Dune <!-- book:${bookId} -->`);
    expect(markdown).toContain(`books: [${bookId}, 999]`);

    const day = await getDay(token, '2026-10-28');
    expect(day.bookNotes).toEqual([
      { bookId, title: 'Dune', text: 'Chapter 3 hit hard.' },
      { bookId: 999, title: 'Gone Book', text: 'Orphan remark' }
    ]);
  });

  it('migrates a legacy month document into daily files without clobbering newer notes', async () => {
    const token = await login();
    await bucket.put(
      'data/users/1/notebook/2026-09.json',
      JSON.stringify({
        days: {
          '2026-09-21': { date: '2026-09-21', todos: [{ id: 'x', text: 'Old todo', done: true }], mood: 'good', reflection: 'Legacy', thoughts: '', updatedAt: '' },
          '2026-09-22': { date: '2026-09-22', todos: [], mood: null, reflection: 'Old 22', thoughts: '', updatedAt: '' }
        }
      })
    );
    await put(token, '2026-09-22', { reflection: 'Newer, written after the upgrade' });

    const day = await getDay(token, '2026-09-21');
    expect(day).toMatchObject({ reflection: 'Legacy', mood: 'good' });
    expect(day.todos[0]).toMatchObject({ text: 'Old todo', done: true });
    expect(bucket.keys()).toContain('data/users/1/notebook/2026-W39/21-09-2026.md');
    expect(bucket.keys()).not.toContain('data/users/1/notebook/2026-09.json');
    expect((await getDay(token, '2026-09-22')).reflection).toBe('Newer, written after the upgrade');
  });

  it('serves the stored Markdown for download', async () => {
    const token = await login();
    expect((await call('/api/v1/notebook/2026-10-28/markdown', token)).status).toBe(404);
    await put(token, '2026-10-28', { reflection: 'hello' });
    const res = await call('/api/v1/notebook/2026-10-28/markdown', token);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('28-10-2026.md');
    expect(await res.text()).toContain('hello');
  });

  it('rejects bad dates, months and empty to-dos', async () => {
    const token = await login();
    expect((await call('/api/v1/notebook/2026-13-01', token, { method: 'PUT', body: '{}' })).status).toBe(400);
    expect((await call('/api/v1/notebook/2026-13-01', token)).status).toBe(400);
    expect((await call('/api/v1/notebook?month=2026-1', token)).status).toBe(400);
    expect((await put(token, '2026-10-26', { todos: [{ text: '  ' }] })).status).toBe(400);
    expect((await put(token, '2026-10-26', { bookNotes: 'nope' })).status).toBe(400);
  });
});

describe('reading activity', () => {
  it('records a day when progress is saved, in the client time zone', async () => {
    const token = await login();
    const bookId = await uploadBook(token);
    const save = (percentage: number) =>
      call('/api/v1/books/progress', token, {
        method: 'POST',
        headers: { 'X-Timezone': 'Pacific/Auckland' },
        body: JSON.stringify({ bookId, epubProgress: { cfi: 'epubcfi(/6/2)', percentage } })
      });
    expect((await save(10)).status).toBe(200);
    expect((await save(15)).status).toBe(200);

    const { days } = (await (await call('/api/v1/activity', token)).json()) as {
      days: Record<string, { books: Record<string, { startPct: number; endPct: number }> }>;
    };
    const today = localDate(Date.now(), 'Pacific/Auckland');
    expect(Object.keys(days)).toEqual([today]);
    expect(days[today].books[String(bookId)]).toMatchObject({ startPct: 10, endPct: 15 });
  });

  it('counts time between saves but ignores long gaps', async () => {
    const t0 = Date.UTC(2026, 9, 26, 10, 0, 0);
    const b = asBucket(bucket);
    await recordReading(b, 1, 7, 10, 'UTC', t0);
    await recordReading(b, 1, 7, 12, 'UTC', t0 + 90_000); // +90s
    await recordReading(b, 1, 7, 13, 'UTC', t0 + 90_000 + 3_600_000); // +1h gap: capped
    await recordReading(b, 1, 8, 5, 'UTC', t0 + 90_000 + 3_600_000 + 60_000); // different book: no time
    const { value } = await (await import('../src/server/api/userData')).activityDoc(b, 1).read();
    const day = value.days['2026-10-26'];
    expect(day.books['7'].seconds).toBe(90 + 300);
    expect(day.books['8'].seconds).toBe(0);
    expect(day.seconds).toBe(390);
  });

  it('falls back to UTC for unknown zones', () => {
    expect(resolveTimeZone('Not/AZone', undefined)).toBe('UTC');
    expect(resolveTimeZone('Not/AZone', 'Asia/Kolkata')).toBe('Asia/Kolkata');
  });
});
