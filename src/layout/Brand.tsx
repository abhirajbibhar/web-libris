import { TOPBAR_HEIGHT } from './constants';

export default function Brand({ title, compact = false }: { title: string; compact?: boolean }) {
  return (
    <div
      className={`flex align-items-center gap-2 flex-shrink-0 surface-card surface-border border-bottom-1 ${
        compact ? 'justify-content-center' : 'px-3'
      }`}
      style={{ height: TOPBAR_HEIGHT }}
    >
      <img src="/favicon.svg" alt="Web Libris" width={28} height={28} className="flex-shrink-0" />
      {!compact && (
        <span className="text-xl font-semibold white-space-nowrap overflow-hidden text-overflow-ellipsis">
          {title}
        </span>
      )}
    </div>
  );
}
