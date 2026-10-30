interface StoredObject {
  bytes: Uint8Array;
  etag: string;
  contentType?: string;
  customMetadata?: Record<string, string>;
  uploaded: Date;
}

export interface R2RangeSpec {
  offset?: number;
  length?: number;
  suffix?: number;
}

/**
 * Minimal in-memory R2 double. Implements the subset of behaviour the app
 * relies on: head/get/put/delete/list plus conditional puts (etagMatches and
 * etagDoesNotMatch: '*'), ranged reads, httpMetadata and customMetadata.
 */
export class MockR2Bucket {
  private objects = new Map<string, StoredObject>();
  private counter = 0;

  async head(key: string): Promise<{ etag: string; size: number; customMetadata?: Record<string, string> } | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return { etag: object.etag, size: object.bytes.length, customMetadata: object.customMetadata };
  }

  /** Lexicographic listing with prefix + cursor paging, like R2. */
  async list(options: { prefix?: string; cursor?: string; limit?: number; include?: string[] } = {}) {
    const limit = options.limit ?? 1000;
    const keys = [...this.objects.keys()]
      .filter(key => key.startsWith(options.prefix ?? ''))
      .sort()
      .filter(key => options.cursor === undefined || key > options.cursor);
    const page = keys.slice(0, limit);
    const truncated = keys.length > page.length;
    return {
      objects: page.map(key => {
        const object = this.objects.get(key)!;
        return {
          key,
          size: object.bytes.length,
          etag: object.etag,
          uploaded: object.uploaded,
          customMetadata: options.include?.includes('customMetadata') ? object.customMetadata : undefined
        };
      }),
      truncated,
      cursor: truncated ? page[page.length - 1] : undefined,
      delimitedPrefixes: [] as string[]
    };
  }

  async get(
    key: string,
    options?: { range?: R2RangeSpec; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }
  ): Promise<any | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    if (options?.onlyIf?.etagMatches !== undefined && object.etag !== options.onlyIf.etagMatches) {
      return null;
    }

    const total = object.bytes.length;
    let start = 0;
    let end = total;
    let range: R2RangeSpec | undefined;
    const r = options?.range;
    if (r) {
      if (r.suffix !== undefined) {
        start = Math.max(0, total - r.suffix);
      } else {
        start = r.offset ?? 0;
      }
      end = r.length !== undefined ? Math.min(total, start + r.length) : total;
      range = { offset: start, length: end - start };
    }
    const slice = object.bytes.slice(start, end);

    return {
      key,
      etag: object.etag,
      httpEtag: object.etag,
      size: total,
      range,
      httpMetadata: object.contentType ? { contentType: object.contentType } : undefined,
      customMetadata: object.customMetadata,
      uploaded: object.uploaded,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(slice.slice());
          controller.close();
        }
      }),
      arrayBuffer: async () => slice.slice().buffer,
      text: async () => new TextDecoder().decode(slice),
      json: async () => JSON.parse(new TextDecoder().decode(slice))
    };
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream | null,
    options?: {
      onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    }
  ): Promise<{ etag: string; size: number } | null> {
    const existing = this.objects.get(key);
    const onlyIf = options?.onlyIf;
    if (onlyIf) {
      if (onlyIf.etagMatches !== undefined) {
        if (!existing || existing.etag !== onlyIf.etagMatches) return null;
      }
      if (onlyIf.etagDoesNotMatch === '*' && existing) return null;
    }

    let bytes: Uint8Array;
    if (typeof value === 'string') {
      bytes = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else if (ArrayBuffer.isView(value)) {
      bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else if (value && typeof (value as Blob).arrayBuffer === 'function') {
      bytes = new Uint8Array(await (value as Blob).arrayBuffer());
    } else if (value && typeof (value as ReadableStream).getReader === 'function') {
      const reader = (value as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        if (chunk) chunks.push(chunk);
      }
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
    } else {
      bytes = new Uint8Array(0);
    }

    const etag = `etag-${++this.counter}`;
    this.objects.set(key, {
      bytes,
      etag,
      contentType: options?.httpMetadata?.contentType,
      customMetadata: options?.customMetadata,
      uploaded: new Date()
    });
    return { etag, size: bytes.length };
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.objects.delete(key);
    }
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }
}

export function asBucket(bucket: MockR2Bucket): R2Bucket {
  return bucket as unknown as R2Bucket;
}
