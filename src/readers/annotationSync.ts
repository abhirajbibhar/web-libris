/**
 * Pure helpers for syncing PDF annotations to the `<book>.annotation.json`
 * sidecar. No viewer imports here, so everything is unit-testable.
 */

/* ------------------------------ shapes ------------------------------ */

export interface Rect {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}

/** The slice of the viewer's annotation object this module relies on. */
export interface AnnotationLike {
  id: string;
  type: number;
  pageIndex: number;
  rect: Rect;
  contents?: string;
  segmentRects?: Rect[];
  strokeColor?: string;
  color?: string;
  fontColor?: string;
  created?: Date | string;
  modified?: Date | string;
}

export interface TransferItem {
  annotation: AnnotationLike;
  ctx?: unknown;
}

export interface TextRun {
  content: string;
  rect: Rect;
  font?: { size?: number };
}

export type HighlightKind = 'highlight' | 'underline' | 'squiggly' | 'note' | 'text';

export interface SidecarHighlight {
  id: string;
  kind: HighlightKind;
  page: number;
  text: string;
  comment: string;
  color?: string;
  createdAt?: string;
}

/** PdfAnnotationSubtype values (from @embedpdf/models) that we care about. */
export const SUBTYPE = {
  TEXT: 1,
  FREETEXT: 3,
  HIGHLIGHT: 9,
  UNDERLINE: 10,
  SQUIGGLY: 11,
  STRIKEOUT: 12
} as const;

/** Annotations a reader creates. Links, widgets and popups belong to the PDF itself. */
const USER_TYPES = new Set([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15]);
export const isUserAnnotation = (item: TransferItem): boolean => USER_TYPES.has(item.annotation.type);

/* ------------------------- JSON-safe encoding ------------------------- */

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), c => c.charCodeAt(0));

/** Annotation objects hold Dates and (for stamps) binary buffers; JSON would flatten both. */
export function encode(value: unknown): unknown {
  const replacer = function (this: Record<string, unknown>, key: string, v: unknown) {
    const raw = this[key];
    if (raw instanceof Date) return { $date: Number.isNaN(raw.getTime()) ? null : raw.toISOString() };
    if (raw instanceof ArrayBuffer) return { $b64: toBase64(new Uint8Array(raw)), $t: 'ArrayBuffer' };
    if (ArrayBuffer.isView(raw)) {
      const view = raw as ArrayBufferView;
      return { $b64: toBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)), $t: 'Uint8Array' };
    }
    return v;
  };
  return JSON.parse(JSON.stringify(value, replacer));
}

export function decode<T = unknown>(plain: unknown): T {
  const reviver = (_key: string, v: unknown) => {
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('$date' in o && Object.keys(o).length === 1) return o.$date === null ? undefined : new Date(o.$date as string);
      if (typeof o.$b64 === 'string') {
        const bytes = fromBase64(o.$b64);
        return o.$t === 'ArrayBuffer' ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
      }
    }
    return v;
  };
  return JSON.parse(JSON.stringify(plain), reviver) as T;
}

/* --------------------------- change detection --------------------------- */

const VOLATILE = new Set(['created', 'modified']);

/**
 * Order-independent fingerprint that ignores timestamps the viewer may touch
 * on its own, so re-importing what we saved never looks like a change.
 */
export function signature(items: TransferItem[]): string {
  const strip = (_k: string, v: unknown) => (VOLATILE.has(_k) ? undefined : v);
  const rows = (encode(items) as TransferItem[]).map(item => JSON.stringify(item, strip));
  return rows.sort().join('\n');
}

/** Everything in `remote` whose id isn't already in `local` (used to merge after a conflict). */
export function missingFrom(local: TransferItem[], remote: TransferItem[]): TransferItem[] {
  const have = new Set(local.map(i => i.annotation.id));
  return remote.filter(i => !have.has(i.annotation.id));
}

/* ---------------------------- text extraction ---------------------------- */

const isoOrUndefined = (value: Date | string | undefined): string | undefined => {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

const overlap1d = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * The text of the runs a highlight covers, in reading order.
 *
 * Assumes left-to-right horizontal text (the common case). A run that is only
 * partly covered is cut proportionally to its width, then widened to whole
 * words, since highlights almost always start and end on word edges.
 */
export function textInRects(segments: Rect[], runs: TextRun[]): string {
  const lines: string[] = [];

  for (const seg of segments) {
    const segLeft = seg.origin.x;
    const segRight = seg.origin.x + seg.size.width;
    const segTop = seg.origin.y;
    const segBottom = seg.origin.y + seg.size.height;

    const hits: { left: number; right: number; text: string; size: number }[] = [];
    for (const run of runs) {
      const r = run.rect;
      if (!run.content || r.size.width <= 0 || r.size.height <= 0) continue;
      const rLeft = r.origin.x;
      const rRight = r.origin.x + r.size.width;
      // Must sit on this line: at least half the run's height inside the segment.
      const vertical = overlap1d(segTop, segBottom, r.origin.y, r.origin.y + r.size.height) / r.size.height;
      if (vertical < 0.5) continue;
      const covered = overlap1d(segLeft, segRight, rLeft, rRight) / r.size.width;
      if (covered < 0.05) continue;

      let text = run.content;
      if (covered < 0.98) {
        const from = Math.max(segLeft, rLeft);
        const to = Math.min(segRight, rRight);
        let start = Math.floor(((from - rLeft) / r.size.width) * text.length);
        let end = Math.ceil(((to - rLeft) / r.size.width) * text.length);
        while (start > 0 && !/\s/.test(text[start - 1])) start--;
        while (end < text.length && !/\s/.test(text[end])) end++;
        text = text.slice(start, end);
      }
      hits.push({ left: rLeft, right: rRight, text, size: run.font?.size ?? r.size.height });
    }

    hits.sort((a, b) => a.left - b.left);
    let line = '';
    let prevRight: number | null = null;
    for (const hit of hits) {
      const gap = prevRight === null ? 0 : hit.left - prevRight;
      const needsSpace = line && !/\s$/.test(line) && !/^\s/.test(hit.text) && gap > hit.size * 0.15;
      line += (needsSpace ? ' ' : '') + hit.text;
      prevRight = hit.right;
    }
    if (line.trim()) lines.push(line.trim());
  }

  // Join lines; undo a hyphen that only exists because the word wrapped.
  let out = '';
  for (const line of lines) {
    if (!out) out = line;
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(line)) out = out.slice(0, -1) + line;
    else out += ' ' + line;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/* --------------------------- highlight building --------------------------- */

const KIND_BY_TYPE: Record<number, HighlightKind> = {
  [SUBTYPE.HIGHLIGHT]: 'highlight',
  [SUBTYPE.UNDERLINE]: 'underline',
  [SUBTYPE.SQUIGGLY]: 'squiggly',
  [SUBTYPE.TEXT]: 'note',
  [SUBTYPE.FREETEXT]: 'text'
};

export const isMarkup = (type: number) => type === SUBTYPE.HIGHLIGHT || type === SUBTYPE.UNDERLINE || type === SUBTYPE.SQUIGGLY;

/** Cache key: the same annotation in the same place has the same text. */
export const textKey = (a: AnnotationLike) =>
  `${a.id}|${a.pageIndex}|${(a.segmentRects ?? []).map(r => `${r.origin.x},${r.origin.y},${r.size.width},${r.size.height}`).join(';')}`;

/**
 * Readable highlight list for the sidecar. `textFor` resolves the marked-up
 * passage (extracting it from the page when it isn't cached yet).
 */
export function buildHighlights(
  items: TransferItem[],
  textFor: (annotation: AnnotationLike) => string
): SidecarHighlight[] {
  const out: SidecarHighlight[] = [];
  for (const { annotation: a } of items) {
    const kind = KIND_BY_TYPE[a.type];
    if (!kind) continue; // strikeout, ink, shapes… stay in `annotations` only
    out.push({
      id: a.id,
      kind,
      page: a.pageIndex + 1,
      text: isMarkup(a.type) ? textFor(a) : '',
      comment: (a.contents ?? '').trim(),
      color: a.strokeColor ?? a.color ?? a.fontColor,
      createdAt: isoOrUndefined(a.created)
    });
  }
  return out.sort((x, y) => x.page - y.page);
}
