import app from './api/index';
import { getBindings } from './env';

/**
 * Single entry point for every `/api/*` and `/public/*` request. Hono keeps
 * working exactly as it did on the Worker: it parses the Request, runs the
 * middleware chain and returns a Response.
 */
export async function handleApiRequest(request: Request): Promise<Response> {
  return await app.fetch(request, getBindings());
}
