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

  const url = new URL(
    e.S3_FORCE_PATH_STYLE
      ? `${e.S3_ENDPOINT}/${e.S3_BUCKET}/${key}`
      : `${e.S3_ENDPOINT.replace('://', `://${e.S3_BUCKET}.`)}/${key}`,
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

function driver(): StorageDriver {
  // Production must set real S3 credentials; the local driver is dev-only and
  // will not survive a multi-instance deployment.
  return env().S3_ACCESS_KEY_ID && env().S3_ENDPOINT.startsWith('http') && process.env.STORAGE_DRIVER === 's3'
    ? s3Driver
    : localDriver;
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
export const ALLOWED_DOCUMENT_TYPES = ['application/pdf', 'text/plain', ...ALLOWED_IMAGE_TYPES] as const;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
