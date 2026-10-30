import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/server/api/index';
import { MockR2Bucket, asBucket } from './mock-r2';

interface TestEnv {
  Library: R2Bucket;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  ADMIN_USER?: string;
  ADMIN_PASSWORD?: string;
}

const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'password123';

let bucket: MockR2Bucket;
let env: TestEnv;

function request(path: string, init?: RequestInit & { token?: string }) {
  const { token, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return app.request(path, { ...rest, headers }, env);
}

/**
 * Most tests rely on the ADMIN_USER/ADMIN_PASSWORD secrets to bootstrap the
 * initial admin, matching how a real deployment without the setup page works.
 */
async function login(username: string, password: string): Promise<string> {
  const res = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

async function uploadBook(token: string, fileName = 'Dune.epub', title = 'Dune') {
  const form = new FormData();
  form.set('file', new File([new Uint8Array([1, 2, 3, 4])], fileName, { type: 'application/epub+zip' }));
  form.set('libraryId', '1');
  form.set(
    'metadata',
    JSON.stringify({ title, authors: ['Frank Herbert'], seriesName: 'Dune', seriesNumber: 1 })
  );
  const res = await request('/api/v1/files/upload', { method: 'POST', body: form, token });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: number; metadata: { title: string }; primaryFile: { bookType: string } };
}

const JWT_SECRET = 'test-jwt-secret';

beforeEach(() => {
  bucket = new MockR2Bucket();
  env = {
    Library: asBucket(bucket),
    ENVIRONMENT: 'development',
    JWT_SECRET,
    ADMIN_USER,
    ADMIN_PASSWORD
  };
});

describe('setup status and bootstrap', () => {
  it('reports setup required when no ADMIN_* secrets are configured', async () => {
    // Override env to remove the secrets.
    env.ADMIN_USER = undefined;
    env.ADMIN_PASSWORD = undefined;

    const status = (await (await request('/api/v1/setup/status')).json()) as { setupRequired: boolean };
    expect(status.setupRequired).toBe(true);
  });

  it('bootstraps the admin from ADMIN_USER/ADMIN_PASSWORD secrets, skipping setup', async () => {
    const status = (await (await request('/api/v1/setup/status')).json()) as { setupRequired: boolean };
    expect(status.setupRequired).toBe(false);

    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const users = (await (await request('/api/v1/users', { token })).json()) as {
      username: string;
      permissions: { admin: boolean };
    }[];
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe(ADMIN_USER);
    expect(users[0].permissions.admin).toBe(true);

    // The default library the setup page would have created.
    const libraries = (await (await request('/api/v1/libraries', { token })).json()) as { name: string }[];
    expect(libraries).toHaveLength(1);
    expect(libraries[0].name).toBe('General');
  });

  it('ignores bootstrap when only one of the two secrets is set', async () => {
    env.ADMIN_USER = 'root';
    env.ADMIN_PASSWORD = undefined;

    const status = (await (await request('/api/v1/setup/status')).json()) as { setupRequired: boolean };
    expect(status.setupRequired).toBe(true);
  });

  it('never bootstraps extra users once accounts exist', async () => {
    // First bootstrap with the standard secrets.
    const adminToken = await login(ADMIN_USER, ADMIN_PASSWORD);

    // Now set different secrets — they must be inert.
    env.ADMIN_USER = 'root';
    env.ADMIN_PASSWORD = 'root-secret-1';

    const status = (await (await request('/api/v1/setup/status')).json()) as { setupRequired: boolean };
    expect(status.setupRequired).toBe(false);

    const bad = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'root', password: 'root-secret-1' })
    });
    expect(bad.status).toBe(401);

    const users = (await (await request('/api/v1/users', { token: adminToken })).json()) as unknown[];
    expect(users).toHaveLength(1);
  });
});

describe('auth', () => {
  it('rejects login with the wrong password and accepts the right one', async () => {
    const bad = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: 'wrong-password' })
    });
    expect(bad.status).toBe(401);
    expect(await login(ADMIN_USER, ADMIN_PASSWORD)).toBeTruthy();
  });

  it('protects authenticated routes', async () => {
    const res = await request('/api/v1/books');
    expect(res.status).toBe(401);
  });

  it('refreshes tokens', async () => {
    const loginRes = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD })
    });
    const { refreshToken } = (await loginRes.json()) as { refreshToken: string };
    const res = await request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string };
    expect(body.accessToken).toBeTruthy();
  });

  it('revokes old access and refresh tokens when the password changes', async () => {
    const oldToken = await login(ADMIN_USER, ADMIN_PASSWORD);
    const loginRes = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD })
    });
    const { refreshToken: oldRefresh } = (await loginRes.json()) as { refreshToken: string };

    const change = await request('/api/v1/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      token: oldToken,
      body: JSON.stringify({ currentPassword: ADMIN_PASSWORD, newPassword: 'new-password-1' })
    });
    expect(change.status).toBe(204);

    // Old access token no longer authenticates.
    const rejected = await request('/api/v1/books', { token: oldToken });
    expect(rejected.status).toBe(401);
    expect(((await rejected.json()) as { message: string }).message).toContain('revoked');

    // Old refresh token can no longer mint new access tokens.
    const refresh = await request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: oldRefresh })
    });
    expect(refresh.status).toBe(401);

    // Logging in again with the new password yields a working token.
    const freshToken = await login(ADMIN_USER, 'new-password-1');
    expect((await request('/api/v1/books', { token: freshToken })).status).toBe(200);
  });

  it('revokes a user\u2019s tokens when an admin resets their password', async () => {
    const adminToken = await login(ADMIN_USER, ADMIN_PASSWORD);
    const created = await request('/api/v1/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      token: adminToken,
      body: JSON.stringify({
        username: 'reader',
        name: 'Reader',
        email: 'reader@example.com',
        password: 'reader-password'
      })
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: number };

    const readerToken = await login('reader', 'reader-password');
    expect((await request('/api/v1/auth/me', { token: readerToken })).status).toBe(200);

    const reset = await request(`/api/v1/users/${id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      token: adminToken,
      body: JSON.stringify({ password: 'reset-password-1' })
    });
    expect(reset.status).toBe(204);

    // The reset user's sessions are dead; the admin's are untouched.
    expect((await request('/api/v1/auth/me', { token: readerToken })).status).toBe(401);
    expect((await request('/api/v1/auth/me', { token: adminToken })).status).toBe(200);

    // And they can get back in with the new password.
    expect(await login('reader', 'reset-password-1')).toBeTruthy();
  });

  it('kills every session on logout-all, including the caller\u2019s', async () => {
    const deviceA = await login(ADMIN_USER, ADMIN_PASSWORD);
    const deviceB = await login(ADMIN_USER, ADMIN_PASSWORD);

    const res = await request('/api/v1/auth/logout-all', { method: 'POST', token: deviceA });
    expect(res.status).toBe(204);

    expect((await request('/api/v1/auth/me', { token: deviceA })).status).toBe(401);
    expect((await request('/api/v1/auth/me', { token: deviceB })).status).toBe(401);

    // Signing in again restores access.
    expect(await login(ADMIN_USER, ADMIN_PASSWORD)).toBeTruthy();
  });

  it('leaves other users signed in on logout-all', async () => {
    const adminToken = await login(ADMIN_USER, ADMIN_PASSWORD);
    await request('/api/v1/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      token: adminToken,
      body: JSON.stringify({
        username: 'reader',
        name: 'Reader',
        email: 'reader@example.com',
        password: 'reader-password'
      })
    });
    const readerToken = await login('reader', 'reader-password');

    const res = await request('/api/v1/auth/logout-all', { method: 'POST', token: adminToken });
    expect(res.status).toBe(204);

    expect((await request('/api/v1/auth/me', { token: readerToken })).status).toBe(200);
    expect((await request('/api/v1/auth/me', { token: adminToken })).status).toBe(401);
  });
});

describe('books', () => {
  it('uploads a book with metadata and lists it', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await uploadBook(token);
    expect(book.metadata.title).toBe('Dune');
    expect(book.primaryFile.bookType).toBe('EPUB');

    const books = (await (await request('/api/v1/books', { token })).json()) as { id: number }[];
    expect(books).toHaveLength(1);
  });

  it('stores the payload under its original upload filename', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await uploadBook(token, 'Dune - Children of Dune (2003).epub');
    expect(bucket.keys()).toContain(`files/${book.id}/Dune - Children of Dune (2003).epub`);
    // No generic `original.<ext>` placeholder is written anymore.
    expect(bucket.keys().some(k => k.includes('original.'))).toBe(false);
  });

  it('rejects unsupported file types', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const form = new FormData();
    form.set('file', new File(['x'], 'malware.exe'));
    form.set('libraryId', '1');
    const res = await request('/api/v1/files/upload', { method: 'POST', body: form, token });
    expect(res.status).toBe(400);
  });

  it('updates read status and personal rating', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await uploadBook(token);

    const statusRes = await request('/api/v1/books/status', {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: [book.id], status: 'READ' })
    });
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as { readStatus: string; dateFinished: string }[];
    expect(statusBody[0].readStatus).toBe('READ');
    expect(statusBody[0].dateFinished).toBeTruthy();

    const ratingRes = await request('/api/v1/books/personal-rating', {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [book.id], rating: 9 })
    });
    const ratingBody = (await ratingRes.json()) as { personalRating: number }[];
    expect(ratingBody[0].personalRating).toBe(9);
  });

  it('patches metadata', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await uploadBook(token, 'dune.epub', 'Dune');
    const res = await request(`/api/v1/books/${book.id}`, {
      method: 'PATCH',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'A desert planet epic.', tags: ['scifi'] })
    });
    const updated = (await res.json()) as { metadata: { description: string; tags: string[]; title: string } };
    expect(updated.metadata.description).toBe('A desert planet epic.');
    expect(updated.metadata.tags).toEqual(['scifi']);
    expect(updated.metadata.title).toBe('Dune');
  });

  it('streams the stored file and supports range requests', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await uploadBook(token);

    const full = await request(`/api/v1/books/${book.id}/file`, { token });
    expect(full.status).toBe(200);
    expect(full.headers.get('Content-Type')).toBe('application/epub+zip');
    expect((await full.arrayBuffer()).byteLength).toBe(4);

    const ranged = await request(`/api/v1/books/${book.id}/file`, { token, headers: { Range: 'bytes=1-2' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('Content-Range')).toBe('bytes 1-2/4');
    expect((await ranged.arrayBuffer()).byteLength).toBe(2);
  });

  it('assigns and unassigns shelves', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await uploadBook(token);
    const shelfRes = await request('/api/v1/shelves', {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Favorites' })
    });
    const shelf = (await shelfRes.json()) as { id: number };

    const assignRes = await request('/api/v1/books/shelves', {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: [book.id], shelvesToAssign: [shelf.id], shelvesToUnassign: [] })
    });
    const assigned = (await assignRes.json()) as { shelves: { id: number }[] }[];
    expect(assigned[0].shelves.map(s => s.id)).toContain(shelf.id);

    const unassignRes = await request('/api/v1/books/shelves', {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: [book.id], shelvesToAssign: [], shelvesToUnassign: [shelf.id] })
    });
    const unassigned = (await unassignRes.json()) as { shelves: { id: number }[] }[];
    expect(unassigned[0].shelves).toHaveLength(0);
  });

  it('deletes a book and removes its objects from the bucket', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await uploadBook(token);
    expect(bucket.keys().some(k => k.startsWith(`files/${book.id}/`))).toBe(true);

    const res = await request(`/api/v1/books?ids=${book.id}`, { method: 'DELETE', token });
    expect(res.status).toBe(200);
    expect(bucket.keys().some(k => k.startsWith(`files/${book.id}/`))).toBe(false);

    const books = (await (await request('/api/v1/books', { token })).json()) as unknown[];
    expect(books).toHaveLength(0);

    // The public cover route stops serving a deleted book's cover at the
    // origin immediately — stale edge copies only linger until max-age.
    const gone = await request(`/public/covers/${book.id}?ext=jpg`);
    expect(gone.status).toBe(404);
  });

  it('updates library book counts immediately after deleting books', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    for (let i = 0; i < 3; i++) await uploadBook(token, `Book ${i}.epub`, `Book ${i}`);

    const before = (await (await request('/api/v1/libraries', { token })).json()) as { bookCount: number }[];
    expect(before[0].bookCount).toBe(3);

    // Delete every book in one request.
    const allBooks = (await (await request('/api/v1/books', { token })).json()) as { id: number }[];
    const del = await request(`/api/v1/books?ids=${allBooks.map(b => b.id).join(',')}`, {
      method: 'DELETE',
      token
    });
    expect(del.status).toBe(200);

    // Same isolate, moments later — the count must already be zero.
    const after = (await (await request('/api/v1/libraries', { token })).json()) as { bookCount: number }[];
    expect(after[0].bookCount).toBe(0);
  });

  it('numbers uploads by how many books exist, not by history', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const first = await uploadBook(token, 'One.epub', 'One');
    const second = await uploadBook(token, 'Two.epub', 'Two');
    expect(second.id).toBe(first.id + 1);

    // Delete everything, then re-upload: ids restart from 1 because the
    // counter is recomputed from the live book list, so upload keys can never
    // point past the count at bytes that were never written.
    await request(`/api/v1/books?ids=${first.id},${second.id}`, { method: 'DELETE', token });
    const third = await uploadBook(token, 'Three.epub', 'Three');
    expect(third.id).toBe(1);
    expect(bucket.keys()).toContain(`files/1/Three.epub`);

    const libraries = (await (await request('/api/v1/libraries', { token })).json()) as { bookCount: number }[];
    expect(libraries[0].bookCount).toBe(1);
  });
});

describe('public cover route', () => {
  async function uploadWithCover(token: string) {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Dune.epub', { type: 'application/epub+zip' }));
    form.set('libraryId', '1');
    form.set('cover', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'cover.jpg', { type: 'image/jpeg' }));
    form.set('metadata', JSON.stringify({ title: 'Dune' }));
    const res = await request('/api/v1/files/upload', { method: 'POST', body: form, token });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: number };
  }

  it('serves covers without auth and edge-cacheable headers', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await uploadWithCover(token);

    // No Authorization header / ?token= at all.
    const res = await request(`/public/covers/${book.id}?ext=jpg&t=${encodeURIComponent(new Date().toISOString())}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=5184000, immutable');
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('returns a fresh URL after re-uploading a cover', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await uploadWithCover(token);
    const first = await request(`/public/covers/${book.id}?ext=jpg`);
    expect(first.status).toBe(200);

    // Overwrite the stored cover bytes; the index now carries a new
    // coverUpdatedOn, which the SPA turns into a new ?t= URL — so caches
    // keyed by the old URL never serve stale bytes.
    await bucket.put(`files/${book.id}/cover.jpg`, new Uint8Array([9, 9, 9]));
    const second = await request(`/public/covers/${book.id}?ext=jpg&t=new`);
    expect(second.status).toBe(200);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array([9, 9, 9]));
  });

  it('404s for unknown books and invalid ids', async () => {
    expect((await request('/public/covers/999?ext=jpg')).status).toBe(404);
    expect((await request('/public/covers/abc')).status).toBe(404);
  });
});

describe('cover wiring', () => {
  it('serves covers from the canonical /covers route the SPA uses', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await uploadPlain(token);
    await bucket.put(`files/${book.id}/cover.png`, new Uint8Array([7, 7]));

    const res = await request(`/covers/${book.id}?ext=png`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([7, 7]));
  });

  async function uploadPlain(token: string) {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Dune.pdf', { type: 'application/pdf' }));
    form.set('libraryId', '1');
    const res = await request('/api/v1/files/upload', { method: 'POST', body: form, token });
    return (await res.json()) as { id: number };
  }

  it('rescan links covers that are in the bucket but missing from the index', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await uploadPlain(token);
    const other = await uploadPlain(token);
    await bucket.put(`files/${book.id}/cover.png`, new Uint8Array([1]));

    const before = (await (await request(`/api/v1/books/${book.id}`, { token })).json()) as { coverExt?: string };
    expect(before.coverExt).toBeUndefined();

    const res = await request('/api/v1/books/covers/rescan', { method: 'POST', token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ covers: 1, fixed: 1, fixedIds: [book.id] });

    const after = (await (await request(`/api/v1/books/${book.id}`, { token })).json()) as {
      coverExt?: string;
      coverUpdatedOn?: string;
    };
    expect(after.coverExt).toBe('png');
    expect(after.coverUpdatedOn).toBeTruthy();

    // Books with no cover object stay untouched; a second run is a no-op.
    const untouched = (await (await request(`/api/v1/books/${other.id}`, { token })).json()) as { coverExt?: string };
    expect(untouched.coverExt).toBeUndefined();
    const again = await (await request('/api/v1/books/covers/rescan', { method: 'POST', token })).json();
    expect(again).toMatchObject({ fixed: 0 });
  });

  it('rescan corrects a wrong recorded extension', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'Dune.pdf', { type: 'application/pdf' }));
    form.set('libraryId', '1');
    form.set('cover', new File([new Uint8Array([0xff, 0xd8])], 'cover.jpg', { type: 'image/jpeg' }));
    const created = (await (await request('/api/v1/files/upload', { method: 'POST', body: form, token })).json()) as {
      id: number;
      coverExt?: string;
    };
    expect(created.coverExt).toBe('jpg');

    // The bucket now holds a webp cover instead; the index still says jpg.
    await bucket.delete(`files/${created.id}/cover.jpg`);
    await bucket.put(`files/${created.id}/cover.webp`, new Uint8Array([1]));
    await request('/api/v1/books/covers/rescan', { method: 'POST', token });

    const record = (await (await request(`/api/v1/books/${created.id}`, { token })).json()) as { coverExt?: string };
    expect(record.coverExt).toBe('webp');
  });

  it('rescan needs library-management rights', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    await request('/api/v1/users', {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'reader', name: 'Reader', email: 'r@e.com', password: 'password123' })
    });
    const readerToken = await login('reader', 'password123');
    const denied = await request('/api/v1/books/covers/rescan', { method: 'POST', token: readerToken });
    expect(denied.status).toBe(403);
  });
});

describe('index freshness after mutations', () => {
  it('reflects a deleted user immediately, even right after a cached read', async () => {
    const adminToken = await login(ADMIN_USER, ADMIN_PASSWORD);
    await request('/api/v1/users', {
      method: 'POST',
      token: adminToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'temp', name: 'Temp', email: 't@e.com', password: 'password123' })
    });
    const tempLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'temp', password: 'password123' })
    });
    const { user } = (await tempLogin.json()) as { user: { id: number } };

    // Warm the isolate's index cache with reads that include the user.
    const usersBefore = (await (await request('/api/v1/users', { token: adminToken })).json()) as unknown[];
    expect(usersBefore).toHaveLength(2);

    const del = await request(`/api/v1/users/${user.id}`, { method: 'DELETE', token: adminToken });
    expect(del.status).toBe(204);

    // Same isolate, moments later — the delete must be visible at once.
    const usersAfter = (await (await request('/api/v1/users', { token: adminToken })).json()) as unknown[];
    expect(usersAfter).toHaveLength(1);
  });

  it('applies rotated JWT_SECRET / ADMIN_* secrets from the very next request', async () => {
    const oldToken = await login(ADMIN_USER, ADMIN_PASSWORD);

    // Simulate `wrangler secret put` + redeploy: new values in env, same store.
    env.JWT_SECRET = 'rotated-jwt-secret';
    env.ADMIN_USER = 'someoneelse';
    env.ADMIN_PASSWORD = 'another-password-1';

    // The old access token was signed with the previous secret — rejected now.
    const rejected = await request('/api/v1/books', { token: oldToken });
    expect(rejected.status).toBe(401);

    // Login uses the NEW secret to verify; the bootstrap is inert because the
    // index already has users, so the old admin password still applies.
    const freshToken = await login(ADMIN_USER, ADMIN_PASSWORD);
    expect((await request('/api/v1/books', { token: freshToken })).status).toBe(200);
  });
});

describe('users and permissions', () => {
  it('creates a restricted user that cannot delete books', async () => {
    const adminToken = await login(ADMIN_USER, ADMIN_PASSWORD);
    const createRes = await request('/api/v1/users', {
      method: 'POST',
      token: adminToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'reader',
        name: 'Reader',
        email: 'reader@example.com',
        password: 'password123'
      })
    });
    expect(createRes.status).toBe(201);

    const readerToken = await login('reader', 'password123');
    const book = await uploadBook(adminToken);
    const del = await request(`/api/v1/books?ids=${book.id}`, { method: 'DELETE', token: readerToken });
    expect(del.status).toBe(403);

    const list = await request('/api/v1/books', { token: readerToken });
    expect(list.status).toBe(200);
    expect(((await list.json()) as unknown[]).length).toBe(1);
  });

  it('hides libraries a user is not assigned to', async () => {
    const adminToken = await login(ADMIN_USER, ADMIN_PASSWORD);
    // second library
    await request('/api/v1/libraries', {
      method: 'POST',
      token: adminToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Comics' })
    });

    await request('/api/v1/users', {
      method: 'POST',
      token: adminToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'reader',
        name: 'Reader',
        email: 'reader@example.com',
        password: 'password123',
        assignedLibraryIds: [2]
      })
    });
    const readerToken = await login('reader', 'password123');
    const libraries = (await (await request('/api/v1/libraries', { token: readerToken })).json()) as { id: number }[];
    expect(libraries.map(l => l.id)).toEqual([2]);
  });

  it('does not let non-admins manage users', async () => {
    const adminToken = await login(ADMIN_USER, ADMIN_PASSWORD);
    await request('/api/v1/users', {
      method: 'POST',
      token: adminToken,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'reader',
        name: 'Reader',
        email: 'reader@example.com',
        password: 'password123'
      })
    });
    const readerToken = await login('reader', 'password123');
    const res = await request('/api/v1/users', { token: readerToken });
    expect(res.status).toBe(403);
  });
});
