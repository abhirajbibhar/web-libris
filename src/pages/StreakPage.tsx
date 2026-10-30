import { useMemo, useState } from 'react';
import { Link } from '~/router/compat';
import { Calendar } from 'primereact/calendar';
import { Tag } from 'primereact/tag';
import PageHeader from '../components/PageHeader';
import SectionCard from '../components/SectionCard';
import StreakCard, { Stat } from '../components/StreakCard';
import { useBooks } from '../hooks/useApi';
import { useActivity, useNotebookEntry } from '../hooks/useJournal';
import { DayReading } from './NotebookPage';
import { dateKey, formatDuration, formatLongDate, monthKey, parseDateKey, todayKey } from '../utils/dates';
import { computeStreaks, isReadDay } from '../utils/streak';

const pad = (n: number) => String(n).padStart(2, '0');

export default function StreakPage() {
  const today = todayKey();
  const { data: activity } = useActivity();
  const [selected, setSelected] = useState(today);
  const [viewMonth, setViewMonth] = useState(monthKey(today));

  const days = activity ?? {};
  const stats = useMemo(() => computeStreaks(days, today), [days, today]);
  const monthStats = useMemo(() => {
    const keys = Object.keys(days).filter(k => k.startsWith(viewMonth));
    return {
      readDays: keys.filter(k => isReadDay(days[k])).length,
      seconds: keys.reduce((sum, k) => sum + days[k].seconds, 0)
    };
  }, [days, viewMonth]);

  const { data: books } = useBooks();
  const todaySeconds = days[today]?.seconds ?? 0;
  const todayBooks = Object.keys(days[today]?.books ?? {}).length;
  const readingNow = (books ?? []).filter(b => b.readStatus === 'READING' || b.readStatus === 'RE_READING').length;

  const notebook = useNotebookEntry(selected).data;
  const todosDone = notebook?.todos.filter(t => t.done).length ?? 0;

  return (
    <div className="flex flex-column gap-3">
      <PageHeader title="Reading streak" subtitle="Your reading habit, day by day" />

      <div className="grid">
        <div className="col-12 lg:col-5 flex flex-column gap-3">
          <SectionCard title="Calendar" icon="pi-calendar">
            <Calendar
              inline
              className="w-full"
              pt={{
                day: { className: 'p-1' },
                dayLabel: { style: { width: '2rem', height: '2rem' } },
                tableHeaderCell: { className: 'p-1' }
              }}
              value={parseDateKey(selected)}
              maxDate={new Date()}
              onChange={event => event.value instanceof Date && setSelected(dateKey(event.value))}
              onViewDateChange={event => event.value instanceof Date && setViewMonth(`${event.value.getFullYear()}-${pad(event.value.getMonth() + 1)}`)}
              dateTemplate={date => {
                const key = `${date.year}-${pad(date.month + 1)}-${pad(date.day)}`;
                const read = isReadDay(days[key]);
                return (
                  <span className="relative inline-flex flex-column align-items-center">
                    <span className={read ? 'font-bold' : undefined}>{date.day}</span>
                    {read && (
                      <span
                        className="absolute border-circle"
                        style={{ width: '0.35rem', height: '0.35rem', bottom: '-0.2rem', background: 'var(--primary-color)' }}
                      />
                    )}
                  </span>
                );
              }}
            />
            <p className="m-0 mt-3 text-xs text-color-secondary flex align-items-center gap-2">
              <span className="border-circle inline-block" style={{ width: '0.5rem', height: '0.5rem', background: 'var(--primary-color)' }} />
              Days you read
            </p>
          </SectionCard>
          <StreakCard />
        </div>

        <div className="col-12 lg:col-7 flex flex-column gap-3">
          <SectionCard title="Today" icon="pi-sun">
            <div className="grid">
              <div className="col-4"><Stat label="Read today" value={formatDuration(todaySeconds)} icon="pi-clock" /></div>
              <div className="col-4"><Stat label="Books today" value={todayBooks} icon="pi-book" /></div>
              <div className="col-4"><Stat label="Reading now" value={readingNow} icon="pi-bookmark" /></div>
            </div>
          </SectionCard>

          <SectionCard title="This month" icon="pi-chart-bar">
            <div className="grid">
              <div className="col-6 md:col-3"><Stat label="Current" value={`${stats.current}d`} icon="pi-bolt" /></div>
              <div className="col-6 md:col-3"><Stat label="Longest" value={`${stats.longest}d`} icon="pi-trophy" /></div>
              <div className="col-6 md:col-3"><Stat label="Days read" value={monthStats.readDays} icon="pi-check-circle" /></div>
              <div className="col-6 md:col-3"><Stat label="Time" value={formatDuration(monthStats.seconds)} icon="pi-clock" /></div>
            </div>
          </SectionCard>

          <SectionCard title={formatLongDate(selected)} icon="pi-book">
            <h4 className="mt-0 mb-2 text-sm text-color-secondary uppercase font-medium">What I read</h4>
            <DayReading date={selected} />

            <h4 className="mt-4 mb-2 text-sm text-color-secondary uppercase font-medium">From my notebook</h4>
            {notebook && (notebook.reflection || notebook.todos.length > 0 || notebook.mood || notebook.bookNotes.some(n => n.text.trim())) ? (
              <div className="flex flex-column gap-2">
                <div className="flex flex-wrap align-items-center gap-2 text-sm">
                  {notebook.mood && <Tag value={notebook.mood} />}
                  {notebook.todos.length > 0 && (
                    <span className="text-color-secondary">
                      {todosDone}/{notebook.todos.length} to-dos done
                    </span>
                  )}
                </div>
                {notebook.reflection && (
                  <p className="m-0 text-sm line-height-3" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {notebook.reflection}
                  </p>
                )}
                {notebook.bookNotes
                  .filter(n => n.text.trim())
                  .map(n => (
                    <div key={n.bookId} className="text-sm line-height-3" style={{ overflowWrap: 'anywhere' }}>
                      <Link to={`/book/${n.bookId}`} className="no-underline text-primary font-medium">
                        {n.title}
                      </Link>
                      <span className="block text-color-secondary" style={{ whiteSpace: 'pre-wrap' }}>
                        {n.text}
                      </span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="m-0 text-sm text-color-secondary">Nothing written for this day.</p>
            )}
            <Link to={selected === today ? '/notebook' : `/notebook?date=${selected}`} className="inline-block mt-3 text-sm no-underline text-primary">
              Open this day in the notebook
            </Link>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
