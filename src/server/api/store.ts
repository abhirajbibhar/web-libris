import { AppIndex, emptyIndex } from './types';

const INDEX_KEY = 'data/index.json';
const MAX_CAS_RETRIES = 5;
/**
 * How long a warm isolate may serve its cached index without re-checking R2.
 * Every mutation writes through to R2 and refreshes this window, so writers
 * always see their own changes; readers get at most STALE_MS of lag instead of
 * a Head op per request — while still picking up deletes/edits made from any
 * other device "that moment" (worst case: one short request + one Head).
 */
const STALE_MS = 10_000;

export class CasConflictError extends Error {
  constructor() {
    super('Index update conflicted too many times, try again');
    this.name = 'CasConflictError';
  }
}

/**
 * Stores the whole library index as a single JSON object in R2 and applies
 * every mutation through an optimistic compare-and-swap on its etag, so
 * concurrent writers (multiple uploads, several devices) never lose data.
 */
export class IndexStore {
  private cachedIndex: AppIndex | null = null;
  private cachedEtag: string | null = null;
  private cacheFreshUntil = 0;

  constructor(
    private readonly bucket: R2Bucket,
    private readonly key: string = INDEX_KEY
  ) {}

  /** Read the current index, preferring the per-isolate cache when fresh. */
  async read(): Promise<{ index: AppIndex; etag: string | null }> {
    // Very recently written/read state — trust it without touching R2 at all.
    if (this.cachedIndex && Date.now() < this.cacheFreshUntil) {
      return { index: this.cachedIndex, etag: this.cachedEtag };
    }
    if (this.cachedIndex && this.cachedEtag !== null) {
      const head = await this.bucket.head(this.key);
      if (head && head.etag === this.cachedEtag) {
        this.cacheFreshUntil = Date.now() + STALE_MS;
        return { index: this.cachedIndex, etag: this.cachedEtag };
      }
    }

    const object = await this.bucket.get(this.key);
    if (!object) {
      const index = emptyIndex();
      this.cachedIndex = index;
      this.cachedEtag = '';
      this.cacheFreshUntil = Date.now() + STALE_MS;
      return { index, etag: null };
    }

    const index = (await object.json<AppIndex>()) ?? emptyIndex();
    this.cachedIndex = index;
    this.cachedEtag = object.etag;
    this.cacheFreshUntil = Date.now() + STALE_MS;
    return { index, etag: object.etag };
  }

  async exists(): Promise<boolean> {
    const head = await this.bucket.head(this.key);
    return head !== null;
  }

  /**
   * Apply `mutate` to a fresh copy of the index and persist it atomically.
   * The mutator receives the draft and may return any value; that value is
   * returned to the caller once the write lands. Retries on CAS conflicts by
   * reloading and re-running the mutator, so the mutation always applies to
   * the latest committed state.
   *
   * All updates for one store run through a single promise chain: two
   * concurrent requests in the same isolate would otherwise both read the
   * same cached etag, and the loser's unconditional retry could clobber the
   * winner's committed write (losing deletes, book-count regressions).
   */
  private queue: Promise<unknown> = Promise.resolve();

  update<T>(mutate: (draft: AppIndex) => T): Promise<T> {
    const run = this.queue.then(() => this.updateNow(mutate));
    // Keep the chain alive even when this caller's update fails.
    this.queue = run.catch(() => undefined);
    return run as Promise<T>;
  }

  private async updateNow<T>(mutate: (draft: AppIndex) => T): Promise<T> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const { index, etag } = await this.read();
      const draft: AppIndex = structuredClone(index);
      const result = mutate(draft);

      const body = JSON.stringify(draft);
      const written = etag
        ? await this.bucket.put(this.key, body, { onlyIf: { etagMatches: etag } })
        : await this.bucket.put(this.key, body, { onlyIf: { etagDoesNotMatch: '*' } });

      if (written) {
        this.cachedIndex = draft;
        this.cachedEtag = written.etag;
        this.cacheFreshUntil = Date.now() + STALE_MS;
        return result;
      }
      // Conflict: another writer won. Drop the cache and retry with fresh state.
      this.cachedIndex = null;
      this.cachedEtag = null;
    }
    throw new CasConflictError();
  }

  /** Force the next read to hit R2 (used after external writes in tests). */
  invalidate(): void {
    this.cachedIndex = null;
    this.cachedEtag = null;
  }
}

/** Characters that must never appear inside an R2 path segment. */
const UNSAFE_CHARS = /[/\x00-\x1f:*?"<>|\\]/g;

/** Collapse a user-supplied filename into a safe single path segment. */
export const sanitizeFileName = (name: string): string => {
  const base = (name.split(/[\\/]/).pop() ?? name).trim();
  const cleaned = base.replace(UNSAFE_CHARS, '_').replace(/\s+/g, ' ');
  return cleaned || 'file';
};

/**
 * Payload files keep their original upload name so a raw bucket export is
 * self-describing: `files/<bookId>/<original filename>` and
 * `files/<bookId>/cover.<ext>`. The bookId folder guarantees uniqueness even
 * when two uploads share a filename.
 */
export const fileKey = (bookId: number, fileName: string) =>
  `files/${bookId}/${sanitizeFileName(fileName)}`;

/** Legacy layout (`files/<id>/original.<ext>`) kept for pre-rename records. */
export const legacyFileKey = (bookId: number, fileName: string) =>
  `files/${bookId}/original.${(fileName.split('.').pop() ?? '').toLowerCase()}`;

/** Resolve the stored payload key for a record (new records carry it inline). */
export const resolveFileKey = (record: { id: number; fileName: string; fileKey?: string }) =>
  record.fileKey ?? legacyFileKey(record.id, record.fileName);

/**
 * Annotation sidecar lives beside the book: `files/<id>/<name>.annotation.json`,
 * so copying a book's folder carries its annotations with it.
 */
export const annotationKey = (record: { id: number; fileName: string; fileKey?: string }) =>
  resolveFileKey(record).replace(/\.[^./]+$/, '') + '.annotation.json';

export const coverKey = (bookId: number, ext: string) => `files/${bookId}/cover.${ext.toLowerCase()}`;

/** All keys to delete for a book: payload plus its cover (if any). */
export const bookStorageKeys = (record: {
  id: number;
  fileName: string;
  fileKey?: string;
  coverExt?: string;
}) => {
  const keys = new Set<string>([resolveFileKey(record), legacyFileKey(record.id, record.fileName)]);
  if (record.coverExt) keys.add(coverKey(record.id, record.coverExt));
  keys.add(annotationKey(record));
  return [...keys];
};
