import { createFileRoute } from '@tanstack/react-router';
import ReaderPage from '~/readers/ReaderPage';

export const Route = createFileRoute('/_app/_shell/read/$bookId')({
  component: ReaderPage
});
