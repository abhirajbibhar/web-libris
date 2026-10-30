import { createFileRoute } from '@tanstack/react-router';
import SeriesPage from '~/pages/SeriesPage';

export const Route = createFileRoute('/_app/_shell/series/$seriesName')({
  component: SeriesPage
});
