import type { ReactNode } from 'react';
import { Button } from 'primereact/button';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Toolbar } from 'primereact/toolbar';
import { tip } from '../utils/tooltip';
import { FLAT_BAR_CLASS } from '../layout/constants';

/** Fullscreen reader frame: covers the whole viewport above the app layout. */
export function ReaderRoot({ children }: { children: ReactNode }) {
  return (
    <div className="fixed top-0 left-0 w-full h-full flex flex-column z-5 surface-ground text-color">
      {children}
    </div>
  );
}

/** Positioned area between the header and footer; children are laid out absolutely. */
export function ReaderBody({ children }: { children: ReactNode }) {
  return <div className="relative flex flex-1 min-h-0 overflow-hidden">{children}</div>;
}

/** Overlay filling the reader body, used for loading and error states. */
export function ReaderOverlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute top-0 left-0 w-full h-full flex flex-column align-items-center justify-content-center gap-3 p-4 text-center text-color-secondary">
      {children}
    </div>
  );
}

export function ReaderLoading({ label }: { label: string }) {
  return (
    <ReaderOverlay>
      <ProgressSpinner style={{ width: '2.5rem', height: '2.5rem' }} strokeWidth="4" />
      <span>{label}</span>
    </ReaderOverlay>
  );
}

export function ReaderMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <ReaderOverlay>
      <h2 className="m-0 text-xl text-color">{title}</h2>
      {children}
    </ReaderOverlay>
  );
}

/** Round icon button used across the readers. `icon` is a primeicons suffix, e.g. "pi-cog". */
export function ReaderIconButton({
  icon,
  title,
  onClick,
  active = false,
  disabled = false,
  tooltipPosition = 'bottom'
}: {
  icon: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tooltipPosition?: 'top' | 'bottom';
}) {
  return (
    <Button
      type="button"
      icon={`pi ${icon}`}
      text={!active}
      severity={active ? undefined : 'secondary'}
      aria-label={title}
      {...tip(title, tooltipPosition)}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

export function ReaderHeader({
  title,
  subtitle,
  onBack,
  actions
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  actions?: ReactNode;
}) {
  return (
    <Toolbar
      className={`${FLAT_BAR_CLASS} px-2 py-2 flex-nowrap flex-shrink-0`}
      start={
        <div className="flex align-items-center gap-2 min-w-0">
          <ReaderIconButton icon="pi-arrow-left" title="Back" onClick={onBack} />
          <span
            className="font-semibold white-space-nowrap overflow-hidden text-overflow-ellipsis"
            style={{ maxWidth: '45vw' }}
            title={title}
          >
            {title}
          </span>
          {subtitle ? (
            <span
              className="text-color-secondary text-sm white-space-nowrap overflow-hidden text-overflow-ellipsis"
              style={{ maxWidth: '30vw' }}
              title={subtitle}
            >
              {subtitle}
            </span>
          ) : null}
        </div>
      }
      end={<div className="flex align-items-center gap-1">{actions}</div>}
    />
  );
}

/** Bottom bar with navigation controls and a progress slider. */
export function ReaderFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="flex align-items-center gap-3 px-3 py-2 flex-shrink-0 surface-card surface-border border-top-1">
      {children}
    </footer>
  );
}

/** Setting row: small caption above its control. */
export function ReaderSetting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-column gap-2">
      <span className="text-color-secondary text-xs font-medium uppercase">{label}</span>
      {children}
    </div>
  );
}

/** True when a key event came from inside an open PrimeReact drawer or dialog. */
export function isFromDrawer(event: KeyboardEvent): boolean {
  return event.target instanceof Element && event.target.closest('.p-sidebar, .p-dialog') !== null;
}
