import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PracticeRunner, type PracticeQuestion } from '@/components/practice/practice-runner';
import { EmptyState } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getProgressSummary } from '@/lib/queries/gamification';
import { PUBLISHED_FILTER } from '@/lib/generation';
import { getTranslations } from '@/lib/i18n';
import { getChapterForTrack } from '@/lib/queries/taxonomy';

export const metadata: Metadata = { title: 'Practice' };

/**
 * The practice screen for one chapter.
 *
 * The question set is loaded on the server and handed to the client runner
 * *without* solutions, correct options or barème point values. Those come back
 * from /api/attempts once an answer has been submitted. Shipping them with the
 * page would mean the answer key is one devtools panel away — which, for a
 * cohort of exam candidates, is not a theoretical concern.
 */
export default async function ChapterPracticePage({
  params,
}: {
  params: Promise<{ subjectId: string; chapterId: string }>;
}) {
  const { chapterId } = await params;
  const user = await requireUser();
  const { t } = await getTranslations();

  const chapter = await getChapterForTrack(chapterId, user.trackId);
  if (!chapter) notFound();

  const [questions, generated, mastery, initialProgress] = await Promise.all([
    db.question.findMany({
      where: { chapterId: chapter.id, verifiedStatus: { not: 'rejected' } },
      select: {
        id: true,
        questionType: true,
        difficulty: true,
        contentText: true,
        contentLatex: true,
        contentImages: true,
        options: true,
        bareme: true,
        _count: { select: { attempts: { where: { userId: user.id } } } },
      },
      orderBy: [{ difficulty: 'asc' }, { createdAt: 'asc' }],
    }),
    /*
     * Approved generated problems belong in the same list.
     *
     * Without this the whole generation pipeline is unreachable: problems get
     * written, solver-checked, approved by an administrator — and then nothing
     * ever serves them, because the practice screen only ever read `questions`.
     * PUBLISHED_FILTER is the same gate every other student-facing query uses.
     */
    db.generatedProblem.findMany({
      where: { chapterId: chapter.id, ...PUBLISHED_FILTER },
      select: {
        id: true,
        difficulty: true,
        contentText: true,
        contentLatex: true,
        bareme: true,
        _count: { select: { attempts: { where: { userId: user.id } } } },
      },
      orderBy: [{ difficulty: 'asc' }, { publishedAt: 'asc' }],
    }),
    db.chapterMastery.findUnique({
      where: { userId_chapterId: { userId: user.id, chapterId: chapter.id } },
      select: { masteryScore: true, attemptsCount: true },
    }),
    getProgressSummary(user.id),
  ]);

  const prepared: PracticeQuestion[] = [
    ...questions.map((question) => ({
      kind: 'question' as const,
      id: question.id,
      questionType: question.questionType,
      difficulty: question.difficulty === null ? null : Number(question.difficulty),
      contentText: question.contentText,
      contentLatex: question.contentLatex,
      contentImages: question.contentImages,
      options: parseOptions(question.options),
      baremeCriteria: criteriaOf(question.bareme),
      attemptedByYou: question._count.attempts > 0,
    })),
    ...generated.map((problem) => ({
      kind: 'generated' as const,
      // Generated problems are always long-form: the generator is prompted for
      // a Bac-style problem with a barème, never for multiple choice.
      questionType: 'problem' as const,
      id: problem.id,
      difficulty: problem.difficulty === null ? null : Number(problem.difficulty),
      contentText: problem.contentText,
      contentLatex: problem.contentLatex,
      contentImages: [],
      options: null,
      baremeCriteria: criteriaOf(problem.bareme),
      attemptedByYou: problem._count.attempts > 0,
    })),
  ];

  return (
    <>
      <PageHeader
        title={chapter.name}
        description={`${chapter.subject.name}${chapter.unit?.name ? ` · ${chapter.unit.name}` : ''}`}
      />

      {prepared.length === 0 ? (
        <EmptyState tone="pending" title={t.practice.noQuestions} body={t.practice.noQuestionsHint} />
      ) : (
        <PracticeRunner
          chapterId={chapter.id}
          chapterName={chapter.name}
          questions={prepared}
          initialMastery={Number(mastery?.masteryScore ?? 0)}
          initialAttempts={mastery?.attemptsCount ?? 0}
          initialProgress={initialProgress}
        />
      )}
    </>
  );
}

/** Criterion labels only — the point values are the marking scheme, revealed after marking. */
function criteriaOf(bareme: unknown): string[] {
  return Array.isArray(bareme)
    ? (bareme as { criterion?: unknown }[]).map((c) => String(c?.criterion ?? ''))
    : [];
}

/** `options` is JSONB; anything that is not the expected shape is treated as absent. */
function parseOptions(value: unknown): { id: string; text: string }[] | null {
  if (!Array.isArray(value)) return null;

  const options = value
    .map((entry) =>
      entry && typeof entry === 'object' && 'id' in entry && 'text' in entry
        ? { id: String((entry as { id: unknown }).id), text: String((entry as { text: unknown }).text) }
        : null,
    )
    .filter((option): option is { id: string; text: string } => option !== null);

  return options.length > 0 ? options : null;
}
