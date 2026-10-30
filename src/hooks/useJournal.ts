import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ActivityDays, Note, NoteInput, NotebookEntry, NotebookMonth, NotebookSummary } from '../api/journal';

export const journalKeys = {
  notes: ['notes'] as const,
  activity: ['activity'] as const,
  notebook: (month: string) => ['notebook', month] as const,
  notebookDay: (date: string) => ['notebook-day', date] as const
};

/* --------------------------------- notes --------------------------------- */

export function useNotes() {
  return useQuery({
    queryKey: journalKeys.notes,
    queryFn: () => api.get<Note[]>('/api/v1/notes')
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NoteInput) => api.post<Note>('/api/v1/notes', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: journalKeys.notes })
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<Pick<Note, 'quote' | 'text' | 'color'>> & { id: number }) =>
      api.put<Note>(`/api/v1/notes/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: journalKeys.notes })
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/v1/notes/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: journalKeys.notes })
  });
}

/** Pull highlights and notes from PDF annotation files into Notes. One book, or every annotated book. */
export function useImportAnnotations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookId?: number) =>
      api.post<{ imported: number; skipped: number; books: number }>('/api/v1/notes/import-annotations', bookId ? { bookId } : {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: journalKeys.notes })
  });
}

/* -------------------------------- activity -------------------------------- */

export function useActivity() {
  return useQuery({
    queryKey: journalKeys.activity,
    queryFn: async () => (await api.get<{ days: ActivityDays }>('/api/v1/activity')).days,
    staleTime: 30_000
  });
}

/* -------------------------------- notebook -------------------------------- */

/** Days that have a note in a month (summaries only). */
export function useNotebookMonth(month: string) {
  return useQuery({
    queryKey: journalKeys.notebook(month),
    queryFn: () => api.get<NotebookMonth>(`/api/v1/notebook?month=${month}`),
    staleTime: 60_000
  });
}

/** One day's full entry, read-only. */
export function useNotebookEntry(date: string) {
  return useQuery({
    queryKey: journalKeys.notebookDay(date),
    queryFn: () => api.get<NotebookEntry>(`/api/v1/notebook/${date}`),
    staleTime: 60_000
  });
}

export const emptyEntry = (date: string): NotebookEntry => ({
  date,
  todos: [],
  mood: null,
  reflection: '',
  thoughts: '',
  bookNotes: [],
  updatedAt: ''
});

export function summarizeEntry(entry: NotebookEntry): NotebookSummary {
  return {
    date: entry.date,
    todos: entry.todos.length,
    done: entry.todos.filter(t => t.done).length,
    mood: entry.mood,
    books: entry.bookNotes.filter(n => n.text.trim()).length,
    hasText: Boolean(entry.reflection.trim() || entry.thoughts.trim())
  };
}

const isBlank = (entry: NotebookEntry) =>
  entry.todos.length === 0 &&
  !entry.mood &&
  !entry.reflection.trim() &&
  !entry.thoughts.trim() &&
  entry.bookNotes.every(n => !n.text.trim());

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type EntryPatch = Partial<Omit<NotebookEntry, 'date' | 'updatedAt'>>;

/**
 * One notebook day with optimistic local edits and a debounced save, so typing
 * never waits on the network. Pending edits are flushed when the day changes
 * or the page unmounts.
 */
export function useNotebookDay(date: string) {
  const month = date.slice(0, 7);
  const queryClient = useQueryClient();
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<NotebookEntry | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');

  const query = useQuery({
    queryKey: journalKeys.notebookDay(date),
    queryFn: () => api.get<NotebookEntry>(`/api/v1/notebook/${date}`),
    staleTime: 60_000,
    // A background refetch must never overwrite text that has not been saved yet.
    refetchOnWindowFocus: () => !pending.current
  });

  const entry = query.data ?? emptyEntry(date);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const toSave = pending.current;
    if (!toSave) return;
    pending.current = null;
    setStatus('saving');
    try {
      await api.put(`/api/v1/notebook/${toSave.date}`, toSave);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }, []);

  const update = useCallback(
    (patch: EntryPatch) => {
      const current = queryClient.getQueryData<NotebookEntry>(journalKeys.notebookDay(date)) ?? emptyEntry(date);
      const next: NotebookEntry = { ...current, ...patch, updatedAt: new Date().toISOString() };
      queryClient.setQueryData(journalKeys.notebookDay(date), next);

      // Keep the month's history list in step without refetching it.
      queryClient.setQueryData<NotebookMonth>(journalKeys.notebook(month), old => {
        const days = { ...(old?.days ?? {}) };
        if (isBlank(next)) delete days[date];
        else days[date] = summarizeEntry(next);
        return { month, days };
      });

      pending.current = next;
      setStatus('saving');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 700);
    },
    [date, month, queryClient, flush]
  );

  useEffect(() => {
    setStatus('idle');
    return () => {
      void flush();
    };
  }, [date, flush]);

  return { entry, update, status, isLoading: query.isLoading };
}
