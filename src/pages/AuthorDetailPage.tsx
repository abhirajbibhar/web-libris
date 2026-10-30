import { useMemo } from 'react';
import { Link, useParams } from '~/router/compat';
import BookCard from '../components/BookCard';
import CardGrid from '../components/CardGrid';
import PageHeader from '../components/PageHeader';
import { EmptyState, LoadingState } from '../components/States';
import { useBooks } from '../hooks/useApi';
import { findAuthorById } from '../utils/entities';

export default function AuthorDetailPage() {
  const { authorId } = useParams();
  const { data: books, isLoading } = useBooks();

  const author = useMemo(
    () => (books && authorId ? findAuthorById(books, authorId) : undefined),
    [books, authorId]
  );

  const sortedBooks = useMemo(
    () =>
      [...(author?.books ?? [])].sort((a, b) =>
        (a.metadata.title ?? a.fileName).localeCompare(b.metadata.title ?? b.fileName)
      ),
    [author]
  );

  if (isLoading) return <LoadingState />;
  if (!author) {
    return (
      <EmptyState icon="pi-users" message="Author not found.">
        <Link to="/authors">Back to authors</Link>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-column gap-3">
      <PageHeader title={author.name} subtitle={`${author.books.length} books`} />
      <CardGrid>
        {sortedBooks.map(book => (
          <BookCard key={book.id} book={book} selected={false} selectionEnabled={false} />
        ))}
      </CardGrid>
    </div>
  );
}
