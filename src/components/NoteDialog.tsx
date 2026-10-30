import { useEffect, useMemo, useState } from 'react';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputTextarea } from 'primereact/inputtextarea';
import { SelectButton } from 'primereact/selectbutton';
import { NOTE_COLORS, type Note, type NoteColor, type NoteInput, type NoteType } from '../api/journal';
import { useBooks } from '../hooks/useApi';
import { useCreateNote, useUpdateNote } from '../hooks/useJournal';
import FormField from './FormField';

/** Theme colour variable for each note colour. */
export const NOTE_COLOR_VAR: Record<NoteColor, string> = {
  yellow: 'var(--yellow-400)',
  green: 'var(--green-400)',
  blue: 'var(--blue-400)',
  pink: 'var(--pink-400)',
  purple: 'var(--purple-400)'
};

const TYPE_OPTIONS = [
  { label: 'Highlight', value: 'highlight' },
  { label: 'Note', value: 'note' }
];

export interface NoteDraft {
  bookId?: number;
  quote?: string;
  location?: string;
  chapter?: string;
  percentage?: number;
}

/** Create a note/highlight, or edit one when `note` is given. */
export default function NoteDialog({
  visible,
  onHide,
  note,
  draft,
  lockBook = false,
  onSaved
}: {
  visible: boolean;
  onHide: () => void;
  note?: Note;
  draft?: NoteDraft;
  /** Hide the book picker (when opened from a book or the reader). */
  lockBook?: boolean;
  onSaved?: () => void;
}) {
  const { data: books } = useBooks();
  const create = useCreateNote();
  const update = useUpdateNote();
  const [bookId, setBookId] = useState<number | null>(null);
  const [type, setType] = useState<NoteType>('note');
  const [quote, setQuote] = useState('');
  const [text, setText] = useState('');
  const [color, setColor] = useState<NoteColor>('yellow');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setBookId(note?.bookId ?? draft?.bookId ?? null);
    setQuote(note?.quote ?? draft?.quote ?? '');
    setText(note?.text ?? '');
    setColor(note?.color ?? 'yellow');
    setType(note?.type ?? (draft?.quote ? 'highlight' : 'note'));
  }, [visible, note, draft]);

  const bookOptions = useMemo(
    () => (books ?? []).map(book => ({ label: book.metadata.title ?? book.fileName, value: book.id })),
    [books]
  );

  const saving = create.isPending || update.isPending;
  const canSave = bookId !== null && (type === 'highlight' ? quote.trim().length > 0 : quote.trim() || text.trim());

  const save = async () => {
    setError(null);
    try {
      if (note) {
        await update.mutateAsync({ id: note.id, quote, text, color });
      } else {
        const input: NoteInput = {
          bookId: bookId!,
          type,
          quote,
          text,
          color,
          location: draft?.location,
          chapter: draft?.chapter,
          percentage: draft?.percentage
        };
        await create.mutateAsync(input);
      }
      onSaved?.();
      onHide();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const footer = (
    <div className="flex justify-content-end gap-2">
      <Button label="Cancel" text severity="secondary" onClick={onHide} />
      <Button label={note ? 'Save' : 'Add'} onClick={() => void save()} loading={saving} disabled={!canSave} />
    </div>
  );

  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      header={note ? 'Edit note' : type === 'highlight' ? 'New highlight' : 'New note'}
      footer={footer}
      style={{ width: '32rem' }}
      breakpoints={{ '640px': '95vw' }}
    >
      <div className="flex flex-column gap-3">
        {!lockBook && !note && (
          <FormField label="Book" htmlFor="note-book">
            <Dropdown
              inputId="note-book"
              value={bookId}
              options={bookOptions}
              onChange={event => setBookId(event.value as number)}
              placeholder="Choose a book"
              filter
              className="w-full"
            />
          </FormField>
        )}
        {!note && (
          <SelectButton
            value={type}
            options={TYPE_OPTIONS}
            allowEmpty={false}
            onChange={event => setType(event.value as NoteType)}
          />
        )}
        <FormField label={type === 'highlight' ? 'Highlighted text' : 'Quote (optional)'} htmlFor="note-quote">
          <InputTextarea id="note-quote" value={quote} onChange={e => setQuote(e.target.value)} rows={3} autoResize maxLength={5000} />
        </FormField>
        <FormField label={type === 'highlight' ? 'Comment (optional)' : 'Note'} htmlFor="note-text">
          <InputTextarea id="note-text" value={text} onChange={e => setText(e.target.value)} rows={4} autoResize maxLength={5000} />
        </FormField>
        <div className="flex align-items-center gap-2" role="radiogroup" aria-label="Colour">
          <span className="text-sm font-medium mr-1">Colour</span>
          {NOTE_COLORS.map(option => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={color === option}
              aria-label={option}
              onClick={() => setColor(option)}
              className="border-circle cursor-pointer"
              style={{
                width: '1.75rem',
                height: '1.75rem',
                background: NOTE_COLOR_VAR[option],
                border: color === option ? '3px solid var(--text-color)' : '2px solid transparent'
              }}
            />
          ))}
        </div>
        {error && <small className="text-red-500">{error}</small>}
      </div>
    </Dialog>
  );
}
