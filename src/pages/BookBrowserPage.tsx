import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from '~/router/compat';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import { DataTable } from 'primereact/datatable';
import { Dropdown } from 'primereact/dropdown';
import { ProgressBar } from 'primereact/progressbar';
import { Rating } from 'primereact/rating';
import { SelectButton } from 'primereact/selectbutton';
import { Tag } from 'primereact/tag';
import { Toolbar } from 'primereact/toolbar';
import { useAuth } from '../auth/AuthContext';
import { useMedia } from '../hooks/useMedia';
import BookCard, { BookCardSkeleton } from '../components/BookCard';
import BookFilterPanel from '../components/BookFilterPanel';
import CardGrid from '../components/CardGrid';
import PageHeader from '../components/PageHeader';
import SearchField from '../components/SearchField';
import { THIN_SCROLL } from '../utils/scroll';
import { tip } from '../utils/tooltip';
import { EmptyState } from '../components/States';
import ShelfAssignerDialog from '../components/ShelfAssignerDialog';
import { coverUrl } from '../api/types';
import type { Book, ReadStatus } from '../api/types';
import { useBooks, useDeleteBooks, useLibraries, useShelves, useUpdateBookShelves, useUpdateBookStatus } from '../hooks/useApi';
import { applyFilters, isFilterActive, matchesSearch, type FilterSelection } from '../utils/filters';
import { formatDate, formatFileSize, READ_STATUS_LABELS, READ_STATUS_OPTIONS } from '../utils/format';
import { SORT_OPTIONS, sortBooks, type SortDirection, type SortField } from '../utils/sort';

const stored = (key: string, fallback: string) => localStorage.getItem(key) ?? fallback;

type EntityType = 'all' | 'library' | 'shelf' | 'unshelved';

const VIEW_OPTIONS = [
  { label: 'Grid view', value: 'grid', icon: 'pi pi-th-large' },
  { label: 'Table view', value: 'table', icon: 'pi pi-list' }
];

export default function BookBrowserPage() {
  const { libraryId, shelfId } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const isMobile = useMedia('(max-width: 900px)');

  const { data: books, isLoading } = useBooks();
  const { data: libraries } = useLibraries();
  const { data: shelves } = useShelves();
  const updateStatus = useUpdateBookStatus();
  const updateBookShelves = useUpdateBookShelves();
  const deleteBooks = useDeleteBooks();

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterSelection>({});
  const [sortField, setSortField] = useState<SortField>(() => stored('booklore-sort-field', 'title') as SortField);
  const [sortDir, setSortDir] = useState<SortDirection>(() => stored('booklore-sort-dir', 'asc') as SortDirection);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => stored('booklore-view-mode', 'grid') as 'grid' | 'table');
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [assignerOpen, setAssignerOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('booklore-sort-field', sortField);
    localStorage.setItem('booklore-sort-dir', sortDir);
    localStorage.setItem('booklore-view-mode', viewMode);
  }, [sortField, sortDir, viewMode]);

  const entityType: EntityType = shelfId
    ? 'shelf'
    : libraryId
      ? 'library'
      : location.pathname === '/unshelved-books'
        ? 'unshelved'
        : 'all';

  const activeShelf = useMemo(
    () => (shelfId ? shelves?.find(s => s.id === Number(shelfId)) : undefined),
    [shelves, shelfId]
  );
  const activeLibrary = useMemo(
    () => (libraryId ? libraries?.find(l => l.id === Number(libraryId)) : undefined),
    [libraries, libraryId]
  );

  const entityBooks = useMemo(() => {
    const all = books ?? [];
    if (entityType === 'library') return all.filter(b => b.libraryId === Number(libraryId));
    if (entityType === 'shelf') return all.filter(b => b.shelves.some(s => s.id === Number(shelfId)));
    if (entityType === 'unshelved') return all.filter(b => (b.shelves?.length ?? 0) === 0);
    return all;
  }, [books, entityType, libraryId, shelfId]);

  const searched = useMemo(() => entityBooks.filter(book => matchesSearch(book, search)), [entityBooks, search]);
  const filtered = useMemo(() => applyFilters(searched, filters), [searched, filters]);
  const sorted = useMemo(() => sortBooks(filtered, sortField, sortDir), [filtered, sortField, sortDir]);

  const filtersActive = isFilterActive(filters) || search.trim().length > 0;

  const title = (() => {
    const base =
      entityType === 'library'
        ? `Library: ${activeLibrary?.name ?? ''}`
        : entityType === 'shelf'
          ? `Shelf: ${activeShelf?.name ?? ''}`
          : entityType === 'unshelved'
            ? 'Unshelved Books'
            : 'All Books';
    return filtersActive ? `${base} (filtered)` : base;
  })();

  const selectedBooks = sorted.filter(book => selectedIds.has(book.id));

  const toggleSelect = (book: Book) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(book.id)) next.delete(book.id);
      else next.add(book.id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(sorted.map(book => book.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const changeStatus = (status: ReadStatus) => {
    if (selectedIds.size === 0) return;
    updateStatus.mutate({ bookIds: [...selectedIds], status }, { onSuccess: clearSelection });
  };

  const unshelf = () => {
    if (!shelfId || selectedIds.size === 0) return;
    updateBookShelves.mutate(
      { bookIds: [...selectedIds], shelvesToAssign: [], shelvesToUnassign: [Number(shelfId)] },
      { onSuccess: clearSelection }
    );
  };

  const confirmDelete = () => {
    confirmDialog({
      message: `Delete ${selectedIds.size} book(s) and their files? This cannot be undone.`,
      header: 'Delete Books',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: () =>
        deleteBooks.mutate([...selectedIds], {
          onSuccess: clearSelection
        })
    });
  };

  /* ------------------------------ rendering ------------------------------ */

  const renderGrid = () => (
    <CardGrid>
      {sorted.map(book => (
        <BookCard
          key={book.id}
          book={book}
          selected={selectedIds.has(book.id)}
          selectionActive={selectedIds.size > 0}
          onToggleSelect={b => toggleSelect(b)}
        />
      ))}
    </CardGrid>
  );

  const tableRows = useMemo(
    () =>
      sorted.map(book => ({
        ...book,
        title: book.metadata.title ?? book.fileName,
        author: book.metadata.authors?.join(', ') ?? '',
        seriesName: book.metadata.seriesName ?? ''
      })),
    [sorted]
  );
  type TableRow = (typeof tableRows)[number];

  const coverCell = (book: TableRow) => {
    const cover = coverUrl(book);
    return cover ? (
      <img
        src={cover}
        alt=""
        loading="lazy"
        className="border-round flex-shrink-0"
        style={{ width: '2.25rem', height: '3.25rem', objectFit: 'cover' }}
      />
    ) : (
      <div
        className="flex align-items-center justify-content-center border-round flex-shrink-0 surface-200 text-color-secondary"
        style={{ width: '2.25rem', height: '3.25rem' }}
      >
        <i className="pi pi-book" />
      </div>
    );
  };

  const renderTable = () => (
    <DataTable
      value={tableRows}
      dataKey="id"
      size="small"
      stripedRows
      tableClassName="white-space-nowrap"
      paginator
      rows={50}
      rowsPerPageOptions={[25, 50, 100]}
      scrollable
      pt={{ wrapper: { style: THIN_SCROLL } }}
      selectionMode="checkbox"
      selection={tableRows.filter(row => selectedIds.has(row.id))}
      onSelectionChange={event => setSelectedIds(new Set((event.value as TableRow[]).map(row => row.id)))}
      sortField={sortField}
      sortOrder={sortDir === 'asc' ? 1 : -1}
      onSort={event => {
        if (event.sortField) setSortField(event.sortField as SortField);
        setSortDir(event.sortOrder === 1 || event.sortOrder === undefined ? 'asc' : 'desc');
      }}
    >
      <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} />
      <Column
        field="title"
        header="Title"
        sortable
        style={{ minWidth: '16rem' }}
        body={(book: TableRow) => (
          <div className="flex align-items-center gap-3 min-w-0">
            {coverCell(book)}
            <Link
              to={`/book/${book.id}`}
              title={book.title}
              className="text-color font-medium no-underline hover:text-primary white-space-nowrap overflow-hidden text-overflow-ellipsis"
              style={{ maxWidth: '22rem' }}
            >
              {book.title}
            </Link>
          </div>
        )}
      />
      <Column field="author" header="Author" sortable />
      <Column field="seriesName" header="Series" sortable />
      <Column
        field="readStatus"
        header="Status"
        sortable
        body={(book: TableRow) => (
          <Tag
            value={READ_STATUS_LABELS[book.readStatus] ?? book.readStatus}
            severity={book.readStatus === 'READ' ? 'success' : 'info'}
          />
        )}
      />
      <Column
        field="personalRating"
        header="Rating"
        sortable
        body={(book: TableRow) =>
          // Ratings are stored on a 0-10 scale; the stars show 0-5.
          book.personalRating ? <Rating value={book.personalRating / 2} readOnly cancel={false} stars={5} /> : null
        }
      />
      <Column field="addedOn" header="Added" sortable body={(book: TableRow) => formatDate(book.addedOn)} />
      <Column field="lastReadTime" header="Last Read" sortable body={(book: TableRow) => formatDate(book.lastReadTime)} />
      <Column field="fileSizeKb" header="Size" sortable body={(book: TableRow) => formatFileSize(book.fileSizeKb)} />
    </DataTable>
  );

  const selectedCount = selectedIds.size;

  return (
    // Desktop: header + toolbar stay put while the books (and the filter card) scroll
    // independently below them. Mobile keeps one normal page scroll.
    <div className={`flex flex-column gap-3${isMobile ? '' : ' h-full'}`}>
      <ConfirmDialog />
      <div className="flex flex-column gap-3 flex-shrink-0">
      <PageHeader title={title} subtitle={`${sorted.length} books`} />

      <Toolbar
        className="surface-card"
        start={
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search title, author, series, ISBN"
            className="w-full md:w-20rem"
          />
        }
        end={
          <div className="flex flex-wrap align-items-center gap-2">
            <Dropdown
              value={sortField}
              options={SORT_OPTIONS.map(option => ({ label: option.label, value: option.field }))}
              onChange={event => setSortField(event.value)}
              aria-label="Sort by"
            />
            <Button
              icon={sortDir === 'asc' ? 'pi pi-sort-alpha-down' : 'pi pi-sort-alpha-up'}
              text
              severity="secondary"
              onClick={() => setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'))}
              aria-label="Toggle sort direction"
              {...tip('Toggle sort direction')}
            />
            <SelectButton
              value={viewMode}
              options={VIEW_OPTIONS}
              optionValue="value"
              allowEmpty={false}
              onChange={event => setViewMode(event.value as 'grid' | 'table')}
              itemTemplate={option => (
                <span className="p-button-label p-c">
                  <i className={option.icon} aria-label={option.label} />
                </span>
              )}
            />
            <Button
              icon="pi pi-filter"
              text={!filterPanelOpen}
              severity={filtersActive ? undefined : 'secondary'}
              badge={filtersActive ? '•' : undefined}
              badgeClassName="p-badge-danger"
              onClick={() => setFilterPanelOpen(open => !open)}
              aria-label="Filters"
              {...tip('Filters')}
            />
          </div>
        }
      />
      </div>

      <div className={`flex gap-3 align-items-start${isMobile ? '' : ' flex-1 min-h-0'}`}>
        <div
          className={`flex-1 min-w-0${isMobile ? '' : ' h-full overflow-y-auto pb-2'}`}
          style={isMobile ? undefined : THIN_SCROLL}
        >
          {isLoading && (
            <CardGrid>
              {Array.from({ length: 12 }).map((_, index) => (
                <BookCardSkeleton key={index} />
              ))}
            </CardGrid>
          )}
          {!isLoading && sorted.length === 0 && (
            <EmptyState
              icon="pi-book"
              message={filtersActive ? 'No books match the current filters.' : 'No books yet. Upload some to get started.'}
            />
          )}
          {!isLoading && sorted.length > 0 && (viewMode === 'grid' ? renderGrid() : renderTable())}
        </div>

        <BookFilterPanel
          visible={filterPanelOpen}
          onHide={() => setFilterPanelOpen(false)}
          books={entityBooks}
          selection={filters}
          onSelectionChange={setFilters}
          onClear={() => {
            setFilters({});
            setSearch('');
          }}
          isMobile={isMobile}
        />
      </div>

      {selectedCount > 0 && (
        <Toolbar
          className={`shadow-4 z-5 gap-2 ${isMobile ? 'border-noround' : 'border-round-xl'}`}
          style={
            isMobile
              ? { position: 'fixed', left: 0, right: 0, bottom: 0 }
              : { position: 'fixed', left: '50%', bottom: '1rem', transform: 'translateX(-50%)', maxWidth: 'calc(100vw - 1rem)' }
          }
          start={
            <span className="flex align-items-center gap-2 white-space-nowrap font-medium">
              <i className="pi pi-check-circle text-primary" /> {selectedCount} selected
            </span>
          }
          end={
            <div className="flex flex-wrap align-items-center gap-2">
              <Button
                icon="pi pi-bookmark-fill"
                outlined
                severity="secondary"
                aria-label="Assign to shelf"
                {...tip('Assign to shelf')}
                onClick={() => setAssignerOpen(true)}
              />
              {entityType === 'shelf' && (
                <Button
                  icon="pi pi-bookmark"
                  outlined
                  severity="secondary"
                  aria-label="Remove from this shelf"
                  {...tip('Remove from this shelf')}
                  onClick={unshelf}
                />
              )}
              <Dropdown
                value={null}
                options={READ_STATUS_OPTIONS}
                onChange={event => changeStatus(event.value as ReadStatus)}
                placeholder={isMobile ? 'Status' : 'Set status'}
                className={isMobile ? 'w-7rem' : undefined}
              />
              <Button icon="pi pi-check-square" outlined severity="secondary" aria-label="Select all" {...tip('Select all')} onClick={selectAll} />
              <Button icon="pi pi-times" outlined severity="secondary" aria-label="Clear selection" {...tip('Clear selection')} onClick={clearSelection} />
              {user?.permissions.canDeleteBook && (
                <Button icon="pi pi-trash" outlined severity="danger" aria-label="Delete selected" {...tip('Delete selected')} onClick={confirmDelete} />
              )}
            </div>
          }
        />
      )}

      <ShelfAssignerDialog
        visible={assignerOpen}
        onHide={() => setAssignerOpen(false)}
        books={selectedBooks}
        onDone={clearSelection}
      />
      {updateStatus.isPending && <ProgressBar mode="indeterminate" style={{ height: '2px' }} />}
    </div>
  );
}
