/**
 * The Hono API was written against Cloudflare R2. Web Libris runs on a plain
 * Node server, so this file declares the small subset of the R2 surface the
 * API actually uses, and implements it on top of the local filesystem.
 *
 * Keeping the same interface means the ported routes stay byte-for-byte the
 * ones from the original app, and swapping in real R2 (or S3) later is a
 * single class substitution.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export type R2Conditional = {
  etagMatches?: string;
  etagDoesNotMatch?: string;
  uploadedBefore?: Date;
  uploadedAfter?: Date;
};

export type R2HTTPMetadata = {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
};

export type R2Range = {
  offset?: number;
  length?: number;
  suffix?: number;
};

export type R2GetOptions = {
  range?: R2Range;
  onlyIf?: R2Conditional;
};

export type R2PutOptions = {
  onlyIf?: R2Conditional;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
};

export type R2ListOptions = {
  prefix?: string;
  cursor?: string;
  limit?: number;
  delimiter?: string;
  include?: ('httpMetadata' | 'customMetadata')[];
};

export interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  range?: R2Range;
  writeHttpMetadata(headers: Headers): void;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

export type R2PutValue = ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null;

export interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
  put(key: string, value: R2PutValue, options?: R2PutOptions): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

interface StoredMeta {
  etag: string;
  contentType?: string;
  customMetadata?: Record<string, string>;
  uploaded: string;
}

interface ResolvedRange {
  start: number;
  end: number;
  length: number;
}

function etagOf(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex');
}

/** Clamp a requested range to the object, R2-style. */
function resolveRange(range: R2Range | undefined, size: number): ResolvedRange | undefined {
  if (!range) return undefined;
  let start = 0;
  if (typeof range.suffix === 'number') {
    start = Math.max(0, size - range.suffix);
  } else if (typeof range.offset === 'number') {
    start = Math.max(0, Math.min(range.offset, size));
  }
  const length = typeof range.length === 'number' ? Math.max(0, range.length) : size - start;
  const end = Math.min(size, start + length);
  return { start, end, length: end - start };
}

function streamRange(filePath: string, range: ResolvedRange | undefined): ReadableStream {
  if (range && range.length === 0) {
    return new ReadableStream({ start: controller => controller.close() });
  }
  const stream = range
    ? createReadStream(filePath, { start: range.start, end: range.end - 1 })
    : createReadStream(filePath);
  return Readable.toWeb(stream) as ReadableStream;
}

class FsObject implements R2ObjectBody {
  bodyUsed = false;

  constructor(
    private readonly filePath: string,
    readonly key: string,
    readonly size: number,
    readonly etag: string,
    readonly uploaded: Date,
    readonly httpMetadata: R2HTTPMetadata | undefined,
    readonly customMetadata: Record<string, string> | undefined,
    readonly range: R2Range | undefined,
    private readonly resolved: ResolvedRange | undefined
  ) {}

  get version(): string {
    return this.etag;
  }

  get httpEtag(): string {
    return `"${this.etag}"`;
  }

  get body(): ReadableStream {
    return streamRange(this.filePath, this.resolved);
  }

  private async bytes(): Promise<Buffer> {
    const all = await readFile(this.filePath);
    return this.resolved ? all.subarray(this.resolved.start, this.resolved.end) : all;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this.bytes();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async text(): Promise<string> {
    return (await this.bytes()).toString('utf8');
  }

  async json<T>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }

  async blob(): Promise<Blob> {
    const bytes = await this.bytes();
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Blob([copy], { type: this.httpMetadata?.contentType });
  }

  writeHttpMetadata(headers: Headers): void {
    if (this.httpMetadata?.contentType) headers.set('Content-Type', this.httpMetadata.contentType);
    if (this.httpMetadata?.contentDisposition) headers.set('Content-Disposition', this.httpMetadata.contentDisposition);
    if (this.httpMetadata?.cacheControl) headers.set('Cache-Control', this.httpMetadata.cacheControl);
  }
}

/**
 * Filesystem-backed R2. Objects live under `<root>/objects/<key>` and their
 * HTTP/custom metadata in `<root>/meta.json`.
 *
 * Local CAS writes are serialized per key so `onlyIf` behaves like R2's
 * conditional put. Reads are plain file reads.
 */
export class FileSystemBucket implements R2Bucket {
  private readonly objectsRoot: string;
  private readonly metaFile: string;
  private meta: Record<string, StoredMeta> = {};
  private loaded: Promise<void> | null = null;
  private readonly locks = new Map<string, Promise<unknown>>();
  private metaQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: string) {
    this.objectsRoot = path.join(root, 'objects');
    this.metaFile = path.join(root, 'meta.json');
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        await mkdir(this.objectsRoot, { recursive: true });
        try {
          this.meta = JSON.parse(await readFile(this.metaFile, 'utf8')) as Record<string, StoredMeta>;
        } catch {
          this.meta = {};
        }
      })();
    }
    return this.loaded;
  }

  private filePath(key: string): string {
    const full = path.resolve(this.objectsRoot, key);
    const root = path.resolve(this.objectsRoot);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Invalid object key: ${key}`);
    }
    return full;
  }

  private async saveMeta(): Promise<void> {
    const snapshot = JSON.stringify(this.meta);
    const run = this.metaQueue.then(async () => {
      await mkdir(this.root, { recursive: true });
      const temp = `${this.metaFile}.${process.pid}.tmp`;
      await writeFile(temp, snapshot, 'utf8');
      await rename(temp, this.metaFile);
    });
    this.metaQueue = run.catch(() => undefined);
    return run;
  }

  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    this.locks.set(key, run.catch(() => undefined));
    return run;
  }

  private metaFor(key: string, stats: { size: number; mtimeMs: number; mtime: Date }): StoredMeta {
    return (
      this.meta[key] ?? {
        etag: `${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}`,
        uploaded: stats.mtime.toISOString()
      }
    );
  }

  private objectFrom(key: string, stats: { size: number; mtimeMs: number; mtime: Date }, range?: ResolvedRange): FsObject {
    const meta = this.metaFor(key, stats);
    return new FsObject(
      this.filePath(key),
      key,
      stats.size,
      meta.etag,
      new Date(meta.uploaded),
      meta.contentType ? { contentType: meta.contentType } : undefined,
      meta.customMetadata,
      range ? { offset: range.start, length: range.length } : undefined,
      range
    );
  }

  async head(key: string): Promise<R2Object | null> {
    await this.ensureLoaded();
    try {
      const stats = await stat(this.filePath(key));
      return this.objectFrom(key, stats);
    } catch {
      return null;
    }
  }

  async get(key: string, options: R2GetOptions = {}): Promise<R2ObjectBody | null> {
    await this.ensureLoaded();
    try {
      const stats = await stat(this.filePath(key));
      const range = resolveRange(options.range, stats.size);
      return this.objectFrom(key, stats, range);
    } catch {
      return null;
    }
  }

  async put(key: string, value: R2PutValue, options: R2PutOptions = {}): Promise<R2Object | null> {
    await this.ensureLoaded();
    return this.withLock(key, async () => {
      const filePath = this.filePath(key);
      let bytes: Buffer;
      if (typeof value === 'string') bytes = Buffer.from(value);
      else if (value instanceof Blob) bytes = Buffer.from(await value.arrayBuffer());
      else if (value instanceof ArrayBuffer) bytes = Buffer.from(value);
      else if (ArrayBuffer.isView(value)) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      else if (value && typeof (value as ReadableStream).getReader === 'function') {
        bytes = Buffer.from(await new Response(value as ReadableStream).arrayBuffer());
      } else if (value === null) bytes = Buffer.alloc(0);
      else throw new Error('Unsupported R2 put value');

      if (options.onlyIf) {
        let existing: StoredMeta | null = null;
        try {
          const stats = await stat(filePath);
          existing = this.metaFor(key, stats);
        } catch {
          existing = null;
        }
        const { etagMatches, etagDoesNotMatch } = options.onlyIf;
        if (etagMatches !== undefined && (!existing || existing.etag !== etagMatches)) return null;
        if (etagDoesNotMatch !== undefined) {
          const matches = etagDoesNotMatch === '*' ? Boolean(existing) : Boolean(existing && existing.etag === etagDoesNotMatch);
          if (matches) return null;
        }
      }

      await mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, bytes);
      await rename(temp, filePath);

      const stats = await stat(filePath);
      const etag = etagOf(bytes);
      this.meta[key] = {
        etag,
        contentType: options.httpMetadata?.contentType,
        customMetadata: options.customMetadata,
        uploaded: new Date().toISOString()
      };
      await this.saveMeta();
      return this.objectFrom(key, stats);
    });
  }

  async delete(keys: string | string[]): Promise<void> {
    await this.ensureLoaded();
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      await this.withLock(key, async () => {
        await rm(this.filePath(key), { force: true });
        delete this.meta[key];
        await this.saveMeta();
      });
    }
  }

  async list(options: R2ListOptions = {}): Promise<R2Objects> {
    await this.ensureLoaded();
    const keys: string[] = [];
    const walk = async (dir: string, prefix: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.endsWith('.tmp')) continue;
        const key = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), key);
        else keys.push(key);
      }
    };
    await walk(this.objectsRoot, '');

    const filtered = keys
      .filter(key => (options.prefix ? key.startsWith(options.prefix) : true))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit ?? 1000;
    const page = filtered.slice(start, start + limit);
    const objects: R2Object[] = [];
    for (const key of page) {
      try {
        const stats = await stat(this.filePath(key));
        objects.push(this.objectFrom(key, stats));
      } catch {
        // Deleted between listing and stat.
      }
    }
    const next = start + page.length;
    return {
      objects,
      truncated: next < filtered.length,
      cursor: next < filtered.length ? String(next) : undefined,
      delimitedPrefixes: []
    };
  }
}
