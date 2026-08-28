import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { QuizRunner, type QuizQuestion } from '@/components/practice/quiz-runner';
import { ChapterDeadEnd } from '@/components/practice/chapter-dead-end';
import { PageHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { getChapterForTrack } from '@/lib/queries/taxonomy';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.todos.actionQuiz };
}

/** A quiz is short by design — long enough to be evidence, short enough to finish. */
const QUIZ_LENGTH = 5;

/**
 * Quiz mode.
 *
 * The difference from practice is when feedback arrives: practice marks each
 * answer as you go, a quiz withholds everything until the end. That makes it
 * the honest measurement of the two — you cannot read the solution to question
 * 2 and then answer question 3 differently — which is why these attempts are
 * recorded under their own `quiz` context.
 *
 * Questions are drawn easiest-first from the chapter, preferring ones the
 * student has not already seen, so a repeat quiz is not the same five
 * questions.
 */
export default async function ChapterQuizPage({
  params,
}: {
  params: Promise<{ subjectId: string; chapterId: string }>;
}) {
  const { chapterId } = await params;
  const user = await requireUser();
  const { t } = await getTranslations();

  const chapter = await getChapterForTrack(chapterId, user.trackId);
  if (!chapter) notFound();

  const select = {
    id: true,
    questionType: true,
    difficulty: true,
    contentText: true,
    contentLatex: true,
    contentImages: true,
    options: true,
    bareme: true,
  } as const;

  const unseen = await db.question.findMany({
    where: {
      chapterId: chapter.id,
      verifiedStatus: { not: 'rejected' },
      attempts: { none: { userId: user.id } },
    },
    select,
    orderBy: [{ difficulty: 'asc' }, { createdAt: 'asc' }],
    take: QUIZ_LENGTH,
  });

  // Top up with seen questions when the chapter does not have enough fresh
  // ones — a three-question quiz is better than no quiz.
  const topUp =
    unseen.length >= QUIZ_LENGTH
      ? []
      : await db.question.findMany({
          where: {
            chapterId: chapter.id,
            verifiedStatus: { not: 'rejected' },
            id: { notIn: unseen.map((q) => q.id) },
          },
          select,
          orderBy: [{ difficulty: 'asc' }, { createdAt: 'asc' }],
          take: QUIZ_LENGTH - unseen.length,
        });

  const questions: QuizQuestion[] = [...unseen, ...topUp].map((question) => ({
    id: question.id,
    questionType: question.questionType,
    contentText: question.contentText,
    contentLatex: question.contentLatex,
    contentImages: question.contentImages,
    options: parseOptions(question.options),
    hasBareme: Array.isArray(question.bareme) && question.bareme.length > 0,
  }));

  return (
    <>
      <PageHeader
        title={`${t.todos.actionQuiz} · ${chapter.name}`}
        description={chapter.subject.name}
      />

      {questions.length === 0 ? (
        <ChapterDeadEnd
          chapterId={chapter.id}
          subjectId={chapter.subject.id}
          subjectName={chapter.subject.name}
        />
      ) : (
        <QuizRunner
          questions={questions}
          subjectId={chapter.subject.id}
          chapterId={chapter.id}
        />
      )}
    </>
  );
}

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
