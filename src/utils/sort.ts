import type { Book } from '../api/types';

export type SortField =
  | 'title'
  | 'author'
  | 'seriesName'
  | 'addedOn'
  | 'lastReadTime'
  | 'personalRating'
  | 'fileSizeKb'
  | 'pageCount'
  | 'publishedDate'
  | 'readStatus';

export type SortDirection = 'asc' | 'desc';

export const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'title', label: 'Title' },
  { field: 'author', label: 'Author' },
  { field: 'seriesName', label: 'Series' },
  { field: 'addedOn', label: 'Date Added' },
  { field: 'lastReadTime', label: 'Last Read' },
  { field: 'personalRating', label: 'My Rating' },
  { field: 'fileSizeKb', label: 'File Size' },
  { field: 'pageCount', label: 'Page Count' },
  { field: 'publishedDate', label: 'Published' },
  { field: 'readStatus', label: 'Read Status' }
];

const textOf = (book: Book, field: SortField): string => {
  switch (field) {
    case 'title':
      return (book.metadata.title ?? book.fileName).toLowerCase();
    case 'author':
      return (book.metadata.authors?.[0] ?? '').toLowerCase();
    case 'seriesName':
      return (book.metadata.seriesName ?? '').toLowerCase();
    case 'publishedDate':
      return book.metadata.publishedDate ?? '';
    case 'readStatus':
      return book.readStatus ?? 'UNSET';
    default:
      return '';
  }
};

const numberOrNull = (book: Book, field: SortField): number | null => {
  switch (field) {
    case 'personalRating':
      return book.personalRating ?? null;
    case 'fileSizeKb':
      return book.fileSizeKb ?? null;
    case 'pageCount':
      return book.metadata.pageCount ?? null;
    default:
      return null;
  }
};

const dateOf = (book: Book, field: SortField): number => {
  const iso =
    field === 'addedOn' ? book.addedOn : field === 'lastReadTime' ? book.lastReadTime ?? book.addedOn : undefined;
  const time = iso ? new Date(iso).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
};

export function sortBooks(books: Book[], field: SortField, direction: SortDirection): Book[] {
  const factor = direction === 'asc' ? 1 : -1;
  const sorted = [...books].sort((a, b) => {
    const aNumber = numberOrNull(a, field);
    const bNumber = numberOrNull(b, field);
    if (aNumber !== null || bNumber !== null) {
      // Missing numeric values always sink to the bottom regardless of direction.
      if (aNumber === null && bNumber === null) return 0;
      if (aNumber === null) return 1;
      if (bNumber === null) return -1;
      return (aNumber - bNumber) * factor;
    }
    if (field === 'addedOn' || field === 'lastReadTime') {
      return (dateOf(a, field) - dateOf(b, field)) * factor;
    }
    return textOf(a, field).localeCompare(textOf(b, field)) * factor;
  });
  return sorted;
}
