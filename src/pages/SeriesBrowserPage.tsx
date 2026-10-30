import { useMemo, useState } from 'react';
import { coverUrl } from '../api/types';
import CardGrid from '../components/CardGrid';
import { CoverPlaceholder } from '../components/BookCard';
import EntityCard from '../components/EntityCard';
import PageHeader from '../components/PageHeader';
import SearchField from '../components/SearchField';
import { EmptyState, LoadingState } from '../components/States';
import { useBooks } from '../hooks/useApi';
import { deriveSeries } from '../utils/entities';

export default function SeriesBrowserPage() {
  const { data: books, isLoading } = useBooks();
  const [search, setSearch] = useState('');

  const series = useMemo(() => deriveSeries(books ?? []), [books]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? series.filter(entry => entry.name.toLowerCase().includes(needle)) : series;
  }, [series, search]);

  return (
    <div className="flex flex-column gap-3">
      <PageHeader title="Series" subtitle={`${visible.length} series`}>
        <SearchField value={search} onChange={setSearch} placeholder="Search series" />
      </PageHeader>

      {isLoading && <LoadingState />}
      {!isLoading && visible.length === 0 && (
        <EmptyState
          icon="pi-objects-column"
          message={search ? 'No series match your search.' : 'No series yet. Set a series name on a book’s metadata.'}
        />
      )}

      <CardGrid minWidth={140}>
        {visible.map(entry => {
          const cover = coverUrl(entry.books[0]);
          return (
            <EntityCard
              key={entry.id}
              to={`/series/${encodeURIComponent(entry.id)}`}
              name={entry.name}
              count={`${entry.books.length} books`}
              media={
                <div className="overflow-hidden" style={{ aspectRatio: '2 / 3' }}>
                  {cover ? (
                    <img src={cover} alt={entry.name} loading="lazy" className="block w-full h-full" style={{ objectFit: 'cover' }} />
                  ) : (
                    <CoverPlaceholder icon="pi-objects-column" />
                  )}
                </div>
              }
            />
          );
        })}
      </CardGrid>
    </div>
  );
}
