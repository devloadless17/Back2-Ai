import { z } from 'zod';

import {
  assertSameOrigin,
  clientKey,
  created,
  fail,
  noContent,
  ok,
  parseBody,
  rateLimit,
  route,
  tooManyRequests,
  unauthorized,
} from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { embed } from '@/lib/ai';
import { db } from '@/lib/db';
import { isEmbeddingConfigured } from '@/lib/env';
import { extractDocumentText } from '@/lib/ocr';
import { ALLOWED_DOCUMENT_TYPES, MAX_UPLOAD_BYTES, deleteObject, putObject } from '@/lib/storage';
import { setEmbedding } from '@/lib/vector';

/**
 * Personal reference documents — tier 3 of retrieval.
 *
 * These are private to one student: their own notes, their teacher's handout, a
 * textbook page they photographed. They are embedded into `user_references` and
 * searched only under that student's id, and any answer drawn from them is
 * labelled as coming from their own material rather than from the official
 * corpus, because nobody has checked them against the programme.
 */
export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const limit = rateLimit(clientKey(request, `references:${user.id}`), 15, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');

  if (!(file instanceof File)) return fail(422, 'FILE_REQUIRED');
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, 'FILE_TOO_LARGE');
  if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(file.type)) {
    return fail(415, 'UNSUPPORTED_FILE_TYPE');
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const stored = await putObject({
    scope: 'references',
    ownerId: user.id,
    filename: file.name || 'document',
    contentType: file.type,
    bytes,
  });

  let extractedText = '';
  try {
    extractedText = await extractDocumentText(bytes, file.type);
  } catch (err) {
    console.error('[references] extraction failed', err);
  }

  // A document we could not read is not stored as a silent no-op: it would sit
  // in the student's list looking usable while contributing nothing.
  if (extractedText.trim().length < 20) {
    await deleteObject(stored.key);
    return fail(422, 'NO_TEXT_EXTRACTED');
  }

  const reference = await db.userReference.create({
    data: {
      userId: user.id,
      fileUrl: stored.key,
      fileName: file.name?.slice(0, 200) ?? null,
      extractedText,
    },
    select: { id: true, fileName: true, createdAt: true },
  });

  let embedded = false;
  if (isEmbeddingConfigured()) {
    try {
      // First 8k characters: enough to place the document in vector space, and
      // the retrieval hit returns the full text as context anyway.
      const vector = await embed(extractedText.slice(0, 8000), 'document');
      await setEmbedding('user_references', reference.id, vector);
      embedded = true;
    } catch (err) {
      console.error('[references] embedding failed', err);
    }
  }

  return created({
    id: reference.id,
    fileName: reference.fileName,
    createdAt: reference.createdAt.toISOString(),
    /** False means it is stored but not yet searchable — the UI says so. */
    searchable: embedded,
  });
});

export const GET = route(async () => {
  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const references = await db.userReference.findMany({
    where: { userId: auth.user.id },
    select: { id: true, fileName: true, fileUrl: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  return ok({ references: references.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) });
});

const deleteSchema = z.object({ id: z.string().uuid() });

export const DELETE = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);

  const body = await parseBody(request, deleteSchema);

  const reference = await db.userReference.findFirst({
    where: { id: body.id, userId: auth.user.id },
    select: { id: true, fileUrl: true },
  });

  if (!reference) return fail(404, 'NOT_FOUND');

  await db.userReference.delete({ where: { id: reference.id } });
  await deleteObject(reference.fileUrl).catch(() => undefined);

  return noContent();
});
