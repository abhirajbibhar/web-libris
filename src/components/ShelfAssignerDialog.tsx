import { useEffect, useRef, useState } from 'react';
import { THIN_SCROLL } from '../utils/scroll';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { Toast } from 'primereact/toast';
import { useShelves, useUpdateBookShelves } from '../hooks/useApi';
import type { Book } from '../api/types';
import CheckRow from './CheckRow';

export default function ShelfAssignerDialog({
  visible,
  onHide,
  books,
  onDone
}: {
  visible: boolean;
  onHide: () => void;
  books: Book[];
  onDone?: () => void;
}) {
  const toast = useRef<Toast>(null);
  const { data: shelves } = useShelves();
  const updateShelves = useUpdateBookShelves();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Pre-check shelves that every selected book already belongs to.
  useEffect(() => {
    if (!visible || !shelves) return;
    const common = new Set<number>();
    for (const shelf of shelves) {
      if (books.length > 0 && books.every(book => book.shelves.some(s => s.id === shelf.id))) {
        common.add(shelf.id);
      }
    }
    setSelected(common);
  }, [visible, shelves, books]);

  const toggle = (id: number, checked: boolean) => {
    setSelected(current => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const apply = async () => {
    const bookIds = books.map(book => book.id);
    const shelvesToAssign: number[] = [];
    const shelvesToUnassign: number[] = [];
    for (const shelf of shelves ?? []) {
      const isSelected = selected.has(shelf.id);
      const allOnShelf = books.every(book => book.shelves.some(s => s.id === shelf.id));
      const noneOnShelf = books.every(book => !book.shelves.some(s => s.id === shelf.id));
      if (isSelected && noneOnShelf) shelvesToAssign.push(shelf.id);
      if (!isSelected && allOnShelf) shelvesToUnassign.push(shelf.id);
    }
    if (shelvesToAssign.length === 0 && shelvesToUnassign.length === 0) {
      onHide();
      return;
    }
    try {
      await updateShelves.mutateAsync({ bookIds, shelvesToAssign, shelvesToUnassign });
      toast.current?.show({ severity: 'success', summary: 'Shelves updated', life: 2000 });
      onHide();
      onDone?.();
    } catch (error) {
      toast.current?.show({
        severity: 'error',
        summary: 'Could not update shelves',
        detail: error instanceof Error ? error.message : undefined,
        life: 3000
      });
    }
  };

  const footer = (
    <div className="flex justify-content-end gap-2">
      <Button label="Cancel" text severity="secondary" onClick={onHide} />
      <Button label="Apply" onClick={() => void apply()} loading={updateShelves.isPending} />
    </div>
  );

  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      header="Assign to Shelf"
      footer={footer}
      style={{ width: '24rem' }}
      breakpoints={{ '640px': '95vw' }}
    >
      <Toast ref={toast} />
      {shelves && shelves.length > 0 ? (
        <div className="flex flex-column gap-3 overflow-y-auto" style={{ maxHeight: '20rem', ...THIN_SCROLL }}>
          {shelves.map(shelf => (
            <CheckRow
              key={shelf.id}
              id={`shelf-assign-${shelf.id}`}
              label={shelf.name}
              count={shelf.bookCount ?? 0}
              checked={selected.has(shelf.id)}
              onChange={checked => toggle(shelf.id, checked)}
            />
          ))}
        </div>
      ) : (
        <p className="m-0 text-color-secondary">No shelves yet. Create one from Settings → Shelves.</p>
      )}
    </Dialog>
  );
}
