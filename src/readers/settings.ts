import { useCallback, useState } from 'react';

/**
 * Reader preferences live in localStorage (per browser/profile). The
 * backend keeps reading *progress*; how you like the page displayed is a
 * device-local concern.
 */

export type EpubTheme = 'light' | 'sepia' | 'dark' | 'night';
export type EpubFlow = 'paginated' | 'scrolled';
export type CbxViewMode = 'single' | 'spread';
export type CbxFitMode = 'width' | 'page';
export type CbxBackground = 'black' | 'gray' | 'white';
export type PdfFitMode = 'page' | 'width';

export interface EpubReaderSettings {
  theme: EpubTheme;
  fontSize: number; // px
  flow: EpubFlow;
  justify: boolean;
}

export interface CbxReaderSettings {
  viewMode: CbxViewMode;
  fit: CbxFitMode;
  background: CbxBackground;
  rtl: boolean;
}

export interface PdfReaderSettings {
  fit: PdfFitMode;
  zoom: number; // multiplier applied on top of the fit scale
}

export interface ReaderSettings {
  epub: EpubReaderSettings;
  cbx: CbxReaderSettings;
  pdf: PdfReaderSettings;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  epub: { theme: 'light', fontSize: 16, flow: 'paginated', justify: false },
  cbx: { viewMode: 'single', fit: 'page', background: 'gray', rtl: false },
  pdf: { fit: 'page', zoom: 1 }
};

const STORAGE_KEY = 'web-libris.reader.settings.v1';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Defaults merged with whatever is stored; corrupt data is discarded. */
export function loadReaderSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return DEFAULT_READER_SETTINGS;

    const readScope = <K extends keyof ReaderSettings>(scope: K): ReaderSettings[K] => {
      const stored = parsed[scope];
      const merged: ReaderSettings[K] = isObject(stored)
        ? ({ ...DEFAULT_READER_SETTINGS[scope], ...stored } as ReaderSettings[K])
        : DEFAULT_READER_SETTINGS[scope];
      return merged;
    };

    return {
      epub: readScope('epub'),
      cbx: readScope('cbx'),
      pdf: readScope('pdf')
    };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing / quota: preferences just do not persist.
  }
}

/** Stateful access to one settings scope; every change is persisted. */
export function useReaderSettings<K extends keyof ReaderSettings>(
  scope: K
): [ReaderSettings[K], (patch: Partial<ReaderSettings[K]>) => void] {
  const [settings, setSettings] = useState<ReaderSettings[K]>(
    () => loadReaderSettings()[scope]
  );

  const update = useCallback(
    (patch: Partial<ReaderSettings[K]>) => {
      setSettings(previous => {
        const next = { ...previous, ...patch } as ReaderSettings[K];
        saveReaderSettings({ ...loadReaderSettings(), [scope]: next });
        return next;
      });
    },
    [scope]
  );

  return [settings, update];
}
