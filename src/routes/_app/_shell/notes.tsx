import { createFileRoute } from '@tanstack/react-router';
import NotesPage from '~/pages/NotesPage';

export const Route = createFileRoute('/_app/_shell/notes')({
  component: NotesPage
});
