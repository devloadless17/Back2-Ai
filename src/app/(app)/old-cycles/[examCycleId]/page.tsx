import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TutorAnchor } from '@/components/chat/tutor-context';
import { AskWhy } from '@/components/practice/ask-why';
import { FlagButton } from '@/components/practice/flag-button';
import { ModelAnswer } from '@/components/practice/model-answer';
import { PartAnswer } from '@/components/practice/part-answer';
import { RevealableSolution } from '@/components/practice/revealable-solution';
import { Alert, EmptyAction, EmptyState } from '@/components/ui/feedback';
import { MathText, PaperPassage, QuestionBody } from '@/components/ui/math';
import { LinkButton } from '@/components/ui/button';
import { PageHeader, Sheet } from '@/components/ui/sheet';
import { BackLink } from '@/components/ui/back-link';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { paperDuration } from '@/lib/exam-duration';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import { dirForLanguage } from '@/lib/i18n/config';
import { formatMarks, paperPartsOf, partMarkdown, partOnlyHeads, partsWithoutAnswer } from '@/lib/paper-parts';
import { OWN_EDITION_ONLY, paperScopeFor, subjectIdsForTrack } from '@/lib/queries/taxonomy';
import { visualKeysFor } from '@/lib/visual-evidence';
import { bodyToRender } from '@/lib/question-body';
import { isForeignToFrenchCourse } from '@/lib/question-shape';

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
    /*
     * The track check, and the edition check.
     *
     * The list this page is reached from already drops the translated printing
     * of an Arabic-taught paper, but a URL is not reached only from a list —
     * an old bookmark or a shared link arrives here directly, and a paper the
     * product has decided is not part of the programme should 404 rather than
     * open because someone still had the address.
     */
    where: {
      id: examCycleId,
      // The same scope the list uses, so a paper visible there opens here —
      // including the other track's printing of a shared science course.
      subjectId: { in: [...(await paperScopeFor(await subjectIdsForTrack(user.trackId))).keys()] },
      ...OWN_EDITION_ONLY,
    },
    select: {
      id: true,
      title: true,
      year: true,
      session: true,
      durationMinutes: true,
      durationIsOfficial: true,
      subject: { select: { id: true, name: true, language: true, examDurationMinutes: true } },
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
          paperParts: true,
          sourcePassage: true,
          chapter: { select: { name: true } },
        },
        orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });

  if (!cycle) notFound();

  // The one visual selector — the same call Zaki's retrieval makes.
  const paperQuestions =
    cycle.subject.name === 'Francais'
      ? cycle.questions.filter((question) => !isForeignToFrenchCourse(question.contentText))
      : cycle.questions;
  const visualKeys = await visualKeysFor(paperQuestions);

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
  // Philosophy papers get no answers added (the user, 2026-10-02): only the
  // ministry's own key is shown, never one written on request.
  const answersWritten = !/philo|فلسف/i.test(cycle.subject.name);
  // Shown unless the paper's own first question already prints it.
  const paperPassage = (() => {
    const passage = paperQuestions.find((q) => q.sourcePassage?.trim())?.sourcePassage ?? null;
    const first = (paperQuestions[0]?.contentText ?? '').replace(/\s+/g, '');
    return passage && !first.includes(passage.replace(/\s+/g, '').slice(0, 60)) ? passage : null;
  })();

  /*
   * A paper of documents: geography, civics, economics print every document
   * first and then ask about them, and every question here carries the same
   * extract. Their pictures are stored on question 1, and shown under it they
   * came after a question that reads them. They go with the documents' text
   * instead; a later question's own picture goes above its text.
   */
  const sharedDocuments =
    paperPassage !== null &&
    paperQuestions.every(
      (q) => (q.sourcePassage ?? '').replace(/\s+/g, '') === paperPassage.replace(/\s+/g, ''),
    );
  const paperFigures = sharedDocuments ? (visualKeys.get(paperQuestions[0]!.id) ?? []) : [];
  const figuresOf = (id: string) =>
    sharedDocuments && id === paperQuestions[0]!.id ? [] : (visualKeys.get(id) ?? []);

  return (
    <>
      <TutorAnchor label={cycle.title} subjectId={cycle.subject.id} />
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
        className="mb-3 inline-flex items-center gap-1 text-meta font-medium text-primary underline-offset-2 hover:underline"
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
          `${format(t.oldCycles.duration, { count: paperDuration(cycle, cycle.subject.examDurationMinutes).minutes })} · ${
            paperDuration(cycle, cycle.subject.examDurationMinutes).official
              ? t.examSim.durationOfficial
              : t.examSim.durationStandardShort
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

      {paperQuestions.length === 0 ? (
        <EmptyState
          tone="pending"
          title={t.practice.emptyPaperTitle}
          body={t.practice.emptyPaperBody}
          action={<EmptyAction href="/old-cycles" label={t.practice.emptyPaperCta} />}
        />
      ) : (
        <Sheet>
          {/* The paper's text, once, above its questions — every question of
              the paper carries the same extract, so it is not repeated. */}
          {paperPassage ? (
            <div className="px-5 pt-5">
              <PaperPassage passage={paperPassage} dir={paperDir} images={paperFigures} />
            </div>
          ) : null}
          {/* One sheet for the whole paper. The `ruled` rhythm separates the
              fragments with the same hairline a mark scheme uses, rather than
              floating each one on its own card. */}
          <div className="ruled">
            {paperQuestions.map((question) => {
              const parts = paperPartsOf(question.paperParts);
              /*
               * With parts, each carries its own answer. The exercise-level
               * solution is still shown when NO part has one: it is what the
               * page showed before, and for some papers it is the only key
               * there is.
               */
              const partsAnswered = Boolean(parts?.parts.some((p) => p.answer || p.answerImage));
              // Parts the official key leaves without an answer the page can show.
              const gaps = parts ? partsWithoutAnswer(parts.parts) : 0;
              const solution = partsAnswered
                ? null
                : bodyToRender(question.officialSolutionLatex, question.officialSolution ?? '').trim() || null;
              return (
              <section key={question.id} className="group px-5 py-5">
                {parts ? (
                  <>
                    <QuestionBody
                      contentText={parts.intro}
                      contentLatex={parts.intro}
                      images={figuresOf(question.id)}
                      imagesFirst={sharedDocuments}
                      dir={paperDir}
                    />
                    {/* One block per printed part, its marks beside it and its
                        own answer under it — matched to the scheme by label. */}
                    <ol className="mt-2 list-none p-0">
                      {parts.parts.map((part, i) => (
                        <li key={`${part.label}-${i}`} className="border-t border-rule py-3 first:border-t-0">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <MathText dir={paperDir}>{partMarkdown(part.text)}</MathText>
                            </div>
                            {typeof part.marks === 'number' && (
                              <span className="shrink-0 pt-0.5 text-meta tabular-nums text-ink-muted">
                                {format(t.oldCycles.partMarks, { count: formatMarks(part.marks) })}
                              </span>
                            )}
                          </div>
                          {part.answer || part.answerImage ? (
                            <PartAnswer answer={part.answer} image={part.answerImage} dir={paperDir} />
                          ) : partsAnswered && !partOnlyHeads(parts.parts, i) ? (
                            <p className="mt-2 text-meta text-ink-muted">
                              {parts.fullKey ? t.oldCycles.partAnswerInFullKey : t.oldCycles.partAnswerMissing}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                    {/* The key has the missing parts' answers but could not place
                        them: the whole key, as printed, so nothing is left out. */}
                    {partsAnswered && gaps > 0 && parts.fullKey && (
                      <details className="mt-2 rounded border border-rule">
                        <summary className="cursor-pointer list-none px-3 py-2 text-meta font-medium text-ink hover:bg-paper-sunken">
                          {t.oldCycles.fullKey}
                        </summary>
                        <div className="px-3 pb-3">
                          <MathText dir={paperDir}>{parts.fullKey}</MathText>
                        </div>
                      </details>
                    )}
                  </>
                ) : (
                  <QuestionBody
                    contentText={question.contentText}
                    contentLatex={question.contentLatex}
                    images={figuresOf(question.id)}
                    imagesFirst={sharedDocuments}
                    dir={paperDir}
                  />
                )}

                {/* No answer stored: say so, rather than showing nothing and
                    leaving the student to wonder whether they missed it. */}
                {!solution && !partsAnswered && (
                  <p className="mt-3 rounded border border-rule bg-paper-sunken px-3 py-2 text-meta text-ink-muted">
                    {t.oldCycles.answerMissing}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                  <AskWhy questionId={question.id} mode={solution ? 'why' : 'solve'} />
                  {/* Reporting a bad transcription matters most here: past
                      papers are the material students trust the most, so an OCR
                      error in one is the error most likely to be revised from —
                      and on this page, the one most likely to be noticed. */}
                  <FlagButton itemType="tagged_question" itemId={question.id} />
                </div>

                <RevealableSolution solution={solution} dir={paperDir} />
                {/* No official answer at all, or parts the key leaves bare with
                    no whole key to fall back on: an answer written on request,
                    labelled as not the ministry's. Nothing is left blank. */}
                {answersWritten && !solution && !partsAnswered && <ModelAnswer questionId={question.id} dir={paperDir} />}
                {answersWritten && partsAnswered && gaps > 0 && !parts?.fullKey && (
                  <ModelAnswer questionId={question.id} dir={paperDir} beyondOfficial />
                )}
              </section>
              );
            })}
          </div>
        </Sheet>
      )}
    </>
  );
}
