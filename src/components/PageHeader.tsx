import type { ReactNode } from 'react';

/** Page title with an optional count line and a slot for toolbar controls. */
export default function PageHeader({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap align-items-center justify-content-between gap-3">
      <div className="flex align-items-baseline gap-3 min-w-0">
        <h2 className="m-0 text-2xl font-semibold">{title}</h2>
        {subtitle && <span className="text-color-secondary text-sm">{subtitle}</span>}
      </div>
      {children && <div className="flex flex-wrap align-items-center gap-2">{children}</div>}
    </div>
  );
}
