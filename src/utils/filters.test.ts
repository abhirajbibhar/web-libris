import { describe, expect, it } from 'vitest';
import type { Book } from '../api/types';
import { applyFilters, buildFacets, isFilterActive, matchesSearch } from './filters';

const book = (overrides: Partial<Book>): Book => ({
  id: 1,
  libraryId: 1,
  libraryName: 'General',
  fileName: 'file.epub',
  addedOn: '2026-01-01T00:00:00Z',
  primaryFile: { id: 1, bookId: 1, bookType: 'EPUB', fileName: 'file.epub', extension: 'epub' },
  metadata: { bookId: 1 },
  shelves: [],
  readStatus: 'UNSET',
  ...overrides
});

describe('applyFilters', () => {
  const dune = book({
    id: 1,
    metadata: {
      title: 'Dune',
      authors: ['Frank Herbert'],
      categories: ['Science Fiction'],
      seriesName: 'Dune'
    },
    readStatus: 'READ',
    primaryFile: { id: 1, bookId: 1, bookType: 'EPUB', fileName: 'dune.epub', extension: 'epub' }
  });
  const hobbit = book({
    id: 2,
    metadata: { title: 'The Hobbit', authors: ['J.R.R. Tolkien'], categories: ['Fantasy'] },
    readStatus: 'UNREAD',
    primaryFile: { id: 2, bookId: 2, bookType: 'PDF', fileName: 'hobbit.pdf', extension: 'pdf' }
  });

  it('returns everything with no filters', () => {
    expect(applyFilters([dune, hobbit], {})).toHaveLength(2);
    expect(isFilterActive({})).toBe(false);
  });

  it('ORs values within one filter type', () => {
    const result = applyFilters([dune, hobbit], { readStatus: ['READ', 'UNREAD'] });
    expect(result.map(b => b.id)).toEqual([1, 2]);
  });

  it('ANDs across filter types', () => {
    const result = applyFilters([dune, hobbit], { readStatus: ['READ'], bookType: ['PDF'] });
    expect(result).toHaveLength(0);
    const match = applyFilters([dune, hobbit], { readStatus: ['READ'], bookType: ['EPUB'] });
    expect(match.map(b => b.id)).toEqual([1]);
  });
});

describe('matchesSearch', () => {
  const dune = book({ metadata: { title: 'Dune', authors: ['Frank Herbert'], isbn13: '9780441013593' } });

  it('matches title, author and isbn case-insensitively', () => {
    expect(matchesSearch(dune, 'dune')).toBe(true);
    expect(matchesSearch(dune, 'HERBERT')).toBe(true);
    expect(matchesSearch(dune, '9780441')).toBe(true);
  });

  it('does not match unrelated terms', () => {
    expect(matchesSearch(dune, 'tolkien')).toBe(false);
    expect(matchesSearch(dune, '')).toBe(true);
  });
});

describe('buildFacets', () => {
  it('counts values within the scope and keeps selected values visible', () => {
    const books = [
      book({ id: 1, metadata: { title: 'A', authors: ['Herbert'] } }),
      book({ id: 2, metadata: { title: 'B', authors: ['Herbert'] } }),
      book({ id: 3, metadata: { title: 'C', authors: ['Tolkien'] } })
    ];
    const facets = buildFacets(books, { author: ['Rowling'] });
    const authorFacet = facets.find(facet => facet.type === 'author');
    expect(authorFacet?.values.find(v => v.name === 'Herbert')?.bookCount).toBe(2);
    // Selected-but-absent value stays listed for deselection.
    expect(authorFacet?.values.some(v => v.name === 'Rowling')).toBe(true);
  });
});
