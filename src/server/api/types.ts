export type BookType = 'PDF' | 'EPUB' | 'CBX' | 'FB2' | 'MOBI' | 'AZW3';

export const BOOK_EXTENSIONS: Record<string, BookType> = {
  pdf: 'PDF',
  epub: 'EPUB',
  cbz: 'CBX',
  cbr: 'CBX',
  zip: 'CBX',
  fb2: 'FB2',
  mobi: 'MOBI',
  azw3: 'AZW3'
};

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

export const READ_STATUSES: readonly ReadStatus[] = [
  'UNSET',
  'UNREAD',
  'READING',
  'RE_READING',
  'READ',
  'PARTIALLY_READ',
  'PAUSED',
  'WONT_READ',
  'ABANDONED'
];

export interface Permissions {
  admin: boolean;
  canUpload: boolean;
  canDownload: boolean;
  canDeleteBook: boolean;
  canEditMetadata: boolean;
  canManageLibrary: boolean;
  canManageUsers: boolean;
}

export const DEFAULT_PERMISSIONS: Permissions = {
  admin: false,
  canUpload: true,
  canDownload: true,
  canDeleteBook: false,
  canEditMetadata: true,
  canManageLibrary: false,
  canManageUsers: false
};

export interface Metadata {
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

export interface EpubProgress {
  cfi: string;
  percentage: number;
}

export interface PageProgress {
  page: number;
  percentage: number;
}

export interface BookRecord {
  id: number;
  libraryId: number;
  addedOn: string;
  lastReadTime?: string;
  /**
   * Exact R2 key of the book's payload file. Written once at upload time so
   * readers never have to rebuild it from `fileName`. Records created before
   * this field existed fall back to `legacyFileKey()` below.
   */
  fileKey?: string;
  fileName: string;
  fileSizeKb?: number;
  bookType: BookType;
  metadata: Metadata;
  shelves: number[];
  personalRating?: number | null;
  readStatus: ReadStatus;
  readStatusModifiedTime?: string;
  dateFinished?: string;
  coverUpdatedOn?: string;
  /** Extension of the stored cover image (e.g. "jpg"); records without a cover omit it. */
  coverExt?: string;
  epubProgress?: EpubProgress;
  pdfProgress?: PageProgress;
  cbxProgress?: PageProgress;
  /** Highlights + notes in the annotation sidecar (0/absent = none). */
  annotationCount?: number;
}

export interface LibraryRecord {
  id: number;
  name: string;
  icon?: string | null;
  iconType?: 'PRIME_NG' | 'CUSTOM_SVG' | null;
  createdOn: string;
}

export interface ShelfRecord {
  id: number;
  name: string;
  icon?: string | null;
  iconType?: 'PRIME_NG' | 'CUSTOM_SVG' | null;
  userId: number;
  publicShelf?: boolean;
  createdOn: string;
}

export interface UserRecord {
  id: number;
  username: string;
  name: string;
  email: string;
  passwordHash: string;
  permissions: Permissions;
  /** null means the user sees every library */
  assignedLibraryIds: number[] | null;
  createdOn: string;
  /**
   * Bumped whenever the password changes. Tokens carry the version they were
   * issued under (`ver`), so a bump instantly revokes every outstanding token.
   * Absent means 0 (password never changed since this field existed).
   */
  tokenVersion?: number;
}

export interface AppIndex {
  schemaVersion: 1;
  counters: {
    user: number;
    library: number;
    shelf: number;
    book: number;
  };
  users: UserRecord[];
  libraries: LibraryRecord[];
  shelves: ShelfRecord[];
  books: BookRecord[];
}

export function emptyIndex(): AppIndex {
  return {
    schemaVersion: 1,
    counters: { user: 0, library: 0, shelf: 0, book: 0 },
    users: [],
    libraries: [],
    shelves: [],
    books: []
  };
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
