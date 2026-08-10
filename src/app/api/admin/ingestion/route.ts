import { assertSameOrigin, created, fail, ok, route, unauthorized } from '@/lib/api';
import { AuditAction, recordAudit } from '@/lib/audit';
import { apiAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { createJob, embedPending, recalibrateDifficulty, runIngestion } from '@/lib/ingestion';
import { ALLOWED_DOCUMENT_TYPES, MAX_UPLOAD_BYTES } from '@/lib/storage';

/**
 * Triggers and monitors ingestion.
 *
 * The job row is created and returned immediately, and the work continues
 * behind the request — a scanned paper takes minutes to segment and tag, which
 * is longer than any sensible HTTP timeout. The admin page polls the job.
 *
 * Note for deployment: this relies on the process outliving the response. That
 * holds on a long-running Node server, which is what this is designed for. On a
 * platform that freezes the process after the response, move the body of the
 * `void run…` call to a queue worker; the job row and the polling UI stay as
 * they are.
 */
export const GET = route(async () => {
  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const jobs = await db.ingestionJob.findMany({
    select: {
      id: true,
      kind: true,
      status: true,
      sourceLabel: true,
      itemsTotal: true,
      itemsProcessed: true,
      itemsFailed: true,
      errorMessage: true,
      log: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      subject: { select: { id: true, name: true } },
      actor: { select: { email: true, displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  return ok({
    jobs: jobs.map((job) => ({
      ...job,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    })),
  });
});

export const POST = route(async (request) => {
  assertSameOrigin(request);

  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);

  const contentType = request.headers.get('content-type') ?? '';

  // --- Maintenance jobs (no document) -------------------------------------
  if (!contentType.includes('multipart/form-data')) {
    const body = (await request.json().catch(() => ({}))) as { kind?: string };

    if (body.kind === 'embed_missing') {
      const jobId = await createJob({
        kind: 'embed_missing',
        subjectId: null,
        sourceLabel: 'Backfill embeddings',
        triggeredBy: auth.user.id,
      });

      void (async () => {
        try {
          await db.ingestionJob.update({
            where: { id: jobId },
            data: { status: 'running', startedAt: new Date() },
          });
          const counts = await embedPending(jobId);
          const total = counts.questions + counts.chunks + counts.references;
          await db.ingestionJob.update({
            where: { id: jobId },
            data: {
              status: 'succeeded',
              finishedAt: new Date(),
              itemsProcessed: total,
              itemsTotal: total,
            },
          });
        } catch (err) {
          await db.ingestionJob.update({
            where: { id: jobId },
            data: {
              status: 'failed',
              finishedAt: new Date(),
              errorMessage: err instanceof Error ? err.message : 'Unknown failure.',
            },
          });
        }
      })();

      await recordAudit({
        actorUserId: auth.user.id,
        action: AuditAction.INGESTION_JOB_TRIGGERED,
        targetType: 'ingestion_job',
        targetId: jobId,
        metadata: { kind: 'embed_missing' },
      });

      return created({ jobId });
    }

    if (body.kind === 'recalibrate_difficulty') {
      const updated = await recalibrateDifficulty();
      return ok({ updated });
    }

    return fail(422, 'UNKNOWN_JOB_KIND');
  }

  // --- Document ingestion --------------------------------------------------
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const subjectId = String(form?.get('subjectId') ?? '');
  const kind = String(form?.get('kind') ?? 'exam_paper');
  const yearRaw = String(form?.get('year') ?? '');
  const session = String(form?.get('session') ?? '') || undefined;

  if (!(file instanceof File)) return fail(422, 'FILE_REQUIRED');
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, 'FILE_TOO_LARGE');
  if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(file.type)) {
    return fail(415, 'UNSUPPORTED_FILE_TYPE');
  }
  if (kind !== 'exam_paper' && kind !== 'course_material') return fail(422, 'UNKNOWN_JOB_KIND');

  const subject = await db.subject.findUnique({ where: { id: subjectId }, select: { id: true } });
  if (!subject) return fail(404, 'SUBJECT_NOT_FOUND');

  const bytes = Buffer.from(await file.arrayBuffer());
  const label = file.name || 'source document';

  const jobId = await createJob({
    kind,
    subjectId: subject.id,
    sourceLabel: label,
    triggeredBy: auth.user.id,
  });

  void runIngestion(jobId, {
    kind,
    subjectId: subject.id,
    label,
    bytes,
    contentType: file.type,
    year: yearRaw ? Number(yearRaw) : undefined,
    session,
  }).catch((err) => {
    console.error('[ingestion] job failed', jobId, err);
  });

  await recordAudit({
    actorUserId: auth.user.id,
    action: AuditAction.INGESTION_JOB_TRIGGERED,
    targetType: 'ingestion_job',
    targetId: jobId,
    metadata: { kind, subjectId: subject.id, label },
  });

  return created({ jobId });
});
