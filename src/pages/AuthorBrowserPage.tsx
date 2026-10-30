import { useMemo, useState } from 'react';
import { Avatar } from 'primereact/avatar';
import CardGrid from '../components/CardGrid';
import EntityCard from '../components/EntityCard';
import PageHeader from '../components/PageHeader';
import SearchField from '../components/SearchField';
import { EmptyState, LoadingState } from '../components/States';
import { useBooks } from '../hooks/useApi';
import { deriveAuthors } from '../utils/entities';

export default function AuthorBrowserPage() {
  const { data: books, isLoading } = useBooks();
  const [search, setSearch] = useState('');

  const authors = useMemo(() => deriveAuthors(books ?? []), [books]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? authors.filter(entry => entry.name.toLowerCase().includes(needle)) : authors;
  }, [authors, search]);

  return (
    <div className="flex flex-column gap-3">
      <PageHeader title="Authors" subtitle={`${visible.length} authors`}>
        <SearchField value={search} onChange={setSearch} placeholder="Search authors" />
      </PageHeader>

      {isLoading && <LoadingState />}
      {!isLoading && visible.length === 0 && (
        <EmptyState
          icon="pi-users"
          message={search ? 'No authors match your search.' : 'No authors yet. Upload books with embedded author metadata.'}
        />
      )}

      <CardGrid minWidth={140}>
        {visible.map(entry => (
          <EntityCard
            key={entry.id}
            to={`/author/${encodeURIComponent(entry.id)}`}
            name={entry.name}
            count={`${entry.books.length} books`}
            media={
              <div className="flex justify-content-center pt-4">
                <Avatar label={entry.name.charAt(0).toUpperCase()} size="xlarge" shape="circle" />
              </div>
            }
          />
        ))}
      </CardGrid>
    </div>
  );
}
