import type { ReactNode } from 'react';

/** Responsive auto-fill grid used for book and entity cards. */
export default function CardGrid({
  minWidth = 150,
  children
}: {
  minWidth?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
        gap: '1rem'
      }}
    >
      {children}
    </div>
  );
}
