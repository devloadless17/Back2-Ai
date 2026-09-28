import { z } from 'zod';
import { assertSameOrigin, fail, ok, parseBody, route, unauthorized } from '@/lib/api';
import { apiAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { paperIsComplete } from '@/lib/ai-exam-production';
import { recordAudit, AuditAction } from '@/lib/audit';

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const auth = await apiAdmin();
  if (!auth.ok) return unauthorized(auth);
  const input = await parseBody(request, z.object({ id: z.string().uuid(), decision: z.enum(['approve', 'reject']) }));
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM generated_exam_papers WHERE id = ${input.id}::uuid FOR UPDATE`;
    const paper = await tx.generatedExamPaper.findUnique({ where: { id: input.id }, include: { problems: true } });
    if (!paper) return 'NOT_FOUND';
    if (paper.status !== 'review') return 'ALREADY_REVIEWED';
    if (input.decision === 'approve' && (!paperIsComplete(paper) || paper.problems.some((q) => q.verificationStatus !== 'solver_passed'))) return 'QUALITY_CHECK_FAILED';
    const approved = input.decision === 'approve';
    const publishedAt = approved ? new Date() : null;
    await tx.generatedProblem.updateMany({ where: { generatedPaperId: paper.id }, data: {
      verificationStatus: approved ? 'approved' : 'rejected', publishedAt,
    } });
    await tx.generatedExamPaper.update({ where: { id: paper.id }, data: { status: approved ? 'approved' : 'rejected', publishedAt } });
    return 'OK';
  });
  if (result !== 'OK') return fail(result === 'NOT_FOUND' ? 404 : 409, result);
  await recordAudit({ actorUserId: auth.user.id, action: AuditAction.GENERATED_PROBLEM_PUBLISHED,
    targetType: 'generated_exam_paper', targetId: input.id, metadata: { decision: input.decision } });
  return ok({ id: input.id, decision: input.decision });
});
