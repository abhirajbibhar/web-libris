import { Hono } from 'hono';
import { requirePermission } from '../auth';
import { AppEnv, canSeeLibrary } from '../context';
import { toLibraryDto } from '../dto';
import { HttpError } from '../types';
import { bookStorageKeys } from '../store';


export function registerLibraryRoutes(app: Hono<AppEnv>): void {
  app.get('/api/v1/libraries', async c => {
    const user = c.get('user');
    const { index } = await c.get('store').read();
    const libraries = index.libraries
      .filter(lib => canSeeLibrary(user, lib.id))
      .map(lib => toLibraryDto(lib, index.books.filter(b => b.libraryId === lib.id).length))
      .sort((a, b) => a.name.localeCompare(b.name));
    return c.json(libraries);
  });

  app.post('/api/v1/libraries', async c => {
    const user = c.get('user');
    requirePermission(user, 'canManageLibrary');
    const store = c.get('store');
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'name is required');

    const created = await store.update(index => {
      if (index.libraries.some(l => l.name.toLowerCase() === name.toLowerCase())) {
        throw new HttpError(409, 'A library with this name already exists');
      }
      const library = {
        id: ++index.counters.library,
        name,
        icon: typeof body.icon === 'string' ? body.icon : 'pi pi-book',
        iconType: body.iconType === 'CUSTOM_SVG' ? ('CUSTOM_SVG' as const) : ('PRIME_NG' as const),
        createdOn: new Date().toISOString()
      };
      index.libraries.push(library);
      return library;
    });

    return c.json(toLibraryDto(created, 0), 201);
  });

  app.put('/api/v1/libraries/:id', async c => {
    requirePermission(c.get('user'), 'canManageLibrary');
    const store = c.get('store');
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));

    const updated = await store.update(index => {
      const library = index.libraries.find(l => l.id === id);
      if (!library) throw new HttpError(404, 'Library not found');
      if (typeof body.name === 'string' && body.name.trim()) library.name = body.name.trim();
      if (body.icon !== undefined) library.icon = body.icon;
      if (body.iconType !== undefined) {
        library.iconType = body.iconType === 'CUSTOM_SVG' ? 'CUSTOM_SVG' : 'PRIME_NG';
      }
      return library;
    });

    const { index } = await store.read();
    return c.json(toLibraryDto(updated, index.books.filter(b => b.libraryId === id).length));
  });

  app.delete('/api/v1/libraries/:id', async c => {
    requirePermission(c.get('user'), 'canManageLibrary');
    const store = c.get('store');
    const id = Number(c.req.param('id'));

    const keys = await store.update(index => {
      const library = index.libraries.find(l => l.id === id);
      if (!library) throw new HttpError(404, 'Library not found');
      const removed = index.books.filter(b => b.libraryId === id);
      const r2Keys = removed.flatMap(b => bookStorageKeys(b));
      index.books = index.books.filter(b => b.libraryId !== id);
      index.libraries = index.libraries.filter(l => l.id !== id);
      // Drop the deleted library from any user library assignments.
      for (const user of index.users) {
        if (user.assignedLibraryIds) {
          user.assignedLibraryIds = user.assignedLibraryIds.filter(libId => libId !== id);
        }
      }
      return r2Keys;
    });

    // Best-effort cleanup of stored files; the index is already consistent.
    if (keys.length > 0) {
      await c.env.Library.delete(keys);
    }
    return c.body(null, 204);
  });
}
