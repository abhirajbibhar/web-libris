/** Height shared by the sidebar brand block and the topbar so their bottom borders align. */
export const TOPBAR_HEIGHT = '4rem';

/** A PrimeReact Toolbar flattened into a full-width bar with only a bottom divider. */
export const FLAT_BAR_CLASS =
  'surface-card surface-border border-noround border-top-none border-left-none border-right-none border-bottom-1';

/** Mask for mobile drawers so they open beneath the topbar instead of covering it. */
export const BELOW_TOPBAR_MASK = {
  top: TOPBAR_HEIGHT,
  height: `calc(100% - ${TOPBAR_HEIGHT})`
} as const;
