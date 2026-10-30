import { createFileRoute } from '@tanstack/react-router';
import NotebookPage from '~/pages/NotebookPage';

export const Route = createFileRoute('/_app/_shell/notebook')({
  component: NotebookPage
});
