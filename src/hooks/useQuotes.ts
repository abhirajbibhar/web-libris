import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { QuoteInput, QuoteItem } from '../api/quotes';

export const quoteKeys = { all: ['quotes'] as const };

export function useQuotes() {
  return useQuery({ queryKey: quoteKeys.all, queryFn: () => api.get<QuoteItem[]>('/api/v1/quotes') });
}

export function useCreateQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: QuoteInput) => api.post<QuoteItem>('/api/v1/quotes', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quoteKeys.all })
  });
}

export function useUpdateQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<QuoteInput> & { id: number }) => api.put<QuoteItem>(`/api/v1/quotes/${id}`, patch),
    // Toggling a star should feel instant.
    onMutate: async patch => {
      await queryClient.cancelQueries({ queryKey: quoteKeys.all });
      const previous = queryClient.getQueryData<QuoteItem[]>(quoteKeys.all);
      queryClient.setQueryData<QuoteItem[]>(quoteKeys.all, old =>
        (old ?? []).map(q => (q.id === patch.id ? ({ ...q, ...patch, bookId: patch.bookId ?? q.bookId } as QuoteItem) : q))
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous && queryClient.setQueryData(quoteKeys.all, ctx.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: quoteKeys.all })
  });
}

export function useDeleteQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/v1/quotes/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quoteKeys.all })
  });
}

/** Turn highlights from Notes into quotes. Pass note ids for specific ones, or nothing for every highlight not yet quoted. */
export function useQuotesFromNotes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteIds?: number[]) => api.post<{ added: number; skipped: number }>('/api/v1/quotes/from-notes', noteIds ? { noteIds } : {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: quoteKeys.all })
  });
}
