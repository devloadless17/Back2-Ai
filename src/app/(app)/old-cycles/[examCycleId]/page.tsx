import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FlagButton } from '@/components/practice/flag-button';
import { RevealableSolution } from '@/components/practice/revealable-solution';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { QuestionBody } from '@/components/ui/math';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';

export const metadata: Metadata = { title: 'Past paper' };

/**
 * One full past paper, in its printed order.
 *
 * Unlike every other question surface in the app, this one ships the official
 * solutions to the client — that is the mode: read the paper, try it on your
 * own paper, reveal. Nothing here posts an attempt, so mastery is untouched.
 */
export default async function ExamCyclePage({
  params,
}: {
  params: Promise<{ examCycleId: string }>;
}) {
  const { examCycleId } = await params;
  const user = await requireUser();
  const { t } = await getTranslations();

  const cycle = await db.examCycle.findFirst({
    where: { id: examCycleId, subject: { trackId: user.trackId ?? undefined } },
    select: {
      id: true,
      title: true,
      year: true,
      session: true,
      durationMinutes: true,
      subject: { select: { id: true, name: true } },
      questions: {
        where: { verifiedStatus: { not: 'rejected' } },
        select: {
          id: true,
          orderIndex: true,
          contentText: true,
          contentLatex: true,
          contentImages: true,
          officialSolution: true,
          officialSolutionLatex: true,
          chapter: { select: { name: true } },
        },
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });

  if (!cycle) notFound();

  return (
    <>
      <PageHeader
        title={cycle.title}
        description={`${cycle.subject.name} · ${cycle.year}${cycle.session ? ` · ${cycle.session}` : ''} · ${format(t.oldCycles.duration, { count: cycle.durationMinutes })}`}
      />

      <Alert tone="info" className="mb-5">
        {t.oldCycles.unscoredNotice}
      </Alert>

      {cycle.questions.length === 0 ? (
        <EmptyState tone="pending" title={t.practice.noQuestions} body={t.practice.noQuestionsHint} />
      ) : (
        <div className="space-y-5">
          {cycle.questions.map((question, index) => (
            <Sheet key={question.id}>
              <SheetHeader
                title={`${t.practice.question} ${index + 1}`}
                actions={question.chapter ? <Badge tone="neutral">{question.chapter.name}</Badge> : null}
              />
              <SheetBody>
                <QuestionBody
                  contentText={question.contentText}
                  contentLatex={question.contentLatex}
                  images={question.contentImages}
                />
              </SheetBody>

              <RevealableSolution
                solution={question.officialSolutionLatex || question.officialSolution}
              />

              {/* Reporting a bad transcription matters most here: past papers are
                  the material students trust the most, so an OCR error in one is
                  the error most likely to be revised from. */}
              <div className="border-t border-rule px-5 py-2">
                <FlagButton itemType="tagged_question" itemId={question.id} />
              </div>
            </Sheet>
          ))}
        </div>
      )}
    </>
  );
}
