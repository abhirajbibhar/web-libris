import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  Book,
  BookDeletionResponse,
  Library,
  RatingUpdateResponse,
  ReadStatus,
  Shelf,
  StatusUpdateResponse,
  User
} from '../api/types';

export const queryKeys = {
  books: ['books'] as const,
  libraries: ['libraries'] as const,
  shelves: ['shelves'] as const,
  users: ['users'] as const,
  setupStatus: ['setup-status'] as const
};

export function useSetupStatus() {
  return useQuery({
    queryKey: queryKeys.setupStatus,
    queryFn: () => api.get<{ setupRequired: boolean }>('/api/v1/setup/status'),
    staleTime: Infinity,
    retry: false
  });
}

export function useBooks() {
  return useQuery({
    queryKey: queryKeys.books,
    queryFn: () => api.get<Book[]>('/api/v1/books')
  });
}

export function useBook(bookId: number) {
  return useQuery({
    queryKey: ['book', bookId],
    queryFn: () => api.get<Book>(`/api/v1/books/${bookId}`),
    enabled: Number.isInteger(bookId)
  });
}

export function useLibraries() {
  return useQuery({
    queryKey: queryKeys.libraries,
    queryFn: () => api.get<Library[]>('/api/v1/libraries')
  });
}

export function useShelves() {
  return useQuery({
    queryKey: queryKeys.shelves,
    queryFn: () => api.get<Shelf[]>('/api/v1/shelves')
  });
}

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => api.get<User[]>('/api/v1/users'),
    enabled
  });
}

export function useUpdateBookStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookIds, status }: { bookIds: number[]; status: ReadStatus }) =>
      api.post<StatusUpdateResponse[]>('/api/v1/books/status', { bookIds, status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.books })
  });
}

export function useUpdatePersonalRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, rating }: { ids: number[]; rating: number | null }) =>
      api.put<RatingUpdateResponse[]>('/api/v1/books/personal-rating', { ids, rating }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.books })
  });
}

export function useUpdateBookShelves() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { bookIds: number[]; shelvesToAssign: number[]; shelvesToUnassign: number[] }) =>
      api.post<Book[]>('/api/v1/books/shelves', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.books });
      queryClient.invalidateQueries({ queryKey: queryKeys.shelves });
    }
  });
}

export function useDeleteBooks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]) => {
      const response = await api.delete<BookDeletionResponse>(`/api/v1/books?ids=${ids.join(',')}`);
      // Wait for the refetches to land before reporting success, so library
      // book counts and lists update the moment the dialog closes instead of
      // showing stale numbers until the next mount.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.books }),
        queryClient.invalidateQueries({ queryKey: queryKeys.shelves }),
        queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
      ]);
      return response;
    }
  });
}

export function useUpdateBookMetadata() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookId, metadata }: { bookId: number; metadata: Record<string, unknown> }) =>
      api.patch<Book>(`/api/v1/books/${bookId}`, metadata),
    onSuccess: book => {
      queryClient.setQueryData(['book', book.id], book);
      queryClient.invalidateQueries({ queryKey: queryKeys.books });
    }
  });
}
