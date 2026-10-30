import { createFileRoute } from '@tanstack/react-router';
import StreakPage from '~/pages/StreakPage';

export const Route = createFileRoute('/_app/_shell/streak')({
  component: StreakPage
});
