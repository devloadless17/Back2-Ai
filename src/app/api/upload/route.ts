import {
  assertSameOrigin,
  clientKey,
  created,
  fail,
  rateLimit,
  route,
  tooManyRequests,
  unauthorized,
} from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { isAiConfigured } from '@/lib/env';
import { toAiImage, transcribeImage } from '@/lib/ocr';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, putObject } from '@/lib/storage';

/**
 * Photo entry point.
 *
 * A student photographs a question (or their own working), and this route
 * transcribes it and opens a grounded conversation about it. The transcription
 * is shown back before anything is asked — OCR on handwritten mathematics is
 * never perfect, and letting the student see and correct what was read is the
 * difference between a useful answer and a confident answer to the wrong
 * question.
 *
 * The image itself is stored privately and referenced by key. It is a
 * photograph of a minor's schoolwork, sometimes with their name on the page.
 */
export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  if (!isAiConfigured()) return fail(503, 'AI_NOT_CONFIGURED');

  const limit = rateLimit(clientKey(request, `upload:${user.id}`), 20, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');

  if (!(file instanceof File)) return fail(422, 'FILE_REQUIRED');
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, 'FILE_TOO_LARGE');
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return fail(415, 'UNSUPPORTED_FILE_TYPE');
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const stored = await putObject({
    scope: 'uploads',
    ownerId: user.id,
    filename: file.name || 'photo.jpg',
    contentType: file.type,
    bytes,
  });

  let extractedText: string;
  let hasIllegibleRegions: boolean;

  try {
    const result = await transcribeImage(toAiImage(bytes, file.type));
    extractedText = result.text;
    hasIllegibleRegions = result.hasIllegibleRegions;
  } catch (err) {
    console.error('[upload] transcription failed', err);
    return fail(502, 'OCR_FAILED');
  }

  if (extractedText.trim().length < 10) {
    return fail(422, 'OCR_EMPTY');
  }

  const session = await db.chatSession.create({
    data: {
      userId: user.id,
      uploadedImageUrl: stored.key,
      title: null,
    },
    select: { id: true },
  });

  return created({
    sessionId: session.id,
    imageKey: stored.key,
    extractedText,
    hasIllegibleRegions,
  });
});
