import { createFileRoute } from '@tanstack/react-router';
import { handleApiRequest } from '~/server/app';

/** Public, unauthenticated cover images, served by the Hono app. */
export const Route = createFileRoute('/covers/$id')({
  server: {
    handlers: {
      GET: ({ request }) => handleApiRequest(request),
      HEAD: ({ request }) => handleApiRequest(request)
    }
  }
});
