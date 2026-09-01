import {
  assertSameOrigin,
  clientKey,
  fail,
  ok,
  rateLimit,
  route,
  tooManyRequests,
  unauthorized,
} from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { isAiConfigured } from '@/lib/env';
import { toAiImage } from '@/lib/ocr';
import { answerPhotoQuestion } from '@/lib/photo-qa';
import { subjectIdsForStudent } from '@/lib/queries/taxonomy';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@/lib/storage';

/**
 * "I'm stuck on this" — a photographed question, answered from the programme.
 *
 * `answerPhotoQuestion` has existed, fully built and fully commented, with no
 * caller: transcribe, retrieve against the student's own subjects, answer only
 * from what was retrieved, verify, withdraw if it fails. Every safety property
 * the chat pipeline has, and no way for a student to reach it. This is the way
 * in.
 *
 * Distinct from `/api/upload`, which is the other thing a photograph can be
 * for. Upload transcribes the image and opens a *conversation* about it, and
 * the student carries on typing. This answers the question in one shot and
 * cites what it answered from, which is what somebody stuck on question 3 at
 * eleven at night actually wants.
 *
 * The image is never stored. Upload keeps its file because a conversation
 * refers back to it; there is nothing here to refer back to, and a photograph
 * of a minor's schoolwork that we do not need is a photograph we should not be
 * holding.
 */
export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  if (!isAiConfigured()) return fail(503, 'AI_NOT_CONFIGURED');

  /*
   * Counted against the same hourly budget as an upload. This costs a
   * transcription, a retrieval, an answer and a verification — the most
   * expensive thing a student can trigger from a single tap — and the limiter
   * is the only thing standing between a stuck camera button and the bill.
   */
  const limit = rateLimit(clientKey(request, `photo-qa:${user.id}`), 20, 60 * 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const note = form?.get('note');

  if (!(file instanceof File)) return fail(422, 'FILE_REQUIRED');
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, 'FILE_TOO_LARGE');
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return fail(415, 'UNSUPPORTED_FILE_TYPE');
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  let answer;
  try {
    answer = await answerPhotoQuestion({
      userId: user.id,
      image: toAiImage(bytes, file.type),
      // Server-derived, never taken from the request: the subject scope is what
      // stops a student being answered out of another track's material.
      subjectIds: await subjectIdsForStudent(user.trackId, user.preferredLanguage),
      locale: user.preferredLanguage,
      note: typeof note === 'string' ? note : undefined,
    });
  } catch (err) {
    console.error('[photo-qa] failed', err);
    return fail(502, 'PHOTO_QA_FAILED');
  }

  /*
   * A photo too dark to read is not an off-programme question, and the two must
   * not arrive at the client looking alike. `unreadable` asks for a better
   * photograph; `covered: false` says the programme does not cover this.
   */
  if (answer.status === 'unreadable') return fail(422, 'OCR_EMPTY');
  if (answer.status === 'not_configured') return fail(503, 'AI_NOT_CONFIGURED');

  return ok({
    covered: answer.covered,
    withdrawn: answer.withdrawn,
    transcription: answer.transcription,
    answer: answer.answer,
    chapterId: answer.chapterId,
    chapterName: answer.chapterName,
    sources: answer.sources,
  });
});
