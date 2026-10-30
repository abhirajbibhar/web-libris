import { useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { Dialog } from 'primereact/dialog';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Menu } from 'primereact/menu';
import { Tag } from 'primereact/tag';
import { Toast } from 'primereact/toast';
import { api } from '../api/client';
import type { QuoteItem } from '../api/quotes';
import CardGrid from '../components/CardGrid';
import PageHeader from '../components/PageHeader';
import SearchField from '../components/SearchField';
import { EmptyState, LoadingState } from '../components/States';
import { useBooks } from '../hooks/useApi';
import { useCreateQuote, useDeleteQuote, useQuotes, useQuotesFromNotes, useUpdateQuote } from '../hooks/useQuotes';
import { saveBlob } from '../utils/download';

const parseTags = (text: string) => [...new Set(text.split(',').map(t => t.trim().toLowerCase()).filter(Boolean))];

export default function QuotesPage() {
  const { data: quotes, isLoading } = useQuotes();
  const { data: books } = useBooks();
  const create = useCreateQuote();
  const update = useUpdateQuote();
  const remove = useDeleteQuote();
  const fromNotes = useQuotesFromNotes();
  const toast = useRef<Toast>(null);
  const exportMenu = useRef<Menu>(null);

  const [search, setSearch] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editing, setEditing] = useState<QuoteItem | null>(null);
  const [open, setOpen] = useState(false);

  const titles = useMemo(() => new Map((books ?? []).map(b => [b.id, b.metadata.title ?? b.fileName])), [books]);
  const allTags = useMemo(() => [...new Set((quotes ?? []).flatMap(q => q.tags))].sort(), [quotes]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (quotes ?? []).filter(q => {
      if (favoritesOnly && !q.favorite) return false;
      if (tag && !q.tags.includes(tag)) return false;
      return !needle || [q.text, q.author, q.source, q.tags.join(' ')].some(v => v.toLowerCase().includes(needle));
    });
  }, [quotes, search, tag, favoritesOnly]);

  const download = async (format: 'csv' | 'json') => {
    try {
      saveBlob(await api.blob(`/api/v1/quotes/export?format=${format}`), `quotes.${format}`);
    } catch (error) {
      toast.current?.show({ severity: 'error', summary: error instanceof Error ? error.message : 'Export failed', life: 4000 });
    }
  };

  const importFromNotes = async () => {
    try {
      const { added } = await fromNotes.mutateAsync(undefined);
      toast.current?.show({
        severity: added > 0 ? 'success' : 'info',
        summary: added > 0 ? `Added ${added} ${added === 1 ? 'quote' : 'quotes'} from your highlights` : 'No new highlights to add',
        life: 3500
      });
    } catch (error) {
      toast.current?.show({ severity: 'error', summary: error instanceof Error ? error.message : 'Import failed', life: 4000 });
    }
  };

  const confirmDelete = (q: QuoteItem) =>
    confirmDialog({
      message: 'Delete this quote? The original note or highlight is not affected.',
      header: 'Delete quote',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () => remove.mutate(q.id)
    });

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  return (
    <div className="flex flex-column gap-3">
      <Toast ref={toast} />
      <ConfirmDialog />
      <PageHeader title="Quotes" subtitle={`${visible.length} ${visible.length === 1 ? 'quote' : 'quotes'}`}>
        <Button label="Add quote" icon="pi pi-plus" onClick={openNew} />
        <Button label="From highlights" icon="pi pi-download" outlined loading={fromNotes.isPending} onClick={() => void importFromNotes()} tooltip="Add every highlight you haven’t quoted yet" tooltipOptions={{ position: 'bottom' }} />
        <Menu
          ref={exportMenu}
          popup
          model={[
            { label: 'Download CSV', icon: 'pi pi-file', command: () => void download('csv') },
            { label: 'Download JSON', icon: 'pi pi-code', command: () => void download('json') }
          ]}
        />
        <Button icon="pi pi-ellipsis-v" text severity="secondary" aria-label="Export" disabled={!quotes?.length} onClick={event => exportMenu.current?.toggle(event)} />
      </PageHeader>

      <div className="flex flex-wrap gap-2 align-items-center">
        <SearchField value={search} onChange={setSearch} placeholder="Search quotes, authors, tags" />
        <Button label="Favourites" icon={favoritesOnly ? 'pi pi-star-fill' : 'pi pi-star'} outlined={!favoritesOnly} onClick={() => setFavoritesOnly(v => !v)} aria-pressed={favoritesOnly} />
        {allTags.map(t => (
          <Button key={t} label={`#${t}`} text={tag !== t} outlined={tag === t} onClick={() => setTag(tag === t ? null : t)} aria-pressed={tag === t} />
        ))}
      </div>

      {isLoading && <LoadingState />}
      {!isLoading && visible.length === 0 && (
        <EmptyState icon="pi-comment" message={quotes?.length ? 'No quotes match your filters.' : 'No quotes yet. Add one by hand, or pull in the highlights you have already made.'}>
          {!quotes?.length && (
            <div className="flex gap-2">
              <Button label="Add a quote" icon="pi pi-plus" onClick={openNew} />
              <Button label="From highlights" icon="pi pi-download" outlined onClick={() => void importFromNotes()} />
            </div>
          )}
        </EmptyState>
      )}

      <CardGrid minWidth={320}>
        {visible.map(q => (
          <div key={q.id} className="surface-card border-1 surface-border border-round p-3 flex flex-column gap-2 h-full">
            <blockquote className="m-0 line-height-3 font-italic" style={{ overflowWrap: 'anywhere' }}>
              “{q.text}”
            </blockquote>
            <div className="text-sm text-color-secondary" style={{ overflowWrap: 'anywhere' }}>
              {[q.author, q.source, q.location ? `p. ${q.location}` : ''].filter(Boolean).join(' · ') || 'Unknown source'}
            </div>
            {q.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {q.tags.map(t => (
                  <Tag key={t} value={`#${t}`} severity="secondary" />
                ))}
              </div>
            )}
            <div className="flex justify-content-end mt-auto pt-2">
              <Button icon={q.favorite ? 'pi pi-star-fill' : 'pi pi-star'} text severity={q.favorite ? 'warning' : 'secondary'} aria-label={q.favorite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => update.mutate({ id: q.id, favorite: !q.favorite })} />
              <Button icon="pi pi-copy" text severity="secondary" aria-label="Copy" onClick={() => void navigator.clipboard?.writeText(`“${q.text}”${q.author ? ` — ${q.author}` : ''}`)} />
              <Button icon="pi pi-pencil" text severity="secondary" aria-label="Edit" onClick={() => { setEditing(q); setOpen(true); }} />
              <Button icon="pi pi-trash" text severity="danger" aria-label="Delete" onClick={() => confirmDelete(q)} />
            </div>
          </div>
        ))}
      </CardGrid>

      <QuoteDialog
        key={editing?.id ?? 'new'}
        visible={open}
        quote={editing}
        bookOptions={[...titles.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))}
        onHide={() => setOpen(false)}
        onSave={async input => {
          if (editing) await update.mutateAsync({ id: editing.id, ...input });
          else await create.mutateAsync(input);
          setOpen(false);
        }}
      />
    </div>
  );
}

function QuoteDialog({
  visible,
  quote,
  bookOptions,
  onHide,
  onSave
}: {
  visible: boolean;
  quote: QuoteItem | null;
  bookOptions: { label: string; value: number }[];
  onHide: () => void;
  onSave: (input: { text: string; author: string; source: string; location: string; tags: string[]; bookId?: number | null }) => Promise<void>;
}) {
  const [text, setText] = useState(quote?.text ?? '');
  const [author, setAuthor] = useState(quote?.author ?? '');
  const [source, setSource] = useState(quote?.source ?? '');
  const [location, setLocation] = useState(quote?.location ?? '');
  const [tags, setTags] = useState(quote?.tags.join(', ') ?? '');
  const [bookId, setBookId] = useState<number | null>(quote?.bookId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!text.trim()) {
      setError('The quote needs some text.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ text, author, source, location, tags: parseTags(tags), bookId });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog visible={visible} onHide={onHide} header={quote ? 'Edit quote' : 'New quote'} style={{ width: 'min(36rem, 96vw)' }} modal draggable={false}
      footer={<><Button label="Cancel" text severity="secondary" onClick={onHide} /><Button label="Save" icon="pi pi-check" loading={busy} onClick={() => void submit()} /></>}>
      <div className="flex flex-column gap-3">
        <div className="flex flex-column gap-1">
          <label htmlFor="q-text" className="font-medium">Quote</label>
          <InputTextarea id="q-text" value={text} onChange={e => setText(e.target.value)} rows={4} autoResize maxLength={5000} autoFocus />
        </div>
        <div className="grid">
          <div className="col-12 md:col-6 flex flex-column gap-1">
            <label htmlFor="q-author" className="font-medium">Author</label>
            <InputText id="q-author" value={author} onChange={e => setAuthor(e.target.value)} maxLength={300} />
          </div>
          <div className="col-12 md:col-6 flex flex-column gap-1">
            <label htmlFor="q-source" className="font-medium">Source</label>
            <InputText id="q-source" value={source} onChange={e => setSource(e.target.value)} maxLength={300} placeholder="Book, article, speech…" />
          </div>
          <div className="col-12 md:col-6 flex flex-column gap-1">
            <label htmlFor="q-book" className="font-medium">Book in your library</label>
            <Dropdown inputId="q-book" value={bookId} options={bookOptions} onChange={e => setBookId(e.value as number | null)} showClear filter placeholder="Optional" />
          </div>
          <div className="col-12 md:col-6 flex flex-column gap-1">
            <label htmlFor="q-loc" className="font-medium">Page</label>
            <InputText id="q-loc" value={location} onChange={e => setLocation(e.target.value)} maxLength={100} />
          </div>
        </div>
        <div className="flex flex-column gap-1">
          <label htmlFor="q-tags" className="font-medium">Tags</label>
          <InputText id="q-tags" value={tags} onChange={e => setTags(e.target.value)} placeholder="stoicism, courage" />
          <small className="text-color-secondary">Separate with commas.</small>
        </div>
        {error && <small className="text-red-500" role="alert">{error}</small>}
      </div>
    </Dialog>
  );
}
