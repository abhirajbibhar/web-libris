import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/server/api/index';
import { ZipArchive, ZipError } from '../src/server/api/zip';
import { MockR2Bucket, asBucket } from './mock-r2';
import { buildZip } from './zip-builder';

interface TestEnv {
  Library: R2Bucket;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  ADMIN_USER?: string;
  ADMIN_PASSWORD?: string;
}

let bucket: MockR2Bucket;
let env: TestEnv;

function request(path: string, init?: RequestInit & { token?: string }) {
  const { token, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return app.request(path, { ...rest, headers }, env);
}

const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'password123';

async function login(username: string, password: string): Promise<string> {
  const loginRes = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  expect(loginRes.status).toBe(200);
  const body = (await loginRes.json()) as { accessToken: string };
  return body.accessToken;
}

async function upload(token: string, fileName: string, bytes: Uint8Array): Promise<{ id: number }> {
  const form = new FormData();
  form.set('file', new File([bytes as unknown as BlobPart], fileName));
  form.set('libraryId', '1');
  const res = await request('/api/v1/files/upload', { method: 'POST', body: form, token });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: number };
}

const CHAPTER_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body><p>Arrakis &amp; spice.</p></body>
</html>`;

const NAV_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
<nav epub:type="toc">
  <ol>
    <li>
      <a href="My%20Chapter.xhtml">Chapter 1</a>
      <ol><li><a href="My%20Chapter.xhtml#spice">Spice</a></li></ol>
    </li>
    <li><a href="nav.xhtml">Colophon</a></li>
  </ol>
</nav>
</body>
</html>`;

const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Dune</dc:title>
    <dc:creator>Frank Herbert</dc:creator>
    <dc:creator>Kevin J. Anderson</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Chilton Books</dc:publisher>
    <dc:identifier id="uid">urn:uuid:1234</dc:identifier>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="ch1" href="My%20Chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="nav" linear="no"/>
  </spine>
</package>`;

async function buildEpub(): Promise<Uint8Array> {
  return buildZip([
    {
      name: 'META-INF/container.xml',
      content: `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    },
    { name: 'OEBPS/content.opf', content: CONTENT_OPF },
    { name: 'OEBPS/My Chapter.xhtml', content: CHAPTER_XHTML },
    { name: 'OEBPS/nav.xhtml', content: NAV_XHTML },
    { name: 'OEBPS/style.css', content: 'body { color: rebeccapurple; }' },
    { name: 'OEBPS/images/cover.jpg', content: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }
  ]);
}

async function buildComic(): Promise<Uint8Array> {
  return buildZip([
    { name: 'p10.png', content: new Uint8Array([1, 0, 0]), store: true },
    { name: 'p1.png', content: new Uint8Array([1, 0, 1]), store: true },
    { name: '__MACOSX/._p1.png', content: new Uint8Array([9, 9, 9]), store: true },
    { name: 'p2.png', content: new Uint8Array([1, 0, 2]), store: true },
    { name: 'notes.txt', content: 'not an image' }
  ]);
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

describe('zip reader', () => {
  it('lists entries and reads deflated and stored content', async () => {
    const bytes = await buildZip([
      { name: 'dir/a.txt', content: 'hello deflated' },
      { name: 'b.bin', content: new Uint8Array([7, 8, 9]), store: true }
    ]);
    await bucket.put('files/1/original.zip', bytes);

    const zip = await ZipArchive.open(asBucket(bucket), 'files/1/original.zip');
    expect(zip.list().map(entry => entry.filename)).toEqual(['dir/a.txt', 'b.bin']);

    const text = await zip.readText('dir/a.txt');
    expect(text).toBe('hello deflated');
    expect([...(await zip.read('b.bin'))]).toEqual([7, 8, 9]);
  });

  it('throws ZipError for missing entries and non-zip data', async () => {
    await bucket.put('files/2/original.zip', 'not a zip at all');
    const zip = await ZipArchive.open(asBucket(bucket), 'files/2/original.zip').catch(error => error);
    // A random string simply has no EOCD record.
    expect(zip).toBeInstanceOf(ZipError);

    const bytes = await buildZip([{ name: 'a.txt', content: 'a' }]);
    await bucket.put('files/3/original.zip', bytes);
    const real = await ZipArchive.open(asBucket(bucket), 'files/3/original.zip');
    await expect(real.read('missing.txt')).rejects.toBeInstanceOf(ZipError);
  });

  it('sorts image entries naturally and skips junk', async () => {
    const bytes = await buildComic();
    await bucket.put('files/4/original.cbz', bytes);
    const zip = await ZipArchive.open(asBucket(bucket), 'files/4/original.cbz');
    expect(zip.imageEntries().map(entry => entry.filename)).toEqual(['p1.png', 'p2.png', 'p10.png']);
  });
});

describe('epub reader endpoints', () => {
  it('serves book info with resolved manifest, sizes, spine, toc and metadata', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await upload(token, 'Dune.epub', await buildEpub());

    const res = await request(`/api/v1/epub/${book.id}/info`, { token });
    expect(res.status).toBe(200);
    const info = (await res.json()) as {
      rootPath: string;
      manifest: { href: string; size: number; properties?: string[] }[];
      spine: { idref: string; href: string; linear: boolean }[];
      toc: { children?: { label: string; href: string; children?: unknown[] }[] };
      metadata: Record<string, unknown>;
      coverPath?: string;
    };

    expect(info.rootPath).toBe('OEBPS/content.opf');

    const chapter = info.manifest.find(item => item.href === 'OEBPS/My Chapter.xhtml');
    expect(chapter).toBeDefined();
    expect(chapter?.size).toBe(CHAPTER_XHTML.length);

    const css = info.manifest.find(item => item.href === 'OEBPS/style.css');
    expect(css?.size).toBe('body { color: rebeccapurple; }'.length);

    expect(info.spine.map(item => [item.idref, item.linear])).toEqual([
      ['ch1', true],
      ['nav', false]
    ]);
    expect(info.coverPath).toBe('OEBPS/images/cover.jpg');
    expect(info.metadata.title).toBe('Dune');
    expect(info.metadata.authors).toEqual(['Frank Herbert', 'Kevin J. Anderson']);

    const tocChildren = info.toc.children ?? [];
    expect(tocChildren[0].label).toBe('Chapter 1');
    expect(tocChildren[0].href).toBe('OEBPS/My Chapter.xhtml');
    expect(tocChildren[0].children?.[0]).toEqual({
      label: 'Spice',
      href: 'OEBPS/My Chapter.xhtml#spice'
    });
  });

  it('serves epub resources with content types, via header or ?token auth', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await upload(token, 'Dune.epub', await buildEpub());

    const css = await request(`/api/v1/epub/${book.id}/file/OEBPS/style.css`, { token });
    expect(css.status).toBe(200);
    expect(css.headers.get('Content-Type')).toBe('text/css');
    expect(await css.text()).toBe('body { color: rebeccapurple; }');

    const chapter = await request(`/api/v1/epub/${book.id}/file/OEBPS/My%20Chapter.xhtml?token=${token}`);
    expect(chapter.status).toBe(200);
    expect(chapter.headers.get('Content-Type')).toBe('application/xhtml+xml');
    expect(await chapter.text()).toBe(CHAPTER_XHTML);

    const bad = await request(`/api/v1/epub/${book.id}/file/OEBPS/style.css?token=not-a-real-token`);
    expect(bad.status).toBe(401);

    const missing = await request(`/api/v1/epub/${book.id}/file/OEBPS/nope.css`, { token });
    expect(missing.status).toBe(404);
  });

  it('rejects non-epub books and unknown ids', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const notEpub = await upload(token, 'Comic.cbz', await buildComic());
    const wrongType = await request(`/api/v1/epub/${notEpub.id}/info`, { token });
    expect(wrongType.status).toBe(400);

    const missing = await request('/api/v1/epub/9999/info', { token });
    expect(missing.status).toBe(404);
  });
});

describe('cbx reader endpoints', () => {
  it('lists pages in natural order', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await upload(token, 'Comic.cbz', await buildComic());

    const res = await request(`/api/v1/cbx/${book.id}/pages`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([1, 2, 3]);
  });

  it('serves individual page images with caching and 404s out-of-range pages', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await upload(token, 'Comic.cbz', await buildComic());

    const page2 = await request(`/api/v1/media/book/${book.id}/cbx/pages/2?token=${token}`);
    expect(page2.status).toBe(200);
    expect(page2.headers.get('Content-Type')).toBe('image/png');
    expect([...new Uint8Array(await page2.arrayBuffer())]).toEqual([1, 0, 2]);

    const page4 = await request(`/api/v1/media/book/${book.id}/cbx/pages/4`, { token });
    expect(page4.status).toBe(404);

    const page0 = await request(`/api/v1/media/book/${book.id}/cbx/pages/0`, { token });
    expect(page0.status).toBe(404);
  });

  it('rejects RAR-based cbr books with a clear message', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await upload(token, 'Batman.cbr', await buildComic());

    const res = await request(`/api/v1/cbx/${book.id}/pages`, { token });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('CBR');
  });
});

describe('reading progress', () => {
  it('stores epub progress and stamps lastReadTime', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await upload(token, 'Dune.epub', await buildEpub());

    const res = await request('/api/v1/books/progress', {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId: book.id,
        epubProgress: { cfi: 'epubcfi(/6/4!/4/2/2/2:0)', percentage: 42.5 }
      })
    });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as {
      epubProgress?: { cfi: string; percentage: number };
      lastReadTime?: string;
    };
    expect(saved.epubProgress).toEqual({ cfi: 'epubcfi(/6/4!/4/2/2/2:0)', percentage: 42.5 });
    expect(saved.lastReadTime).toBeTruthy();

    const fetched = (await (await request(`/api/v1/books/${book.id}`, { token })).json()) as {
      epubProgress?: { percentage: number };
    };
    expect(fetched.epubProgress?.percentage).toBe(42.5);
  });

  it('stores pdf and cbx page progress together', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await upload(token, 'Comic.cbz', await buildComic());

    const res = await request('/api/v1/books/progress', {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId: book.id,
        pdfProgress: { page: 3, percentage: 12.5 },
        cbxProgress: { page: 7, percentage: 33.3 }
      })
    });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as {
      pdfProgress?: { page: number; percentage: number };
      cbxProgress?: { page: number; percentage: number };
    };
    expect(saved.pdfProgress).toEqual({ page: 3, percentage: 12.5 });
    expect(saved.cbxProgress).toEqual({ page: 7, percentage: 33.3 });
  });

  it('validates progress payloads', async () => {
    const token = await login(ADMIN_USER, ADMIN_PASSWORD);
    const book = await upload(token, 'Dune.epub', await buildEpub());

    const post = (body: unknown) =>
      request('/api/v1/books/progress', {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

    expect((await post({})).status).toBe(400);
    expect((await post({ bookId: book.id })).status).toBe(400);
    expect(
      (await post({ bookId: book.id, epubProgress: { percentage: 10 } })).status
    ).toBe(400);
    expect(
      (await post({ bookId: book.id, epubProgress: { cfi: 'x', percentage: 900 } })).status
    ).toBe(200);
    expect(
      (await post({ bookId: book.id, pdfProgress: { page: 0, percentage: 5 } })).status
    ).toBe(400);
    expect((await post({ bookId: 9999, pdfProgress: { page: 1, percentage: 5 } })).status).toBe(404);

    const fetched = (await (await request(`/api/v1/books/${book.id}`, { token })).json()) as {
      epubProgress?: { percentage: number };
    };
    expect(fetched.epubProgress?.percentage).toBe(100);
  });

  it('requires authentication', async () => {
    const res = await request('/api/v1/books/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: 1, epubProgress: { cfi: 'x', percentage: 1 } })
    });
    expect(res.status).toBe(401);
  });
});
