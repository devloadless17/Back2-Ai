import 'server-only';

import { db } from '@/lib/db';
import {
  type ConsumerLocator,
  type LegacyVerdictName,
  selectVisualEvidence,
  type VisualRelationRow,
  type VisualSelection,
} from '@/lib/visual-selection';

/**
 * Loads the rows `selectVisualEvidence` needs and applies it — the ONE path by
 * which both the student's pages and Nour's retrieval obtain an exercise's
 * visuals. Neither side filters, orders or falls back on its own, so they
 * cannot drift apart: same exercise, same part, same phase → same keys.
 */

export type QuestionForVisuals = {
  id: string;
  contentText: string;
  contentImages: string[];
};

export type VisualOptions = {
  part?: string | null;
  phase?: 'question' | 'solution';
  /** Required for the solution phase; reveal is proven from the database, never trusted from a caller. */
  userId?: string | null;
  isAdmin?: boolean;
};

/**
 * Has this student submitted or revealed these exercises? An attempt on the
 * question, or a submitted exam simulation that contained it. Nothing a
 * browser can assert — only rows the server wrote at submission.
 */
export async function revealedQuestionIds(userId: string, questionIds: string[]): Promise<Set<string>> {
  if (questionIds.length === 0) return new Set();
  const [attempts, simulated] = await Promise.all([
    db.attempt.findMany({
      where: { userId, questionId: { in: questionIds } },
      select: { questionId: true },
    }),
    db.examSimulationQuestion.findMany({
      where: {
        questionId: { in: questionIds },
        examSimulation: { userId, submittedAt: { not: null } },
      },
      select: { questionId: true },
    }),
  ]);
  return new Set(
    [...attempts, ...simulated].map((r) => r.questionId).filter((id): id is string => Boolean(id)),
  );
}

function asLocators(value: unknown): ConsumerLocator[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (v): v is ConsumerLocator =>
      Boolean(v) && typeof v.label === 'string' && typeof v.fingerprint === 'string',
  );
}

/**
 * DEPLOY-ORDER SAFETY. This code can reach an environment before the
 * `20260921120000_visual_evidence` migration has been applied there. Only the
 * two Prisma codes for a missing table or column are absorbed, and they are
 * treated as "no canonical rows" — which is exactly the behaviour before this
 * feature: the legacy page, with no verdict suppressing it. Any other error
 * still throws. Logged once, by code only.
 */
let schemaGapLogged = false;
async function orEmptyIfUnmigrated<T>(query: Promise<T[]>): Promise<T[]> {
  try {
    return await query;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'P2021' || code === 'P2022') {
      if (!schemaGapLogged) {
        schemaGapLogged = true;
        console.warn(`[visual-evidence] visual tables not migrated here (${code}); using legacy images only`);
      }
      return [];
    }
    throw error;
  }
}

export async function selectVisualsFor(
  questions: QuestionForVisuals[],
  options: VisualOptions = {},
): Promise<Map<string, VisualSelection>> {
  const out = new Map<string, VisualSelection>();
  if (questions.length === 0) return out;
  const ids = questions.map((q) => q.id);
  const phase = options.phase ?? 'question';

  const [relations, audits, revealed] = await Promise.all([
    orEmptyIfUnmigrated(db.questionVisual.findMany({
      where: { questionId: { in: ids }, status: 'active' },
      select: {
        questionId: true,
        role: true,
        status: true,
        consumers: true,
        occurrence: {
          select: {
            id: true,
            access: true,
            storageKey: true,
            readingOrder: true,
            groupKey: true,
            groupPart: true,
            identityText: true,
          },
        },
      },
    })),
    orEmptyIfUnmigrated(
      db.legacyImageAudit.findMany({ where: { questionId: { in: ids } }, select: { questionId: true, verdict: true } }),
    ),
    phase === 'solution'
      ? options.isAdmin
        ? Promise.resolve(new Set(ids))
        : options.userId
          ? revealedQuestionIds(options.userId, ids)
          : Promise.resolve(new Set<string>())
      : Promise.resolve(new Set<string>()),
  ]);

  const byQuestion = new Map<string, VisualRelationRow[]>();
  for (const r of relations) {
    const row: VisualRelationRow = {
      occurrenceId: r.occurrence.id,
      role: r.role,
      status: r.status,
      access: r.occurrence.access,
      storageKey: r.occurrence.storageKey,
      readingOrder: r.occurrence.readingOrder,
      groupKey: r.occurrence.groupKey,
      groupPart: r.occurrence.groupPart,
      identityText: r.occurrence.identityText,
      consumers: asLocators(r.consumers),
    };
    byQuestion.set(r.questionId, [...(byQuestion.get(r.questionId) ?? []), row]);
  }
  const verdicts = new Map(audits.map((a) => [a.questionId, a.verdict as LegacyVerdictName]));

  for (const q of questions) {
    out.set(
      q.id,
      selectVisualEvidence({
        contentText: q.contentText,
        relations: byQuestion.get(q.id) ?? [],
        legacyImages: q.contentImages ?? [],
        legacyVerdict: verdicts.get(q.id) ?? null,
        part: options.part ?? null,
        phase,
        revealed: revealed.has(q.id),
      }),
    );
  }
  return out;
}

/** Just the ordered keys per question — what a page hands its renderer. */
export async function visualKeysFor(
  questions: QuestionForVisuals[],
  options: VisualOptions = {},
): Promise<Map<string, string[]>> {
  const selections = await selectVisualsFor(questions, options);
  return new Map([...selections].map(([id, s]) => [id, s.keys]));
}
