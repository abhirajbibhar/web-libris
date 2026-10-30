# Web Libris

A full replica of the BookLore library app, rebuilt on **TanStack Start** with its
own Hono API. Same pages, same readers, same behaviour — a different framework
foundation.

## Why TanStack Start

The goal was a foundation that can stay viable for a long time. No framework
comes with a 20-year guarantee, so the durable bet is: web standards, no
proprietary runtime, MIT-licensed pieces, and a thin framework boundary.

TanStack Start fits that:

- **Vite-based** — the browser-heavy parts of this app (foliate EPUB reader,
  EmbedPDF/PDFium WASM, CBX reader, PrimeReact) keep working unchanged.
- **Deploy-anywhere** — the build is a standard Nitro server. Run it on a VPS,
  in a container, on Fly/Render/Cloudflare, or keep it as a static SPA.
- **Already in the stack** — the app uses TanStack Query for data; Start's
  router and server routes are the same family.
- **File-based, type-safe routing** — URL structure is visible in the tree, and
  links/params are checked by TypeScript.
- **SPA mode** — this app is intentionally client-rendered (localStorage auth,
  canvas/WASM readers), so Start pre-renders only the shell. Server routes still
  run for `/api/*` and `/covers/*`.

Alternatives considered: React Router v7 framework mode (most conservative,
smallest migration since the pages already used `react-router-dom`) and Next.js
16 (largest ecosystem, but its RSC/SSR model adds friction around browser-only
readers). The UI code stays framework-agnostic, so either remains a viable
future move.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | TanStack Start 1.x (Vite 8, SPA mode) |
| Routing | TanStack Router, file-based (`src/routes`) |
| Data | TanStack Query |
| UI | React 19, PrimeReact, PrimeFlex, Prime Icons |
| API | Hono, running as TanStack Start server routes |
| Auth | JWT (jose) + PBKDF2, access/refresh tokens in localStorage |
| Storage | Local filesystem behind an R2-compatible interface |
| Readers | foliate (EPUB), EmbedPDF (PDF), zip reader (CBX) |

## Getting started

Requires **Node 22+**.

```bash
npm install
cp .env.example .env      # then set JWT_SECRET and the bootstrap admin
npm run dev               # http://localhost:3000
```

Generate a signing secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

On the first request, if `ADMIN_USER` and `ADMIN_PASSWORD` are set and no user
exists, that account is created. Sign in, then remove those two variables.

Scripts:

```bash
npm run dev        # Vite dev server with HMR
npm run build      # client + server build into .output/, then typecheck
npm start          # run the production server (.output/server/index.mjs)
npm run typecheck  # tsc --noEmit
npm test           # vitest (UI utilities + API integration tests)
```

## How the API is wired

The original Cloudflare Worker's Hono app moved into `src/server/api/`
unchanged except for the storage binding:

- `src/routes/api/$.ts` hands every `/api/*` request to Hono.
- `src/routes/covers/$id.ts` serves public cover images.
- `src/server/r2.ts` implements the R2 surface the API uses (`head`, `get` with
  ranges, conditional `put`, `delete`, `list` with metadata) on the local
  filesystem, including per-key locking for compare-and-swap writes.
- `src/server/env.ts` loads `.env` and creates one bucket per server process.

Data lives in `./.data` (`objects/<key>` plus `meta.json`). Point
`WEB_LIBRIS_DATA_DIR` elsewhere to move it. To run on real R2 or S3, replace
`FileSystemBucket` with an implementation of the same interface — no route
changes needed.

The SPA's public cover URL changed from `/public/covers/:id` to `/covers/:id`,
because `/public/*` is reserved for the framework's static directory. The old
path still works for existing links.

## Project layout

```
src/
  routes/            TanStack Router routes + server routes (api, covers)
    __root.tsx       document shell, providers, theme bootstrap
    _app.tsx         auth guard
    _app/_shell.tsx  sidebar + topbar layout
  pages/             screens (ported)
  components/        shared UI (ported)
  readers/           EPUB / PDF / CBX readers (ported)
  api/               browser API client + types
  hooks/             TanStack Query hooks
  layout/            app shell pieces
  router/compat.tsx  react-router vocabulary on top of TanStack Router
  server/            Hono API, local R2 bucket, env
public/              foliate, PrimeReact themes, favicon
test/                API integration tests (ported from the worker)
```

`router/compat.tsx` exports `Link`, `NavLink`, `Navigate`, `Outlet`,
`useLocation`, `useNavigate`, `useParams` and `useSearchParams` backed by
TanStack Router. That keeps the ported screens unchanged while TanStack Router
owns matching, params and history.

## Deployment

The production server reads `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASSWORD` and
(optionally) `WEB_LIBRIS_DATA_DIR` from the environment. `npm run build` emits a
Nitro `node-server` build in `.output/`; `npm start` runs it. Back up `.data/`
with the app.

## Known issue

`test/store.test.ts › does not lose writes from two stores over the same bucket`
fails identically on the original Worker app. It asserts a cross-store read sees
another instance's write immediately, which contradicts the store's deliberate
10-second read-cache window. It was left unchanged rather than weakened.
