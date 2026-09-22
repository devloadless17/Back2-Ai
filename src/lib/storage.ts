import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '@/lib/env';

/**
 * Object storage for uploads: answer photos, personal reference documents,
 * ingested source papers.
 *
 * Two drivers behind one interface. The local driver writes under ./uploads and
 * is the dev default; the S3 driver is for production.
 *
 * Deliberate design point: this module never returns a public URL. Everything
 * stored here is either a student's own work or their private documents, so
 * reads go through `/api/files/[...key]`, which checks ownership before
 * streaming bytes. A presigned or public bucket URL would make a leaked link
 * sufficient to read another student's exam paper.
 */

export type StoredObject = {
  /** Opaque storage key. Persist this, not a URL. */
  key: string;
  size: number;
  contentType: string;
  /** SHA-256 of the bytes — lets ingestion detect a re-upload of the same file. */
  checksum: string;
};

export type UploadInput = {
  /** Logical bucket: 'answers' | 'references' | 'ingestion' | 'question-images'. */
  scope: string;
  /** Scopes the key to a user so ownership is derivable from the key itself. */
  ownerId?: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
};

const LOCAL_ROOT = path.join(process.cwd(), 'uploads');

/** Rejects traversal and absolute paths before any key touches the filesystem. */
function assertSafeKey(key: string): void {
  if (
    key.length === 0 ||
    key.includes('..') ||
    key.startsWith('/') ||
    key.startsWith('\\') ||
    path.isAbsolute(key) ||
    /[\0<>:"|?*]/.test(key)
  ) {
    throw new Error('Invalid storage key.');
  }
}

function buildKey(input: UploadInput): string {
  const ext = path.extname(input.filename).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
  const segments = [input.scope, input.ownerId, `${randomUUID()}${ext}`].filter(Boolean);
  return segments.join('/');
}

interface StorageDriver {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const localDriver: StorageDriver = {
  async put(key, bytes) {
    const target = path.join(LOCAL_ROOT, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  },
  async get(key) {
    return readFile(path.join(LOCAL_ROOT, key));
  },
  async remove(key) {
    await unlink(path.join(LOCAL_ROOT, key)).catch(() => undefined);
  },
};

/**
 * S3-compatible driver using SigV4 over fetch.
 *
 * Written directly rather than pulling in the AWS SDK: this needs exactly three
 * operations, and the SDK is a large dependency to add to a system that will be
 * security-reviewed. Works against AWS S3, Cloudflare R2, and MinIO.
 */
const s3Driver: StorageDriver = {
  async put(key, bytes, contentType) {
    const response = await signedFetch('PUT', key, bytes, contentType);
    if (!response.ok) {
      throw new Error(`Object storage rejected the upload (${response.status}).`);
    }
  },
  async get(key) {
    const response = await signedFetch('GET', key);
    if (!response.ok) {
      throw new Error(`Object storage read failed (${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  },
  async remove(key) {
    await signedFetch('DELETE', key);
  },
};

async function signedFetch(
  method: 'GET' | 'PUT' | 'DELETE',
  key: string,
  body?: Buffer,
  contentType?: string,
): Promise<Response> {
  const { createHmac } = await import('node:crypto');
  const e = env();

  // A trailing slash on the endpoint would make the path `//bucket/key`, which
  // is signed as written and rejected as a mismatch — an authentication error
  // for what is really a typo in a config value nobody looks at twice.
  const endpoint = e.S3_ENDPOINT.replace(/\/+$/, '');

  const url = new URL(
    e.S3_FORCE_PATH_STYLE
      ? `${endpoint}/${e.S3_BUCKET}/${key}`
      : `${endpoint.replace('://', `://${e.S3_BUCKET}.`)}/${key}`,
  );

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash('sha256')
    .update(body ?? Buffer.alloc(0))
    .digest('hex');

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${headers[h]}\n`).join('');
  const signedHeaderList = signedHeaders.join(';');

  const canonicalRequest = [
    method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${e.S3_REGION}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${e.S3_SECRET_ACCESS_KEY}`, dateStamp), e.S3_REGION), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return fetch(url, {
    method,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${e.S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaderList}, Signature=${signature}`,
    },
    // Node's fetch accepts a Uint8Array at runtime, but the DOM `BodyInit` type
    // shipped with TypeScript 5.7+ no longer admits the generic
    // `Uint8Array<ArrayBufferLike>`. The cast is a types-only workaround.
    body: body
      ? (new Uint8Array(body.buffer, body.byteOffset, body.byteLength) as unknown as BodyInit)
      : undefined,
  });
}

/**
 * Why object storage is not in use, named without printing any value.
 *
 * The local driver cannot work on a serverless deployment — the function root is
 * read-only, so it fails on mkdir — and it is reached by falling through this
 * check rather than by being chosen. When all three conditions are set correctly
 * the fall-through is impossible, so the useful thing to log is which one is not.
 */
function s3Gap(): string | null {
  if (!env().S3_ACCESS_KEY_ID) return 'S3_ACCESS_KEY_ID is empty';
  if (!env().S3_ENDPOINT.startsWith('http')) return 'S3_ENDPOINT does not start with http';
  if (process.env.STORAGE_DRIVER !== 's3') return 'STORAGE_DRIVER is not exactly "s3"';
  return null;
}

let gapLogged = false;

function driver(): StorageDriver {
  // Production must set real S3 credentials; the local driver is dev-only and
  // will not survive a multi-instance deployment.
  const gap = s3Gap();
  if (!gap) return s3Driver;

  if (!gapLogged) {
    gapLogged = true;
    console.warn(`[storage] object storage is off: ${gap}. Uploads will not persist.`);
  }
  return localDriver;
}

export async function putObject(input: UploadInput): Promise<StoredObject> {
  const key = buildKey(input);
  assertSafeKey(key);
  await driver().put(key, input.bytes, input.contentType);

  return {
    key,
    size: input.bytes.byteLength,
    contentType: input.contentType,
    checksum: createHash('sha256').update(input.bytes).digest('hex'),
  };
}

export async function getObject(key: string): Promise<Buffer> {
  assertSafeKey(key);
  return driver().get(key);
}

/** The key names bytes that differ from the ones being written. */
export class ContentConflictError extends Error {
  constructor(key: string) {
    super(`Storage key already holds different bytes: ${key}`);
    this.name = 'ContentConflictError';
  }
}

/**
 * Writes bytes under a key derived from their content — never a random name.
 *
 * Idempotent: the same bytes at the same key is `unchanged`, nothing written.
 * Never overwrites: the key embeds the SHA-256 of the bytes it names, so bytes
 * that do not hash to it are refused before anything is read, and an existing
 * object with a different payload is a conflict, not a replacement.
 */
export async function putContentAddressed(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<'written' | 'unchanged'> {
  assertSafeKey(key);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const named = /\/([0-9a-f]{64})\.[a-z0-9]+$/.exec(key)?.[1];
  if (!named || named !== checksum) throw new ContentConflictError(key);

  let existing: Buffer | null = null;
  try {
    existing = await driver().get(key);
  } catch {
    existing = null;
  }
  if (existing) {
    if (createHash('sha256').update(existing).digest('hex') === checksum) return 'unchanged';
    throw new ContentConflictError(key);
  }
  await driver().put(key, bytes, contentType);
  return 'written';
}

export async function deleteObject(key: string): Promise<void> {
  assertSafeKey(key);
  await driver().remove(key);
}

/**
 * Derives the owner from a key written by `buildKey`. Used by the file-serving
 * route as a second check alongside the database lookup.
 */
export function ownerFromKey(key: string): string | null {
  const parts = key.split('/');
  return parts.length >= 3 ? (parts[1] ?? null) : null;
}

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/**
 * What a student may attach.
 *
 * Word documents are here because that is what a Lebanese school hands out —
 * teachers circulate .docx, and a student who cannot attach the handout their
 * teacher gave them has to retype it or photograph a screen.
 *
 * `.doc` (the pre-2007 binary format) is deliberately absent. It is not a ZIP,
 * needs a real parser, and returning garbled text from one would be worse than
 * refusing it: the student would not know the tutor was reading nonsense.
 */
export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ...ALLOWED_IMAGE_TYPES,
] as const;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
