import { createFileRoute } from '@tanstack/react-router';
import AuthorBrowserPage from '~/pages/AuthorBrowserPage';

export const Route = createFileRoute('/_app/_shell/authors/')({
  component: AuthorBrowserPage
});
