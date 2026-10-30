import { useCallback, useEffect, useMemo, useRef } from 'react';
import { api, tokenStore } from '../api/client';
import type { Book, ReadingProgressUpdate } from '../api/types';
import { useQueryClient } from '@tanstack/react-query';

const FLUSH_DELAY_MS = 1500;

type ProgressFields = Omit<ReadingProgressUpdate, 'bookId'>;

/**
 * Debounced reading-progress writer.
 *
 * Relocation events fire constantly while reading; we keep only the latest
 * payload and post it on a throttle (first call schedules, later calls
 * overwrite until it fires). Pending progress is flushed when the reader
 * unmounts and on pagehide so closing a tab does not lose your place.
 */
export function useProgressSaver(bookId: number) {
  const queryClient = useQueryClient();
  const pending = useRef<ProgressFields | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const post = useCallback(
    (fields: ProgressFields, keepalive: boolean) => {
      const body: ReadingProgressUpdate = { bookId, ...fields };
      if (keepalive) {
        // The page may be going away: plain fetch with keepalive, because
        // the react-query/api path cannot run reliably during unload.
        const token = tokenStore.access;
        void fetch('/api/v1/books/progress', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify(body),
          keepalive: true
        }).catch(() => undefined);
        return;
      }
      api
        .post<Book>('/api/v1/books/progress', body)
        .then(updated => queryClient.setQueryData(['book', bookId], updated))
        .catch(() => undefined);
    },
    [bookId, queryClient]
  );

  const flushNow = useCallback(
    (keepalive = false) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const fields = pending.current;
      if (fields) {
        pending.current = null;
        post(fields, keepalive);
      }
    },
    [post]
  );

  const save = useCallback(
    (fields: ProgressFields) => {
      pending.current = fields;
      if (timer.current) return; // throttle: an earlier timer will pick this up
      timer.current = setTimeout(() => {
        timer.current = null;
        flushNow();
      }, FLUSH_DELAY_MS);
    },
    [flushNow]
  );

  useEffect(() => {
    const onPageHide = () => flushNow(true);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      // Unmount flush goes through the normal client (page still alive).
      flushNow();
    };
  }, [flushNow]);

  return useMemo(() => ({ save, flush: flushNow }), [save, flushNow]);
}
