import { createFileRoute } from '@tanstack/react-router';
import BookDetailPage from '~/pages/BookDetailPage';

export const Route = createFileRoute('/_app/_shell/book/$bookId')({
  component: BookDetailPage
});
