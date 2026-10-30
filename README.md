# Web Libris

A self-hosted web library for your books, comics and documents. Upload your files, organise them into libraries and shelves, read them in the browser, and keep track of your reading, highlights, quotes and notes.

Web Libris is a client-rendered app built on **TanStack Start** with its own **Hono** API running on the same origin. Everything is stored on disk, so there is no external database to set up.

## Features

- **Formats:** EPUB, PDF, CBZ / CBR / ZIP (comics), FB2, MOBI and AZW3.
- **Built-in readers:** EPUB, MOBI, AZW3 and FB2 through [foliate-js](https://github.com/johnfactotum/foliate-js), PDF through EmbedPDF, and a dedicated comic reader. Reader preferences are saved per browser.
- **Organisation:** multiple libraries, personal shelves, series and author browsers, an "Unshelved" view, filters, sorting, and grid or table views.
- **Reading progress:** progress is saved per book and format, with read statuses (Unread, Reading, Re-reading, Read, Paused, Abandoned and more) and personal ratings.
- **Annotations:** highlights and notes inside books, stored alongside each book.
- **Journal and streaks:** a daily reading streak, a "today plan" and a notebook for day-by-day book notes.
- **Quotes:** save and browse favourite quotes.
- **Users and permissions:** an admin plus extra users, each with fine-grained permissions (upload, download, delete books, edit metadata, manage libraries, manage users) and optional per-library access.
- **Themes:** light and dark (PrimeReact Lara, amber).
- **Responsive UI** with a collapsible sidebar and a mobile drawer.

## Tech stack

| Area | Technology |
| --- | --- |
| App framework | TanStack Start (SPA mode), TanStack Router, TanStack Query |
| UI | React 19, PrimeReact, PrimeFlex, PrimeIcons |
| API | Hono (served under `/api` on the same origin) |
| Auth | JWT (`jose`), PBKDF2 password hashing |
| Readers | foliate-js, `@embedpdf/react-pdf-viewer`, `jszip` |
| Storage | Local filesystem, behind an R2-compatible bucket abstraction |
| Tooling | TypeScript, Vite, Nitro, Vitest |

## Getting started

### Requirements

- Node.js **22 or newer**
- npm

### Install and run

```bash
git clone https://github.com/abhirajbibhar/web-libris.git
cd web-libris
npm install
cp .env.example .env      # then edit it (see below)
npm run dev
```

Open <http://localhost:3000> and sign in with the `ADMIN_USER` and `ADMIN_PASSWORD` from your `.env`.

### Configuration

Settings are read from `.env` (real environment variables take priority).

| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | Yes | Secret used to sign access and refresh tokens. Use a long random value. |
| `ADMIN_USER` | First run | Username of the first admin account. |
| `ADMIN_PASSWORD` | First run | Password of the first admin account. |
| `WEB_LIBRIS_DATA_DIR` | No | Where books, covers and the index are stored. Defaults to `./.data`. |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**First sign-in:** when no user exists yet, the first login with `ADMIN_USER` / `ADMIN_PASSWORD` creates the admin account and a default library called "General". After that these values are ignored, so you should remove them from `.env`. Manage further accounts from **Settings → Users**.

### Production build

```bash
npm run build     # builds the app, then type-checks
npm start         # runs .output/server/index.mjs
```

Make sure `JWT_SECRET` is set and the data directory is on persistent storage.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server on port 3000 |
| `npm run build` | Production build plus type-check |
| `npm start` | Run the production build |
| `npm run preview` | Preview the build with Vite |
| `npm run typecheck` | Type-check only |
| `npm test` | Run the Vitest suite once |

## Data and backups

Everything lives in the data directory (`./.data` by default):

- `data/index.json` holds users, libraries, shelves and book records.
- Uploaded book files and extracted covers.
- Annotation, journal, notebook and quote data.

Back up this whole directory to back up your library. Do not commit it; it is already in `.gitignore`.

## Project structure

```
src/
  routes/       File-based routes (pages and the /api catch-all)
  pages/        Page components (dashboard, browsers, detail, settings, ...)
  components/   Reusable UI pieces (cards, dialogs, filters, ...)
  readers/      EPUB / PDF / comic readers, progress and annotation sync
  layout/       App shell: sidebar, topbar, brand
  hooks/        Data hooks built on TanStack Query
  api/          Client-side API helpers and types
  auth/         Auth context and route guard
  theme/        Light/dark theme handling
  utils/        Filtering, sorting, dates, streaks, formatting
  server/
    app.ts      Entry point for API requests
    env.ts      Environment and storage bindings
    r2.ts       Filesystem bucket (R2-compatible)
    api/        Hono app, auth, store and route modules
public/         Static assets, themes and the bundled foliate-js files
test/           API, auth, store and annotation tests
```

## API overview

All endpoints are under `/api/v1`. Everything except setup status, login, refresh and version requires a bearer token.

- **Auth:** `POST /auth/login`, `POST /auth/refresh`, `GET /setup/status`
- **Books:** list, detail, file download, cover, upload, delete, status, rating, progress and shelf assignment
- **Libraries and shelves:** create, rename and delete
- **Users:** list, create, update, reset password and delete (admin or `canManageUsers`)
- **Annotations, quotes, journal and notebook:** per-user data routes

Book covers are also served from `/covers/:id` without authentication so they can be cached.

## Contributing

1. Create a branch for your change.
2. Run `npm run typecheck` and `npm test` before opening a pull request.
3. Planned work and ideas are tracked in [`Addition.md`](./Addition.md).

## License

Released under the [MIT License](./LICENSE).
