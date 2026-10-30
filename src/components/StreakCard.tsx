import { useMemo } from 'react';
import { Link } from '~/router/compat';
import { useActivity } from '../hooks/useJournal';
import { parseDateKey, todayKey } from '../utils/dates';
import { computeStreaks, isReadDay, lastDays } from '../utils/streak';
import SectionCard from './SectionCard';

export function Stat({ label, value, icon }: { label: string; value: string | number; icon?: string }) {
  return (
    <div className="flex flex-column gap-1 min-w-0">
      <span className="text-color-secondary text-xs uppercase font-medium white-space-nowrap">{label}</span>
      <span className="text-2xl font-semibold flex align-items-center gap-2">
        {icon && <i className={`pi ${icon} text-primary text-xl`} />}
        {value}
      </span>
    </div>
  );
}

/** Streak summary plus the last seven days at a glance. */
export default function StreakCard({ className }: { className?: string }) {
  const { data: activity } = useActivity();
  const today = todayKey();
  const stats = useMemo(() => computeStreaks(activity ?? {}, today), [activity, today]);
  const week = lastDays(today, 7);

  return (
    <SectionCard
      className={className}
      title="Reading streak"
      icon="pi-bolt"
      action={
        <Link to="/streak" className="text-sm no-underline text-primary white-space-nowrap">
          Calendar
        </Link>
      }
    >
      <div className="flex gap-5 mb-3">
        <Stat label="Current" value={`${stats.current} ${stats.current === 1 ? 'day' : 'days'}`} />
        <Stat label="Longest" value={`${stats.longest} ${stats.longest === 1 ? 'day' : 'days'}`} />
      </div>
      <div className="flex justify-content-between gap-1" aria-label="Last seven days">
        {week.map(key => {
          const read = isReadDay(activity?.[key]);
          return (
            <div key={key} className="flex flex-column align-items-center gap-1">
              <span
                className={`border-circle flex align-items-center justify-content-center ${read ? 'bg-primary' : 'surface-200'}`}
                style={{ width: '2rem', height: '2rem' }}
                title={`${key}${read ? ': read' : ''}`}
              >
                {read && <i className="pi pi-check text-xs" />}
              </span>
              <span className="text-xs text-color-secondary">
                {parseDateKey(key).toLocaleDateString(undefined, { weekday: 'narrow' })}
              </span>
            </div>
          );
        })}
      </div>
      {!stats.readToday && (
        <p className="m-0 mt-3 text-sm text-color-secondary">
          {stats.current > 0 ? 'Read a little today to keep your streak going.' : 'Read a few pages today to start a streak.'}
        </p>
      )}
    </SectionCard>
  );
}
