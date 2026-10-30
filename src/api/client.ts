const ACCESS_KEY = 'accessToken';
const REFRESH_KEY = 'refreshToken';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Tokens only exist in the browser; the SPA shell is prerendered on the server. */
const storage = (): Storage | null => (typeof localStorage === 'undefined' ? null : localStorage);

export const tokenStore = {
  get access(): string | null {
    return storage()?.getItem(ACCESS_KEY) ?? null;
  },
  get refresh(): string | null {
    return storage()?.getItem(REFRESH_KEY) ?? null;
  },
  save(access: string, refresh: string) {
    storage()?.setItem(ACCESS_KEY, access);
    storage()?.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    storage()?.removeItem(ACCESS_KEY);
    storage()?.removeItem(REFRESH_KEY);
  }
};

async function parseError(response: Response): Promise<ApiError> {
  let message = response.statusText || 'Request failed';
  try {
    const body = (await response.json()) as { message?: string };
    if (body?.message) message = body.message;
  } catch {
    // keep default message
  }
  return new ApiError(response.status, message);
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = tokenStore.refresh;
      if (!refreshToken) return false;
      try {
        const response = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { accessToken: string; refreshToken: string };
        tokenStore.save(body.accessToken, body.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        // Allow a fresh attempt for the next 401 burst.
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      }
    })();
  }
  return refreshPromise;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true, as: 'json' | 'blob' = 'json'): Promise<T> {
  const headers = new Headers(init.headers);
  // Lets the server place reading activity on the reader's own calendar day.
  headers.set('X-Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
  const token = tokenStore.access;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Cannot reach the server');
  }

  if (response.status === 401 && retry) {
    if (await tryRefresh()) {
      return request<T>(path, init, false, as);
    }
    tokenStore.clear();
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login?reason=session_expired';
    }
    throw new ApiError(401, 'Session expired');
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  if (as === 'blob') return (await response.blob()) as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  /** Authenticated download of a non-JSON response. */
  blob: (path: string) => request<Blob>(path, {}, true, 'blob'),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' })
};
