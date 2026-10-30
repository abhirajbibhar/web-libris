import { useMemo, useState } from 'react';
import { Link, useSearchParams } from '~/router/compat';
import { Button } from 'primereact/button';
import { Calendar } from 'primereact/calendar';
import { InputTextarea } from 'primereact/inputtextarea';
import { SelectButton } from 'primereact/selectbutton';
import { Tag } from 'primereact/tag';
import { api } from '../api/client';
import type { Mood } from '../api/journal';
import DayBookNotes from '../components/DayBookNotes';
import PageHeader from '../components/PageHeader';
import SectionCard from '../components/SectionCard';
import { LoadingState } from '../components/States';
import TodoList from '../components/TodoList';
import { useBooks } from '../hooks/useApi';
import { useActivity, useNotebookDay, useNotebookEntry, useNotebookMonth } from '../hooks/useJournal';
import { addDays, dateKey, formatDuration, formatLongDate, monthKey, parseDateKey, todayKey } from '../utils/dates';
import { saveBlob } from '../utils/download';

const MOODS: { label: string; value: Mood }[] = [
  { label: 'Great', value: 'great' },
  { label: 'Good', value: 'good' },
  { label: 'Okay', value: 'okay' },
  { label: 'Low', value: 'low' }
];
const MOOD_SEVERITY = { great: 'success', good: 'info', okay: 'warning', low: 'danger' } as const;

const STATUS_LABEL = { idle: '', saving: 'Saving…', saved: 'All changes saved', error: 'Could not save' } as const;

/** Per-book reading summary for one day, filled in automatically from reading activity. */
export function DayReading({ date }: { date: string }) {
  const { data: activity } = useActivity();
  const { data: books } = useBooks();
  const day = activity?.[date];
  const entries = Object.entries(day?.books ?? {});

  if (entries.length === 0) {
    return <p className="m-0 text-sm text-color-secondary">No reading recorded for this day.</p>;
  }
  return (
    <div className="flex flex-column gap-3">
      <div className="text-sm text-color-secondary">
        About <strong className="text-color">{formatDuration(day?.seconds ?? 0)}</strong> across {entries.length}{' '}
        {entries.length === 1 ? 'book' : 'books'}
      </div>
      {entries.map(([id, info]) => {
        const book = books?.find(b => String(b.id) === id);
        const delta = Math.round(info.endPct - info.startPct);
        return (
          <div key={id} className="flex align-items-center justify-content-between gap-3">
            <div className="min-w-0">
              {book ? (
                <Link to={`/book/${book.id}`} className="no-underline text-color font-medium white-space-nowrap overflow-hidden text-overflow-ellipsis block">
                  {book.metadata.title ?? book.fileName}
                </Link>
              ) : (
                <span className="text-color-secondary">Removed book</span>
              )}
              <span className="text-xs text-color-secondary">
                {Math.round(info.startPct)}% → {Math.round(info.endPct)}%
                {info.seconds >= 60 ? ` · ${formatDuration(info.seconds)}` : ''}
              </span>
            </div>
            {delta !== 0 && <Tag value={`${delta > 0 ? '+' : ''}${delta}%`} severity={delta > 0 ? 'success' : 'warning'} />}
          </div>
        );
      })}
    </div>
  );
}

export default function NotebookPage() {
  const [params, setParams] = useSearchParams();
  const today = todayKey();
  const requested = params.get('date');
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today;
  const goTo = (key: string) => setParams(key === today ? {} : { date: key }, { replace: true });

  const { entry, update, status, isLoading } = useNotebookDay(date);
  const monthData = useNotebookMonth(monthKey(date));
  const previousDay = addDays(date, -1);
  const previous = useNotebookEntry(previousDay).data;
  const [downloadError, setDownloadError] = useState(false);

  const downloadMarkdown = async () => {
    setDownloadError(false);
    try {
      // Make sure the latest edits are on the server before exporting.
      await new Promise(resolve => setTimeout(resolve, 900));
      const blob = await api.blob(`/api/v1/notebook/${date}/markdown`);
      const [y, m, d] = date.split('-');
      saveBlob(blob, `${d}-${m}-${y}.md`);
    } catch {
      setDownloadError(true);
    }
  };

  const carryable = useMemo(() => {
    const existing = new Set(entry.todos.map(t => t.text.toLowerCase()));
    return (previous?.todos ?? []).filter(t => !t.done && !existing.has(t.text.toLowerCase()));
  }, [previous, entry.todos]);

  const history = useMemo(
    () => Object.values(monthData.data?.days ?? {}).sort((a, b) => b.date.localeCompare(a.date)),
    [monthData.data]
  );

  return (
    <div className="flex flex-column gap-3">
      <PageHeader title="Notebook" subtitle={formatLongDate(date)}>
        <Button icon="pi pi-chevron-left" text severity="secondary" aria-label="Previous day" onClick={() => goTo(addDays(date, -1))} />
        <Calendar
          value={parseDateKey(date)}
          onChange={event => event.value instanceof Date && goTo(dateKey(event.value))}
          showIcon
          dateFormat="dd M yy"
          inputClassName="w-8rem"
          aria-label="Choose a day"
        />
        <Button icon="pi pi-chevron-right" text severity="secondary" aria-label="Next day" onClick={() => goTo(addDays(date, 1))} />
        {date !== today && <Button label="Today" outlined onClick={() => goTo(today)} />}
        <Button
          icon="pi pi-download"
          text
          severity="secondary"
          aria-label="Download this day as Markdown"
          tooltip="Download .md"
          tooltipOptions={{ position: 'bottom' }}
          onClick={() => void downloadMarkdown()}
        />
      </PageHeader>
      {downloadError && <small className="text-red-500">Nothing to download yet. Write something for this day first.</small>}

      {isLoading ? (
        <LoadingState />
      ) : (
        <div className="grid">
          <div className="col-12 lg:col-7 flex flex-column gap-3">
            <SectionCard
              title="To-do"
              icon="pi-list-check"
              action={
                carryable.length > 0 ? (
                  <Button
                    label={`Carry over ${carryable.length}`}
                    icon="pi pi-arrow-down"
                    text
                    onClick={() => update({ todos: [...entry.todos, ...carryable.map(t => ({ ...t, id: `${t.id}-c`, done: false }))] })}
                  />
                ) : undefined
              }
            >
              <TodoList todos={entry.todos} onChange={todos => update({ todos })} idPrefix="notebook" />
            </SectionCard>

            <SectionCard title="How was my reading today?" icon="pi-face-smile">
              <div className="flex flex-column gap-3">
                <SelectButton
                  value={entry.mood}
                  options={MOODS}
                  onChange={event => update({ mood: (event.value as Mood | null) ?? null })}
                  aria-label="Mood"
                />
                <InputTextarea
                  value={entry.reflection}
                  onChange={event => update({ reflection: event.target.value })}
                  rows={4}
                  autoResize
                  maxLength={20000}
                  placeholder="What did you read, how did it feel, what stood out?"
                  aria-label="Reading reflection"
                />
              </div>
            </SectionCard>

            <DayBookNotes date={date} entry={entry} onChange={bookNotes => update({ bookNotes })} />

            <SectionCard title="Thoughts & learnings" icon="pi-lightbulb">
              <InputTextarea
                value={entry.thoughts}
                onChange={event => update({ thoughts: event.target.value })}
                rows={5}
                autoResize
                maxLength={20000}
                placeholder="Ideas, questions, things to remember…"
                className="w-full"
                aria-label="Thoughts and learnings"
              />
            </SectionCard>
          </div>

          <div className="col-12 lg:col-5 flex flex-column gap-3">
            <SectionCard title={date === today ? 'Today’s reading progress' : 'Reading that day'} icon="pi-chart-line">
              <DayReading date={date} />
            </SectionCard>

            <SectionCard title="This month" icon="pi-calendar">
              {history.length === 0 ? (
                <p className="m-0 text-sm text-color-secondary">No entries yet this month.</p>
              ) : (
                <div className="flex flex-column">
                  {history.map(day => (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => goTo(day.date)}
                      className={`flex align-items-center justify-content-between gap-2 py-2 px-2 border-none border-round cursor-pointer text-left text-color hover:surface-hover ${day.date === date ? 'surface-100' : 'bg-transparent'}`}
                    >
                      <span className="text-sm font-medium">
                        {parseDateKey(day.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                      </span>
                      <span className="flex align-items-center gap-2 text-xs text-color-secondary">
                        {day.todos > 0 && `${day.done}/${day.todos} done`}
                        {day.mood && <Tag value={day.mood} severity={MOOD_SEVERITY[day.mood]} />}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      )}

      <div
        className="text-xs text-color-secondary text-right"
        style={{ minHeight: '1rem' }}
        role="status"
        aria-live="polite"
      >
        {STATUS_LABEL[status]}
      </div>
    </div>
  );
}
