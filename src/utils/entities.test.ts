import { describe, expect, it } from 'vitest';
import type { Book } from '../api/types';
import { deriveAuthors, deriveSeries } from './entities';
import { sortBooks } from './sort';

const book = (id: number, metadata: Book['metadata'], extra: Partial<Book> = {}): Book => ({
  id,
  libraryId: 1,
  libraryName: 'General',
  fileName: `book-${id}.epub`,
  addedOn: '2026-01-01T00:00:00Z',
  primaryFile: { id, bookId: id, bookType: 'EPUB', fileName: `book-${id}.epub`, extension: 'epub' },
  metadata: { bookId: id, ...metadata },
  shelves: [],
  readStatus: 'UNSET',
  ...extra
});

describe('sortBooks', () => {
  const books = [
    book(1, { title: 'dune' }),
    book(2, { title: 'Ancillary Justice' }),
    book(3, { title: 'Children of Time' })
  ];

  it('sorts titles case-insensitively', () => {
    expect(sortBooks(books, 'title', 'asc').map(b => b.metadata.title)).toEqual([
      'Ancillary Justice',
      'Children of Time',
      'dune'
    ]);
  });

  it('sinks missing numeric values regardless of direction', () => {
    const withRatings = [
      book(1, { title: 'A' }, { personalRating: 8 }),
      book(2, { title: 'B' }),
      book(3, { title: 'C' }, { personalRating: 4 })
    ];
    expect(sortBooks(withRatings, 'personalRating', 'desc').map(b => b.id)).toEqual([1, 3, 2]);
    expect(sortBooks(withRatings, 'personalRating', 'asc').map(b => b.id)).toEqual([3, 1, 2]);
  });
});

describe('deriveSeries', () => {
  it('groups case-insensitively and orders by series number', () => {
    const books = [
      book(1, { title: 'Book 2', seriesName: 'Dune', seriesNumber: 2 }),
      book(2, { title: 'Book 1', seriesName: 'dune', seriesNumber: 1 }),
      book(3, { title: 'Solo', seriesName: undefined })
    ];
    const series = deriveSeries(books);
    expect(series).toHaveLength(1);
    expect(series[0].books.map(b => b.id)).toEqual([2, 1]);
  });
});

describe('deriveAuthors', () => {
  it('deduplicates books per author and groups multi-author books', () => {
    const books = [
      book(1, { title: 'A', authors: ['Frank Herbert'] }),
      book(2, { title: 'B', authors: ['Frank Herbert'] }),
      book(3, { title: 'C', authors: ['Ann Leckie', 'Frank Herbert'] })
    ];
    const authors = deriveAuthors(books);
    const frank = authors.find(author => author.id === 'frank herbert');
    expect(frank?.books.map(b => b.id)).toEqual([1, 2, 3]);
    expect(authors).toHaveLength(2);
  });
});
