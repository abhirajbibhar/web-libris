import { Hono, type Handler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { bearerToken, tokenVersionMatches, verifyToken } from './auth';
import { AppEnv, getStore } from './context';
import { registerAnnotationRoutes } from './routes/annotations';
import { registerQuoteRoutes } from './routes/quotes';
import { registerAuthRoutes } from './routes/auth';
import { registerBookRoutes } from './routes/books';
import { registerCbxRoutes } from './routes/cbx';
import { registerEpubRoutes } from './routes/epub';
import { registerJournalRoutes } from './routes/journal';
import { registerLibraryRoutes } from './routes/libraries';
import { registerShelfRoutes } from './routes/shelves';
import { registerUserRoutes } from './routes/users';
import { coverKey, CasConflictError } from './store';
import { HttpError } from './types';

const app = new Hono<AppEnv>();

const PUBLIC_ROUTES = new Set([
  'GET /api/v1/setup/status',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'GET /api/v1/version'
]);

// Security headers applied to every response (API + SPA + assets).
// Runs after the handler so it can add headers to whichever Response the
// handler returned (json() body, direct new Response() for file streams, etc.).
app.use('*', async (c, next) => {
  await next();
  const headers = c.res.headers;
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Basic CSP: only self-origin scripts/styles/images/connect, plus the
  // jsdelivr CDN the app loads PrimeReact/foliate from. Tighten further
  // once you've confirmed every third-party origin the app reaches out to.
  headers.set('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "connect-src 'self'; " +
    "font-src 'self' data:; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
});

app.use('/api/*', async (c, next) => {
  c.set('store', getStore(c.env.Library));

  if (PUBLIC_ROUTES.has(`${c.req.method} ${c.req.path}`)) {
    return next();
  }

  // Browser-initiated resource loads (images, fonts, stylesheets inside the
  // readers) cannot attach headers, so they authenticate with ?token=.
  const token = bearerToken(c.req.header('Authorization')) ?? (c.req.query('token') || undefined);
  if (!token) return c.json({ message: 'Authentication required' }, 401);

  let payload;
  try {
    payload = await verifyToken(c.env, token, 'access');
  } catch {
    return c.json({ message: 'Invalid or expired token' }, 401);
  }

  const { index } = await c.get('store').read();
  const user = index.users.find(u => String(u.id) === payload.sub);
  if (!user) return c.json({ message: 'User no longer exists' }, 401);
  if (!tokenVersionMatches(payload, user)) {
    return c.json({ message: 'Session revoked, please sign in again' }, 401);
  }

  c.set('user', user);
  return next();
});

app.get('/api/v1/version', c => c.json({ version: '0.1.0', app: 'web-libris' }));

/**
 * Public cover images: served straight from R2, bypassing JWT auth so the
 * response can be `Cache-Control: public` and land in Cloudflare's edge cache.
 * Covers carry no reading progress or account data — only a book's front image,
 * which is already visible to every user allowed to see the book — and URLs
 * are unguessable (numeric ids, private library listings). A re-uploaded cover
 * gets a new `?t=<coverUpdatedOn>` URL, so caches never serve stale bytes.
 * Books deleted while an edge copy is alive simply 404 at the origin; the
 * residual window is bounded by the max-age below.
 */
const COVER_MAX_AGE = 5_184_000; // 60 days — ~10K Class B ops per full library refresh stays free
const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif'
};

const servePublicCover: Handler<AppEnv> = async c => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ message: 'Not found' }, 404);

  const ext = (c.req.query('ext') ?? 'jpg').toLowerCase();
  const object = await c.env.Library.get(coverKey(id, ext));
  if (!object) return c.json({ message: 'Not found' }, 404);

  const headers = new Headers({
    'Content-Type': object.httpMetadata?.contentType ?? EXT_CONTENT_TYPE[ext] ?? 'image/jpeg',
    'Cache-Control': `public, max-age=${COVER_MAX_AGE}, immutable`,
    'Vary': 'Accept-Encoding'
  });
  if (object.etag) headers.set('ETag', object.etag);
  return new Response(object.body, { headers });
};

// `/covers/*` is the canonical URL. `/public/covers/*` is kept so existing
// links and the original app's asset path keep working.
app.get('/covers/:id', servePublicCover);
app.get('/public/covers/:id', servePublicCover);

registerAuthRoutes(app);
registerUserRoutes(app);
registerLibraryRoutes(app);
registerShelfRoutes(app);
registerBookRoutes(app);
registerEpubRoutes(app);
registerCbxRoutes(app);
registerJournalRoutes(app);
registerAnnotationRoutes(app);
registerQuoteRoutes(app);

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ message: err.message }, err.status as ContentfulStatusCode);
  }
  if (err instanceof CasConflictError) {
    return c.json({ message: err.message }, 409);
  }
  console.error('Unhandled error:', err);
  return c.json({ message: 'Internal server error' }, 500);
});

// TanStack Start serves the SPA shell and static assets; this app only ever
// sees /api/* and /public/* requests.
app.notFound(c => c.json({ message: 'Not found' }, 404));

export default app;
