import { createFileRoute } from '@tanstack/react-router';
import AuthorDetailPage from '~/pages/AuthorDetailPage';

export const Route = createFileRoute('/_app/_shell/author/$authorId')({
  component: AuthorDetailPage
});
