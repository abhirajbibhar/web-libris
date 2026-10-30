import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FileSystemBucket, type R2Bucket } from './r2';

export interface ApiBindings {
  Library: R2Bucket;
  JWT_SECRET?: string;
  ENVIRONMENT?: string;
  ADMIN_USER?: string;
  ADMIN_PASSWORD?: string;
}

/** Read `.env` without a dependency; real process env always wins. */
function loadDotEnv(): void {
  const file = path.join(process.cwd(), '.env');
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

let cached: ApiBindings | null = null;

/**
 * One bucket per server process, sharing the in-memory index cache exactly
 * like the single-isolate Worker did.
 */
export function getBindings(): ApiBindings {
  if (cached) return cached;
  loadDotEnv();
  cached = {
    Library: new FileSystemBucket(process.env.WEB_LIBRIS_DATA_DIR ?? path.join(process.cwd(), '.data')),
    JWT_SECRET: process.env.JWT_SECRET,
    ENVIRONMENT: process.env.NODE_ENV ?? 'development',
    ADMIN_USER: process.env.ADMIN_USER,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD
  };
  return cached;
}
