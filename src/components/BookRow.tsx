import { Children, type ReactNode } from 'react';
import { THIN_SCROLL } from '../utils/scroll';

/** Horizontally scrolling row of fixed-width items (touch friendly). */
export default function BookRow({ children, itemWidth = '9.5rem' }: { children: ReactNode; itemWidth?: string }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2" style={THIN_SCROLL}>
      {Children.map(children, child => (
        <div className="flex-shrink-0" style={{ width: itemWidth }}>
          {child}
        </div>
      ))}
    </div>
  );
}
