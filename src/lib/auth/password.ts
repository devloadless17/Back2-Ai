import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing using Node's built-in scrypt.
 *
 * Deliberately dependency-free: this system is destined for a government
 * deployment, and the password path is the last place to accept avoidable
 * third-party supply-chain surface. scrypt is memory-hard and ships in Node.
 *
 * Parameters are stored inside the hash string, so they can be raised later
 * without invalidating existing passwords — `needsRehash` detects old hashes
 * and callers upgrade them transparently on next successful login.
 */

const PARAMS = { N: 32768, r: 8, p: 1 } as const;
const KEYLEN = 64;
const SALT_BYTES = 16;

// scrypt needs roughly 128 * N * r bytes; give it headroom or Node throws.
function maxmemFor(N: number, r: number): number {
  return 256 * N * r;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, {
    ...PARAMS,
    maxmem: maxmemFor(PARAMS.N, PARAMS.r),
  });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltB64 = parts[4];
  const hashB64 = parts[5];
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !saltB64 || !hashB64) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');

  let derived: Buffer;
  try {
    derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: maxmemFor(N, r),
    });
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** True when `stored` was produced with weaker parameters than the current policy. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < PARAMS.N || Number(parts[2]) < PARAMS.r || Number(parts[3]) < PARAMS.p;
}

/**
 * Constant-ish-time dummy verification. Called on login when the email does not
 * exist, so that "unknown email" and "wrong password" take comparable time and
 * the endpoint cannot be used to enumerate registered accounts.
 */
export async function dummyVerify(): Promise<void> {
  await scryptAsync('dummy-password-for-timing', randomBytes(SALT_BYTES), KEYLEN, {
    ...PARAMS,
    maxmem: maxmemFor(PARAMS.N, PARAMS.r),
  });
}
