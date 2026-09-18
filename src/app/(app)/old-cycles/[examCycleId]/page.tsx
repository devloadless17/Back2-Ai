import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TutorAnchor } from '@/components/chat/tutor-context';
import { AskWhy } from '@/components/practice/ask-why';
import { FlagButton } from '@/components/practice/flag-button';
import { RevealableSolution } from '@/components/practice/revealable-solution';
import { Alert, EmptyAction, EmptyState } from '@/components/ui/feedback';
import { QuestionBody } from '@/components/ui/math';
import { LinkButton } from '@/components/ui/button';
import { PageHeader, Sheet } from '@/components/ui/sheet';
import { BackLink } from '@/components/ui/back-link';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import { dirForLanguage } from '@/lib/i18n/config';

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
      durationIsOfficial: true,
      subject: { select: { id: true, name: true, language: true } },
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

  /*
   * THE PAPER'S DIRECTION, NOT THE STUDENT'S.
   *
   * A Lebanese candidate sits Arabic history and French maths off one
   * timetable, so the interface language says nothing about the paper on the
   * screen. This page rendered every paper left-to-right: an Arabic history
   * exercise arrived with its numbering, its brackets and its full stops on
   * the wrong side of each line, and fell back to a Latin font with
   * substituted glyphs.
   *
   * Taken from `subjects.language` rather than sniffed from the text, because
   * this is the one place that knows for certain what the paper was printed
   * in — a maths paper set in Arabic carries more Latin symbols than Arabic
   * words, and counting characters would call it French.
   */
  const paperDir = dirForLanguage(cycle.subject.language);

  return (
    <>
      <TutorAnchor label={cycle.title} />
      <BackLink href="/old-cycles" label={t.nav.oldCycles} />

      {/*
        The way out.
        
        A paper is a page a student reads for twenty minutes and then wants to
        leave, and this one had no exit: the only link back to the list lived
        inside the empty state, so it appeared exactly when there was no paper
        to read and never when there was. The browser's own back button is not
        an answer — a student who arrived here from a subject hub, a search or a
        bookmark has no shared history to go back through.

        It carries the subject, so leaving a chemistry paper returns to
        chemistry's papers rather than to all 231 of them.
      */}
      <Link
        href={`/old-cycles?subject=${cycle.subject.id}`}
        className="mb-3 inline-flex items-center gap-1 text-meta font-semibold text-primary underline-offset-2 hover:underline"
      >
        <span aria-hidden="true">&larr;</span>
        {t.oldCycles.title}
      </Link>

      <PageHeader
        title={cycle.title}
        /*
         * The duration says where it came from. This page printed the paper's
         * `duration_minutes` flat, and that column defaults to 180 with the
         * corpus loader setting nothing — so every ingested paper here claimed
         * a three-hour limit we had no source for.
         */
        description={[
          cycle.subject.name,
          String(cycle.year),
          cycle.session || null,
          `${format(t.oldCycles.duration, { count: cycle.durationMinutes })} · ${
            cycle.durationIsOfficial ? t.examSim.durationOfficial : t.examSim.durationStandardShort
          }`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          /* The paper you are reading, sat properly. `startFromRealCycle` has
             always accepted a cycle id; only the link was missing, so a
             student who wanted to attempt what they were reading had to go and
             find it again in a dropdown. */
          <LinkButton href={`/exam-sim/new?cycle=${cycle.id}`} variant="secondary" size="sm">
            {t.examSim.sitThisPaper}
          </LinkButton>
        }
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
                  dir={paperDir}
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
                  dir={paperDir}
                />
              </section>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
