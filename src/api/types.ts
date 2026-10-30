export type BookType = 'PDF' | 'EPUB' | 'CBX' | 'FB2' | 'MOBI' | 'AZW3';

export type ReadStatus =
  | 'UNSET'
  | 'UNREAD'
  | 'READING'
  | 'RE_READING'
  | 'READ'
  | 'PARTIALLY_READ'
  | 'PAUSED'
  | 'WONT_READ'
  | 'ABANDONED';

export interface Permissions {
  admin: boolean;
  canUpload: boolean;
  canDownload: boolean;
  canDeleteBook: boolean;
  canEditMetadata: boolean;
  canManageLibrary: boolean;
  canManageUsers: boolean;
}

export interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  permissions: Permissions;
  assignedLibraryIds: number[] | null;
}

export interface Library {
  id: number;
  name: string;
  icon?: string | null;
  iconType?: 'PRIME_NG' | 'CUSTOM_SVG' | null;
  bookCount?: number;
}

export interface Shelf {
  id: number;
  name: string;
  icon?: string | null;
  iconType?: 'PRIME_NG' | 'CUSTOM_SVG' | null;
  publicShelf?: boolean;
  userId?: number;
  bookCount?: number;
}

export interface Metadata {
  bookId?: number;
  title?: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  seriesName?: string;
  seriesNumber?: number | null;
  seriesTotal?: number | null;
  publisher?: string;
  publishedDate?: string;
  isbn13?: string;
  isbn10?: string;
  pageCount?: number | null;
  language?: string;
  categories?: string[];
  tags?: string[];
  moods?: string[];
}

export interface BookFile {
  id: number;
  bookId: number;
  bookType: BookType;
  fileName: string;
  extension: string;
  fileSizeKb?: number;
}

export interface Book {
  id: number;
  libraryId: number;
  libraryName: string;
  fileName: string;
  fileSizeKb?: number;
  addedOn: string;
  lastReadTime?: string;
  primaryFile: BookFile;
  metadata: Metadata;
  shelves: Shelf[];
  personalRating?: number | null;
  readStatus: ReadStatus;
  readStatusModifiedTime?: string;
  dateFinished?: string;
  coverUpdatedOn?: string;
  coverExt?: string;
  epubProgress?: { cfi: string; percentage: number };
  pdfProgress?: { page: number; percentage: number };
  cbxProgress?: { page: number; percentage: number };
  /** Highlights and notes saved in the PDF annotation file (absent = none). */
  annotationCount?: number;
}

export interface BookDeletionResponse {
  deleted: number[];
  failedFileDeletions: number[];
}

export interface StatusUpdateResponse {
  bookId: number;
  readStatus: ReadStatus;
  readStatusModifiedTime: string;
  dateFinished?: string;
}

export interface RatingUpdateResponse {
  bookId: number;
  personalRating: number | null;
}

export interface EpubManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string[];
  size: number;
}

export interface EpubSpineItem {
  idref: string;
  href: string;
  mediaType: string;
  linear: boolean;
}

export interface EpubTocNode {
  label: string;
  href: string;
  children?: EpubTocNode[];
}

/** Response of GET /api/v1/epub/:id/info (foliate streaming book info). */
export interface EpubBookInfo {
  containerPath: string;
  rootPath: string;
  spine: EpubSpineItem[];
  manifest: EpubManifestItem[];
  toc: EpubTocNode | null;
  metadata: Record<string, unknown>;
  coverPath?: string;
}

export interface EpubProgressUpdate {
  cfi: string;
  percentage: number;
}

export interface PageProgressUpdate {
  page: number;
  percentage: number;
}

/** Payload of POST /api/v1/books/progress (at least one progress field). */
export interface ReadingProgressUpdate {
  bookId: number;
  epubProgress?: EpubProgressUpdate;
  pdfProgress?: PageProgressUpdate;
  cbxProgress?: PageProgressUpdate;
}

/**
 * Cover images load from the unauthenticated `/public/covers/<id>` route so
 * Cloudflare's edge cache can store them (responses with an Authorization
 * header are never edge-cached). The `t=<coverUpdatedOn>` param versions the
 * URL: a re-uploaded cover produces a new URL, so no cache ever serves stale
 * bytes.
 */
export const coverUrl = (book: Pick<Book, 'id' | 'coverUpdatedOn' | 'coverExt'>): string => {
  // `/public/*` is reserved for the framework's static directory, so public
  // cover images live at `/covers/<id>` instead.
  // No cover recorded at all.
  if (!book.coverUpdatedOn && !book.coverExt) return '';
  const params = new URLSearchParams();
  // Records created before `coverExt` existed only ever stored jpg covers, and
  // the worker defaults to jpg too, so mirror that instead of hiding the cover.
  if (book.coverUpdatedOn) params.set('t', book.coverUpdatedOn);
  params.set('ext', book.coverExt ?? 'jpg');
  return `/covers/${book.id}?${params.toString()}`;
};

export const fileUrl = (bookId: number): string => `/api/v1/books/${bookId}/file`;

/** Highest recorded reading progress across formats, as a 0-100 percentage. */
export function bookProgressPercent(book: Book): number {
  const candidates = [
    book.epubProgress?.percentage,
    book.pdfProgress?.percentage,
    book.cbxProgress?.percentage
  ].filter((value): value is number => typeof value === 'number');
  if (candidates.length === 0) return 0;
  return Math.min(100, Math.round(Math.max(...candidates)));
}
