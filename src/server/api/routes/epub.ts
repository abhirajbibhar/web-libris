import { Context, Hono } from 'hono';
import { AppEnv, canSeeLibrary } from '../context';
import { resolveFileKey } from '../store';
import { BookRecord, HttpError } from '../types';
import { findAll, findFirst, parseXml, XmlNode } from '../xml';
import { ZipArchive, ZipError } from '../zip';

const EXT_OF = (fileName: string) => (fileName.split('.').pop() ?? '').toLowerCase();

const local = (name: string) => {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
};

/**
 * Byte-for-byte the same resolution foliate's epub.js performs client-side
 * (`resolveURL`), so the manifest hrefs we report match the names the reader
 * passes back to us (and to its size map).
 */
export const resolveZipPath = (url: string, relativeTo: string): string => {
  try {
    if (relativeTo.includes(':')) return String(new URL(url, relativeTo));
    const root = 'https://invalid.invalid/';
    const obj = new URL(url, root + relativeTo);
    obj.search = '';
    return decodeURI(obj.href.replace(root, ''));
  } catch {
    return url;
  }
};

const RESOURCE_MIME: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  css: 'text/css',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  otf: 'font/otf',
  png: 'image/png',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  webm: 'video/webm',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  xhtml: 'application/xhtml+xml'
};

export function resourceContentType(path: string): string {
  const ext = EXT_OF(path.split('/').pop() ?? path);
  return RESOURCE_MIME[ext] ?? 'application/octet-stream';
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string[];
}

interface TocNode {
  label: string;
  href: string;
  children?: TocNode[];
}

function textOf(node: XmlNode): string {
  let out = node.text;
  for (const child of node.children) out += textOf(child);
  return out;
}

export function registerEpubRoutes(app: Hono<AppEnv>): void {
  const getBook = async (c: Context<AppEnv>, idParam: string): Promise<BookRecord> => {
    const user = c.get('user');
    const { index } = await c.get('store').read();
    const record = index.books.find(b => b.id === Number(idParam));
    if (!record || !canSeeLibrary(user, record.libraryId)) throw new HttpError(404, 'Book not found');
    if (EXT_OF(record.fileName) !== 'epub') throw new HttpError(400, 'Book is not an EPUB file');
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

  app.get('/api/v1/epub/:id/info', async c => {
    const record = await getBook(c, c.req.param('id'));
    const zip = await openZip(c, record);

    let containerXml: string;
    try {
      containerXml = await zip.readText('META-INF/container.xml');
    } catch {
      throw new HttpError(400, 'Missing META-INF/container.xml (not a valid EPUB)');
    }
    const container = parseXml(containerXml);
    const rootfile = container ? findFirst(container, 'rootfile') : undefined;
    const opfPath = rootfile?.attrs['full-path'];
    if (!opfPath) throw new HttpError(400, 'EPUB has no package document');

    const opf = parseXml(await zip.readText(opfPath));
    if (!opf) throw new HttpError(400, 'EPUB package document could not be parsed');

    const manifestItems: ManifestItem[] = findAll(opf, 'item').map(item => ({
      id: item.attrs.id ?? '',
      href: resolveZipPath(item.attrs.href ?? '', opfPath),
      mediaType: item.attrs['media-type'] ?? '',
      properties: item.attrs.properties ? item.attrs.properties.split(/\s+/).filter(Boolean) : undefined
    }));

    const sizeByName = new Map(zip.list().map(entry => [entry.filename, entry.uncompressedSize]));
    const manifest = manifestItems.map(item => ({ ...item, size: sizeByName.get(item.href) ?? 0 }));

    const byId = new Map(manifestItems.map(item => [item.id, item]));
    const spine = findAll(opf, 'itemref')
      .map(itemref => {
        const item = byId.get(itemref.attrs.idref ?? '');
        if (!item) return null;
        return {
          idref: item.id,
          href: item.href,
          mediaType: item.mediaType,
          linear: itemref.attrs.linear !== 'no'
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const metadata = parseOpfMetadata(opf);
    const coverPath = findCoverPath(opf, manifestItems);
    const toc = await parseToc(zip, opf, manifestItems);

    return c.json({
      containerPath: 'META-INF/container.xml',
      rootPath: opfPath,
      spine,
      manifest,
      toc,
      metadata,
      coverPath
    });
  });

  app.get('/api/v1/epub/:id/file/*', async c => {
    const record = await getBook(c, c.req.param('id'));
    const zip = await openZip(c, record);

    // This Hono version matches trailing wildcards but does not expose them
    // as params, so recover the remainder from the (already decoded) path.
    const marker = '/file/';
    const markerIndex = c.req.path.indexOf(marker);
    const rawPath = markerIndex === -1 ? '' : c.req.path.slice(markerIndex + marker.length);
    let path: string;
    try {
      path = rawPath
        .split('/')
        .map(segment => decodeURIComponent(segment))
        .join('/');
    } catch {
      path = rawPath;
    }
    if (!path) throw new HttpError(404, 'File not found');

    let bytes: Uint8Array;
    try {
      bytes = await zip.read(path);
    } catch (cause) {
      if (cause instanceof ZipError) throw new HttpError(404, 'File not found in book');
      throw cause;
    }

    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': resourceContentType(path),
        'Cache-Control': 'private, max-age=3600'
      }
    });
  });
}

function parseOpfMetadata(opf: XmlNode): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const first = (name: string) => findFirst(opf, name)?.text.trim() || undefined;

  const title = first('title');
  if (title) metadata.title = title;
  const creators = findAll(opf, 'creator')
    .map(creator => creator.text.trim())
    .filter(Boolean);
  if (creators.length > 0) metadata.authors = creators;
  const language = first('language');
  if (language) metadata.language = language;
  const publisher = first('publisher');
  if (publisher) metadata.publisher = publisher;
  const description = findFirst(opf, 'description')?.text.trim();
  if (description) metadata.description = description;
  const identifier = first('identifier');
  if (identifier) metadata.identifier = identifier;
  const date = first('date');
  if (date) metadata.publishedDate = date;
  return metadata;
}

function findCoverPath(opf: XmlNode, manifest: ManifestItem[]): string | undefined {
  const coverImage = manifest.find(item => item.properties?.includes('cover-image'));
  if (coverImage) return coverImage.href;

  const metaCover = findAll(opf, 'meta').find(meta => meta.attrs.name === 'cover');
  const contentId = metaCover?.attrs.content;
  const item = contentId ? manifest.find(entry => entry.id === contentId) : undefined;
  if (item && item.mediaType.startsWith('image/')) return item.href;

  const guess = manifest.find(
    entry => entry.mediaType.startsWith('image/') && /cover/i.test(entry.href)
  );
  return guess?.href;
}

async function parseToc(
  zip: ZipArchive,
  opf: XmlNode,
  manifest: ManifestItem[]
): Promise<TocNode | null> {
  const navItem = manifest.find(item => item.properties?.includes('nav'));
  if (navItem) {
    try {
      const nav = parseXml(await zip.readText(navItem.href));
      if (nav) {
        const navs = findAll(nav, 'nav');
        const tocNav =
          navs.find(n => (n.attrs['epub:type'] ?? n.attrs.type ?? '').includes('toc')) ?? navs[0];
        if (tocNav) {
          const items = parseNavList(tocNav, navItem.href);
          if (items.length > 0) return { label: 'Contents', href: navItem.href, children: items };
        }
      }
    } catch {
      // fall through to NCX
    }
  }

  const spineTocId = findFirst(opf, 'spine')?.attrs.toc;
  const ncxItem = manifest.find(
    item => item.id === spineTocId || item.mediaType === 'application/x-dtbncx+xml'
  );
  if (ncxItem) {
    try {
      const ncx = parseXml(await zip.readText(ncxItem.href));
      if (ncx) {
        const items = parseNavPoints(findFirst(ncx, 'navMap'), ncxItem.href);
        if (items.length > 0) return { label: 'Contents', href: ncxItem.href, children: items };
      }
    } catch {
      // a book with no readable toc is not an error
    }
  }
  return null;
}

function parseNavList(nav: XmlNode, navPath: string): TocNode[] {
  const rootList = findFirst(nav, 'ol');
  if (!rootList) return [];

  const parseList = (list: XmlNode): TocNode[] =>
    list.children
      .filter(child => local(child.name) === 'li')
      .map(li => {
        const anchor = findFirst(li, 'a');
        if (!anchor) return null;
        const href = resolveZipPath(anchor.attrs.href ?? '', navPath);
        const label = textOf(anchor).trim() || href.split('#')[0];
        const nested = li.children.find(child => local(child.name) === 'ol');
        const children = nested ? parseList(nested) : [];
        return children.length > 0 ? { label, href, children } : { label, href };
      })
      .filter((entry): entry is TocNode => entry !== null);

  return parseList(rootList);
}

function parseNavPoints(navMap: XmlNode | undefined, ncxPath: string): TocNode[] {
  if (!navMap) return [];
  const build = (navPoint: XmlNode): TocNode => {
    const label = textOf(findFirst(navPoint, 'text') ?? { name: '', attrs: {}, children: [], text: '' }).trim();
    const src = findFirst(navPoint, 'content')?.attrs.src ?? '';
    const href = resolveZipPath(src, ncxPath);
    const children = navPoint.children
      .filter(child => local(child.name) === 'navPoint')
      .map(build);
    return children.length > 0 ? { label, href, children } : { label, href };
  };
  return navMap.children
    .filter(child => local(child.name) === 'navPoint')
    .map(build);
}
