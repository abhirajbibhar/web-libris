import { createFileRoute } from '@tanstack/react-router';
import SeriesBrowserPage from '~/pages/SeriesBrowserPage';

export const Route = createFileRoute('/_app/_shell/series/')({
  component: SeriesBrowserPage
});
