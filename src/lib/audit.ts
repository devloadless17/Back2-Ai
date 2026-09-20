import 'server-only';

import { headers } from 'next/headers';
import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * Append-only audit trail.
 *
 * Every action that changes what a student is graded on, what content is
 * visible, or who can do what must land here. The exec plan's own rules depend
 * on it: admin-gated publication of generated content, admin edits to a locked
 * track/language, and any relaxation of those defaults being "an explicit,
 * logged config change".
 *
 * Writes are best-effort and never block or fail the action being audited —
 * but failures are surfaced on the server console rather than swallowed.
 */

export const AuditAction = {
  // Auth
  LOGIN_SUCCEEDED: 'auth.login.succeeded',
  LOGIN_FAILED: 'auth.login.failed',
  LOGOUT: 'auth.logout',
  SIGNUP: 'auth.signup',
  PASSWORD_CHANGED: 'auth.password.changed',
  SESSIONS_REVOKED: 'auth.sessions.revoked',
  EMAIL_VERIFIED: 'auth.email.verified',
  /*
   * A reset that was completed, not one that was asked for. Requests are not
   * logged: the endpoint answers identically whether or not the address exists,
   * and an audit row per request would record exactly the difference the
   * response is careful to hide.
   */
  PASSWORD_RESET: 'auth.password.reset',

  // Admin actions on students
  USER_TRACK_CHANGED: 'admin.user.track_changed',
  USER_LANGUAGE_CHANGED: 'admin.user.language_changed',
  USER_ROLE_CHANGED: 'admin.user.role_changed',
  USER_DEACTIVATED: 'admin.user.deactivated',
  USER_REACTIVATED: 'admin.user.reactivated',
  USER_VERIFICATION_RESENT: 'admin.user.verification_resent',

  // Content lifecycle
  REVIEW_ITEM_APPROVED: 'review.item.approved',
  REVIEW_ITEM_REJECTED: 'review.item.rejected',
  CONTENT_FLAGGED: 'review.content.flagged',
  GENERATED_PROBLEM_PUBLISHED: 'content.generated_problem.published',
  ANNOUNCEMENT_CREATED: 'admin.announcement.created',
  ANNOUNCEMENT_UPDATED: 'admin.announcement.updated',
  ANNOUNCEMENT_DELETED: 'admin.announcement.deleted',
  INGESTION_JOB_TRIGGERED: 'admin.ingestion.triggered',
  /*
   * A chapter taken out of, or put back into, the programme.
   *
   * Audited because it is the widest-reaching action an administrator can take
   * on the student side: it changes what every student in a track can practise,
   * and it moves the denominator of "programme covered" on all of their
   * dashboards at once. The record carries how many questions and attempts sat
   * behind the chapter at the moment of the decision, so the call can be
   * reviewed against what was true then.
   */
  CHAPTER_CANCELLED: 'admin.chapter.cancelled',
  CHAPTER_RESTORED: 'admin.chapter.restored',

  // Billing. Logged even while no processor is connected: a change to what a
  // student believes they have agreed to pay is exactly the kind of event that
  // has to be reconstructable later.
  BILLING_PLAN_CHANGED: 'billing.plan.changed',
  BILLING_CARD_SAVED: 'billing.card.saved',
  BILLING_CARD_REMOVED: 'billing.card.removed',

  // Examination integrity
  EXAM_SIM_STARTED: 'exam.sim.started',
  EXAM_SIM_SUBMITTED: 'exam.sim.submitted',
  EXAM_SIM_AUTO_SUBMITTED: 'exam.sim.auto_submitted',
  EXAM_SIM_GRADED: 'exam.sim.graded',
  EXAM_ANSWER_REJECTED_OCR: 'exam.answer.ocr_rejected',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

type AuditInput = {
  actorUserId?: string | null;
  action: AuditActionValue | (string & {});
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

async function callerIp(): Promise<string | null> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    if (forwarded) return (forwarded.split(',')[0] ?? '').trim() || null;
    return h.get('x-real-ip');
  } catch {
    // Outside a request scope (cron, seed script, CLI) there is no caller IP.
    return null;
  }
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: input.metadata ?? undefined,
        ipAddress: await callerIp(),
      },
    });
  } catch (err) {
    console.error('[audit] failed to record event', input.action, err);
  }
}
