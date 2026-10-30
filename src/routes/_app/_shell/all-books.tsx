import { createFileRoute } from '@tanstack/react-router';
import BookBrowserPage from '~/pages/BookBrowserPage';

export const Route = createFileRoute('/_app/_shell/all-books')({
  component: BookBrowserPage
});
