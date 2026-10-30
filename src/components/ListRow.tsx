import type { ReactNode } from 'react';

/** Responsive list row: icon/avatar + text on the left, actions on the right, wrapping on small screens. */
export default function ListRow({
  icon,
  leading,
  title,
  subtitle,
  meta,
  actions
}: {
  icon?: string;
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap align-items-center gap-3 py-3 border-bottom-1 surface-border">
      {leading ??
        (icon && (
          <span
            className="flex align-items-center justify-content-center border-round surface-100 text-primary flex-shrink-0"
            style={{ width: '2.5rem', height: '2.5rem' }}
          >
            <i className={`pi ${icon}`} />
          </span>
        ))}
      <div className="flex-1 min-w-0 flex flex-column gap-1" style={{ minWidth: '11rem' }}>
        <span className="font-medium white-space-nowrap overflow-hidden text-overflow-ellipsis">{title}</span>
        {subtitle && (
          <span className="text-sm text-color-secondary" style={{ overflowWrap: 'anywhere' }}>
            {subtitle}
          </span>
        )}
        {meta && <div className="flex flex-wrap gap-1 mt-1">{meta}</div>}
      </div>
      {actions && <div className="flex flex-shrink-0 ml-auto">{actions}</div>}
    </div>
  );
}
