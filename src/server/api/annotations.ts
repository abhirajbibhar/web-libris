import type { NoteColor } from './userData';

export type HighlightKind = 'highlight' | 'underline' | 'squiggly' | 'note' | 'text';
export const HIGHLIGHT_KINDS: readonly HighlightKind[] = ['highlight', 'underline', 'squiggly', 'note', 'text'];

/** Human-readable view of one annotation, derived by the reader when it saves. */
export interface SidecarHighlight {
  id: string;
  kind: HighlightKind;
  /** 1-based page number. */
  page: number;
  /** The marked-up passage (empty for sticky notes). */
  text: string;
  /** The reader's own comment. */
  comment: string;
  color?: string;
  createdAt?: string;
}

/** `<book file name>.annotation.json` */
export interface AnnotationSidecar {
  schemaVersion: 1;
  bookId: number;
  fileName: string;
  /** Version token: the save time. null = no sidecar yet. */
  updatedAt: string | null;
  pageCount?: number;
  /** Viewer-native annotation objects, opaque to the server; fed back into the viewer on open. */
  annotations: unknown[];
  highlights: SidecarHighlight[];
}

export const MAX_SIDECAR_BYTES = 5 * 1024 * 1024;

export const emptySidecar = (bookId: number, fileName: string): AnnotationSidecar => ({
  schemaVersion: 1,
  bookId,
  fileName,
  updatedAt: null,
  annotations: [],
  highlights: []
});

/** Clean one highlight from untrusted input; null when unusable. */
export function cleanHighlight(raw: unknown): SidecarHighlight | null {
  const h = (raw ?? {}) as Record<string, unknown>;
  if (typeof h.id !== 'string' || !h.id || h.id.length > 200) return null;
  if (!(HIGHLIGHT_KINDS as readonly unknown[]).includes(h.kind)) return null;
  const page = Number(h.page);
  if (!Number.isInteger(page) || page < 1) return null;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    id: h.id,
    kind: h.kind as HighlightKind,
    page,
    text: str(h.text, 5000).trim(),
    comment: str(h.comment, 5000).trim(),
    color: typeof h.color === 'string' && h.color.length <= 40 ? h.color : undefined,
    createdAt: typeof h.createdAt === 'string' && !Number.isNaN(Date.parse(h.createdAt)) ? h.createdAt : undefined
  };
}

/** Snap a CSS hex colour to the nearest of the app's note colours by hue. */
export function nearestNoteColor(color: string | undefined): NoteColor {
  const m = color?.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return 'yellow';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.08) return 'yellow';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 20 || h >= 330) return 'pink';
  if (h < 70) return 'yellow';
  if (h < 170) return 'green';
  if (h < 260) return 'blue';
  return 'purple';
}
