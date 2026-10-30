import type { CSSProperties } from 'react';

/** Slim scrollbar that follows the active theme. Spread onto any scrolling element's `style`. */
export const THIN_SCROLL: CSSProperties = {
  scrollbarWidth: 'thin',
  scrollbarColor: 'var(--surface-400) transparent'
};
