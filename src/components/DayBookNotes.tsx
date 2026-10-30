import { useMemo } from 'react';
import { Link } from '~/router/compat';
import { Button } from 'primereact/button';
import { Dropdown } from 'primereact/dropdown';
import { InputTextarea } from 'primereact/inputtextarea';
import { Tag } from 'primereact/tag';
import type { BookNote, NotebookEntry } from '../api/journal';
import { useBooks } from '../hooks/useApi';
import { useActivity, useNotes } from '../hooks/useJournal';
import { dateKey, formatDuration } from '../utils/dates';
import SectionCard from './SectionCard';

/**
 * A remark per book for one day. The list is the books the reading log says you
 * read that day, plus any you add by hand (e.g. read offline). Highlights and
 * notes you captured from that book on that day are shown alongside, so you can
 * react to them without leaving the page.
 */
export default function DayBookNotes({
  date,
  entry,
  onChange
}: {
  date: string;
  entry: NotebookEntry;
  onChange: (bookNotes: BookNote[]) => void;
}) {
  const { data: books } = useBooks();
  const { data: activity } = useActivity();
  const { data: notes } = useNotes();

  const read = activity?.[date]?.books ?? {};

  /** Book ids to show: reading log first, then anything already noted or added by hand. */
  const rows = useMemo(() => {
    const ids = Object.keys(read).map(Number);
    for (const note of entry.bookNotes) if (!ids.includes(note.bookId)) ids.push(note.bookId);
    return ids;
  }, [read, entry.bookNotes]);

  const dayNotes = useMemo(() => {
    const byBook = new Map<number, typeof notes>();
    for (const note of notes ?? []) {
      if (dateKey(new Date(note.createdAt)) !== date) continue;
      byBook.set(note.bookId, [...(byBook.get(note.bookId) ?? []), note]);
    }
    return byBook;
  }, [notes, date]);

  const addable = useMemo(
    () =>
      (books ?? [])
        .filter(b => !rows.includes(b.id))
        .map(b => ({ label: b.metadata.title ?? b.fileName, value: b.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [books, rows]
  );

  const titleOf = (bookId: number) => {
    const book = books?.find(b => b.id === bookId);
    return book ? (book.metadata.title ?? book.fileName) : (entry.bookNotes.find(n => n.bookId === bookId)?.title ?? 'Removed book');
  };

  const setText = (bookId: number, text: string) => {
    const exists = entry.bookNotes.some(n => n.bookId === bookId);
    onChange(
      exists
        ? entry.bookNotes.map(n => (n.bookId === bookId ? { ...n, text } : n))
        : [...entry.bookNotes, { bookId, title: titleOf(bookId), text }]
    );
  };

  return (
    <SectionCard title="Book notes" icon="pi-book">
      {rows.length === 0 ? (
        <p className="mt-0 mb-3 text-sm text-color-secondary">
          Books you read this day appear here so you can jot something down about each. You can also add one by hand.
        </p>
      ) : (
        <div className="flex flex-column gap-4 mb-3">
          {rows.map(bookId => {
            const info = read[String(bookId)];
            const delta = info ? Math.round(info.endPct - info.startPct) : 0;
            const text = entry.bookNotes.find(n => n.bookId === bookId)?.text ?? '';
            const captured = dayNotes.get(bookId) ?? [];
            const exists = books?.some(b => b.id === bookId);
            return (
              <div key={bookId} className="flex flex-column gap-2">
                <div className="flex align-items-center justify-content-between gap-2">
                  <div className="min-w-0 flex flex-column">
                    {exists ? (
                      <Link to={`/book/${bookId}`} className="no-underline text-color font-medium white-space-nowrap overflow-hidden text-overflow-ellipsis">
                        {titleOf(bookId)}
                      </Link>
                    ) : (
                      <span className="font-medium text-color-secondary">{titleOf(bookId)}</span>
                    )}
                    {info && (
                      <span className="text-xs text-color-secondary">
                        {Math.round(info.startPct)}% → {Math.round(info.endPct)}%{info.seconds >= 60 ? ` · ${formatDuration(info.seconds)}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex align-items-center gap-1 flex-shrink-0">
                    {delta !== 0 && <Tag value={`${delta > 0 ? '+' : ''}${delta}%`} severity={delta > 0 ? 'success' : 'warning'} />}
                    {!info && !text.trim() && (
                      <Button
                        icon="pi pi-times"
                        text
                        severity="secondary"
                        aria-label={`Remove ${titleOf(bookId)}`}
                        onClick={() => onChange(entry.bookNotes.filter(n => n.bookId !== bookId))}
                      />
                    )}
                  </div>
                </div>

                {captured.length > 0 && (
                  <ul className="m-0 pl-3 flex flex-column gap-1 text-sm text-color-secondary" style={{ listStyle: 'none', borderLeft: '3px solid var(--surface-border)' }}>
                    {captured.slice(0, 4).map(note => (
                      <li key={note.id} className="font-italic" style={{ overflowWrap: 'anywhere' }}>
                        {note.quote ? `“${note.quote}”` : note.text}
                      </li>
                    ))}
                    {captured.length > 4 && <li>+{captured.length - 4} more from this day</li>}
                  </ul>
                )}

                <InputTextarea
                  value={text}
                  onChange={event => setText(bookId, event.target.value)}
                  rows={2}
                  autoResize
                  maxLength={20000}
                  placeholder="What stood out in this book today?"
                  aria-label={`Notes on ${titleOf(bookId)}`}
                  className="w-full"
                />
              </div>
            );
          })}
        </div>
      )}

      <Dropdown
        value={null}
        options={addable}
        onChange={event => {
          const bookId = event.value as number;
          onChange([...entry.bookNotes, { bookId, title: titleOf(bookId), text: '' }]);
        }}
        placeholder="Add a book…"
        filter
        emptyMessage="No more books"
        className="w-full"
        aria-label="Add a book to this day"
      />
    </SectionCard>
  );
}
