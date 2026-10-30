/**
 * Random-access ZIP reader over R2 ranged reads.
 *
 * EPUB and CBX files are ZIP archives that can be far too large to buffer in
 * a Worker, so instead of downloading the whole object we read just the few
 * kilobytes we need: the end-of-central-directory record from the tail, the
 * central directory, and then each file's local header + compressed payload.
 * Entries are inflated on the fly with DecompressionStream.
 */

export interface ZipEntry {
  filename: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** Bytes we scan from the tail for the EOCD record (max comment is 64 KiB). */
const EOCD_SEARCH_BYTES = 0xffff + 22;
/** Sanity caps so a corrupt or hostile archive cannot exhaust Worker memory. */
const MAX_ENTRY_BYTES = 96 * 1024 * 1024;
const MAX_CENTRAL_DIR_BYTES = 64 * 1024 * 1024;

const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false });

async function readSlice(
  bucket: R2Bucket,
  key: string,
  offset: number,
  length: number
): Promise<Uint8Array> {
  if (length <= 0) return new Uint8Array(0);
  const object = await bucket.get(key, { range: { offset, length } });
  if (!object) throw new ZipError(`Could not read zip data at offset ${offset}`);
  return new Uint8Array(await object.arrayBuffer());
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  try {
    const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (cause) {
    throw new ZipError(`Failed to inflate zip entry: ${cause instanceof Error ? cause.message : cause}`);
  }
}

function findEocdIndex(tail: Uint8Array): number {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) !== EOCD_SIG) continue;
    const commentLength = view.getUint16(i + 20, true);
    if (i + 22 + commentLength === tail.byteLength) return i;
  }
  throw new ZipError('Not a zip archive (end of central directory not found)');
}

export class ZipArchive {
  private constructor(
    private readonly bucket: R2Bucket,
    private readonly key: string,
    private readonly entriesByName: Map<string, ZipEntry>
  ) {}

  /** Open a zip object stored at `key` in the bucket. */
  static async open(bucket: R2Bucket, key: string): Promise<ZipArchive> {
    const head = await bucket.head(key);
    if (!head) throw new ZipError(`File not found: ${key}`);

    const tailLength = Math.min(head.size, EOCD_SEARCH_BYTES);
    const tail = await readSlice(bucket, key, head.size - tailLength, tailLength);
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    const eocdIndex = findEocdIndex(tail);

    let entryCount: number;
    let centralSize: number;
    let centralOffset: number;

    if (eocdIndex >= 20 && view.getUint32(eocdIndex - 20, true) === EOCD64_LOCATOR_SIG) {
      const zip64Offset = Number(view.getBigUint64(eocdIndex - 20 + 8, true));
      const zip64 = await readSlice(bucket, key, zip64Offset, 56);
      if (zip64.byteLength < 56 || new DataView(zip64.buffer, zip64.byteOffset).getUint32(0, true) !== EOCD64_SIG) {
        throw new ZipError('Broken zip64 end of central directory record');
      }
      const zip64View = new DataView(zip64.buffer, zip64.byteOffset, zip64.byteLength);
      entryCount = Number(zip64View.getBigUint64(32, true));
      centralSize = Number(zip64View.getBigUint64(40, true));
      centralOffset = Number(zip64View.getBigUint64(48, true));
    } else {
      entryCount = view.getUint16(eocdIndex + 10, true);
      centralSize = view.getUint32(eocdIndex + 12, true);
      centralOffset = view.getUint32(eocdIndex + 16, true);
    }

    if (centralSize > MAX_CENTRAL_DIR_BYTES) {
      throw new ZipError('Zip central directory is too large');
    }
    if (centralOffset + centralSize > head.size) {
      throw new ZipError('Broken zip: central directory points outside the file');
    }

    const central = await readSlice(bucket, key, centralOffset, centralSize);
    const entriesByName = new Map<string, ZipEntry>();
    let cursor = 0;
    const centralView = new DataView(central.buffer, central.byteOffset, central.byteLength);

    for (let i = 0; i < entryCount && cursor + 46 <= central.byteLength; i++) {
      if (centralView.getUint32(cursor, true) !== CENTRAL_SIG) {
        throw new ZipError('Broken zip: invalid central directory entry');
      }
      const method = centralView.getUint16(cursor + 10, true);
      let compressedSize = centralView.getUint32(cursor + 20, true);
      let uncompressedSize = centralView.getUint32(cursor + 24, true);
      const nameLength = centralView.getUint16(cursor + 28, true);
      const extraLength = centralView.getUint16(cursor + 30, true);
      const commentLength = centralView.getUint16(cursor + 32, true);
      let localHeaderOffset = centralView.getUint32(cursor + 42, true);

      const nameStart = cursor + 46;
      const filename = decoder.decode(central.subarray(nameStart, nameStart + nameLength));

      // Zip64 extra field (id 0x0001) overrides whichever sizes/offsets came
      // out as 0xffffffff, in fixed order.
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
        let extraCursor = nameStart + nameLength;
        const extraEnd = extraCursor + extraLength;
        while (extraCursor + 4 <= extraEnd) {
          const headerId = centralView.getUint16(extraCursor, true);
          const dataSize = centralView.getUint16(extraCursor + 2, true);
          if (headerId === 0x0001) {
            let field = extraCursor + 4;
            if (uncompressedSize === 0xffffffff && field + 8 <= extraEnd) {
              uncompressedSize = Number(centralView.getBigUint64(field, true));
              field += 8;
            }
            if (compressedSize === 0xffffffff && field + 8 <= extraEnd) {
              compressedSize = Number(centralView.getBigUint64(field, true));
              field += 8;
            }
            if (localHeaderOffset === 0xffffffff && field + 8 <= extraEnd) {
              localHeaderOffset = Number(centralView.getBigUint64(field, true));
            }
            break;
          }
          extraCursor += 4 + dataSize;
        }
      }

      entriesByName.set(filename, {
        filename,
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });
      cursor = nameStart + nameLength + extraLength + commentLength;
    }

    return new ZipArchive(bucket, key, entriesByName);
  }

  /** All entries, in central directory order. */
  list(): ZipEntry[] {
    return [...this.entriesByName.values()];
  }

  /** Image entries usable as comic pages, sorted the way a human would. */
  imageEntries(): ZipEntry[] {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return this.list()
      .filter(entry => isImageFilename(entry.filename) && entry.uncompressedSize > 0)
      .sort((a, b) => collator.compare(a.filename, b.filename));
  }

  has(filename: string): boolean {
    return this.lookup(filename) !== undefined;
  }

  private lookup(filename: string): ZipEntry | undefined {
    const direct = this.entriesByName.get(filename);
    if (direct) return direct;
    try {
      return this.entriesByName.get(decodeURIComponent(filename));
    } catch {
      return undefined;
    }
  }

  /** Read and decompress a single entry's bytes. */
  async read(filename: string): Promise<Uint8Array> {
    const entry = this.lookup(filename);
    if (!entry) throw new ZipError(`File not found in zip: ${filename}`);
    if (entry.filename.endsWith('/')) return new Uint8Array(0);
    if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
      throw new ZipError(`Zip entry too large to read: ${filename}`);
    }

    const localHeader = await readSlice(this.bucket, this.key, entry.localHeaderOffset, 30);
    if (localHeader.byteLength < 30) throw new ZipError(`Broken zip: truncated local header for ${filename}`);
    const localView = new DataView(localHeader.buffer, localHeader.byteOffset);
    if (localView.getUint32(0, true) !== LOCAL_SIG) {
      throw new ZipError(`Broken zip: invalid local header for ${filename}`);
    }
    const nameLength = localView.getUint16(26, true);
    const extraLength = localView.getUint16(28, true);
    const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;

    const data = await readSlice(this.bucket, this.key, dataOffset, entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRaw(data);
    throw new ZipError(`Unsupported compression method ${entry.method} for ${filename}`);
  }

  async readText(filename: string): Promise<string> {
    return decoder.decode(await this.read(filename));
  }
}

const IMAGE_EXTENSIONS = new Set([
  'avif', 'bmp', 'gif', 'jfif', 'jpeg', 'jpg', 'png', 'webp'
]);

export function isImageFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (lower.startsWith('__macosx/') || lower.split('/').some(part => part.startsWith('.'))) return false;
  const ext = lower.split('.').pop() ?? '';
  return IMAGE_EXTENSIONS.has(ext);
}

