import type { AnnotationPlugin, DocumentManagerPlugin, PluginRegistry } from '@embedpdf/react-pdf-viewer';
import { ApiError, api } from '../api/client';
import {
  buildHighlights,
  decode,
  encode,
  isMarkup,
  isUserAnnotation,
  missingFrom,
  signature,
  textInRects,
  textKey,
  type AnnotationLike,
  type SidecarHighlight,
  type TextRun,
  type TransferItem
} from './annotationSync';

export type SyncStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

interface Sidecar {
  updatedAt: string | null;
  pageCount?: number;
  annotations: unknown[];
  highlights: SidecarHighlight[];
}

const SAVE_DELAY_MS = 1500;
const SETTLE_MS = 1200;
const MAX_CONFLICT_RETRIES = 3;

/**
 * Keeps a PDF's annotations in `<book>.annotation.json` next to the book:
 * loads them into the viewer when it opens, and saves (debounced) when they change.
 *
 * Safety rules: nothing is ever saved until the existing file has been read
 * successfully (so a failed load can't overwrite it with an empty one), and a
 * save based on an out-of-date copy is merged, never blindly overwritten.
 *
 * Returns a function that detaches everything.
 */
export function attachAnnotationSync(
  registry: PluginRegistry,
  bookId: number,
  onStatus: (status: SyncStatus) => void
): () => void {
  const annotation = registry.getPlugin<AnnotationPlugin>('annotation')?.provides();
  const docs = registry.getPlugin<DocumentManagerPlugin>('document-manager')?.provides();
  if (!annotation || !docs) return () => undefined;

  const path = `/api/v1/books/${bookId}/annotations`;
  let disposed = false;
  let started = false;
  let phase: 'waiting' | 'importing' | 'live' = 'waiting';
  let base: string | null = null; // version of the file we last saw
  let lastSig = '';
  let native = new Set<string>(); // annotations that belong to the PDF itself
  const imported = new Set<string>();
  const textCache = new Map<string, string>();
  let timer: number | undefined;
  let saving = false;
  let again = false;
  let touched = false;
  let conflicts = 0;

  const pageCount = () => docs.getActiveDocument()?.pages.length;

  const currentItems = async (): Promise<TransferItem[]> => {
    const all = (await annotation.exportAnnotations().toPromise()) as unknown as TransferItem[];
    return all.filter(i => isUserAnnotation(i) && !native.has(i.annotation.id));
  };

  /** Fill the text cache for markup annotations on the pages that need it. */
  const fillTexts = async (items: TransferItem[]) => {
    const doc = docs.getActiveDocument();
    if (!doc) return;
    const wanted = items.filter(i => isMarkup(i.annotation.type) && !textCache.has(textKey(i.annotation)));
    const pages = [...new Set(wanted.map(i => i.annotation.pageIndex))];
    for (const pageIndex of pages) {
      const page = doc.pages[pageIndex];
      if (!page) continue;
      try {
        const runs = (await registry.getEngine().getPageTextRects(doc, page).toPromise()) as unknown as TextRun[];
        for (const { annotation: a } of wanted.filter(i => i.annotation.pageIndex === pageIndex)) {
          const segments = a.segmentRects?.length ? a.segmentRects : [a.rect];
          textCache.set(textKey(a), textInRects(segments, runs));
        }
      } catch {
        // Leave uncached; the next save tries again.
      }
    }
  };

  const save = async (): Promise<void> => {
    if (disposed || phase !== 'live') return;
    if (saving) {
      again = true;
      return;
    }
    saving = true;
    try {
      const items = await currentItems();
      const sig = signature(items);
      if (sig === lastSig) return;
      onStatus('saving');
      await fillTexts(items);
      const highlights = buildHighlights(items, (a: AnnotationLike) => textCache.get(textKey(a)) ?? '');
      try {
        const saved = await api.put<Sidecar>(path, {
          baseUpdatedAt: base,
          pageCount: pageCount(),
          annotations: encode(items),
          highlights
        });
        base = saved.updatedAt;
        lastSig = sig;
        conflicts = 0;
        onStatus('saved');
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        // Another device saved first: pull its version, add what we lack, save again.
        if (++conflicts > MAX_CONFLICT_RETRIES) throw error;
        const remote = await api.get<Sidecar>(path);
        const missing = missingFrom(items, decode<TransferItem[]>(remote.annotations)).filter(
          i => !native.has(i.annotation.id)
        );
        base = remote.updatedAt;
        if (missing.length > 0) {
          for (const i of missing) imported.add(i.annotation.id);
          annotation.importAnnotations(missing as never);
        }
        again = true;
      }
    } catch {
      onStatus('error');
    } finally {
      saving = false;
      if (again && !disposed) {
        again = false;
        schedule(300);
      }
    }
  };

  const schedule = (delay = SAVE_DELAY_MS) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void save(), delay);
  };

  const start = async () => {
    if (started || disposed) return;
    started = true;
    phase = 'importing';
    onStatus('loading');
    native = new Set(annotation.getAnnotations().map(t => t.object.id));
    try {
      const remote = await api.get<Sidecar>(path);
      base = remote.updatedAt;
      const stored = decode<TransferItem[]>(remote.annotations).filter(i => !native.has(i.annotation.id));
      if (stored.length > 0) {
        for (const i of stored) imported.add(i.annotation.id);
        annotation.importAnnotations(stored as never);
      }
    } catch {
      // Could not read the saved file: stay read-only rather than risk overwriting it.
      phase = 'waiting';
      onStatus('error');
      return;
    }
    // Let the viewer finish applying the import (it echoes create events), then
    // take that state as the baseline so opening a book never triggers a save.
    window.setTimeout(async () => {
      if (disposed) return;
      lastSig = signature(await currentItems().catch(() => []));
      phase = 'live';
      onStatus('idle');
      if (touched) {
        lastSig = '';
        schedule(0);
      }
    }, SETTLE_MS);
  };

  const off = annotation.onAnnotationEvent(event => {
    if (event.type === 'loaded') {
      window.clearTimeout(fallback);
      void start();
      return;
    }
    if (phase === 'waiting') return;
    const id = event.annotation.id;
    if (phase === 'importing') {
      // Echoes of our own import are not user edits.
      if (!(event.type === 'create' && imported.has(id))) touched = true;
      return;
    }
    if (native.has(id)) return;
    schedule();
  });

  // The 'loaded' event normally starts us; this covers attaching after it fired.
  const fallback = window.setTimeout(() => void start(), docs.getActiveDocument() ? SETTLE_MS : 6000);

  const flush = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
      void save();
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flush);

  return () => {
    flush();
    disposed = true;
    window.clearTimeout(fallback);
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flush);
    off();
  };
}
