import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { TutorAnchor } from '@/components/chat/tutor-context';
import { AskWhy } from '@/components/practice/ask-why';
import { FlagButton } from '@/components/practice/flag-button';
import { RevealableSolution } from '@/components/practice/revealable-solution';
import { Alert, EmptyAction, EmptyState } from '@/components/ui/feedback';
import { QuestionBody } from '@/components/ui/math';
import { PageHeader, Sheet } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';

export const metadata: Metadata = { title: 'Past paper' };

/**
 * One full past paper, as one paper.
 *
 * Unlike every other question surface in the app, this one ships the official
 * solutions to the client — that is the mode: read the paper, try it on your
 * own paper, reveal. Nothing here posts an attempt, so mastery is untouched.
 *
 * It used to render one titled card per row, "Question 1" through "Question N",
 * and that was a lie the extractor told and this page repeated. A Lebanese
 * philosophy paper offers a candidate three subjects to choose between; the
 * rows stored for one of them run to fifty-eight, averaging 1,400 characters.
 * Those are not questions. They are fragments of a paper that was split at the
 * wrong boundaries, and numbering them made the damage look deliberate.
 *
 * So the rows are joined back into the document they came from: printed order,
 * hairlines instead of cards, no invented numbering. It does not fix the
 * extraction — that is a corpus problem — but it stops the reader being told
 * something false about what they are looking at, and a paper read as a paper
 * is what this mode was for anyway.
 *
 * Each fragment keeps its own solution and its own "Why this answer?", because
 * whatever the boundaries are wrong about, the solution stored beside a
 * fragment does belong to it.
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
      <TutorAnchor label={cycle.title} />

      <PageHeader
        title={cycle.title}
        description={`${cycle.subject.name} · ${cycle.year}${cycle.session ? ` · ${cycle.session}` : ''} · ${format(t.oldCycles.duration, { count: cycle.durationMinutes })}`}
      />

      <Alert tone="info" className="mb-5">
        {t.oldCycles.unscoredNotice} {t.oldCycles.paperNotice}
      </Alert>

      {cycle.questions.length === 0 ? (
        <EmptyState
          tone="pending"
          title={t.practice.emptyPaperTitle}
          body={t.practice.emptyPaperBody}
          action={<EmptyAction href="/old-cycles" label={t.practice.emptyPaperCta} />}
        />
      ) : (
        <Sheet>
          {/* One sheet for the whole paper. The `ruled` rhythm separates the
              fragments with the same hairline a mark scheme uses, rather than
              floating each one on its own card. */}
          <div className="ruled">
            {cycle.questions.map((question) => (
              <section key={question.id} className="group px-5 py-5">
                <QuestionBody
                  contentText={question.contentText}
                  contentLatex={question.contentLatex}
                  images={question.contentImages}
                />

                <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                  <AskWhy questionId={question.id} />
                  {/* Reporting a bad transcription matters most here: past
                      papers are the material students trust the most, so an OCR
                      error in one is the error most likely to be revised from —
                      and on this page, the one most likely to be noticed. */}
                  <FlagButton itemType="tagged_question" itemId={question.id} />
                </div>

                <RevealableSolution
                  solution={question.officialSolutionLatex || question.officialSolution}
                />
              </section>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
