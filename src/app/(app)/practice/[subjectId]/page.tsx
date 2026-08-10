import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, EmptyState } from '@/components/ui/feedback';
import { Meter } from '@/components/ui/progress';
import { PageHeader, Sheet, SheetBody } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
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

  const subject = await getSubjectForTrack(subjectId, user.trackId);
  if (!subject) notFound();

  const chapters = await listChapters(subject.id, user.id);

  const byUnit = new Map<string, typeof chapters>();
  for (const chapter of chapters) {
    const key = chapter.unitName ?? '';
    byUnit.set(key, [...(byUnit.get(key) ?? []), chapter]);
  }

  return (
    <>
      <PageHeader
        title={subject.name}
        description={format(t.practice.chaptersIn, { subject: subject.name })}
      />

      {chapters.length === 0 ? (
        <EmptyState tone="pending" title={t.practice.noQuestions} body={t.practice.noQuestionsHint} />
      ) : (
        <div className="space-y-6">
          {[...byUnit.entries()].map(([unitName, unitChapters]) => (
            <section key={unitName || 'ungrouped'}>
              {unitName && (
                <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                  {unitName}
                </h2>
              )}

              <Sheet>
                <SheetBody className="p-0">
                  <ul className="ruled">
                    {unitChapters.map((chapter) => (
                      <li key={chapter.id}>
                        <Link
                          href={`/practice/${subject.id}/${chapter.id}`}
                          className="flex items-center gap-4 px-5 py-3.5 transition-colors duration-150 hover:bg-paper-sunken"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink">{chapter.name}</p>
                            <p className="text-[12px] text-ink-faint">
                              {chapter.questionCount === 0
                                ? t.practice.noQuestions
                                : `${chapter.questionCount} · ${chapter.attemptsCount} ${t.practice.attempts}`}
                            </p>
                          </div>

                          <div className="hidden w-40 shrink-0 sm:block">
                            <Meter value={chapter.masteryScore} size="sm" />
                          </div>

                          {chapter.attemptsCount === 0 && chapter.questionCount > 0 && (
                            <Badge tone="neutral">{t.dashboard.readinessNotYet}</Badge>
                          )}
                        </Link>

                        {/* Quiz sits outside the row link — a nested anchor is
                            invalid HTML and swallows the click. */}
                        {chapter.questionCount > 0 && (
                          <div className="-mt-2 px-5 pb-2.5">
                            <Link
                              href={`/practice/${subject.id}/${chapter.id}/quiz`}
                              className="text-[12.5px] font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {t.todos.actionQuiz}
                            </Link>
                          </div>
                        )}
                      </li>
                    ))}
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
