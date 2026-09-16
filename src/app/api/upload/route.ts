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
import { budgetState } from '@/lib/ai';
import { db } from '@/lib/db';
import { isAiConfigured } from '@/lib/env';
import { extractDocumentText, toAiImage, transcribeImage } from '@/lib/ocr';
import {
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  putObject,
} from '@/lib/storage';

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


  /*

   * The month's ceiling, checked before the spend rather than after it, so

   * the request that would cross the line is the one refused.

   */

  const budget = await budgetState(user.id);

  if (budget.exhausted) return fail(402, 'AI_BUDGET_EXHAUSTED');

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');

  // Optional: the thread this photo is being clipped to.
  const attachToRaw = form?.get('sessionId');
  const attachTo = typeof attachToRaw === 'string' && attachToRaw.trim() ? attachToRaw.trim() : null;

  if (!(file instanceof File)) return fail(422, 'FILE_REQUIRED');
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, 'FILE_TOO_LARGE');
  if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(file.type)) {
    return fail(415, 'UNSUPPORTED_FILE_TYPE');
  }

  /*
   * A photograph and a document are read differently and fail differently.
   *
   * A photo goes to the model, which reports the regions it could not read so
   * the student is warned before they trust the transcription. A PDF, a Word
   * file or a text file is parsed, which either works or returns nothing — and
   * nothing from a PDF means a scan with no text layer, which is a different
   * problem with a different remedy: photograph the page instead.
   */
  const isImage = (ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type);

  const bytes = Buffer.from(await file.arrayBuffer());

  /*
   * Keeping the photo is secondary to reading it.
   *
   * On a serverless deployment without object storage configured, the local
   * driver tries to mkdir under the read-only function root and throws ENOENT.
   * That was aborting the whole request, so a student photographing a question
   * got a 500 and the tutor never saw an image it could read perfectly well —
   * the transcription below does not need the file to have been saved anywhere.
   *
   * So the save is best-effort. What is lost when it fails is the ability to
   * show the photo back in the thread later, and the reply is unaffected.
   */
  let stored: Awaited<ReturnType<typeof putObject>> | null = null;
  try {
    stored = await putObject({
      scope: 'uploads',
      ownerId: user.id,
      filename: file.name || 'photo.jpg',
      contentType: file.type,
      bytes,
    });
  } catch (err) {
    console.error('[upload] could not store the photo; transcribing anyway', err);
  }

  let extractedText: string;
  let hasIllegibleRegions = false;

  try {
    if (isImage) {
      const result = await transcribeImage(toAiImage(bytes, file.type));
      extractedText = result.text;
      hasIllegibleRegions = result.hasIllegibleRegions;
    } else {
      extractedText = await extractDocumentText(bytes, file.type);
    }
  } catch (err) {
    console.error('[upload] extraction failed', err);
    return fail(502, 'OCR_FAILED');
  }

  if (extractedText.trim().length < 10) {
    /*
     * A PDF that yields nothing is a scan, and telling that student to "try a
     * sharper photo" sends them round a loop they cannot exit — they did not
     * take a photo. Its own code so the client can say the one useful thing:
     * photograph the page instead.
     */
    return fail(422, isImage ? 'OCR_EMPTY' : 'DOCUMENT_HAS_NO_TEXT');
  }

  /*
   * Attaching inside an existing thread reuses it.
   *
   * The endpoint used to create a conversation unconditionally, which was right
   * when the only way in was the dedicated upload page. Now a student can clip a
   * photo to a thread they are already in, and minting a second session for it
   * would split one question across two conversations — the tutor would answer
   * about the photo somewhere the student is not looking, and the thread they
   * *are* looking at would never see it.
   */
  const existing = attachTo
    ? await db.chatSession.findFirst({
        where: { id: attachTo, userId: user.id },
        select: { id: true },
      })
    : null;

  if (attachTo && !existing) return fail(404, 'SESSION_NOT_FOUND');

  const session =
    existing ??
    (await db.chatSession.create({
      data: {
        userId: user.id,
        uploadedImageUrl: stored?.key ?? null,
        title: null,
      },
      select: { id: true },
    }));

  // A thread can accumulate several photos; the column holds the latest, which
  // is the one the next question is about.
  if (existing) {
    await db.chatSession.update({
      where: { id: existing.id },
      data: { uploadedImageUrl: stored?.key ?? null },
    });
  }

  return created({
    sessionId: session.id,
    imageKey: stored?.key ?? null,
    extractedText,
    hasIllegibleRegions,
  });
});
