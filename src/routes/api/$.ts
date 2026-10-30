import { createFileRoute } from '@tanstack/react-router';
import { handleApiRequest } from '~/server/app';

const handler = ({ request }: { request: Request }) => handleApiRequest(request);

/**
 * Every API request lands here and is handed to the Hono application, which
 * owns authentication, routing and the JSON surface under /api/v1.
 */
export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      PUT: handler,
      PATCH: handler,
      DELETE: handler,
      HEAD: handler,
      OPTIONS: handler
    }
  }
});
