import { createFileRoute } from '@tanstack/react-router';
import { Navigate } from '~/router/compat';

export const Route = createFileRoute('/')({
  component: () => <Navigate to="/dashboard" replace />
});
