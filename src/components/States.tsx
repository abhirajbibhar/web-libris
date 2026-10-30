import type { ReactNode } from 'react';
import { ProgressSpinner } from 'primereact/progressspinner';

export function EmptyState({
  icon,
  message,
  children
}: {
  icon: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-column align-items-center gap-3 py-6 px-3 text-center text-color-secondary">
      <i className={`pi ${icon} text-5xl opacity-50`} />
      <p className="m-0">{message}</p>
      {children}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-column align-items-center gap-3 py-6 text-color-secondary">
      <ProgressSpinner style={{ width: '2.5rem', height: '2.5rem' }} strokeWidth="4" />
      <span>{label}</span>
    </div>
  );
}
