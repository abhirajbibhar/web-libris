import { useMemo } from 'react';
import { Link, useNavigate } from '~/router/compat';
import { Button } from 'primereact/button';
import { bookProgressPercent } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import BookCard from '../components/BookCard';
import BookRow from '../components/BookRow';
import QuoteCard from '../components/QuoteCard';
import SectionCard from '../components/SectionCard';
import { EmptyState, LoadingState } from '../components/States';
import TodayPlanCard from '../components/TodayPlanCard';
import { useBooks } from '../hooks/useApi';
import { useActivity } from '../hooks/useJournal';
import { formatLongDate, greeting, todayKey } from '../utils/dates';
import { computeStreaks } from '../utils/streak';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: books, isLoading } = useBooks();
  const { data: activity } = useActivity();
  const today = todayKey();

  const stats = useMemo(() => computeStreaks(activity ?? {}, today), [activity, today]);

  const continueReading = useMemo(
    () =>
      (books ?? [])
        .filter(b => b.lastReadTime && b.readStatus !== 'READ' && bookProgressPercent(b) > 0 && bookProgressPercent(b) < 100)
        .sort((a, b) => (b.lastReadTime ?? '').localeCompare(a.lastReadTime ?? ''))
        .slice(0, 10),
    [books]
  );
  const recentlyAdded = useMemo(
    () => [...(books ?? [])].sort((a, b) => b.addedOn.localeCompare(a.addedOn)).slice(0, 12),
    [books]
  );

  const name = (user?.name || user?.username || '').split(' ')[0];

  return (
    <div className="grid">
      <div className="col-12 lg:col-8">
        <SectionCard className="h-full" title={formatLongDate(today)} icon="pi-calendar">
          <h1 className="m-0 mb-1 text-3xl font-semibold">
            {greeting(new Date().getHours())}
            {name ? `, ${name}` : ''}
          </h1>
          <p className="m-0 text-color-secondary">
            {stats.readToday
              ? 'Nice work, you have read today. Keep it going.'
              : stats.current > 0
                ? 'A few pages today keeps your streak alive.'
                : 'A few pages today is a great place to begin.'}{' '}
            <Link to="/streak" className="no-underline text-primary white-space-nowrap">
              See your streak
            </Link>
          </p>
        </SectionCard>
      </div>
      <div className="col-12 lg:col-4">
        <QuoteCard />
      </div>

      <div className="col-12 lg:col-8">
        <SectionCard className="h-full" title="Continue reading" icon="pi-play">
          {isLoading ? (
            <LoadingState />
          ) : continueReading.length === 0 ? (
            <EmptyState icon="pi-book" message="Books you start reading will show up here." />
          ) : (
            <BookRow>
              {continueReading.map(book => (
                <BookCard key={book.id} book={book} selected={false} selectionEnabled={false} />
              ))}
            </BookRow>
          )}
        </SectionCard>
      </div>
      <div className="col-12 lg:col-4">
        <TodayPlanCard />
      </div>

      <div className="col-12">
        <SectionCard
          className="h-full"
          title="Recently added"
          icon="pi-plus-circle"
          action={<Button label="All books" link onClick={() => navigate('/all-books')} />}
        >
          {isLoading ? (
            <LoadingState />
          ) : recentlyAdded.length === 0 ? (
            <EmptyState icon="pi-upload" message="Upload your first book to see it here." />
          ) : (
            <BookRow>
              {recentlyAdded.map(book => (
                <BookCard key={book.id} book={book} selected={false} selectionEnabled={false} />
              ))}
            </BookRow>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
