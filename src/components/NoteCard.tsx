import { Link } from '~/router/compat';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { confirmDialog } from 'primereact/confirmdialog';
import type { Note } from '../api/journal';
import { useDeleteNote } from '../hooks/useJournal';
import { tip } from '../utils/tooltip';
import { NOTE_COLOR_VAR } from './NoteDialog';

/** One note or highlight, shared by this page and the book page. */
export default function NoteCard({
  note,
  bookTitle,
  showBook = true,
  onEdit,
  onDelete,
  onQuote
}: {
  note: Note;
  bookTitle?: string;
  showBook?: boolean;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
  /** Offered for highlights, which have a passage worth keeping as a quote. */
  onQuote?: (note: Note) => void;
}) {
  return (
    <Card
      className="h-full"
      style={{ borderLeft: `4px solid ${NOTE_COLOR_VAR[note.color]}` }}
      pt={{ body: { className: 'p-3 flex flex-column h-full' }, content: { className: 'p-0 flex-1' } }}
    >
      {note.quote && (
        <blockquote className="m-0 mb-2 font-italic line-height-3" style={{ overflowWrap: 'anywhere' }}>
          “{note.quote}”
        </blockquote>
      )}
      {note.text && (
        <p className="m-0 line-height-3 text-sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {note.text}
        </p>
      )}
      <div className="flex align-items-center justify-content-between gap-2 mt-3 pt-2 border-top-1 surface-border">
        <div className="min-w-0 text-xs text-color-secondary flex flex-column gap-1">
          {showBook && bookTitle && (
            <Link to={`/book/${note.bookId}`} className="no-underline text-primary font-medium white-space-nowrap overflow-hidden text-overflow-ellipsis">
              {bookTitle}
            </Link>
          )}
          <span className="white-space-nowrap overflow-hidden text-overflow-ellipsis">
            {[note.source ? 'From PDF' : null, note.chapter, note.location && note.source ? `p. ${note.location}` : null, note.percentage !== undefined ? `${Math.round(note.percentage)}%` : null, new Date(note.createdAt).toLocaleDateString()]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <div className="flex flex-shrink-0">
          <Button
            icon="pi pi-copy"
            text
            severity="secondary"
            aria-label="Copy"
            {...tip('Copy')}
            onClick={() => void navigator.clipboard?.writeText([note.quote, note.text].filter(Boolean).join('\n\n'))}
          />
          {onQuote && note.quote && (
            <Button icon="pi pi-comment" text severity="secondary" aria-label="Save as quote" {...tip('Save as quote')} onClick={() => onQuote(note)} />
          )}
          <Button icon="pi pi-pencil" text severity="secondary" aria-label="Edit" onClick={() => onEdit(note)} />
          <Button icon="pi pi-trash" text severity="danger" aria-label="Delete" onClick={() => onDelete(note)} />
        </div>
      </div>
    </Card>
  );
}

export function useConfirmDeleteNote() {
  const remove = useDeleteNote();
  return (note: Note) =>
    confirmDialog({
      message: 'Delete this note? This cannot be undone.',
      header: 'Delete note',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => remove.mutate(note.id)
    });
}

