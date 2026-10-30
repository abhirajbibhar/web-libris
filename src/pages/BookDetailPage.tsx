import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from '~/router/compat';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { Dropdown } from 'primereact/dropdown';
import { Image } from 'primereact/image';
import { InputTextarea } from 'primereact/inputtextarea';
import { ProgressBar } from 'primereact/progressbar';
import { Rating } from 'primereact/rating';
import { Tag } from 'primereact/tag';
import { Toast } from 'primereact/toast';
import { bookProgressPercent, coverUrl } from '../api/types';
import type { ReadStatus } from '../api/types';
import type { Note } from '../api/journal';
import { useAuth } from '../auth/AuthContext';
import BookCard, { CoverPlaceholder } from '../components/BookCard';
import BookRow from '../components/BookRow';
import NoteCard, { useConfirmDeleteNote } from '../components/NoteCard';
import NoteDialog from '../components/NoteDialog';
import SectionCard from '../components/SectionCard';
import { EmptyState, LoadingState } from '../components/States';
import { useBook, useBooks, useDeleteBooks, useUpdateBookMetadata, useUpdateBookStatus, useUpdatePersonalRating } from '../hooks/useApi';
import { useNotes } from '../hooks/useJournal';
import { findSeriesByName } from '../utils/entities';
import { formatDate, formatFileSize, READ_STATUS_OPTIONS } from '../utils/format';

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-2 text-sm border-bottom-1 surface-border">
      <span className="w-6rem flex-shrink-0 text-color-secondary text-xs font-medium uppercase pt-1">{label}</span>
      <span className="flex-1 min-w-0" style={{ overflowWrap: 'anywhere' }}>
        {children}
      </span>
    </div>
  );
}

export default function BookDetailPage() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const toast = useRef<Toast>(null);
  const { user } = useAuth();
  const id = Number(bookId);

  const { data: book, isLoading } = useBook(id);
  const { data: allBooks } = useBooks();
  const { data: allNotes } = useNotes();
  const confirmDeleteNote = useConfirmDeleteNote();
  const updateStatus = useUpdateBookStatus();
  const updateRating = useUpdatePersonalRating();
  const updateMetadata = useUpdateBookMetadata();
  const deleteBooks = useDeleteBooks();

  const [description, setDescription] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | undefined>();

  useEffect(() => {
    if (book) {
      setDescription(book.metadata.description ?? '');
      setEditingDescription(false);
    }
  }, [book]);

  const bookNotes = useMemo(() => (allNotes ?? []).filter(n => n.bookId === id), [allNotes, id]);

  if (isLoading) return <LoadingState />;
  if (!book) {
    return (
      <EmptyState icon="pi-exclamation-circle" message="Book not found.">
        <Button label="Back to books" link onClick={() => navigate('/all-books')} />
      </EmptyState>
    );
  }

  const metadata = book.metadata;
  const title = metadata.title ?? book.fileName;
  const cover = coverUrl(book);
  const progress = Math.round(bookProgressPercent(book));
  const canEdit = user?.permissions.canEditMetadata || user?.permissions.admin;
  const readable = ['EPUB', 'PDF', 'CBX'].includes(book.primaryFile?.bookType ?? '');
  const seriesBooks =
    metadata.seriesName && allBooks ? findSeriesByName(allBooks, metadata.seriesName.toLowerCase()) : undefined;
  const seriesSiblings = seriesBooks?.books.filter(other => other.id !== book.id) ?? [];

  const saveDescription = async () => {
    try {
      await updateMetadata.mutateAsync({ bookId: book.id, metadata: { description } });
      setEditingDescription(false);
      toast.current?.show({ severity: 'success', summary: 'Description saved', life: 2000 });
    } catch (error) {
      toast.current?.show({
        severity: 'error',
        summary: 'Save failed',
        detail: error instanceof Error ? error.message : undefined,
        life: 3000
      });
    }
  };

  const confirmDelete = () => {
    confirmDialog({
      message: 'Delete this book and its file? This cannot be undone.',
      header: 'Delete Book',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => deleteBooks.mutate([book.id], { onSuccess: () => navigate('/all-books') })
    });
  };

  const openNoteDialog = (note?: Note) => {
    setEditingNote(note);
    setNoteDialogOpen(true);
  };

  return (
    <div className="flex flex-column gap-3 mx-auto w-full" style={{ maxWidth: '72rem' }}>
      <ConfirmDialog />
      <Toast ref={toast} />

      {/* Header: cover, title and the main actions */}
      <Card pt={{ body: { className: 'p-3 md:p-4' }, content: { className: 'p-0' } }}>
        <div className="flex flex-column md:flex-row gap-4">
          <div className="flex-shrink-0 mx-auto md:mx-0" style={{ width: 'min(100%, 11rem)' }}>
            {cover ? (
              <Image src={cover} alt={title} preview className="block" imageClassName="block w-full border-round shadow-3" />
            ) : (
              <div className="border-round overflow-hidden shadow-3" style={{ aspectRatio: '2 / 3' }}>
                <CoverPlaceholder label={title} />
              </div>
            )}
          </div>

          <div className="flex flex-column gap-3 flex-1 min-w-0 text-center md:text-left">
            <div>
              <h1 className="m-0 text-2xl md:text-3xl font-semibold" style={{ overflowWrap: 'anywhere' }}>
                {title}
              </h1>
              {metadata.subtitle && <p className="m-0 mt-1 text-color-secondary font-italic">{metadata.subtitle}</p>}
              {metadata.authors && metadata.authors.length > 0 && (
                <p className="m-0 mt-2 font-medium">by {metadata.authors.join(', ')}</p>
              )}
              {metadata.seriesName && (
                <div className="flex flex-wrap align-items-center justify-content-center md:justify-content-start gap-2 mt-2">
                  <Tag icon="pi pi-objects-column" value={metadata.seriesName} />
                  {metadata.seriesNumber != null && (
                    <span className="text-color-secondary text-sm">
                      #{metadata.seriesNumber}
                      {metadata.seriesTotal ? ` of ${metadata.seriesTotal}` : ''}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-4 justify-content-center md:justify-content-start">
              <div className="flex flex-column gap-2 text-left">
                <label htmlFor="read-status" className="text-color-secondary text-xs font-medium uppercase">
                  Read status
                </label>
                <Dropdown
                  inputId="read-status"
                  value={book.readStatus}
                  options={READ_STATUS_OPTIONS}
                  onChange={event => updateStatus.mutate({ bookIds: [book.id], status: event.value as ReadStatus })}
                  className="w-12rem"
                />
              </div>
              <div className="flex flex-column gap-2 text-left">
                <span className="text-color-secondary text-xs font-medium uppercase">My rating</span>
                <Rating
                  // Ratings are stored on a 0-10 scale; the stars show 0-5.
                  value={(book.personalRating ?? 0) / 2}
                  cancel={false}
                  stars={5}
                  onChange={event => updateRating.mutate({ ids: [book.id], rating: (event.value as number) * 2 })}
                />
              </div>
            </div>

            {progress > 0 && (
              <div className="flex align-items-center gap-2">
                <ProgressBar value={progress} showValue={false} className="flex-1" style={{ height: '0.5rem' }} />
                <span className="text-sm text-color-secondary white-space-nowrap">{progress}% read</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2 justify-content-center md:justify-content-start">
              {readable && (
                <Button
                  label={progress > 0 ? 'Continue reading' : 'Start reading'}
                  icon="pi pi-book"
                  onClick={() => navigate(`/read/${book.id}`)}
                />
              )}
              <Button label="Add note" icon="pi pi-pencil" outlined onClick={() => openNoteDialog()} />
              {user?.permissions.canDeleteBook && (
                <Button label="Delete" icon="pi pi-trash" severity="danger" outlined onClick={confirmDelete} />
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid">
        <div className="col-12 lg:col-7 flex flex-column gap-3">
          {/* About: the description lives in its own card */}
          <SectionCard
            title="About this book"
            icon="pi-info-circle"
            action={
              canEdit && !editingDescription ? (
                <Button
                  label={metadata.description ? 'Edit' : 'Add'}
                  icon="pi pi-pencil"
                  text
                  onClick={() => setEditingDescription(true)}
                />
              ) : undefined
            }
          >
            {editingDescription ? (
              <div className="flex flex-column gap-2">
                <InputTextarea
                  value={description}
                  onChange={event => setDescription(event.target.value)}
                  rows={8}
                  autoResize
                  placeholder="Add a description…"
                  className="w-full"
                  aria-label="Description"
                />
                <div className="flex gap-2">
                  <Button label="Save" onClick={() => void saveDescription()} loading={updateMetadata.isPending} />
                  <Button
                    label="Cancel"
                    text
                    severity="secondary"
                    onClick={() => {
                      setDescription(metadata.description ?? '');
                      setEditingDescription(false);
                    }}
                  />
                </div>
              </div>
            ) : metadata.description ? (
              <p className="m-0 line-height-3" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {metadata.description}
              </p>
            ) : (
              <p className="m-0 text-color-secondary">No description yet.</p>
            )}
          </SectionCard>

          <SectionCard
            title={`Notes & highlights${bookNotes.length ? ` (${bookNotes.length})` : ''}`}
            icon="pi-pencil"
            action={<Button label="Add" icon="pi pi-plus" text onClick={() => openNoteDialog()} />}
          >
            {bookNotes.length === 0 ? (
              <p className="m-0 text-color-secondary text-sm">Nothing saved from this book yet.</p>
            ) : (
              <div className="flex flex-column gap-3">
                {bookNotes.map(note => (
                  <NoteCard key={note.id} note={note} showBook={false} onEdit={openNoteDialog} onDelete={confirmDeleteNote} />
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <div className="col-12 lg:col-5">
          <SectionCard title="Details" icon="pi-list">
            <div className="flex flex-column">
              {metadata.publisher && <MetaRow label="Publisher">{metadata.publisher}</MetaRow>}
              {metadata.publishedDate && <MetaRow label="Published">{formatDate(metadata.publishedDate)}</MetaRow>}
              {metadata.pageCount != null && <MetaRow label="Pages">{metadata.pageCount}</MetaRow>}
              {metadata.language && <MetaRow label="Language">{metadata.language}</MetaRow>}
              {metadata.isbn13 && <MetaRow label="ISBN-13">{metadata.isbn13}</MetaRow>}
              {metadata.isbn10 && <MetaRow label="ISBN-10">{metadata.isbn10}</MetaRow>}
              {metadata.categories && metadata.categories.length > 0 && (
                <MetaRow label="Genres">
                  <span className="flex flex-wrap gap-1">
                    {metadata.categories.map(category => (
                      <Tag key={category} value={category} />
                    ))}
                  </span>
                </MetaRow>
              )}
              {metadata.tags && metadata.tags.length > 0 && (
                <MetaRow label="Tags">
                  <span className="flex flex-wrap gap-1">
                    {metadata.tags.map(tag => (
                      <Tag key={tag} value={tag} severity="secondary" />
                    ))}
                  </span>
                </MetaRow>
              )}
              <MetaRow label="Format">{book.primaryFile?.bookType}</MetaRow>
              <MetaRow label="Size">{formatFileSize(book.fileSizeKb)}</MetaRow>
              <MetaRow label="File">{book.fileName}</MetaRow>
              <MetaRow label="Library">{book.libraryName}</MetaRow>
              <MetaRow label="Added">{formatDate(book.addedOn)}</MetaRow>
              {book.lastReadTime && <MetaRow label="Last read">{formatDate(book.lastReadTime)}</MetaRow>}
            </div>
            {!canEdit && <p className="m-0 mt-3 text-xs text-color-secondary">You can view metadata but not edit it.</p>}
          </SectionCard>
        </div>
      </div>

      {seriesSiblings.length > 0 && (
        <SectionCard title="More in this series" icon="pi-objects-column">
          <BookRow>
            {seriesSiblings.map(sibling => (
              <BookCard
                key={sibling.id}
                book={sibling}
                selected={false}
                selectionEnabled={false}
                badge={sibling.metadata.seriesNumber != null ? `#${sibling.metadata.seriesNumber}` : undefined}
              />
            ))}
          </BookRow>
        </SectionCard>
      )}

      <NoteDialog
        visible={noteDialogOpen}
        onHide={() => setNoteDialogOpen(false)}
        note={editingNote}
        draft={{ bookId: book.id, percentage: progress > 0 ? progress : undefined }}
        lockBook
      />
    </div>
  );
}
