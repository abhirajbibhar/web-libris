import type { TooltipOptions } from 'primereact/tooltip/tooltipoptions';

/**
 * Tooltip props for a PrimeReact Button, only on devices that can really hover.
 * On touch screens a tap leaves the tooltip stuck open and it can push past the
 * screen edge, so there the button simply gets no tooltip (it keeps its aria-label).
 */
export function tip(
  label: string,
  position: TooltipOptions['position'] = 'top'
): { tooltip?: string; tooltipOptions?: TooltipOptions } {
  if (typeof window === 'undefined' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    return {};
  }
  return { tooltip: label, tooltipOptions: { position, showDelay: 400, hideDelay: 0 } };
}
