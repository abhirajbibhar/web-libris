import type { ReactNode } from 'react';
import { Card } from 'primereact/card';

/** Card with a compact title row, used to split pages into clear sections. */
export default function SectionCard({
  title,
  icon,
  action,
  children,
  className
}: {
  title: string;
  icon?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={className}
      pt={{ body: { className: 'p-3' }, content: { className: 'p-0' } }}
      header={
        <div className="flex align-items-center justify-content-between gap-2 px-3 pt-3">
          <h3 className="m-0 text-base font-semibold flex align-items-center gap-2 min-w-0">
            {icon && <i className={`pi ${icon} text-primary`} />}
            <span className="white-space-nowrap overflow-hidden text-overflow-ellipsis">{title}</span>
          </h3>
          {action}
        </div>
      }
    >
      <div className="pt-2">{children}</div>
    </Card>
  );
}
