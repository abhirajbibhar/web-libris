import type { Book } from '../api/types';

export interface GroupedEntity {
  /** Route-safe identifier (lowercased key). */
  id: string;
  name: string;
  books: Book[];
}

function groupBy(books: Book[], keyOf: (book: Book) => { id: string; name: string } | null): GroupedEntity[] {
  const groups = new Map<string, GroupedEntity>();
  for (const book of books) {
    const key = keyOf(book);
    if (!key) continue;
    const group = groups.get(key.id) ?? { id: key.id, name: key.name, books: [] };
    group.books.push(book);
    groups.set(key.id, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function deriveSeries(books: Book[]): GroupedEntity[] {
  const groups = groupBy(books, book => {
    const name = book.metadata.seriesName?.trim();
    return name ? { id: name.toLowerCase(), name } : null;
  });
  for (const group of groups) {
    group.books.sort(
      (a, b) => (a.metadata.seriesNumber ?? Number.MAX_SAFE_INTEGER) - (b.metadata.seriesNumber ?? Number.MAX_SAFE_INTEGER)
    );
  }
  return groups;
}

export function deriveAuthors(books: Book[]): GroupedEntity[] {
  const authors: GroupedEntity[] = [];
  const byId = new Map<string, GroupedEntity>();
  for (const book of books) {
    for (const rawName of book.metadata.authors ?? []) {
      const name = rawName.trim();
      if (!name) continue;
      const id = name.toLowerCase();
      let entity = byId.get(id);
      if (!entity) {
        entity = { id, name, books: [] };
        byId.set(id, entity);
        authors.push(entity);
      }
      if (!entity.books.some(existing => existing.id === book.id)) {
        entity.books.push(book);
      }
    }
  }
  return authors.sort((a, b) => a.name.localeCompare(b.name));
}

export function findSeriesByName(books: Book[], seriesId: string): GroupedEntity | undefined {
  return deriveSeries(books).find(series => series.id === seriesId);
}

export function findAuthorById(books: Book[], authorId: string): GroupedEntity | undefined {
  return deriveAuthors(books).find(author => author.id === authorId);
}
