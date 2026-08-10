import { z } from 'zod';

import { assertSameOrigin, fail, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { ExamError, saveAnswer } from '@/lib/exam';
import { isAiConfigured } from '@/lib/env';
import { toAiImage, transcribeImage } from '@/lib/ocr';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, putObject } from '@/lib/storage';

/**
 * Records one answer during a sitting. Two submission paths, one destination.
 *
 * Typed answers are stored as written. Photographed work is stored, transcribed,
 * and put through the OCR self-consistency gate *here* — during the sitting,
 * while the student can still re-take the photo. Deferring that check to
 * marking would mean telling them their handwriting was unreadable after the
 * paper is over, which is not a recoverable moment.
 *
 * Nothing is marked at this point. Per-question feedback while the clock runs
 * would turn a simulation into a guided exercise.
 */
const typedSchema = z.object({
  slotId: z.string().uuid(),
  answer: z.string().max(20_000),
});

export const POST = route(async (request, context: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);

  const auth = await apiUser();
  if (!auth.ok) return unauthorized(auth);
  const { user } = auth;

  const { id: simulationId } = await context.params;
  const contentType = request.headers.get('content-type') ?? '';

  try {
    // --- Photo path -------------------------------------------------------
    if (contentType.includes('multipart/form-data')) {
      if (!isAiConfigured()) return fail(503, 'AI_NOT_CONFIGURED');

      const form = await request.formData().catch(() => null);
      const file = form?.get('file');
      const slotId = String(form?.get('slotId') ?? '');

      if (!slotId) return fail(422, 'SLOT_REQUIRED');
      if (!(file instanceof File)) return fail(422, 'FILE_REQUIRED');
      if (file.size > MAX_UPLOAD_BYTES) return fail(413, 'FILE_TOO_LARGE');
      if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
        return fail(415, 'UNSUPPORTED_FILE_TYPE');
      }

      const slot = await db.examSimulationQuestion.findFirst({
        where: { id: slotId, examSimulation: { id: simulationId, userId: user.id } },
        select: {
          question: { select: { contentText: true } },
          generatedProblem: { select: { contentText: true } },
          examSimulation: { select: { subject: { select: { name: true } } } },
        },
      });
      if (!slot) return fail(404, 'SLOT_NOT_FOUND');

      const bytes = Buffer.from(await file.arrayBuffer());

      const stored = await putObject({
        scope: 'answers',
        ownerId: user.id,
        filename: file.name || 'answer.jpg',
        contentType: file.type,
        bytes,
      });

      let extractedText: string;
      try {
        const result = await transcribeImage(toAiImage(bytes, file.type), {
          questionText: slot.question?.contentText ?? slot.generatedProblem?.contentText,
          subject: slot.examSimulation.subject.name,
        });
        extractedText = result.text;
      } catch (err) {
        console.error('[exam-sim] transcription failed', err);
        return fail(502, 'OCR_FAILED');
      }

      const result = await saveAnswer({
        simulationId,
        userId: user.id,
        slotId,
        photo: { url: stored.key, extractedText },
      });

      return ok({
        status: result.status,
        extractedText,
        imageKey: stored.key,
        notes: result.status === 'photo_rejected' ? result.notes : null,
      });
    }

    // --- Typed path -------------------------------------------------------
    const body = await parseBody(request, typedSchema);
    const result = await saveAnswer({
      simulationId,
      userId: user.id,
      slotId: body.slotId,
      typedAnswer: body.answer,
    });

    return ok({ status: result.status });
  } catch (err) {
    if (err instanceof ExamError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'EXPIRED' ? 410 : 409;
      return fail(status, err.code);
    }
    throw err;
  }
});
