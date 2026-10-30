import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '~/router/compat';
import { Button } from 'primereact/button';
import { InputNumber } from 'primereact/inputnumber';
import { SelectButton } from 'primereact/selectbutton';
import { Sidebar } from 'primereact/sidebar';
import { Slider } from 'primereact/slider';
import NoteDialog, { type NoteDraft } from '../components/NoteDialog';
import { Tree, type TreeExpandedKeysType } from 'primereact/tree';
import type { TreeNode } from 'primereact/treenode';
import type { Book, EpubBookInfo } from '../api/types';
import { api, tokenStore } from '../api/client';
import { useProgressSaver } from './progress';
import { EPUB_THEMES, generateEpubCss } from './epubStyles';
import {
  createFoliateView,
  loadFoliate,
  type FoliateRelocateDetail,
  type FoliateTocItem,
  type FoliateView
} from './foliate';
import {
  isFromDrawer,
  ReaderBody,
  ReaderFooter,
  ReaderHeader,
  ReaderIconButton,
  ReaderLoading,
  ReaderMessage,
  ReaderRoot,
  ReaderSetting
} from './ReaderChrome';
import { useReaderSettings, type EpubFlow, type EpubTheme } from './settings';
import { formatPercent } from './readerUtils';

interface PositionState {
  cfi?: string;
  percentage: number;
  chapter?: string;
}

const THEME_OPTIONS: { label: string; value: EpubTheme }[] = [
  { label: 'Light', value: 'light' },
  { label: 'Sepia', value: 'sepia' },
  { label: 'Dark', value: 'dark' },
  { label: 'Night', value: 'night' }
];
const FLOW_OPTIONS: { label: string; value: EpubFlow }[] = [
  { label: 'Paginated', value: 'paginated' },
  { label: 'Scrolled', value: 'scrolled' }
];
const ALIGN_OPTIONS = [
  { label: 'Left', value: false },
  { label: 'Justify', value: true }
];

function toTreeNodes(items: FoliateTocItem[], prefix = ''): TreeNode[] {
  return items.map((item, index) => {
    const key = `${prefix}${index}`;
    return {
      key,
      label: item.label,
      data: item.href,
      children: item.subitems && item.subitems.length > 0 ? toTreeNodes(item.subitems, `${key}-`) : undefined
    };
  });
}

function collectKeys(nodes: TreeNode[], into: TreeExpandedKeysType = {}): TreeExpandedKeysType {
  for (const node of nodes) {
    if (node.children && node.children.length > 0 && node.key !== undefined) {
      into[String(node.key)] = true;
      collectKeys(node.children, into);
    }
  }
  return into;
}

export default function EbookReader({ book }: { book: Book }) {
  const navigate = useNavigate();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const saver = useProgressSaver(book.id);
  const [settings, updateSettings] = useReaderSettings('epub');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toc, setToc] = useState<FoliateTocItem[]>([]);
  const [position, setPosition] = useState<PositionState>({ percentage: 0 });
  const [scrub, setScrub] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  // Last passage the reader selected in the book; offered as the quote for a new note.
  const selectionRef = useRef('');

  /** Push theme/size/flow into the foliate renderer. */
  const applyStyles = useCallback(() => {
    const renderer = viewRef.current?.renderer;
    if (!renderer) return;
    if (typeof renderer.setStyles === 'function') {
      renderer.setStyles(generateEpubCss(settings));
    }
    renderer.setAttribute('flow', settings.flow);
    if (settings.flow === 'paginated') renderer.setAttribute('margin', '40px');
    else renderer.removeAttribute('margin');
  }, [settings]);

  // Keep the latest applyStyles in a ref (the load effect attaches a
  // 'load' listener once) and re-apply whenever settings change.
  const applyStylesRef = useRef(applyStyles);
  useEffect(() => {
    applyStylesRef.current = applyStyles;
    applyStyles();
  }, [applyStyles]);

  useEffect(() => {
    const container = surfaceRef.current;
    if (!container) return;
    let cancelled = false;

    const handleRelocate = (detail: FoliateRelocateDetail) => {
      const fraction = detail.fraction;
      const cfi = detail.cfi;
      const percentage =
        typeof fraction === 'number'
          ? Math.min(100, Math.max(0, Math.round(fraction * 1000) / 10))
          : undefined;

      selectionRef.current = '';
      setPosition({
        cfi,
        percentage: percentage ?? 0,
        chapter: detail.tocItem?.label ?? undefined
      });

      if (cfi && percentage !== undefined) {
        saver.save({ epubProgress: { cfi, percentage } });
      }
    };

    (async () => {
      try {
        await loadFoliate();
        const info = await api.get<EpubBookInfo>(`/api/v1/epub/${book.id}/info`);
        if (cancelled) return;

        const view = createFoliateView(container);
        viewRef.current = view;

        const onRelocate = (event: Event) =>
          handleRelocate((event as CustomEvent<FoliateRelocateDetail>).detail ?? {});
        const onLoad = (event: Event) => {
          applyStylesRef.current();
          const doc = (event as CustomEvent<{ doc?: Document }>).detail?.doc;
          doc?.addEventListener('selectionchange', () => {
            const text = doc.getSelection()?.toString().trim();
            if (text) selectionRef.current = text.slice(0, 5000);
          });
        };
        view.addEventListener('relocate', onRelocate);
        view.addEventListener('load', onLoad);

        const makeStreamingBook = window.makeStreamingBook;
        if (!makeStreamingBook) throw new Error('EPUB engine failed to initialise');

        const epub = await makeStreamingBook(book.id, '/api/v1/epub', info, tokenStore.access);
        if (cancelled) {
          view.removeEventListener('relocate', onRelocate);
          view.removeEventListener('load', onLoad);
          view.close();
          view.remove();
          viewRef.current = null;
          return;
        }

        await view.open(epub);

        // Resume where the last session stopped.
        const progress = book.epubProgress;
        try {
          if (progress?.cfi) await view.goTo(progress.cfi);
          else if (progress?.percentage && progress.percentage > 0) {
            await view.goToFraction(progress.percentage / 100);
          } else {
            await view.goTo(0);
          }
        } catch {
          // A saved position may no longer resolve (file edited); start over.
        }
        if (cancelled) return;

        setToc(view.book?.toc ?? []);
        applyStylesRef.current();
        setLoading(false);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Failed to open the book');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      const view = viewRef.current;
      viewRef.current = null;
      if (view) {
        view.close();
        view.remove();
      }
    };
    // Deliberately keyed on book.id only: the load effect must run once;
    // saver.save and applyStylesRef already track the latest closures.
  }, [book.id]);

  // Keyboard navigation.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const view = viewRef.current;
      if (!view) return;
      if (event.target instanceof HTMLInputElement || isFromDrawer(event)) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        view.next();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        view.prev();
      } else if (event.key === 'Escape') {
        setTocOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const goToTocItem = (href: string) => {
    setTocOpen(false);
    void viewRef.current?.goTo(href).catch(() => undefined);
  };

  const tocNodes = useMemo(() => toTreeNodes(toc), [toc]);
  const [expandedKeys, setExpandedKeys] = useState<TreeExpandedKeysType>({});
  useEffect(() => {
    setExpandedKeys(collectKeys(tocNodes));
  }, [tocNodes]);

  const displayedPercent = scrub ?? Math.round(position.percentage);

  return (
    <ReaderRoot>
      <ReaderHeader
        title={book.metadata.title ?? book.fileName}
        subtitle={position.chapter}
        onBack={() => navigate(`/book/${book.id}`)}
        actions={
          <>
            <ReaderIconButton
              icon="pi-pencil"
              title="Add note or highlight"
              disabled={loading}
              onClick={() =>
                setNoteDraft({
                  bookId: book.id,
                  quote: selectionRef.current,
                  location: position.cfi,
                  chapter: position.chapter,
                  percentage: position.percentage
                })
              }
            />
            <ReaderIconButton
              icon="pi-list"
              title="Table of contents"
              active={tocOpen}
              onClick={() => setTocOpen(open => !open)}
              disabled={loading || toc.length === 0}
            />
            <ReaderIconButton
              icon="pi-cog"
              title="Reader settings"
              active={settingsOpen}
              onClick={() => setSettingsOpen(open => !open)}
              disabled={loading}
            />
          </>
        }
      />

      <ReaderBody>
        <div
          ref={surfaceRef}
          className="absolute top-0 left-0 w-full h-full"
          style={{ background: EPUB_THEMES[settings.theme].bg }}
        />

        {loading ? <ReaderLoading label="Opening book…" /> : null}
        {error ? (
          <ReaderMessage title="Could not open this book">
            <p className="m-0">{error}</p>
          </ReaderMessage>
        ) : null}
      </ReaderBody>

      <Sidebar
        visible={tocOpen}
        onHide={() => setTocOpen(false)}
        position="left"
        header="Contents"
        className="w-full md:w-24rem"
      >
        <Tree
          value={tocNodes}
          expandedKeys={expandedKeys}
          onToggle={event => setExpandedKeys(event.value)}
          filter
          filterMode="lenient"
          filterPlaceholder="Search contents"
          className="border-none p-0"
          nodeTemplate={node => (
            <Button
              type="button"
              label={node.label}
              text
              severity="secondary"
              className="p-0 text-left justify-content-start"
              onClick={() => goToTocItem(String(node.data))}
            />
          )}
        />
      </Sidebar>

      <Sidebar
        visible={settingsOpen}
        onHide={() => setSettingsOpen(false)}
        position="right"
        header="Reader settings"
        className="w-full md:w-20rem"
      >
        <div className="flex flex-column gap-4">
          <ReaderSetting label="Theme">
            <SelectButton
              value={settings.theme}
              options={THEME_OPTIONS}
              allowEmpty={false}
              onChange={event => updateSettings({ theme: event.value as EpubTheme })}
            />
          </ReaderSetting>
          <ReaderSetting label="Font size">
            <InputNumber
              value={settings.fontSize}
              onValueChange={event => {
                if (event.value != null) updateSettings({ fontSize: event.value });
              }}
              min={10}
              max={32}
              suffix=" px"
              showButtons
              buttonLayout="horizontal"
              className="w-full"
              inputClassName="w-full text-center"
              aria-label="Font size"
            />
          </ReaderSetting>
          <ReaderSetting label="Layout">
            <SelectButton
              value={settings.flow}
              options={FLOW_OPTIONS}
              allowEmpty={false}
              onChange={event => updateSettings({ flow: event.value as EpubFlow })}
            />
          </ReaderSetting>
          <ReaderSetting label="Alignment">
            <SelectButton
              value={settings.justify}
              options={ALIGN_OPTIONS}
              allowEmpty={false}
              onChange={event => updateSettings({ justify: Boolean(event.value) })}
            />
          </ReaderSetting>
        </div>
      </Sidebar>

      <NoteDialog
        visible={noteDraft !== null}
        onHide={() => setNoteDraft(null)}
        draft={noteDraft ?? undefined}
        lockBook
        onSaved={() => {
          selectionRef.current = '';
        }}
      />

      <ReaderFooter>
        <ReaderIconButton
          icon="pi-chevron-left"
          title="Previous page"
          tooltipPosition="top"
          disabled={loading}
          onClick={() => viewRef.current?.prev()}
        />
        <Slider
          className="flex-1 mx-2"
          value={displayedPercent}
          min={0}
          max={100}
          disabled={loading}
          onChange={event => setScrub(event.value as number)}
          onSlideEnd={event => {
            const target = event.value as number;
            setScrub(null);
            void viewRef.current?.goToFraction(target / 100).catch(() => undefined);
          }}
        />
        <ReaderIconButton
          icon="pi-chevron-right"
          title="Next page"
          tooltipPosition="top"
          disabled={loading}
          onClick={() => viewRef.current?.next()}
        />
        <strong className="text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatPercent(position.percentage)}
        </strong>
      </ReaderFooter>
    </ReaderRoot>
  );
}
