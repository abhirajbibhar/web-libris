import JSZip from 'jszip';
import type { PdfEngine } from '@embedpdf/engines';
import pdfiumWasmUrl from '../readers/pdfiumWasm';
import type { Metadata } from '../api/types';

export interface ExtractedInfo {
  metadata: Metadata;
  cover?: Blob;
}

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];

const COVER_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif'
};

const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

const stripHtml = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const decoded = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
  return decoded || undefined;
};

const titleFromFileName = (fileName: string): string => fileName.replace(/\.[^.]+$/, '');

function resolveRelative(opfPath: string, relative: string): string {
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const segments: string[] = [];
  for (const part of (base + relative).split('/')) {
    if (part === '..') segments.pop();
    else if (part !== '.' && part !== '') segments.push(part);
  }
  return segments.join('/');
}

/* --------------------------------- EPUB -------------------------------- */

async function extractEpub(file: File): Promise<ExtractedInfo> {
  const zip = await JSZip.loadAsync(file);
  const metadata: Metadata = { title: titleFromFileName(file.name) };

  const containerFile = zip.file('META-INF/container.xml');
  const opfPath = containerFile
    ? new DOMParser()
        .parseFromString(await containerFile.async('text'), 'application/xml')
        .getElementsByTagName('rootfile')[0]
        ?.getAttribute('full-path')
    : undefined;

  let coverBlob: Blob | undefined;

  if (opfPath) {
    const opfFile = zip.file(opfPath);
    if (opfFile) {
      const doc = new DOMParser().parseFromString(await opfFile.async('text'), 'application/xml');
      const textOf = (tag: string) => doc.getElementsByTagNameNS('*', tag)[0]?.textContent?.trim() || undefined;

      const title = textOf('title');
      if (title) metadata.title = title;
      const subtitle = textOf('subtitle');
      if (subtitle) metadata.subtitle = subtitle;

      const authors = [...doc.getElementsByTagNameNS('*', 'creator')]
        .map(creator => creator.textContent?.trim())
        .filter((value): value is string => Boolean(value));
      if (authors.length > 0) metadata.authors = authors;

      const description = stripHtml(textOf('description'));
      if (description) metadata.description = description;
      const publisher = textOf('publisher');
      if (publisher) metadata.publisher = publisher;
      const date = textOf('date');
      if (date) metadata.publishedDate = date.slice(0, 10);
      const language = textOf('language');
      if (language) metadata.language = language;

      const categories = [...doc.getElementsByTagNameNS('*', 'subject')]
        .map(subject => subject.textContent?.trim())
        .filter((value): value is string => Boolean(value));
      if (categories.length > 0) metadata.categories = categories;

      // Calibre-style series tags
      const metas = [...doc.getElementsByTagName('meta')];
      const seriesMeta = metas.find(meta => meta.getAttribute('name') === 'calibre:series');
      const seriesIndexMeta = metas.find(meta => meta.getAttribute('name') === 'calibre:series_index');
      const seriesName = seriesMeta?.getAttribute('content')?.trim();
      if (seriesName) {
        metadata.seriesName = seriesName;
        const index = Number(seriesIndexMeta?.getAttribute('content'));
        metadata.seriesNumber = Number.isFinite(index) ? index : null;
      }

      // Cover: <meta name="cover" content="manifest-id"/> or properties="cover-image"
      let coverHref: string | undefined;
      const coverMeta = metas.find(meta => meta.getAttribute('name') === 'cover');
      const coverId = coverMeta?.getAttribute('content');
      const manifestItems = [...doc.getElementsByTagNameNS('*', 'item')];
      if (coverId) {
        coverHref = manifestItems.find(item => item.getAttribute('id') === coverId)?.getAttribute('href') ?? undefined;
      }
      if (!coverHref) {
        coverHref =
          manifestItems.find(item => (item.getAttribute('properties') ?? '').includes('cover-image'))?.getAttribute('href') ??
          undefined;
      }
      if (!coverHref) {
        // Fall back to the largest image in the archive whose name mentions cover.
        const candidates = Object.keys(zip.files).filter(
          path => IMAGE_EXTENSIONS.includes(extOf(path)) && /cover/i.test(path)
        );
        coverHref = candidates[0];
      }
      if (coverHref) {
        const coverPath = coverHref.startsWith('/') ? coverHref.slice(1) : resolveRelative(opfPath, coverHref);
        const entry = zip.file(coverPath);
        if (entry) {
          const bytes = await entry.async('uint8array');
          coverBlob = new Blob([bytes as unknown as BlobPart], { type: COVER_MIME[extOf(coverPath)] ?? 'image/jpeg' });
        }
      }
    }
  }

  return { metadata, cover: coverBlob };
}

/* ---------------------------------- PDF --------------------------------- */

// One headless PDFium engine is shared by all uploads; the wasm is only
// loaded the first time a PDF is picked. The module is imported lazily so the
// engine code stays out of the main bundle.
let enginePromise: Promise<PdfEngine<Blob>> | null = null;

function getPdfEngine(): Promise<PdfEngine<Blob>> {
  if (!enginePromise) {
    enginePromise = import('@embedpdf/engines/pdfium-direct-engine')
      .then(({ createPdfiumEngine }) => createPdfiumEngine(pdfiumWasmUrl))
      .catch(error => {
        enginePromise = null; // allow a retry on the next upload
        throw error;
      });
  }
  return enginePromise;
}

async function extractPdf(file: File): Promise<ExtractedInfo> {
  const metadata: Metadata = { title: titleFromFileName(file.name) };
  let coverBlob: Blob | undefined;

  try {
    const engine = await getPdfEngine();
    const content = await file.arrayBuffer();
    const doc = await engine.openDocumentBuffer({ id: `upload-${Date.now()}`, content }).toPromise();
    try {
      try {
        const info = await engine.getMetadata(doc).toPromise();
        if (info.title?.trim()) metadata.title = info.title.trim();
        if (info.author?.trim()) metadata.authors = info.author.split(/[,;&]/).map(a => a.trim()).filter(Boolean);
        if (info.subject?.trim()) metadata.description = info.subject.trim();
        if (info.keywords?.trim()) {
          metadata.categories = info.keywords.split(/[,;]/).map(k => k.trim()).filter(Boolean);
        }
      } catch {
        // Missing/corrupt info dictionary: keep the filename-derived title.
      }

      try {
        const firstPage = doc.pages[0];
        if (firstPage) {
          // Same target as before: at most 800px wide, JPEG at 85% quality.
          const scaleFactor = Math.min(1, 800 / firstPage.size.width);
          coverBlob = await engine
            .renderPage(doc, firstPage, { scaleFactor, dpr: 1, imageType: 'image/jpeg', imageQuality: 0.85 })
            .toPromise();
        }
      } catch {
        // A corrupt first page simply has no cover.
      }
    } finally {
      await engine.closeDocument(doc).toPromise().catch(() => undefined);
    }
  } catch {
    // Unparseable / password-protected PDF: fall back to filename metadata, upload proceeds.
  }
  return { metadata, cover: coverBlob };
}

/* ---------------------------------- CBX --------------------------------- */

async function extractCbx(file: File): Promise<ExtractedInfo> {
  const metadata: Metadata = { title: titleFromFileName(file.name) };
  try {
    const zip = await JSZip.loadAsync(file);
    const firstImage = Object.keys(zip.files)
      .filter(path => !zip.files[path].dir && IMAGE_EXTENSIONS.includes(extOf(path)))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
    if (firstImage) {
      const bytes = await zip.files[firstImage].async('uint8array');
      return {
        metadata,
        cover: new Blob([bytes as unknown as BlobPart], { type: COVER_MIME[extOf(firstImage)] ?? 'image/jpeg' })
      };
    }
  } catch {
    // RAR-based CBX cannot be parsed client-side; upload without a cover.
  }
  return { metadata };
}

/* ------------------------------- dispatcher ------------------------------ */

/**
 * Reads embedded metadata and a cover thumbnail from a book file so uploads
 * arrive already described. Unsupported or corrupt files simply upload with a
 * filename-derived title.
 */
export async function extractBookInfo(file: File): Promise<ExtractedInfo> {
  const extension = extOf(file.name);
  try {
    switch (extension) {
      case 'epub':
        return await extractEpub(file);
      case 'pdf':
        return await extractPdf(file);
      case 'cbz':
      case 'zip':
        return await extractCbx(file);
      default:
        return { metadata: { title: titleFromFileName(file.name) } };
    }
  } catch {
    return { metadata: { title: titleFromFileName(file.name) } };
  }
}

export const SUPPORTED_UPLOAD_EXTENSIONS = ['pdf', 'epub', 'cbz', 'cbr', 'zip', 'fb2', 'mobi', 'azw3'];
