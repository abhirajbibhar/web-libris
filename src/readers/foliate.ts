import type { EpubBookInfo } from '../api/types';

/**
 * Foliate ships as plain ES modules (copied from the Angular app's assets
 * into public/foliate). It registers the <foliate-view> custom element and
 * exposes makeStreamingBook on window, so we load it with a runtime <script
 * type="module"> exactly like the original does — no bundler involvement.
 */

export interface FoliateTocItem {
  label: string;
  href: string;
  subitems?: FoliateTocItem[];
}

export interface FoliateRelocateDetail {
  cfi?: string;
  fraction?: number;
  tocItem?: { label?: string; href?: string } | null;
  pageItem?: { label?: string; href?: string } | null;
}

export interface FoliateRenderer {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  setStyles(css: string): void;
}

export interface FoliateView extends HTMLElement {
  open(book: unknown): Promise<void>;
  close(): void;
  goTo(target: string | number): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  prev(): void;
  next(): void;
  readonly book?: {
    metadata?: { title?: string; language?: string };
    toc?: FoliateTocItem[];
  };
  readonly renderer?: FoliateRenderer;
}

declare global {
  interface Window {
    makeStreamingBook?: (
      bookId: number,
      baseUrl: string,
      bookInfo: EpubBookInfo,
      authToken: string | null,
      bookType?: string | null
    ) => Promise<unknown>;
  }
}

let foliateLoading: Promise<void> | null = null;

export function loadFoliate(): Promise<void> {
  if (typeof customElements !== 'undefined' && customElements.get('foliate-view')) {
    return Promise.resolve();
  }
  if (foliateLoading) return foliateLoading;

  foliateLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-booklore-foliate]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load the EPUB engine')));
      return;
    }
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/foliate/view.js';
    script.dataset.bookloreFoliate = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load the EPUB engine'));
    document.head.appendChild(script);
  })
    .then(
      () => customElements.whenDefined('foliate-view'),
      error => Promise.reject(error)
    )
    .then(() => undefined);

  return foliateLoading;
}

export function createFoliateView(container: HTMLElement): FoliateView {
  const view = document.createElement('foliate-view') as unknown as FoliateView;
  view.style.width = '100%';
  view.style.height = '100%';
  view.style.display = 'block';
  container.appendChild(view);
  return view;
}
