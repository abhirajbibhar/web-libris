import {
  DATE_RE,
  dateFromKey,
  isEmptyEntry,
  notebookKey,
  notebookPrefix,
  parseEntry,
  serializeEntry,
  summarize,
  summaryFromMetadata,
  summaryToMetadata,
  weekYearsOfMonth,
  type NotebookEntry,
  type NotebookSummary
} from './notebook';
import { legacyNotebookKey, type LegacyNotebookMonthDoc } from './userData';

const MARKDOWN = 'text/markdown; charset=utf-8';

export const emptyEntry = (date: string): NotebookEntry => ({
  date,
  todos: [],
  mood: null,
  reflection: '',
  thoughts: '',
  bookNotes: [],
  updatedAt: ''
});

async function putDay(bucket: R2Bucket, userId: number, entry: NotebookEntry, extra: string, onlyIfNew = false) {
  await bucket.put(notebookKey(userId, entry.date), serializeEntry(entry, extra), {
    httpMetadata: { contentType: MARKDOWN },
    customMetadata: summaryToMetadata(summarize(entry)),
    ...(onlyIfNew ? { onlyIf: { etagDoesNotMatch: '*' } } : {})
  });
}

/**
 * Move a legacy `YYYY-MM.json` notebook month into per-day Markdown files.
 * Never overwrites a day that already has a `.md`, and is safe to run twice.
 */
export async function migrateLegacyMonth(bucket: R2Bucket, userId: number, month: string): Promise<void> {
  const key = legacyNotebookKey(userId, month);
  const object = await bucket.get(key);
  if (!object) return;
  const doc = (await object.json<LegacyNotebookMonthDoc>().catch(() => null)) ?? { days: {} };
  for (const [date, legacy] of Object.entries(doc.days ?? {})) {
    if (!DATE_RE.test(date)) continue;
    const entry: NotebookEntry = { ...emptyEntry(date), ...legacy, date, bookNotes: [] };
    if (isEmptyEntry(entry)) continue;
    await putDay(bucket, userId, entry, '', true);
  }
  await bucket.delete(key);
}

export interface StoredDay {
  entry: NotebookEntry;
  /** True when a file exists for this day. */
  exists: boolean;
  /** Raw Markdown as stored, for download. */
  markdown: string | null;
}

export async function readDay(bucket: R2Bucket, userId: number, date: string): Promise<StoredDay> {
  const key = notebookKey(userId, date);
  let object = await bucket.get(key);
  if (!object) {
    await migrateLegacyMonth(bucket, userId, date.slice(0, 7));
    object = await bucket.get(key);
  }
  if (!object) return { entry: emptyEntry(date), exists: false, markdown: null };
  const markdown = await object.text();
  const { entry } = parseEntry(date, markdown, object.uploaded ? new Date(object.uploaded).toISOString() : '');
  return { entry, exists: true, markdown };
}

/** Save a day. A day with nothing in it removes its file instead of leaving an empty note behind. */
export async function writeDay(bucket: R2Bucket, userId: number, entry: NotebookEntry): Promise<NotebookEntry> {
  const key = notebookKey(userId, entry.date);
  const existing = await bucket.get(key);
  // Hand-written sections the app doesn't know about ride along untouched.
  const extra = existing ? parseEntry(entry.date, await existing.text()).extra : '';

  if (isEmptyEntry(entry) && !extra.trim()) {
    if (existing) await bucket.delete(key);
    return entry;
  }
  await putDay(bucket, userId, entry, extra);
  return entry;
}

/** One summary per day that has a note in `month` (YYYY-MM), from a single listing. */
export async function listMonth(
  bucket: R2Bucket,
  userId: number,
  month: string
): Promise<Record<string, NotebookSummary>> {
  await migrateLegacyMonth(bucket, userId, month);

  const days: Record<string, NotebookSummary> = {};
  const needsRead: { key: string; date: string }[] = [];

  for (const year of weekYearsOfMonth(month)) {
    let cursor: string | undefined;
    do {
      const page: R2Objects = await bucket.list({
        prefix: `${notebookPrefix(userId)}${year}-W`,
        cursor,
        include: ['customMetadata']
      });
      for (const object of page.objects) {
        const date = dateFromKey(object.key);
        if (!date || !date.startsWith(month)) continue;
        const summary = summaryFromMetadata(date, object.customMetadata);
        if (summary) days[date] = summary;
        else needsRead.push({ key: object.key, date });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }

  // Files edited by hand outside the app lose their metadata; read those directly.
  await Promise.all(
    needsRead.map(async ({ key, date }) => {
      const object = await bucket.get(key);
      if (object) days[date] = summarize(parseEntry(date, await object.text()).entry);
    })
  );

  return days;
}
