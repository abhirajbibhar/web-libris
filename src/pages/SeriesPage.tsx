import { useMemo } from 'react';
import { Link, useParams } from '~/router/compat';
import BookCard from '../components/BookCard';
import CardGrid from '../components/CardGrid';
import PageHeader from '../components/PageHeader';
import { EmptyState, LoadingState } from '../components/States';
import { useBooks } from '../hooks/useApi';
import { findSeriesByName } from '../utils/entities';

export default function SeriesPage() {
  const { seriesName } = useParams();
  const { data: books, isLoading } = useBooks();

  const series = useMemo(
    () => (books && seriesName ? findSeriesByName(books, seriesName) : undefined),
    [books, seriesName]
  );

  if (isLoading) return <LoadingState />;
  if (!series) {
    return (
      <EmptyState icon="pi-objects-column" message="Series not found.">
        <Link to="/series">Back to series</Link>
      </EmptyState>
    );
  }

  const total = series.books[0]?.metadata.seriesTotal;

  return (
    <div className="flex flex-column gap-3">
      <PageHeader title={series.name} subtitle={`${series.books.length} books${total ? ` of ${total}` : ''}`} />
      <CardGrid>
        {series.books.map(book => (
          <BookCard
            key={book.id}
            book={book}
            selected={false}
            selectionEnabled={false}
            badge={book.metadata.seriesNumber != null ? `#${book.metadata.seriesNumber}` : undefined}
          />
        ))}
      </CardGrid>
    </div>
  );
}
