import type { Metadata } from 'next';
import Link from 'next/link';

import { Meter } from '@/components/ui/progress';
import { LinkButton } from '@/components/ui/button';
import { PageHeader, Sheet, SheetBody, SheetHeader, StatTile } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { cn } from '@/lib/cn';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import { getStanding } from '@/lib/queries/standing';
import { markOutOf20, PASS_MARK, type MarkBand } from '@/lib/standing';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.standing.title };
}

/**
 * Standing — the same question a Lebanese report card answers.
 *
 * Deliberately separate from `/performance`, which explains *why* a number is
 * what it is (mastery, coverage, trend). This page answers "what am I on", in
 * the only unit that needs no explanation to a student, a parent or a teacher.
 *
 * Two honesty rules run through it. A subject with too little marked work shows
 * no mark at all rather than a low one — the difference between "you are weak
 * here" and "we cannot say yet" is the whole credibility of the prediction. And
 * the mark is labelled as an estimate everywhere it appears, because it is
 * derived from practice, not awarded by an examiner.
 */
export default async function StandingPage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  const standing = await getStanding(user.id, user.trackId, user.preferredLanguage);
  const scale = markOutOf20(1);

  const bandLabel: Record<MarkBand, string> = {
    failing: t.standing.bandFailing,
    passing: t.standing.bandPassing,
    good: t.standing.bandGood,
    strong: t.standing.bandStrong,
  };

  const trendLabel = {
    up: t.standing.trendUp,
    flat: t.standing.trendFlat,
    down: t.standing.trendDown,
  } as const;

  return (
    <>
      <PageHeader
        title={t.standing.title}
        description={t.standing.subtitle}
        /*
         * The printable version lives one click from the live one. A parent
         * meeting is the reason it exists, and nobody finds a page they have to
         * be told the URL of.
         */
        actions={
          <LinkButton href="/report" variant="secondary" size="sm">
            {t.report.title}
          </LinkButton>
        }
      />

      {/* --- The four figures --------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t.standing.predictedMark}
          tone="mark"
          value={
            standing.overall === null
              ? '—'
              : format(t.standing.outOf, { mark: standing.overall, scale })
          }
          caption={
            standing.overall === null ? t.standing.notEnoughYetHint : t.standing.predictedMarkHint
          }
        />

        <StatTile
          label={t.standing.coverage}
          value={`${Math.round(standing.coverage.ratio * 100)}%`}
          caption={format(t.standing.coverageHint, {
            practised: standing.coverage.practised,
            available: standing.coverage.available,
          })}
        />

        <StatTile
          label={t.standing.daysLeft}
          value={standing.daysToExam === null ? '—' : standing.daysToExam}
          caption={
            standing.examLabel
              ? format(t.standing.daysLeftFor, { label: standing.examLabel })
              : t.standing.noExamDate
          }
        />

        <StatTile
          label={t.standing.effort}
          value={standing.effort.daysWorked}
          caption={format(t.standing.effortHint, {
            worked: standing.effort.daysWorked,
            elapsed: standing.effort.daysElapsed,
          })}
        />
      </div>

      {/* --- Subject by subject, as a mark sheet --------------------------- */}
      <Sheet className="mt-5">
        <SheetHeader title={t.standing.bySubject} description={t.standing.equalWeighting} />
        <SheetBody className="p-0">
          {/* Contained sideways scroll. A subject table on a 360px phone is the
              one place in this product where horizontal scroll is the right
              answer — the alternative is a stacked list that loses the
              column-to-column comparison the table exists for. The page body
              still never scrolls sideways; only this box does. */}
          <div className="scroll-x">
            <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="label px-5 py-2 text-start font-semibold">
                  {t.settings.track}
                </th>
                <th scope="col" className="label px-3 py-2 text-end font-semibold">
                  {t.standing.predictedMark}
                </th>
                <th scope="col" className="label hidden px-3 py-2 text-start font-semibold sm:table-cell">
                  {t.performance.trend}
                </th>
              </tr>
            </thead>
            <tbody className="ruled">
              {standing.subjects.map((subject) => (
                <tr key={subject.subjectId}>
                  <td className="px-5 py-3">
                    <span className="font-medium text-ink">{subject.subjectName}</span>
                    {subject.band && (
                      <span className="ms-2 text-caption text-ink-muted">
                        {bandLabel[subject.band]}
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-3 text-end">
                    {subject.mark === null ? (
                      <span className="text-meta text-ink-faint">{t.standing.notEnoughYet}</span>
                    ) : (
                      <span
                        className={cn(
                          'figure text-body',
                          subject.mark < PASS_MARK ? 'text-mark' : 'text-ink',
                        )}
                      >
                        {format(t.standing.outOf, { mark: subject.mark, scale })}
                      </span>
                    )}
                  </td>

                  <td className="hidden px-3 py-3 text-meta text-ink-muted sm:table-cell">
                    {trendLabel[subject.trend]}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </SheetBody>
      </Sheet>

      {/* --- Coverage, spelled out ---------------------------------------- */}
      <Sheet className="mt-5">
        <SheetHeader title={t.standing.coverage} description={t.standing.coverageNote} />
        <SheetBody className="space-y-2">
          <Meter
            value={standing.coverage.ratio}
            label={format(t.standing.coverageHint, {
              practised: standing.coverage.practised,
              available: standing.coverage.available,
            })}
            caption={`${Math.round(standing.coverage.ratio * 100)}%`}
            tone="primary"
          />
          <p className="text-meta text-ink-muted">
            {format(t.standing.passMark, { mark: PASS_MARK })} ·{' '}
            <Link href="/performance" className="text-primary underline-offset-2 hover:underline">
              {t.performance.title}
            </Link>
          </p>
        </SheetBody>
      </Sheet>
    </>
  );
}
