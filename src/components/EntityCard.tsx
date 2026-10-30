import type { ReactNode } from 'react';
import { Link } from '~/router/compat';
import { Card } from 'primereact/card';

/** Linked card used on the Series and Authors browsers. */
export default function EntityCard({
  to,
  name,
  count,
  media
}: {
  to: string;
  name: string;
  count: string;
  media: ReactNode;
}) {
  return (
    <Link to={to} className="no-underline text-color block">
      <Card
        header={media}
        className="h-full text-center overflow-hidden hover:shadow-4"
        pt={{ body: { className: 'p-3' }, content: { className: 'p-0' } }}
      >
        <div
          className="font-semibold text-sm line-height-2"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          title={name}
        >
          {name}
        </div>
        <div className="text-color-secondary text-xs mt-1">{count}</div>
      </Card>
    </Link>
  );
}
