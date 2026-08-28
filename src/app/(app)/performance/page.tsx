import type { Metadata } from 'next';

import { LinkButton } from '@/components/ui/button';
import { RingGauge } from '@/components/ui/charts';
import { EmptyAction, EmptyState } from '@/components/ui/feedback';
import { BandChip, bandForMastery, type Band } from '@/components/ui/band';
import { Meter } from '@/components/ui/progress';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { getTranslations } from '@/lib/i18n';
import { getProgressForUser, rankChapters, rankStrongest } from '@/lib/queries/progress';

export const metadata: Metadata = { title: 'Performance' };

/**
 * Where the student stands.
 *
 * Readiness is shown with its three components broken out rather than as a
 * single number. This is a prediction about a national exam that decides where
 * they go next; "68%" with no account of where it comes from is a number they
 * can neither trust nor act on. Split into mastery, coverage and trend, it says
 * what to do — a low coverage component means "open the chapters you have not
 * touched", which a single figure never communicates.
 */
export default async function PerformancePage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  const bandLabels: Record<Band, string> = {
    weak: t.dashboard.bandWeak,
    developing: t.dashboard.bandDeveloping,
    mastered: t.dashboard.bandMastered,
    not_started: t.dashboard.bandNotStarted,
    needs_review: t.dashboard.bandNeedsReview,
  };

  const progress = await getProgressForUser(user.id, user.trackId, user.preferredLanguage);
  const weakest = rankChapters(progress, 8);
  const strongest = rankStrongest(progress, 5);

  const anyReportable = progress.some((subject) => subject.readiness.reportable);

  return (
    <>
      <PageHeader title={t.performance.title} description={t.performance.subtitle} />

      {progress.length === 0 ? (
        <EmptyState
          tone="pending"
          title={t.practice.noProgressTitle}
          body={t.practice.noProgressBody}
          action={<EmptyAction href="/practice" label={t.practice.noProgressCta} />}
        />
      ) : (
        <div className="space-y-5">
          {/* --- Readiness per subject --- */}
          <Sheet>
            <SheetHeader
              title={t.performance.readinessBySubject}
              description={t.performance.componentsExplain}
            />
            <SheetBody>
              {!anyReportable ? (
                <EmptyState
                  tone="neutral"
                  title={t.performance.noData}
                  body={t.performance.noDataHint}
                  className="border-0 bg-transparent px-0 py-2"
                  action={
                    <LinkButton href="/practice" variant="primary">
                      {t.dashboard.noActivityCta}
                    </LinkButton>
                  }
                />
              ) : (
                <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                  {progress.map((subject) =>
                    subject.readiness.reportable ? (
                      <div key={subject.subjectId} className="space-y-4">
                        <RingGauge
                          value={subject.readiness.score}
                          label={subject.subjectName}
                          size={150}
                          tone="brand"
                          caption={
                            subject.readiness.trend === 'up'
                              ? `↑ ${t.performance.trendUp}`
                              : subject.readiness.trend === 'down'
                                ? `↓ ${t.performance.trendDown}`
                                : `→ ${t.performance.trendFlat}`
                          }
                        />

                        <div className="space-y-2">
                          <Meter
                            value={subject.readiness.masteryComponent}
                            label={t.performance.masteryComponent}
                            size="sm"
                          />
                          <Meter
                            value={subject.readiness.coverageComponent}
                            label={t.performance.coverageComponent}
                            size="sm"
                          />
                          <Meter
                            value={subject.readiness.trendComponent}
                            label={t.performance.trendComponent}
                            size="sm"
                          />
                        </div>
                      </div>
                    ) : (
                      <div key={subject.subjectId} className="space-y-1">
                        <p className="text-[12.5px] font-medium uppercase tracking-wide text-ink-muted">
                          {subject.subjectName}
                        </p>
                        <p className="text-lg font-bold text-ink-faint">
                          {t.dashboard.readinessNotYet}
                        </p>
                        <p className="text-[12.5px] leading-snug text-ink-muted">
                          {t.performance.noDataHint}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              )}
            </SheetBody>
          </Sheet>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* --- Weakest --- */}
            <Sheet>
              <SheetHeader title={t.performance.weakTopics} />
              <SheetBody className="p-0">
                {weakest.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-ink-muted">{t.performance.noDataHint}</p>
                ) : (
                  <ul className="ruled">
                    {weakest.map((chapter) => (
                      <li key={chapter.chapterId} className="px-5 py-3">
                        <div className="mb-1.5 flex items-baseline justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">
                              {chapter.chapterName}
                            </p>
                            <p className="text-[12px] text-ink-faint">{chapter.subjectName}</p>
                          </div>
                          <a
                            href={`/practice/${chapter.subjectId}/${chapter.chapterId}`}
                            className="shrink-0 text-[12.5px] font-medium text-primary underline-offset-2 hover:underline"
                          >
                            {t.performance.practiseThis}
                          </a>
                        </div>
                        {/* The band names what the bar only shows. A meter on
                            its own is a length: a student reads "about a third"
                            and has to guess whether that is bad. The same chip
                            vocabulary as the dashboard grid and the chapter
                            list says it outright. */}
                        <div className="flex items-center gap-2.5">
                          <Meter
                            value={chapter.masteryScore}
                            size="sm"
                            caption={`${chapter.attemptsCount} ${t.practice.attempts}`}
                            className="min-w-0 flex-1"
                          />
                          <BandChip
                            band={bandForMastery(chapter.masteryScore, chapter.attemptsCount)}
                            label={
                              bandLabels[bandForMastery(chapter.masteryScore, chapter.attemptsCount)]
                            }
                            className="shrink-0"
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </SheetBody>
            </Sheet>

            {/* --- Strongest --- */}
            <Sheet>
              <SheetHeader title={t.performance.strongTopics} />
              <SheetBody className="p-0">
                {strongest.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-ink-muted">{t.performance.noDataHint}</p>
                ) : (
                  <ul className="ruled">
                    {strongest.map((chapter) => (
                      <li key={chapter.chapterId} className="px-5 py-3">
                        <div className="mb-1.5 min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{chapter.chapterName}</p>
                          <p className="text-[12px] text-ink-faint">{chapter.subjectName}</p>
                        </div>
                        {/* The band names what the bar only shows. A meter on
                            its own is a length: a student reads "about a third"
                            and has to guess whether that is bad. The same chip
                            vocabulary as the dashboard grid and the chapter
                            list says it outright. */}
                        <div className="flex items-center gap-2.5">
                          <Meter
                            value={chapter.masteryScore}
                            size="sm"
                            caption={`${chapter.attemptsCount} ${t.practice.attempts}`}
                            className="min-w-0 flex-1"
                          />
                          <BandChip
                            band={bandForMastery(chapter.masteryScore, chapter.attemptsCount)}
                            label={
                              bandLabels[bandForMastery(chapter.masteryScore, chapter.attemptsCount)]
                            }
                            className="shrink-0"
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </SheetBody>
            </Sheet>
          </div>
        </div>
      )}
    </>
  );
}
