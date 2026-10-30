import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from '~/router/compat';
import NoteDialog, { type NoteDraft } from '../components/NoteDialog';
import { SelectButton } from 'primereact/selectbutton';
import { Sidebar } from 'primereact/sidebar';
import { Slider } from 'primereact/slider';
import type { Book } from '../api/types';
import { api, tokenStore } from '../api/client';
import { useProgressSaver } from './progress';
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
import { useReaderSettings, type CbxBackground, type CbxFitMode, type CbxViewMode } from './settings';
import {
  alignSpreadStart,
  clampPage,
  formatPercent,
  pagePercentage,
  preloadablePages,
  stepPage,
  visiblePages
} from './readerUtils';

const BACKGROUNDS: Record<CbxBackground, string> = {
  black: '#000000',
  gray: '#3f3f46',
  white: '#ffffff'
};

const VIEW_OPTIONS: { label: string; value: CbxViewMode }[] = [
  { label: 'Single', value: 'single' },
  { label: 'Spread', value: 'spread' }
];
const FIT_OPTIONS: { label: string; value: CbxFitMode }[] = [
  { label: 'Page', value: 'page' },
  { label: 'Width', value: 'width' }
];
const BACKGROUND_OPTIONS: { label: string; value: CbxBackground }[] = [
  { label: 'Black', value: 'black' },
  { label: 'Gray', value: 'gray' },
  { label: 'White', value: 'white' }
];
const DIRECTION_OPTIONS = [
  { label: 'Left to right', value: false },
  { label: 'Right to left', value: true }
];

/** Scroll surface holding the page image(s). */
function surfaceStyle(spread: boolean, fitWidth: boolean, background: string): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    overflow: 'auto',
    padding: 8,
    display: 'flex',
    alignItems: fitWidth ? 'flex-start' : 'center',
    justifyContent: 'center',
    gap: spread ? 8 : undefined,
    background
  };
}

/** One page image; sizing depends on single/spread and fit mode. */
function pageStyle(spread: boolean, fitWidth: boolean): CSSProperties {
  const base: CSSProperties = { display: 'block', maxWidth: '100%', objectFit: 'contain' };
  if (spread) {
    return {
      ...base,
      flex: '1 1 0',
      minWidth: 0,
      maxHeight: fitWidth ? 'none' : '100%',
      height: fitWidth ? 'auto' : undefined
    };
  }
  return fitWidth
    ? { ...base, maxHeight: 'none', width: '100%', height: 'auto' }
    : { ...base, maxHeight: '100%' };
}

export default function CbxReader({ book }: { book: Book }) {
  const navigate = useNavigate();
  const saver = useProgressSaver(book.id);
  const [settings, updateSettings] = useReaderSettings('cbx');

  const [pages, setPages] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(() => book.cbxProgress?.page ?? 1);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const total = pages?.length ?? 0;
  const spread = settings.viewMode === 'spread';

  // Fetch the page list once.
  useEffect(() => {
    let cancelled = false;
    api
      .get<number[]>(`/api/v1/cbx/${book.id}/pages`)
      .then(list => {
        if (!cancelled) setPages(list);
      })
      .catch(cause => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Failed to load pages');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  // Align the restored position to the current spread/direction parity.
  useEffect(() => {
    if (total <= 0) return;
    setCurrent(previous => {
      const clamped = clampPage(previous, total);
      return spread ? alignSpreadStart(clamped, settings.rtl) : clamped;
    });
  }, [total, spread, settings.rtl]);

  const shown = useMemo(
    () => visiblePages(current, total, spread, settings.rtl),
    [current, total, spread, settings.rtl]
  );

  const goTo = useCallback(
    (page: number) => {
      if (total <= 0) return;
      const next = clampPage(page, total);
      setCurrent(next);
      saver.save({
        cbxProgress: { page: next, percentage: pagePercentage(next, total) }
      });
    },
    [total, saver]
  );

  const goNext = useCallback(
    () => goTo(stepPage(current, 1, total, spread, settings.rtl)),
    [current, total, spread, settings.rtl, goTo]
  );

  const goPrev = useCallback(
    () => goTo(stepPage(current, -1, total, spread, settings.rtl)),
    [current, total, spread, settings.rtl, goTo]
  );

  const imageUrl = useCallback(
    (page: number) =>
      `/api/v1/media/book/${book.id}/cbx/pages/${page}?token=${encodeURIComponent(tokenStore.access ?? '')}`,
    [book.id]
  );

  // Warm the HTTP cache for nearby pages.
  useEffect(() => {
    if (total <= 0) return;
    for (const page of preloadablePages(current, total, spread, settings.rtl)) {
      const image = new Image();
      image.src = imageUrl(page);
    }
  }, [current, total, spread, settings.rtl, imageUrl]);

  // Keyboard + swipe navigation.
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || isFromDrawer(event)) return;
      if (total <= 0) return;
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          if (settings.rtl) goPrev();
          else goNext();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          if (settings.rtl) goNext();
          else goPrev();
          break;
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          event.preventDefault();
          goNext();
          break;
        case 'ArrowUp':
        case 'PageUp':
          event.preventDefault();
          goPrev();
          break;
        case 'Home':
          event.preventDefault();
          goTo(1);
          break;
        case 'End':
          event.preventDefault();
          goTo(total);
          break;
        case 'Escape':
          setSettingsOpen(false);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [total, settings.rtl, goNext, goPrev, goTo]);

  const onTouchStart = (event: React.TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = (event.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 60) return;
    const swipedForward = delta < 0; // dragged left -> next in LTR
    const forward = settings.rtl ? !swipedForward : swipedForward;
    if (forward) goNext();
    else goPrev();
  };

  const fitWidth = settings.fit === 'width';

  return (
    <ReaderRoot>
      <ReaderHeader
        title={book.metadata.title ?? book.fileName}
        subtitle={settings.rtl ? 'Right-to-left' : undefined}
        onBack={() => navigate(`/book/${book.id}`)}
        actions={
          <>
            <ReaderIconButton
              icon="pi-pencil"
              title="Add note"
              disabled={!pages}
              onClick={() =>
                setNoteDraft({
                  bookId: book.id,
                  location: String(current),
                  chapter: `Page ${current} of ${total}`,
                  percentage: total > 0 ? pagePercentage(current, total) : undefined
                })
              }
            />
            <ReaderIconButton
              icon="pi-cog"
              title="Reader settings"
              active={settingsOpen}
              onClick={() => setSettingsOpen(open => !open)}
            />
          </>
        }
      />

      <ReaderBody>
        <div
          style={surfaceStyle(spread, fitWidth, BACKGROUNDS[settings.background])}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {pages &&
            shown.map(page => (
              <img
                key={page}
                src={imageUrl(page)}
                alt={`Page ${page}`}
                draggable={false}
                style={pageStyle(spread, fitWidth)}
              />
            ))}
        </div>

        {!pages && !error ? <ReaderLoading label="Loading pages…" /> : null}
        {error ? (
          <ReaderMessage title="Could not open this comic">
            <p className="m-0">{error}</p>
          </ReaderMessage>
        ) : null}
      </ReaderBody>

      <Sidebar
        visible={settingsOpen}
        onHide={() => setSettingsOpen(false)}
        position="right"
        header="Reader settings"
        className="w-full md:w-20rem"
      >
        <div className="flex flex-column gap-4">
          <ReaderSetting label="Pages">
            <SelectButton
              value={settings.viewMode}
              options={VIEW_OPTIONS}
              allowEmpty={false}
              onChange={event => updateSettings({ viewMode: event.value as CbxViewMode })}
            />
          </ReaderSetting>
          <ReaderSetting label="Fit">
            <SelectButton
              value={settings.fit}
              options={FIT_OPTIONS}
              allowEmpty={false}
              onChange={event => updateSettings({ fit: event.value as CbxFitMode })}
            />
          </ReaderSetting>
          <ReaderSetting label="Background">
            <SelectButton
              value={settings.background}
              options={BACKGROUND_OPTIONS}
              allowEmpty={false}
              onChange={event => updateSettings({ background: event.value as CbxBackground })}
            />
          </ReaderSetting>
          <ReaderSetting label="Direction">
            <SelectButton
              value={settings.rtl}
              options={DIRECTION_OPTIONS}
              allowEmpty={false}
              onChange={event => updateSettings({ rtl: Boolean(event.value) })}
            />
          </ReaderSetting>
        </div>
      </Sidebar>

      <NoteDialog
        visible={noteDraft !== null}
        onHide={() => setNoteDraft(null)}
        draft={noteDraft ?? undefined}
        lockBook
      />

      <ReaderFooter>
        <ReaderIconButton
          icon={settings.rtl ? 'pi-chevron-right' : 'pi-chevron-left'}
          title="Previous page"
          tooltipPosition="top"
          disabled={!pages || current <= 1}
          onClick={goPrev}
        />
        <Slider
          className="flex-1 mx-2"
          value={current}
          min={1}
          max={Math.max(1, total)}
          disabled={!pages}
          onChange={event => setCurrent(event.value as number)}
          onSlideEnd={event => goTo(event.value as number)}
        />
        <ReaderIconButton
          icon={settings.rtl ? 'pi-chevron-left' : 'pi-chevron-right'}
          title="Next page"
          tooltipPosition="top"
          disabled={!pages || current >= total}
          onClick={goNext}
        />
        <span className="text-sm text-color-secondary white-space-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {total > 0 ? (
            <>
              Page <strong className="text-color">{current}</strong> / {total}
            </>
          ) : (
            '—'
          )}
        </span>
        <strong className="text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {total > 0 ? formatPercent(pagePercentage(current, total)) : '0%'}
        </strong>
      </ReaderFooter>
    </ReaderRoot>
  );
}
