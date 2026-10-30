import { Link } from '~/router/compat';
import { Skeleton } from 'primereact/skeleton';
import { useNotebookDay } from '../hooks/useJournal';
import { todayKey } from '../utils/dates';
import SectionCard from './SectionCard';
import TodoList from './TodoList';

/** Today's to-dos from the notebook, editable right from the dashboard. */
export default function TodayPlanCard() {
  const today = todayKey();
  const { entry, update, status, isLoading } = useNotebookDay(today);

  return (
    <SectionCard
      className="h-full"
      title="Today’s plan"
      icon="pi-list-check"
      action={
        <Link to="/notebook" className="text-sm no-underline text-primary white-space-nowrap">
          Open notebook
        </Link>
      }
    >
      {isLoading ? (
        <div className="flex flex-column gap-2">
          <Skeleton height="1.2rem" />
          <Skeleton height="1.2rem" width="70%" />
        </div>
      ) : (
        <>
          <TodoList todos={entry.todos} onChange={todos => update({ todos })} idPrefix="plan" />
          {status === 'error' && <small className="text-red-500 block mt-2">Could not save. Check your connection.</small>}
        </>
      )}
    </SectionCard>
  );
}
