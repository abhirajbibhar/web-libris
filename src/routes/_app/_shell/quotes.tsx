import { createFileRoute } from '@tanstack/react-router';
import QuotesPage from '~/pages/QuotesPage';

export const Route = createFileRoute('/_app/_shell/quotes')({
  component: QuotesPage
});
