import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { TutorAnchor } from '@/components/chat/tutor-context';
import { PracticeRunner, type PracticeQuestion } from '@/components/practice/practice-runner';
import { ChapterDeadEnd } from '@/components/practice/chapter-dead-end';
import { PageHeader } from '@/components/ui/sheet';
import { BackLink } from '@/components/ui/back-link';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { PUBLISHED_FILTER } from '@/lib/generation';
import { getTranslations } from '@/lib/i18n';
import { dirForLanguage } from '@/lib/i18n/config';
import { getChapterForTrack } from '@/lib/queries/taxonomy';
import { oneCopyEach, questionKey, seenQuestionKeys } from '@/lib/queries/seen-questions';
import { visualKeysFor } from '@/lib/visual-evidence';

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

  const [allCopies, generated, mastery, seenKeys] = await Promise.all([
    db.question.findMany({
      where: {
        /*
         * Every chapter this exercise belongs to, not only the one it is filed
         * under. A Lebanese exercise crosses consecutive chapters by design —
         * an alcohol, its oxidation, the aldehyde that results — and
         * `chapter_id` can hold one of them, so the others never offered it.
         * `chapter_id` still decides where mastery is credited; this decides
         * what a chapter is allowed to show.
         */
        alsoInChapters: { some: { chapterId: chapter.id } },
        verifiedStatus: { not: 'rejected' },
      },
      select: {
        id: true,
        questionType: true,
        difficulty: true,
        contentText: true,
        contentLatex: true,
        contentImages: true,
        options: true,
        bareme: true,
        sourcePassage: true,
        /*
         * The paper this question came off, for the question masthead.
         *
         * Null for textbook questions, and that is the fact the UI needs: a
         * question with no exam cycle is not official and must not be dressed
         * as one. Paper number and question-number-on-paper are NOT in this
         * schema and stay absent rather than become invented metadata.
         */
        sourceExam: { select: { year: true, session: true } },
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
    seenQuestionKeys(user.id),
  ]);

  // One copy of each question, and "already answered" meaning any copy of it:
  // see `questionKey`. Without this a chapter could list one exercise twice,
  // and offer the second copy as new to a student who had answered the first.
  const questions = oneCopyEach(allCopies);

  // The one visual selector — the same call Nour's retrieval makes.
  const visualKeys = await visualKeysFor(questions);

  const prepared: PracticeQuestion[] = [
    ...questions.map((question) => ({
      kind: 'question' as const,
      id: question.id,
      questionType: question.questionType,
      difficulty: question.difficulty === null ? null : Number(question.difficulty),
      contentText: question.contentText,
      contentLatex: question.contentLatex,
      contentImages: visualKeys.get(question.id) ?? [],
      options: parseOptions(question.options),
      baremeCriteria: criteriaOf(question.bareme),
      examYear: question.sourceExam?.year ?? null,
      examSession: question.sourceExam?.session ?? null,
      /*
       * Summed from the criteria, not read from a column. These papers print
       * the exercise total in a header the extractor does not always catch,
       * and every criterion carries its own marks regardless.
       */
      marks: marksOf(question.bareme),
      attemptedByYou:
        question._count.attempts > 0 || seenKeys.has(questionKey(question.contentText)),
      passage: question.sourcePassage,
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
      // A generated problem came off no paper. Never official, and the masthead
      // says nothing rather than implying otherwise.
      examYear: null,
      examSession: null,
      marks: marksOf(problem.bareme),
      attemptedByYou: problem._count.attempts > 0,
    })),
  ];

  return (
    <>
      <TutorAnchor label={chapter.name} subjectId={chapter.subject.id} />
      <BackLink href={`/practice/${chapter.subject.id}`} label={chapter.subject.name} />

      <PageHeader
        title={chapter.name}
        description={`${chapter.subject.name}${chapter.unit?.name ? ` · ${chapter.unit.name}` : ''}`}
      />

      {prepared.length === 0 ? (
        <ChapterDeadEnd
          chapterId={chapter.id}
          subjectId={chapter.subject.id}
          subjectName={chapter.subject.name}
        />
      ) : (
        <PracticeRunner
          chapterId={chapter.id}
          chapterName={chapter.name}
          questions={prepared}
          initialMastery={Number(mastery?.masteryScore ?? 0)}
          initialAttempts={mastery?.attemptsCount ?? 0}
          paperDir={dirForLanguage(chapter.subject.language)}
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

/**
 * Total marks a question carries, summed from its own criteria.
 *
 * Not read from a column: these papers print the exercise total in a header
 * the extractor does not always catch, while every criterion carries its own
 * marks. Zero becomes null — a question worth nothing is a question with no
 * barème, and the masthead should stay silent rather than print "0 marks".
 */
function marksOf(bareme: unknown): number | null {
  if (!Array.isArray(bareme)) return null;
  const total = (bareme as { points?: unknown }[]).reduce(
    (sum, c) => sum + (Number(c?.points) || 0),
    0,
  );
  return total > 0 ? total : null;
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
