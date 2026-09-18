import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, EmptyAction, EmptyState } from '@/components/ui/feedback';
import { BandChip, bandForMastery, type Band } from '@/components/ui/band';
import { Meter } from '@/components/ui/progress';
import { Sheet, SheetBody } from '@/components/ui/sheet';
import { TutorAnchor } from '@/components/chat/tutor-context';
import { SubjectHub } from '@/components/practice/subject-hub';
import { ExamFrequency } from '@/components/practice/exam-frequency';
import { BackLink } from '@/components/ui/back-link';
import { getSubjectHub } from '@/lib/queries/subject-hub';
import { requireUser } from '@/lib/auth/guards';
import { cn } from '@/lib/cn';
import { chapterHasQuestions, chapterState } from '@/lib/curriculum';
import { getTranslations } from '@/lib/i18n';
import { getSubjectForTrack, listChapters } from '@/lib/queries/taxonomy';

export const metadata: Metadata = { title: 'Practice' };

/**
 * Chapters of one subject, grouped by unit and in syllabus order.
 *
 * Order is the syllabus order, not weakest-first. Students navigate by where
 * they are in the year; a list that reshuffles itself as their mastery changes
 * is a list they can never learn the shape of. The weakest chapter is surfaced
 * separately, on the dashboard, where it is the point.
 */
export default async function SubjectChaptersPage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const { subjectId } = await params;
  const user = await requireUser();
  const { t } = await getTranslations();

  const bandLabels: Record<Band, string> = {
    weak: t.dashboard.bandWeak,
    developing: t.dashboard.bandDeveloping,
    mastered: t.dashboard.bandMastered,
    not_started: t.dashboard.bandNotStarted,
    needs_review: t.dashboard.bandNeedsReview,
  };

  const subject = await getSubjectForTrack(subjectId, user.trackId);
  if (!subject) notFound();

  const [chapters, hub] = await Promise.all([
    listChapters(subject.id, user.id),
    getSubjectHub(subject.id, user.id, user.preferredLanguage),
  ]);

  const byUnit = new Map<string, typeof chapters>();
  for (const chapter of chapters) {
    const key = chapter.unitName ?? '';
    byUnit.set(key, [...(byUnit.get(key) ?? []), chapter]);
  }

  return (
    <>
      {/*
        What a student can do in this subject, before the list of what is in it.

        The chapter list is still here and unchanged — it is the index, and an
        index belongs under the things it indexes rather than in place of them.
      */}
      {/* So the tutor knows which subject the student is standing in. */}
      <TutorAnchor label={subject.name} />
      {/*
        Up to the dashboard, not across to the subject list.
        
        `/practice` is the subject index, and it is the parent by URL and the
        wrong answer by use. A student reaches a subject hub from the dashboard,
        from a next-move card, from a chapter, or from a link a classmate sent,
        and the one place they always mean by "out of here" is the top. The
        subject list is a picker they passed through once, not somewhere to
        return to.
      */}
      <BackLink href="/dashboard" label={t.nav.dashboard} />

      <SubjectHub subjectId={subject.id} subjectName={subject.name} counts={hub} />

      <h2 id="chapters" className="label mb-2 px-1 pt-1">
        {t.hub.index}
      </h2>

      {chapters.length === 0 ? (
        <EmptyState
          tone="pending"
          title={t.practice.noQuestions}
          body={t.practice.emptyNothing.replace('{subject}', subject.name)}
          action={<EmptyAction href="/practice" label={t.practice.noPapersCta} />}
        />
      ) : (
        <div className="space-y-6">
          {[...byUnit.entries()].map(([unitName, unitChapters]) => (
            <section key={unitName || 'ungrouped'}>
              {unitName && (
                <h2 className="mb-2 px-1 text-caption font-semibold uppercase tracking-wider text-ink-faint">
                  {unitName}
                </h2>
              )}

              <Sheet>
                <SheetBody className="p-0">
                  <ul className="ruled">
                    {unitChapters.map((chapter) => {
                      /*
                       * THREE STATES, NOT TWO.
                       *
                       * The chapter list is the real curriculum, read from the
                       * textbooks, and it runs ahead of the questions — which
                       * come from past papers and examine some chapters every
                       * year and others never. A row that cannot be practised
                       * is greyed rather than linked, because sending a student
                       * to an empty screen teaches them the list is unreliable.
                       *
                       * That rule is older than `ChapterDeadEnd`, and it is now
                       * the thing keeping students away from it. The chapter
                       * page no longer shows an empty screen when there are no
                       * questions: it offers the chapter's own reading, the
                       * tutor grounded on that reading, and the nearest chapter
                       * that can be practised. Greying the row hides all three.
                       *
                       * It matters at scale, not in the margins. 320 of 1,193
                       * chapters have reading and no questions — 28 in LH أدب
                       * عربي, and 782 passages behind ten grey rows in LH
                       * English. Every one of them said "no questions", which is
                       * true, and let the student conclude "nothing here", which
                       * is not.
                       *
                       * So the inert state is kept for what it was written for:
                       * a chapter with genuinely nothing behind it, of which
                       * there are 22.
                       */
                      /*
                       * Shared with the Bac Map. Both pages have to answer
                       * "what is this chapter" and they must answer it the
                       * same way; a student reading "12 questions" here and
                       * "nothing here" there has no reason to trust either.
                       */
                      const state = chapterState(chapter);
                      const practisable = chapterHasQuestions(state);
                      const readable = state === 'readingOnly';

                      const row = (
                        <>
                          <div className="min-w-0 flex-1">
                            <p
                              className={cn(
                                'truncate text-sm font-medium',
                                practisable || readable ? 'text-ink' : 'text-ink-faint',
                              )}
                            >
                              {chapter.name}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <p className="text-caption text-ink-faint">
                                {practisable
                                  ? `${chapter.questionCount} · ${chapter.attemptsCount} ${t.practice.attempts}`
                                  : readable
                                    ? t.practice.readingOnly
                                    : t.practice.noQuestions}
                              </p>

                              {/*
                                How often the examiners have actually set this
                                chapter. Beside the question count on purpose:
                                the count says how much there is to practise,
                                this says whether it is worth practising, and a
                                student deciding where to spend Sunday needs
                                both in the same glance.
                              */}
                              {practisable && (
                                <ExamFrequency
                                  examYears={chapter.examYears}
                                  labels={{
                                    core: t.practice.examCore,
                                    regular: t.practice.examRegular,
                                    occasional: t.practice.examOccasional,
                                    dormant: t.practice.examDormant,
                                    years: t.practice.examYears,
                                  }}
                                />
                              )}
                            </div>
                          </div>

                          {practisable && (
                            <div className="hidden w-40 shrink-0 sm:block">
                              <Meter value={chapter.masteryScore} size="sm" />
                            </div>
                          )}

                          {/* The same band vocabulary as the dashboard grid and
                              the results page — icon, label and colour together,
                              from one primitive. A page-specific variant would
                              mean a student learning the scale twice. Zero
                              attempts reads as "not started", never as weak. */}
                          {practisable && (
                            <BandChip
                              band={bandForMastery(chapter.masteryScore, chapter.attemptsCount)}
                              label={
                                bandLabels[bandForMastery(chapter.masteryScore, chapter.attemptsCount)]
                              }
                            />
                          )}
                        </>
                      );

                      return (
                      <li key={chapter.id}>
                        {practisable || readable ? (
                        <Link
                          href={`/practice/${subject.id}/${chapter.id}`}
                          className="flex items-center gap-4 px-5 py-3.5 transition-colors duration-150 hover:bg-paper-sunken"
                        >
                          {row}
                        </Link>
                        ) : (
                          <div className="flex cursor-default items-center gap-4 px-5 py-3.5 opacity-60">
                            {row}
                          </div>
                        )}

                        {/* Quiz sits outside the row link — a nested anchor is
                            invalid HTML and swallows the click. */}
                        {chapter.questionCount > 0 && (
                          <div className="-mt-2 px-5 pb-2.5">
                            <Link
                              href={`/practice/${subject.id}/${chapter.id}/quiz`}
                              className="text-meta font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {t.todos.actionQuiz}
                            </Link>
                          </div>
                        )}
                      </li>
                      );
                    })}
                  </ul>
                </SheetBody>
              </Sheet>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
