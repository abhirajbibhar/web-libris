import type { R2Bucket } from '../r2';
import { IndexStore } from './store';
import type { UserRecord } from './types';

export interface AppEnv {
  Bindings: {
    Library: R2Bucket;
    /** Required: the only JWT signing key. No fallback — the worker fails fast
     *  on first use if this is not set. */
    JWT_SECRET?: string;
    ENVIRONMENT?: string;
    /** One-time bootstrap: initial admin username (with ADMIN_PASSWORD). */
    ADMIN_USER?: string;
    /** One-time bootstrap: initial admin password (with ADMIN_USER). */
    ADMIN_PASSWORD?: string;
  };
  Variables: {
    user: UserRecord;
    store: IndexStore;
  };
}

const stores = new WeakMap<R2Bucket, IndexStore>();

/** One IndexStore per isolate per bucket, so the etag cache is reused across requests. */
export function getStore(bucket: R2Bucket): IndexStore {
  let store = stores.get(bucket);
  if (!store) {
    store = new IndexStore(bucket);
    stores.set(bucket, store);
  }
  return store;
}

/** Books a user is allowed to see (null assignedLibraryIds = all libraries). */
export function canSeeLibrary(user: UserRecord, libraryId: number): boolean {
  return user.assignedLibraryIds === null || user.assignedLibraryIds.includes(libraryId);
}
