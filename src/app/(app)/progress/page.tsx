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
import { evidenceReading, markOutOf20, PASS_MARK, type MarkBand } from '@/lib/standing';

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

  /*
   * The track read as one. Chapter counts add exactly, so `trackCoverage` is a
   * real fraction rather than a mean of fractions, and `trackMastery` is the
   * mean over every attempted chapter in the track — weighting each subject by
   * the evidence it actually has, not by how many subjects there are.
   */
  const chaptersAttempted = standing.subjects.reduce((n, s) => n + s.evidence.chaptersAttempted, 0);
  const chaptersTotal = standing.subjects.reduce((n, s) => n + s.evidence.chaptersTotal, 0);
  const trackMastery =
    chaptersAttempted === 0
      ? 0
      : standing.subjects.reduce((sum, s) => sum + s.evidence.mastery * s.evidence.chaptersAttempted, 0) /
        chaptersAttempted;
  const trackCoverage = chaptersTotal === 0 ? 0 : chaptersAttempted / chaptersTotal;

  const readingText = {
    none: t.standing.readingNone,
    early: t.standing.readingEarly,
    strongNarrow: format(t.standing.readingStrongNarrow, {
      done: chaptersAttempted,
      total: chaptersTotal,
    }),
    weakBroad: t.standing.readingWeakBroad,
    strongBroad: t.standing.readingStrongBroad,
  }[evidenceReading(trackMastery, trackCoverage)];

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

      {/* --- What the mark is made of -------------------------------------
          Readiness multiplies strength by breadth, and a student cannot be
          asked to do that multiplication in their head. Without this, high
          marks on a quarter of the programme produce a low figure that reads
          as "I am bad at this" when the truth is "I am good at this and have
          barely started it" — and those two call for completely different
          work. The two figures are given different shapes on purpose: breadth
          is a proportion, so it gets a bar; strength is a level, so it gets a
          numeral. They are never combined into one dial. */}
      <Sheet className="mt-5">
        <SheetHeader title={t.standing.madeOf} description={t.standing.madeOfNote} />
        <SheetBody className="space-y-4">
          <p className="text-body text-ink">{readingText}</p>

          {chaptersTotal > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="label">{t.standing.strength}</p>
                <p className="figure mt-1 text-heading leading-none text-ink sm:text-display">
                  {chaptersAttempted === 0
                    ? t.standing.notStarted
                    : format(t.standing.outOf, {
                        mark: Math.round(trackMastery * scale * 10) / 10,
                        scale,
                      })}
                </p>
                <p className="mt-1 text-meta text-ink-muted">{t.standing.strengthHint}</p>
              </div>

              <div>
                <p className="label">{t.standing.practised}</p>
                <Meter
                  className="mt-2"
                  value={trackCoverage}
                  caption={format(t.standing.practisedOf, {
                    done: chaptersAttempted,
                    total: chaptersTotal,
                  })}
                  tone="primary"
                />
              </div>
            </div>
          )}
        </SheetBody>
      </Sheet>

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
            <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="label px-5 py-2 text-start font-semibold">
                  {t.settings.track}
                </th>
                <th scope="col" className="label px-3 py-2 text-end font-semibold">
                  {t.standing.predictedMark}
                </th>
                <th scope="col" className="label px-3 py-2 text-end font-semibold">
                  {t.standing.strength}
                </th>
                <th scope="col" className="label px-3 py-2 text-start font-semibold">
                  {t.standing.practised}
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
                      /* Not a low mark — no mark. The student is told how much
                         more work makes one appear, so the blank reads as a
                         threshold rather than a verdict. */
                      <span className="text-meta text-ink-faint">
                        {subject.evidence.attemptsNeeded > 0
                          ? format(t.standing.needMore, { count: subject.evidence.attemptsNeeded })
                          : t.standing.notEnoughYet}
                      </span>
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

                  {/* Strength: a level, so a numeral. A subject nobody has
                      opened says so — an untouched chapter is not a failed
                      one, and printing 0 here would be the exact error v1
                      made in the model. */}
                  <td className="px-3 py-3 text-end">
                    {subject.evidence.chaptersAttempted === 0 ? (
                      <span className="text-meta text-ink-faint">{t.standing.notStarted}</span>
                    ) : (
                      <span className="figure text-body text-ink">
                        {format(t.standing.outOf, {
                          mark: Math.round(subject.evidence.mastery * scale * 10) / 10,
                          scale,
                        })}
                      </span>
                    )}
                  </td>

                  {/* Practised: a share of a whole, so a bar. Never the same
                      shape as strength, so the two cannot be misread as one
                      measure at two sizes. */}
                  <td className="px-3 py-3">
                    <Meter
                      size="sm"
                      value={subject.evidence.coverage}
                      tone="primary"
                      caption={format(t.standing.practisedOf, {
                        done: subject.evidence.chaptersAttempted,
                        total: subject.evidence.chaptersTotal,
                      })}
                    />
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
