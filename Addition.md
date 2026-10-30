# Addition.md: Web Libris roadmap

A working checklist of everything worth adding or fixing, **in the order I suggest doing it**. Finish one item, tick it off, then move to the next.

Each item has:
- **Why**: the reason it matters
- **Where**: files to start in (paths are relative to the repo root)
- **Steps**: a short plan
- **Done when**: how you know it works

Effort tags: 🟢 small (an hour or two) · 🟡 medium (a day) · 🔴 large (several days)

---

## Phase 0: Quick fixes and housekeeping

- [x] **0.1 Rename the app to "Web Libris" everywhere.** Done. Old `booklore*` keys, the JWT issuer and the sidebar brand (it showed the username) now use Web Libris.
  - Side effects: everyone has to sign in again once (JWT issuer changed), and saved theme, sort order, view mode, sidebar state and reader settings reset once (localStorage keys changed).

- [x] **0.2 Fix the incorrect store test** 🟢 ✅ done
  - **Why:** `test/store.test.ts` › "does not lose writes from two stores over the same bucket" fails on the original code. It is a test bug, not a store bug: `storeB` uses a different key (`data/index-b.json`) but the test then reads `storeA` and expects B's shelf.
  - **Where:** `test/store.test.ts`, `src/server/api/store.ts`
  - **Steps:** make both stores use the same key and force B's cache to be stale (call `storeB.read()` before A writes, and avoid the 10s freshness shortcut, for example by exposing a way to set the stale window or calling `invalidate()` selectively). Assert that both the library and the shelf survive.
  - **Done when:** `npm test` is fully green.

- [x] **0.3 Read the version from `package.json`** 🟢 ✅ done
  - **Why:** `/api/v1/version` hardcodes `0.1.0`.
  - **Where:** `src/server/api/index.ts`
  - **Done when:** bumping `package.json` changes the API response.

- [x] **0.4 Choose and add a LICENSE** 🟢 ✅ done (MIT; change it if you prefer another)
  - **Why:** the README says none is chosen yet.
  - **Done when:** `LICENSE` exists and the README license section names it.

---

## Phase 1: Security and deployment

- [ ] **1.1 Login rate limiting** 🟡
  - **Why:** `POST /api/v1/auth/login` has no throttling, so passwords can be guessed freely.
  - **Where:** `src/server/api/routes/auth.ts`, `src/server/api/index.ts`
  - **Steps:** track failed attempts per IP and per username in memory (a `Map` with timestamps is enough for a single server). Use exponential backoff or a 15-minute lock after about 5 failures. Return `429` with a `Retry-After` header. Clear the counter on success. Show a friendly message on the login page.
  - **Done when:** a test proves the 6th wrong attempt returns 429 and a correct login still works after the lock expires.

- [ ] **1.2 Stronger password hashing with rehash-on-login** 🟡
  - **Why:** PBKDF2 runs at 100,000 iterations; OWASP currently recommends far more (about 600,000 for PBKDF2-SHA256).
  - **Where:** `src/server/api/auth.ts` (`PBKDF2_ITERATIONS`, `hashPassword`, `verifyPassword`), `src/server/api/routes/auth.ts`
  - **Steps:** raise the constant. The stored hash already contains its iteration count, so old hashes still verify. After a successful login, if the stored count is lower than the constant, hash again and save it through `store.update`.
  - **Done when:** an old-format hash logs in and is upgraded; new users get the new count.

- [ ] **1.3 Stop accepting tokens in query strings** 🟡
  - **Why:** `?token=` is accepted so images, fonts and reader assets can load, but URLs end up in logs, history and referrers.
  - **Where:** `src/server/api/index.ts` (auth middleware), `src/api/client.ts`, readers
  - **Steps:** pick one: (a) short-lived signed URLs (60 seconds) for file and asset requests, or (b) an httpOnly, SameSite cookie for auth. Remove the long-lived query-token path.
  - **Done when:** the long-lived access token never appears in a URL.

- [ ] **1.4 Refresh-token rotation and logout revocation** 🟡
  - **Why:** the 30-day refresh token is only invalidated when the password changes.
  - **Where:** `src/server/api/auth.ts`, `src/server/api/routes/auth.ts`, `src/auth/AuthContext.tsx`
  - **Steps:** issue a new refresh token on every refresh and keep a per-user list of valid token IDs (`jti`). Add a "Sign out everywhere" button in Settings that bumps `tokenVersion`.

- [ ] **1.5 Tighten the Content-Security-Policy** 🟡
  - **Why:** `script-src` allows `'unsafe-inline'`.
  - **Where:** `src/server/api/index.ts`, `src/routes/__root.tsx` (the inline theme script)
  - **Steps:** generate a nonce per response, or move the theme bootstrap to a static file in `public/`. Check the readers still work afterwards.

- [ ] **1.6 Dockerfile and docker-compose** 🟡
  - **Why:** one command to run it anywhere.
  - **Steps:** multi-stage build (`npm ci`, `npm run build`, run `node .output/server/index.mjs`) with Node 22, a non-root user, a volume for `WEB_LIBRIS_DATA_DIR`, and a health check on `/api/v1/version`. Document it in the README.

- [ ] **1.7 CI with GitHub Actions** 🟢
  - **Steps:** workflow on push and pull request: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.

- [ ] **1.8 Automated backups** 🟡
  - **Steps:** a script or admin button that zips the data directory (or at least `data/index.json` and annotation data) on a schedule and keeps the last N copies. Test a restore.

---

## Phase 2: Core library features

- [ ] **2.1 Confirm and build metadata editing** 🟡
  - **Why:** a `canEditMetadata` permission exists, but I found no route that updates metadata (only status, rating, progress, shelves, delete, cover rescan and upload). Check this first.
  - **Where:** `src/server/api/routes/books.ts` (`pickMetadata` already validates the fields), `src/pages/BookDetailPage.tsx`, `src/hooks/useApi.ts`
  - **Steps:** add `PUT /api/v1/books/:id/metadata` guarded by `requirePermission(user, 'canEditMetadata')`. Build an edit dialog on the detail page for title, subtitle, authors, series name and number, publisher, date, ISBNs, language, description, categories, tags and moods. Add cover upload or replace.
  - **Done when:** edits persist, show in the grid and search, and users without the permission cannot save.

- [ ] **2.2 ISBN and metadata lookup** 🟡
  - **Why:** many files arrive with poor or missing metadata.
  - **Steps:** add a server route that calls Open Library (and optionally Google Books) by ISBN or title+author. Doing the call server-side avoids loosening the browser CSP. In the edit dialog add "Fetch metadata" and let the user pick which fields to apply. Offer cover choices.

- [ ] **2.3 Duplicate detection on upload** 🟡
  - **Where:** `src/server/api/routes/books.ts` (`/files/upload`), `src/components/UploadDialog.tsx`
  - **Steps:** store a content hash (SHA-256) on each book record at upload. Compare against existing books by hash, then by ISBN or title+author. Return a conflict and let the user choose **Skip / Keep both / Replace**.

- [ ] **2.4 Better search** 🟡
  - **Why:** `matchesSearch` in `src/utils/filters.ts` is a plain substring match on title, filename, authors, series and ISBN.
  - **Steps:** also search description, tags, categories and moods. Add typo-tolerant matching (a small Fuse.js or a hand-written trigram score). Rank title and author matches above the rest. Add tests in `src/utils/filters.test.ts`.

- [ ] **2.5 Global search (Cmd/Ctrl + K)** 🟡
  - **Steps:** a command palette that searches books, authors, series, shelves, quotes, notes and annotations, and jumps straight to the result. Also use it for navigation ("Go to Settings").

- [ ] **2.6 Bulk metadata edit** 🟢
  - **Where:** `src/pages/BookBrowserPage.tsx` (multi-select already exists)
  - **Steps:** with books selected, add "Edit metadata" for series, tags, categories, moods, language and author, using one API call that takes a list of IDs.

---

## Phase 3: Reading experience

- [ ] **3.1 Reading-time tracking** 🟡
  - **Why:** progress is stored but not time spent, which blocks good stats.
  - **Where:** `src/readers/*`, `src/server/api/userData.ts`, `src/server/api/routes/journal.ts`
  - **Steps:** count active seconds (pause when the tab is hidden or idle for 2+ minutes). Send them with progress updates. Store per book per day.

- [ ] **3.2 Bookmarks** 🟡
  - **Steps:** add or remove a bookmark at the current location (CFI for EPUB, page for PDF/CBX). List them in the reader side panel and on the book detail page. Check what already exists before starting.

- [ ] **3.3 In-book search UI** 🟡
  - **Why:** foliate's `search.js` is already bundled in `public/foliate/`. Check whether the reader exposes it.
  - **Steps:** search box in the reader chrome, a results list with context snippets, and jump-to-result.

- [ ] **3.4 Dictionary and text-to-speech** 🟡
  - **Why:** `dict.js` and `tts.js` are already bundled.
  - **Steps:** a "Define" action on selected text, and Play/Pause/Speed controls for read-aloud.

- [ ] **3.5 Annotation improvements** 🟡
  - **Where:** `src/readers/annotationController.ts`, `src/server/api/routes/annotations.ts`, `src/pages/NotesPage.tsx`
  - **Steps:** highlight colours, tags on notes, an "all highlights" page with filters, and export to Markdown (for Obsidian or Notion).

- [ ] **3.6 Sync status indicator** 🟢
  - **Steps:** a small "Saved / Saving / Offline" indicator in the reader so people trust that progress is not lost.

---

## Phase 4: Insights and motivation

- [ ] **4.1 Reading goals** 🟡
  - **Steps:** yearly goal of N books, optional daily pages or minutes. Show a progress ring on the dashboard.

- [ ] **4.2 Stats page** 🟡
  - **Steps:** books finished per month, pages per day, time per day (needs 3.1), top authors, top genres, average rating, and a read-status breakdown. `dateFinished` and `readStatus` already exist.

- [ ] **4.3 "Up next" and series awareness** 🟢
  - **Steps:** on the dashboard show the next unread book in a series you are reading, using `seriesName` and `seriesNumber`. On the series page flag missing volumes using `seriesTotal`.

- [ ] **4.4 Year in review** 🟡
  - **Steps:** a shareable summary page once there is enough data (books, pages, favourite author, longest streak).

---

## Phase 5: Organisation and interoperability

- [ ] **5.1 Smart shelves (saved filters)** 🟡
  - **Where:** `src/utils/filters.ts`, `src/components/BookFilterPanel.tsx`, `src/server/api/routes/shelves.ts`
  - **Steps:** let a shelf be defined by a filter ("unread EPUBs tagged sci-fi, rated 4+") that updates automatically. Also allow saving a filter as a named view.

- [ ] **5.2 Export** 🟢
  - **Steps:** export the library as CSV (check `src/server/api/csv.ts`, which may already do part of this), and export quotes, notes and annotations as Markdown or JSON.

- [ ] **5.3 Import from Goodreads (CSV)** 🟡
  - **Steps:** map title, author, ISBN, rating, shelves and date read onto existing books. Preview matches before applying.

- [ ] **5.4 OPDS catalog** 🟡
  - **Why:** lets KOReader, Moon+ Reader, Marvin and others browse and download from your library.
  - **Steps:** add `/opds` (Atom feed) with root, new, by author, by series and search, protected by HTTP Basic or a per-user app password.

- [ ] **5.5 Send to Kindle / e-reader** 🔴
  - **Steps:** per-user Kindle address and SMTP settings, with a "Send" action on the book. Format conversion is a separate, larger task.

---

## Phase 6: UI and UX polish

- [ ] **6.1 Dashboard upgrade** 🟡
  - **Where:** `src/pages/DashboardPage.tsx`
  - **Steps:** add a stats strip (books read this year, current streak, goal progress), an "Up next" row, and a "Currently reading" summary.

- [ ] **6.2 Book browser improvements** 🟡
  - **Where:** `src/pages/BookBrowserPage.tsx`
  - **Steps:** saved views, virtualised grid for large libraries, keyboard navigation (arrow keys, Enter to open, `/` to focus search), and drag-and-drop upload anywhere on the page.

- [ ] **6.3 Book detail page** 🟡
  - **Where:** `src/pages/BookDetailPage.tsx`
  - **Steps:** show reading history, this book's annotations, and related books (same series or author), plus the edit button from 2.1.

- [ ] **6.4 More themes** 🟢
  - **Where:** `src/theme/ThemeContext.tsx`, `public/themes/`
  - **Steps:** an "Auto (system)" option, a few accent colours, and a sepia or high-contrast theme.

- [ ] **6.5 Installable PWA** 🟡
  - **Steps:** web manifest, icons, a service worker that caches the app shell, and optional offline reading of books the user chooses to download.

- [ ] **6.6 Mobile reader gestures** 🟡
  - **Steps:** tap zones and swipe to turn pages, a bottom navigation bar on small screens, and a distraction-free fullscreen mode.

- [ ] **6.7 Accessibility pass** 🟡
  - **Steps:** check focus order and focus return in dialogs, colour contrast in the amber theme, labels on the card grid, and reduced-motion support. Run axe or Lighthouse.

- [ ] **6.8 UX polish** 🟢
  - **Steps:** undo toasts after deleting, clearer empty states with a next action, a first-run onboarding checklist for new admins, and a login page "Forgot password? Ask your admin" note.

---

## Phase 7: Scale and architecture

Do this when your library gets big (thousands of books) or you want several heavy users.

- [ ] **7.1 Server-side pagination and filtering** 🔴
  - **Why:** `GET /api/v1/books` returns every book on every load.
  - **Steps:** add `page`, `pageSize`, `q`, `sort` and filter parameters. Keep lightweight "facet" endpoints for filter counts. Update `useBooks`.

- [ ] **7.2 Move the index to SQLite** 🔴
  - **Why:** one JSON file rewritten on every change gets slow and risky as it grows.
  - **Steps:** introduce a storage interface, implement it with SQLite, and write a one-time migration from `data/index.json`. Keep files and covers on disk. This also gives you indexed search.

- [ ] **7.3 Upload queue with progress and resume** 🔴
  - **Where:** `src/components/UploadDialog.tsx`, `/api/v1/files/upload`
  - **Steps:** upload several files at once with per-file progress, retry on failure, and chunked or resumable uploads for large files. Add limits and validation (file size, zip-bomb checks for CBZ).

- [ ] **7.4 Per-user reading state on shared libraries** 🔴
  - **Why:** rating, status and progress are stored on the book record, so two users sharing a library overwrite each other.
  - **Steps:** move `readStatus`, `personalRating`, progress and `lastReadTime` into per-user records and update the DTOs and dashboard queries.

- [ ] **7.5 API test coverage** 🟡
  - **Steps:** tests for upload edge cases (corrupt files, huge files, bad extensions), permission checks on every mutating route, and library-access restrictions (`assignedLibraryIds`).

---

## Suggested order

1. Phase 0 (0.2 to 0.4)
2. 1.1, 1.2, 1.6, 1.7
3. 2.1, then 2.2, 2.4, 2.5
4. 3.1, then 4.1 and 4.2
5. 5.4, 6.5
6. The rest as needed; Phase 7 only when the library size demands it

## Notes

- Run `npm run typecheck && npm test` after every item.
- Commit one item at a time (for example `feat: login rate limiting`) so each change is easy to review or undo.
- When you finish an item, tick the box and add the date next to it.
