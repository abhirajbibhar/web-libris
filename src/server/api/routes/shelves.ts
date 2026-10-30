import { Hono } from 'hono';
import { AppEnv } from '../context';
import { toShelfDto } from '../dto';
import { HttpError, ShelfRecord } from '../types';

const canManage = (shelf: ShelfRecord, userId: number, isAdmin: boolean) =>
  shelf.userId === userId || isAdmin;

export function registerShelfRoutes(app: Hono<AppEnv>): void {
  app.get('/api/v1/shelves', async c => {
    const user = c.get('user');
    const { index } = await c.get('store').read();
    const shelves = index.shelves
      .filter(s => s.userId === user.id || s.publicShelf || user.permissions.admin)
      .map(s => toShelfDto(s, index.books.filter(b => b.shelves.includes(s.id)).length));
    return c.json(shelves);
  });

  app.post('/api/v1/shelves', async c => {
    const user = c.get('user');
    const store = c.get('store');
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'name is required');

    const created = await store.update(index => {
      const shelf: ShelfRecord = {
        id: ++index.counters.shelf,
        name,
        icon: typeof body.icon === 'string' ? body.icon : 'pi pi-bookmark',
        iconType: body.iconType === 'CUSTOM_SVG' ? 'CUSTOM_SVG' : 'PRIME_NG',
        userId: user.id,
        publicShelf: body.publicShelf === true,
        createdOn: new Date().toISOString()
      };
      index.shelves.push(shelf);
      return shelf;
    });

    return c.json(toShelfDto(created, 0), 201);
  });

  app.put('/api/v1/shelves/:id', async c => {
    const user = c.get('user');
    const store = c.get('store');
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));

    const updated = await store.update(index => {
      const shelf = index.shelves.find(s => s.id === id);
      if (!shelf) throw new HttpError(404, 'Shelf not found');
      if (!canManage(shelf, user.id, user.permissions.admin)) {
        throw new HttpError(403, 'You can only edit your own shelves');
      }
      if (typeof body.name === 'string' && body.name.trim()) shelf.name = body.name.trim();
      if (body.icon !== undefined) shelf.icon = body.icon;
      if (body.iconType !== undefined) shelf.iconType = body.iconType === 'CUSTOM_SVG' ? 'CUSTOM_SVG' : 'PRIME_NG';
      if (body.publicShelf !== undefined) shelf.publicShelf = body.publicShelf === true;
      return shelf;
    });

    const { index } = await store.read();
    return c.json(toShelfDto(updated, index.books.filter(b => b.shelves.includes(id)).length));
  });

  app.delete('/api/v1/shelves/:id', async c => {
    const user = c.get('user');
    const store = c.get('store');
    const id = Number(c.req.param('id'));

    await store.update(index => {
      const shelf = index.shelves.find(s => s.id === id);
      if (!shelf) throw new HttpError(404, 'Shelf not found');
      if (!canManage(shelf, user.id, user.permissions.admin)) {
        throw new HttpError(403, 'You can only delete your own shelves');
      }
      index.shelves = index.shelves.filter(s => s.id !== id);
      for (const book of index.books) {
        book.shelves = book.shelves.filter(shelfId => shelfId !== id);
      }
    });

    return c.body(null, 204);
  });
}
