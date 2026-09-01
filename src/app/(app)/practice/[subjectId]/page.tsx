import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, EmptyAction, EmptyState } from '@/components/ui/feedback';
import { BandChip, bandForMastery, type Band } from '@/components/ui/band';
import { Meter } from '@/components/ui/progress';
import { Sheet, SheetBody } from '@/components/ui/sheet';
import { SubjectHub } from '@/components/practice/subject-hub';
import { getSubjectHub } from '@/lib/queries/subject-hub';
import { requireUser } from '@/lib/auth/guards';
import { cn } from '@/lib/cn';
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
                       * A chapter with no questions is not a link.
                       *
                       * The chapter list is the real curriculum, read from the
                       * textbooks, and it runs ahead of the questions — which
                       * arrive chapter by chapter through ingestion. Linking to
                       * a chapter that cannot be practised sends the student to
                       * an empty screen and teaches them the list is unreliable.
                       * Showing it greyed says the opposite: the syllabus is
                       * complete, this part is not ready yet.
                       */
                      const practisable = chapter.questionCount > 0;

                      const row = (
                        <>
                          <div className="min-w-0 flex-1">
                            <p
                              className={cn(
                                'truncate text-sm font-medium',
                                practisable ? 'text-ink' : 'text-ink-faint',
                              )}
                            >
                              {chapter.name}
                            </p>
                            <p className="text-caption text-ink-faint">
                              {practisable
                                ? `${chapter.questionCount} · ${chapter.attemptsCount} ${t.practice.attempts}`
                                : t.practice.noQuestions}
                            </p>
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
                        {practisable ? (
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
