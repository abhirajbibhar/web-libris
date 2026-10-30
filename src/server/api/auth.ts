import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { HttpError, Permissions, UserRecord } from './types';

const PBKDF2_ITERATIONS = 100_000;
const encoder = new TextEncoder();

export const ACCESS_TOKEN_TTL = '12h';
export const REFRESH_TOKEN_TTL = '30d';

export interface TokenPayload extends JWTPayload {
  type: 'access' | 'refresh';
  username: string;
  /** user.tokenVersion at issue time; absent on legacy tokens (counts as 0) */
  ver?: number;
}

/* ----------------------------- passwords ----------------------------- */

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const salt = fromBase64(parts[2]);
  const expected = fromBase64(parts[3]);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    expected.length * 8
  );
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/* -------------------------------- JWT -------------------------------- */

const keyCache = new Map<string, CryptoKey>();

async function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify'
    ]);
    keyCache.set(secret, key);
  }
  return key;
}

/**
 * The only JWT signing secret source: the `JWT_SECRET` worker secret.
 * There is no fallback — if it is not set the worker fails fast on the first
 * request that needs to sign or verify a token, rather than silently falling
 * back to a bucket file or a well-known dev value.
 */
export interface JwtEnv {
  JWT_SECRET?: string;
  ENVIRONMENT?: string;
  Library?: R2Bucket;
}

export async function jwtSecret(env: JwtEnv): Promise<string> {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set — this worker requires it as a Cloudflare Worker secret');
  }
  return env.JWT_SECRET;
}

async function signToken(
  secret: string,
  user: UserRecord,
  type: 'access' | 'refresh',
  ttl: string
): Promise<string> {
  return new SignJWT({ username: user.username, type, ver: user.tokenVersion ?? 0 } satisfies Partial<TokenPayload>)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuer('web-libris')
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(await hmacKey(secret));
}

export async function signAccessToken(env: JwtEnv, user: UserRecord): Promise<string> {
  return signToken(await jwtSecret(env), user, 'access', ACCESS_TOKEN_TTL);
}

export async function signRefreshToken(env: JwtEnv, user: UserRecord): Promise<string> {
  return signToken(await jwtSecret(env), user, 'refresh', REFRESH_TOKEN_TTL);
}

export async function verifyToken(
  env: JwtEnv,
  token: string,
  expectedType: 'access' | 'refresh'
): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, await hmacKey(await jwtSecret(env)), {
    issuer: 'web-libris'
  });
  const typed = payload as TokenPayload;
  if (typed.type !== expectedType) {
    throw new HttpError(401, 'Invalid token type');
  }
  return typed;
}

/**
 * True while `payload` was issued under the user's current tokenVersion.
 * Password changes bump the version, so every older token (access or refresh)
 * stops being accepted for that user. Legacy tokens with no `ver` claim count
 * as version 0, matching users whose password never changed.
 */
export function tokenVersionMatches(payload: TokenPayload, user: UserRecord): boolean {
  return (payload.ver ?? 0) === (user.tokenVersion ?? 0);
}

export function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/* ----------------------------- permissions ---------------------------- */

export type PermissionKey = keyof Permissions;

export function hasPermission(user: UserRecord, permission: PermissionKey): boolean {
  return user.permissions.admin || user.permissions[permission];
}

export function requirePermission(user: UserRecord, permission: PermissionKey): void {
  if (!hasPermission(user, permission)) {
    throw new HttpError(403, 'You do not have permission to perform this action');
  }
}
