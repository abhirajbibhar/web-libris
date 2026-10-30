import { Context, Hono } from 'hono';
import { AppEnv, canSeeLibrary } from '../context';
import { resolveFileKey } from '../store';
import { BookRecord, HttpError } from '../types';
import { ZipArchive, ZipError } from '../zip';

const EXT_OF = (fileName: string) => (fileName.split('.').pop() ?? '').toLowerCase();

/** Zip-based comic archives we can read; cbr (RAR) has no JS unzip story. */
const ZIP_EXTENSIONS = new Set(['cbz', 'zip']);

const IMAGE_MIME: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jfif: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

export function registerCbxRoutes(app: Hono<AppEnv>): void {
  const getBook = async (c: Context<AppEnv>, idParam: string): Promise<BookRecord> => {
    const user = c.get('user');
    const { index } = await c.get('store').read();
    const record = index.books.find(b => b.id === Number(idParam));
    if (!record || !canSeeLibrary(user, record.libraryId)) throw new HttpError(404, 'Book not found');
    const ext = EXT_OF(record.fileName);
    if (!ZIP_EXTENSIONS.has(ext)) {
      const message =
        ext === 'cbr'
          ? 'CBR (RAR) archives are not supported; convert the book to CBZ'
          : 'Book is not a comic archive';
      throw new HttpError(400, message);
    }
    return record;
  };

  const openZip = async (c: Context<AppEnv>, record: BookRecord): Promise<ZipArchive> => {
    try {
      return await ZipArchive.open(c.env.Library, resolveFileKey(record));
    } catch (cause) {
      if (cause instanceof ZipError) throw new HttpError(400, cause.message);
      throw cause;
    }
  };

  /** Page images in reading order (natural sort), one-based for the API. */
  const openPages = async (c: Context<AppEnv>, record: BookRecord) => {
    const zip = await openZip(c, record);
    const images = zip.imageEntries();
    if (images.length === 0) throw new HttpError(400, 'No page images found in archive');
    return { zip, images };
  };

  app.get('/api/v1/cbx/:id/pages', async c => {
    const record = await getBook(c, c.req.param('id'));
    const { images } = await openPages(c, record);
    return c.json(images.map((_, index) => index + 1));
  });

  app.get('/api/v1/media/book/:id/cbx/pages/:page', async c => {
    const record = await getBook(c, c.req.param('id'));
    const { zip, images } = await openPages(c, record);

    const page = Number(c.req.param('page'));
    if (!Number.isInteger(page) || page < 1 || page > images.length) {
      throw new HttpError(404, `Page not found (1-${images.length})`);
    }

    const entry = images[page - 1];
    let bytes: Uint8Array;
    try {
      bytes = await zip.read(entry.filename);
    } catch (cause) {
      if (cause instanceof ZipError) throw new HttpError(400, cause.message);
      throw cause;
    }

    const ext = EXT_OF(entry.filename);
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': IMAGE_MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=31536000, immutable'
      }
    });
  });
}
