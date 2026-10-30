import { Hono } from 'hono';
import { hashPassword } from '../auth';
import { AppEnv } from '../context';
import { toUserDto } from '../dto';
import { DEFAULT_PERMISSIONS, HttpError, Permissions } from '../types';

const PERMISSION_KEYS: (keyof Permissions)[] = [
  'admin',
  'canUpload',
  'canDownload',
  'canDeleteBook',
  'canEditMetadata',
  'canManageLibrary',
  'canManageUsers'
];

function sanitizePermissions(value: unknown): Permissions {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PERMISSIONS };
  const input = value as Record<string, unknown>;
  const permissions = { ...DEFAULT_PERMISSIONS };
  for (const key of PERMISSION_KEYS) {
    if (typeof input[key] === 'boolean') permissions[key] = input[key] as boolean;
  }
  return permissions;
}

export function registerUserRoutes(app: Hono<AppEnv>): void {
  app.use('/api/v1/users/*', async (c, next) => {
    if (!c.get('user').permissions.admin) {
      return c.json({ message: 'Admin access required' }, 403);
    }
    await next();
  });

  app.get('/api/v1/users', async c => {
    const { index } = await c.get('store').read();
    return c.json(index.users.map(toUserDto));
  });

  app.post('/api/v1/users', async c => {
    const store = c.get('store');
    const body = await c.req.json().catch(() => ({}));

    const username = String(body.username ?? '').trim().toLowerCase();
    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim();
    const password = String(body.password ?? '');
    if (!username || !name || !email) throw new HttpError(400, 'username, name and email are required');
    if (password.length < 8) throw new HttpError(400, 'password must be at least 8 characters');

    const permissions = sanitizePermissions(body.permissions);
    let assignedLibraryIds: number[] | null = null;
    if (Array.isArray(body.assignedLibraryIds)) {
      assignedLibraryIds = body.assignedLibraryIds.map(Number);
    }

    const passwordHash = await hashPassword(password);
    const created = await store.update(index => {
      if (index.users.some(u => u.username === username)) {
        throw new HttpError(409, 'Username already exists');
      }
      const user = {
        id: ++index.counters.user,
        username,
        name,
        email,
        passwordHash,
        permissions,
        assignedLibraryIds,
        createdOn: new Date().toISOString()
      };
      index.users.push(user);
      return user;
    });

    return c.json(toUserDto(created), 201);
  });

  app.put('/api/v1/users/:id', async c => {
    const store = c.get('store');
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));

    const updated = await store.update(index => {
      const user = index.users.find(u => u.id === id);
      if (!user) throw new HttpError(404, 'User not found');

      if (typeof body.name === 'string' && body.name.trim()) user.name = body.name.trim();
      if (typeof body.email === 'string' && body.email.trim()) user.email = body.email.trim();
      if (body.permissions !== undefined) user.permissions = sanitizePermissions(body.permissions);
      if (body.assignedLibraryIds !== undefined) {
        user.assignedLibraryIds = Array.isArray(body.assignedLibraryIds)
          ? body.assignedLibraryIds.map(Number)
          : null;
      }

      // Never allow the last admin to demote themselves out of admin.
      if (!user.permissions.admin) {
        const adminCount = index.users.filter(u => u.permissions.admin).length;
        if (adminCount === 0) throw new HttpError(400, 'At least one admin is required');
      }
      return user;
    });

    return c.json(toUserDto(updated));
  });

  app.post('/api/v1/users/:id/password', async c => {
    const store = c.get('store');
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    const password = String(body.password ?? '');
    if (password.length < 8) throw new HttpError(400, 'password must be at least 8 characters');

    const passwordHash = await hashPassword(password);
    await store.update(index => {
      const user = index.users.find(u => u.id === id);
      if (!user) throw new HttpError(404, 'User not found');
      user.passwordHash = passwordHash;
      // Revokes every access/refresh token issued before this reset.
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    });
    return c.body(null, 204);
  });

  app.delete('/api/v1/users/:id', async c => {
    const store = c.get('store');
    const id = Number(c.req.param('id'));
    const current = c.get('user');
    if (id === current.id) throw new HttpError(400, 'You cannot delete your own account');

    await store.update(index => {
      const user = index.users.find(u => u.id === id);
      if (!user) throw new HttpError(404, 'User not found');
      if (user.permissions.admin) {
        const adminCount = index.users.filter(u => u.permissions.admin).length;
        if (adminCount <= 1) throw new HttpError(400, 'Cannot delete the last admin');
      }
      index.users = index.users.filter(u => u.id !== id);
      // Shelves owned by the removed user are removed from their books too.
      const ownedShelfIds = index.shelves.filter(s => s.userId === id).map(s => s.id);
      index.shelves = index.shelves.filter(s => s.userId !== id);
      for (const book of index.books) {
        book.shelves = book.shelves.filter(shelfId => !ownedShelfIds.includes(shelfId));
      }
    });
    return c.body(null, 204);
  });
}
