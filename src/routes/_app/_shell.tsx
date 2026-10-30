import { createFileRoute } from '@tanstack/react-router';
import AppLayout from '~/layout/AppLayout';

/** Sidebar + topbar shell around the signed-in pages. */
export const Route = createFileRoute('/_app/_shell')({
  component: AppLayout
});
