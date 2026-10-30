import { createFileRoute } from '@tanstack/react-router';
import RequireAuth from '~/auth/RequireAuth';

/** Every route below this point requires a session. */
export const Route = createFileRoute('/_app')({
  component: RequireAuth
});
