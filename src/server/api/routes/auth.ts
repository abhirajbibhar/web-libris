import { Hono } from 'hono';
import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
  tokenVersionMatches,
  verifyPassword,
  verifyToken
} from '../auth';
import { AppEnv } from '../context';
import { toUserDto } from '../dto';
import type { IndexStore } from '../store';
import { DEFAULT_PERMISSIONS, HttpError, UserRecord } from '../types';

/**
 * One-time bootstrap for fresh deployments: when the store has no users yet
 * and both ADMIN_USER and ADMIN_PASSWORD worker secrets are set, create the
 * initial admin (plus the default library) so the setup page can be skipped —
 * sign in with those credentials straight away.
 *
 * The secrets are inert once any user exists: they never overwrite or add
 * accounts, so afterwards accounts live in the index and are managed from the
 * UI only. Name/email default to the username; edit them later in Users.
 */

const requireString = (value: unknown, field: string, min = 1): string => {
  if (typeof value !== 'string' || value.trim().length < min) {
    throw new HttpError(400, `${field} is required${min > 1 ? ` (min ${min} characters)` : ''}`);
  }
  return value.trim();
};
async function ensureBootstrapAdmin(
  env: { ADMIN_USER?: string; ADMIN_PASSWORD?: string },
  store: IndexStore
): Promise<void> {
  const username = env.ADMIN_USER?.trim().toLowerCase();
  const password = env.ADMIN_PASSWORD;
  if (!username || !password) {
    if (username || password) {
      console.warn('ADMIN_USER and ADMIN_PASSWORD must both be set; skipping admin bootstrap');
    }
    return;
  }

  const { index } = await store.read();
  if (index.users.length > 0) return;

  const passwordHash = await hashPassword(password);
  await store.update(draft => {
    if (draft.users.length > 0) return null; // another request bootstrapped first
    const admin: UserRecord = {
      id: ++draft.counters.user,
      username,
      name: username,
      email: `${username}@admin.local`,
      passwordHash,
      permissions: {
        ...DEFAULT_PERMISSIONS,
        admin: true,
        canUpload: true,
        canDownload: true,
        canDeleteBook: true,
        canManageLibrary: true,
        canManageUsers: true
      },
      assignedLibraryIds: null,
      createdOn: new Date().toISOString()
    };
    draft.users.push(admin);

    // Same default library the setup page would have created.
    draft.libraries.push({
      id: ++draft.counters.library,
      name: 'General',
      icon: 'pi pi-book',
      iconType: 'PRIME_NG',
      createdOn: new Date().toISOString()
    });
    return admin;
  });
}

export function registerAuthRoutes(app: Hono<AppEnv>): void {
  app.get('/api/v1/setup/status', async c => {
    const store = c.get('store');
    await ensureBootstrapAdmin(c.env, store);
    const { index } = await store.read();
    return c.json({ setupRequired: index.users.length === 0 });
  });

  app.post('/api/v1/auth/login', async c => {
    const store = c.get('store');
    await ensureBootstrapAdmin(c.env, store);
    const body = await c.req.json().catch(() => ({}));
    const username = requireString(body.username, 'username').toLowerCase();
    const password = requireString(body.password, 'password');

    const { index } = await store.read();
    const user = index.users.find(u => u.username === username);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(401, 'Invalid username or password');
    }

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(c.env, user),
      signRefreshToken(c.env, user)
    ]);
    return c.json({ accessToken, refreshToken, user: toUserDto(user) });
  });

  app.post('/api/v1/auth/refresh', async c => {
    const store = c.get('store');
    const body = await c.req.json().catch(() => ({}));
    const token = typeof body.refreshToken === 'string' ? body.refreshToken : null;
    if (!token) throw new HttpError(400, 'refreshToken is required');

    let payload;
    try {
      payload = await verifyToken(c.env, token, 'refresh');
    } catch {
      throw new HttpError(401, 'Invalid refresh token');
    }

    const { index } = await store.read();
    const user = index.users.find(u => String(u.id) === payload.sub);
    if (!user) throw new HttpError(401, 'User no longer exists');
    if (!tokenVersionMatches(payload, user)) {
      throw new HttpError(401, 'Session revoked, please sign in again');
    }

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(c.env, user),
      signRefreshToken(c.env, user)
    ]);
    return c.json({ accessToken, refreshToken });
  });

  app.get('/api/v1/auth/me', c => {
    return c.json(toUserDto(c.get('user')));
  });

  app.post('/api/v1/auth/logout', c => {
    // Tokens are stateless JWTs; the client discards them.
    return c.body(null, 204);
  });

  app.post('/api/v1/auth/logout-all', async c => {
    const store = c.get('store');
    const currentUser = c.get('user');
    // Bumping the version invalidates every token issued to this user so far
    // — including the one that authorized this request. All devices, this one
    // included, must sign in again.
    await store.update(index => {
      const stored = index.users.find(u => u.id === currentUser.id);
      if (stored) stored.tokenVersion = (stored.tokenVersion ?? 0) + 1;
    });
    return c.body(null, 204);
  });

  app.post('/api/v1/auth/password', async c => {
    const store = c.get('store');
    const currentUser = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const currentPassword = requireString(body.currentPassword, 'currentPassword');
    const newPassword = requireString(body.newPassword, 'newPassword', 8);

    const { index } = await store.read();
    const user = index.users.find(u => u.id === currentUser.id);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new HttpError(401, 'Current password is incorrect');
    }
    const passwordHash = await hashPassword(newPassword);
    await store.update(index => {
      const stored = index.users.find(u => u.id === currentUser.id);
      if (stored) {
        stored.passwordHash = passwordHash;
        // Revokes every access/refresh token issued before this change.
        stored.tokenVersion = (stored.tokenVersion ?? 0) + 1;
      }
    });
    return c.body(null, 204);
  });
}
