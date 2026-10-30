import { createFileRoute } from '@tanstack/react-router';
import { handleApiRequest } from '~/server/app';

/**
 * Public cover images. Kept on the same Hono route so their cache headers and
 * unauthenticated behaviour match the original app.
 */
export const Route = createFileRoute('/public/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleApiRequest(request),
      HEAD: ({ request }) => handleApiRequest(request)
    }
  }
});
