import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PDFViewer,
  type PDFViewerConfig,
  type PluginRegistry,
  type ScrollPlugin
} from '@embedpdf/react-pdf-viewer';
import { Tag } from 'primereact/tag';
import { fileUrl, type Book } from '../api/types';
import { tokenStore } from '../api/client';
import { attachAnnotationSync, type SyncStatus } from './annotationController';
import { useProgressSaver } from './progress';
import { clampPage, pagePercentage } from './readerUtils';
import wasmUrl from './pdfiumWasm';
import { useTheme } from '../theme/ThemeContext';

/**
 * PDF reader built on EmbedPDF. It fills the app layout (below the topbar,
 * beside the sidebar) rather than covering the viewport, so its route lives
 * under <AppLayout /> (see App.tsx).
 */
export default function PdfReader({ book }: { book: Book }) {
  const saver = useProgressSaver(book.id);
  const { mode } = useTheme();
  const startPage = book.pdfProgress?.page ?? 1;

  // Highlights and notes are saved beside the book as `<file name>.annotation.json`.
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const detach = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      detach.current?.();
      detach.current = null;
    },
    []
  );
  useEffect(() => {
    if (syncStatus !== 'saved') return;
    const t = window.setTimeout(() => setSyncStatus('idle'), 2500);
    return () => window.clearTimeout(t);
  }, [syncStatus]);

  // The config object is read once when the viewer mounts. PdfReader is keyed
  // by book id (see ReaderPage), so a new book always gets a fresh viewer.
  // Switching the app theme while a PDF is open takes effect on the next open.
  const config = useMemo<PDFViewerConfig>(() => {
    const token = tokenStore.access;
    return {
      wasmUrl,
      // Follows the app theme at the time the book is opened.
      theme: { preference: mode },
      tabBar: 'never',
      // Hide these toolbar tabs / menu entries (and the features behind them).
      disabledCategories: [
        'document-open',
        'document-close',
        'document-print',
        'document-protect',
        'security',
        'mode-shapes',
        'mode-insert',
        'mode-form',
        'mode-redact',
        'insert',
        'form',
        'redaction'
      ],
      documentManager: {
        initialDocuments: [
          {
            url: fileUrl(book.id),
            name: book.fileName,
            // Our file endpoint is range-capable and needs the bearer token.
            requestOptions: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
          }
        ]
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  const handleReady = (registry: PluginRegistry) => {
    detach.current?.();
    detach.current = attachAnnotationSync(registry, book.id, setSyncStatus);

    const scroll = registry.getPlugin<ScrollPlugin>('scroll')?.provides();
    if (!scroll) return;

    // Restore the saved page once the first layout is ready.
    scroll.onLayoutReady(event => {
      if (!event.isInitial) return;
      const target = clampPage(startPage, event.totalPages);
      if (target > 1) scroll.scrollToPage({ pageNumber: target, behavior: 'instant' });
    });

    // Persist progress (debounced inside the saver) as the page changes.
    scroll.onPageChange(event => {
      saver.save({
        pdfProgress: {
          page: event.pageNumber,
          percentage: pagePercentage(event.pageNumber, event.totalPages)
        }
      });
    });
  };

  return (
    <div className="flex flex-column flex-1 min-h-0 surface-card relative">
      {syncStatus !== 'idle' && (
        <div className="absolute" style={{ right: 12, bottom: 12, zIndex: 20, pointerEvents: 'none' }} role="status" aria-live="polite">
          <Tag
            icon={syncStatus === 'saved' ? 'pi pi-check' : syncStatus === 'error' ? 'pi pi-exclamation-triangle' : 'pi pi-spin pi-spinner'}
            severity={syncStatus === 'error' ? 'danger' : syncStatus === 'saved' ? 'success' : 'info'}
            value={
              syncStatus === 'saved' ? 'Annotations saved' : syncStatus === 'error' ? 'Annotations not saved' : syncStatus === 'loading' ? 'Loading annotations' : 'Saving annotations'
            }
          />
        </div>
      )}
      <PDFViewer config={config} style={{ width: '100%', height: '100%', flex: '1 1 auto', minHeight: 0 }} onReady={handleReady} />
    </div>
  );
}
