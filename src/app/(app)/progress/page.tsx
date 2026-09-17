import type { Metadata } from 'next';

import { BacMap } from '@/components/progress/bac-map';
import { ChapterRankList } from '@/components/progress/chapter-rank-list';
import { NextUpCard } from '@/components/progress/next-up-card';
import { RecurringLosses } from '@/components/progress/recurring-losses';
import { SchoolVsPredicted } from '@/components/progress/school-vs-predicted';
import { LinkButton } from '@/components/ui/button';
import { Meter } from '@/components/ui/progress';
import { PageHeader, Sheet, SheetBody, SheetHeader, StatTile } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { cn } from '@/lib/cn';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import { compareMarks, schoolMarksBySubject } from '@/lib/queries/grades';
import { getNextUp } from '@/lib/queries/next-up';
import { getProgressForUser, rankChapters, rankStrongest } from '@/lib/queries/progress';
import { recurringLosses } from '@/lib/queries/recurring-losses';
import { getStanding } from '@/lib/queries/standing';
import { listChaptersForTrack } from '@/lib/queries/taxonomy';
import { markOutOf20, PASS_MARK, type MarkBand } from '@/lib/standing';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslations();
  return { title: t.standing.title };
}

/**
 * Progress — the canonical account of where a student stands.
 *
 * `/performance` used to hold the second half of this: the same readiness
 * numbers broken into their model components, plus the chapter rankings. It
 * redirects here now. Two pages that each answered half a question meant a
 * student could read "Mathematics 14.8" on one and have to go and find the
 * other to learn which chapter was dragging it.
 *
 * What did NOT come across is the ring gauge and the three component meters.
 * They plotted `masteryComponent`, which is mastery multiplied by coverage —
 * the conflated term the readiness v2 work exists to stop showing. Answering
 * "why is my mark what it is" with the model's own internals was never the
 * right answer to that question; mastery, practised and evidence are.
 *
 * One vocabulary runs through the page, and each word means exactly one thing:
 *
 *   Mastery    how well I do on material I have practised
 *   Practised  how much of my programme I have attempted
 *   Evidence   how much marked work supports the figure
 *   Readiness  the combined standing model
 *
 * There is no second percentage called coverage. The question-bank measure
 * that used to sit here is a fact about our corpus, not the student, and it
 * now lives in `src/lib/queries/content-health.ts` under its real name.
 */
export default async function ProgressPage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  /*
   * One round of queries, issued together.
   *
   * The Bac Map is the reason this matters: Track -> Subject -> Chapter over a
   * GS track is 243 chapters across its subjects, and asking per subject would
   * grow the query count with the curriculum. `listChaptersForTrack` is two
   * queries for the whole track, and it shares its loader with the practice
   * index so the two surfaces cannot disagree about a chapter.
   *
   * No question bodies are loaded. The map shows counts and links into the
   * existing chapter page; shipping the corpus to a phone to draw a number
   * would be a poor trade on a Lebanese mobile connection.
   */
  const [standing, progress, schoolMarks, next, losses, chapters] = await Promise.all([
    getStanding(user.id, user.trackId, user.preferredLanguage),
    getProgressForUser(user.id, user.trackId, user.preferredLanguage),
    schoolMarksBySubject(user.id),
    getNextUp(user.id, user.trackId, user.preferredLanguage),
    recurringLosses(user.id, { limit: 5 }),
    user.trackId ? listChaptersForTrack(user.trackId, user.id) : Promise.resolve([]),
  ]);

  const scale = markOutOf20(1);
  const { evidence } = standing;
  const percent = (n: number) => `${Math.round(n * 100)}%`;

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
        actions={
          <LinkButton href="/report" variant="secondary" size="sm">
            {t.report.title}
          </LinkButton>
        }
      />

      {/* --- Where I stand -------------------------------------------------
          The mark, and the figures it is made of. Deliberately plain numbers
          rather than a sentence: any wording that sorted them into "strong" or
          "narrow" would need cutoffs, and nothing in this product knows where
          strong begins. 92% beside 4 of 22 chapters already tells a student
          which of the two is short. */}
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
            standing.overall === null
              ? t.standing.notEnoughYetHint
              : format(t.standing.basedOnAnswers, { count: evidence.markedAnswers })
          }
        />

        <StatTile
          label={t.standing.mastery}
          value={evidence.chaptersAttempted === 0 ? '—' : percent(evidence.mastery)}
          caption={
            evidence.chaptersAttempted === 0 ? t.standing.notStarted : t.standing.masteryHint
          }
        />

        <StatTile
          label={t.standing.practised}
          value={percent(standing.coverage.ratio)}
          caption={format(t.standing.practisedOf, {
            done: standing.coverage.practised,
            total: standing.coverage.available,
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
      </div>

      <p className="mt-3 text-meta text-ink-muted">
        {format(t.standing.effortHint, {
          worked: standing.effort.daysWorked,
          elapsed: standing.effort.daysElapsed,
        })}
        {' · '}
        {format(t.standing.passMark, { mark: PASS_MARK })}
      </p>

      {/* --- What to do next -----------------------------------------------
          The same `getNextUp` the dashboard reads, through the same card, so
          the two surfaces cannot recommend different things. */}
      <div className="mt-5">
        <NextUpCard next={next} />
      </div>

      {/* --- My subjects ---------------------------------------------------- */}
      <Sheet className="mt-5">
        <SheetHeader title={t.standing.bySubject} description={t.standing.equalWeighting} />
        <SheetBody className="p-0">
          {/* --- Phones: one subject per row, stacked -----------------------
              The table below carries five columns, which is a comparison
              instrument and needs width to be one. Dragging it sideways on a
              360px screen does not give a student the comparison — it gives
              them two columns at a time and a memory test. So the phone gets
              the same four figures in reading order instead, and the table
              starts where there is room for it. */}
          <ul className="ruled sm:hidden">
            {standing.subjects.map((subject) => (
              <li key={subject.subjectId} className="px-5 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words font-medium text-ink">
                    {subject.subjectName}
                  </span>
                  {subject.mark === null ? (
                    <span className="shrink-0 text-meta text-ink-faint">
                      {subject.evidence.attemptsNeeded > 0
                        ? format(t.standing.needMore, { count: subject.evidence.attemptsNeeded })
                        : t.standing.notEnoughYet}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'figure shrink-0 text-body',
                        subject.mark < PASS_MARK ? 'text-mark' : 'text-ink',
                      )}
                    >
                      {format(t.standing.outOf, { mark: subject.mark, scale })}
                    </span>
                  )}
                </div>

                <p className="mt-0.5 text-meta text-ink-muted">
                  {subject.evidence.chaptersAttempted === 0
                    ? t.standing.notStarted
                    : `${t.standing.mastery} ${percent(subject.evidence.mastery)}`}
                  {' · '}
                  {format(t.standing.practisedOf, {
                    done: subject.evidence.chaptersAttempted,
                    total: subject.evidence.chaptersTotal,
                  })}
                  {' · '}
                  {trendLabel[subject.trend]}
                </p>

                <Meter
                  className="mt-1.5"
                  size="sm"
                  value={subject.evidence.coverage}
                  tone="primary"
                />
              </li>
            ))}
          </ul>

          {/* --- From sm up: the comparison table ---------------------------
              Still allowed its own contained sideways scroll between sm and
              the width the five columns want. The page body never scrolls
              sideways; only this box does. */}
          <div className="scroll-x hidden sm:block">
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
                    {t.standing.mastery}
                  </th>
                  <th scope="col" className="label px-3 py-2 text-start font-semibold">
                    {t.standing.practised}
                  </th>
                  <th scope="col" className="label px-3 py-2 text-start font-semibold">
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
                        /* Not a low mark — no mark. The student is told how
                           much more work makes one appear, so the blank reads
                           as a threshold rather than a verdict. */
                        <span className="text-meta text-ink-faint">
                          {subject.evidence.attemptsNeeded > 0
                            ? format(t.standing.needMore, {
                                count: subject.evidence.attemptsNeeded,
                              })
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

                    {/* Mastery: a level, so a numeral. A subject nobody has
                        opened says so — an untouched chapter is not a failed
                        one, and printing 0 here would be the exact error the
                        model stopped making. */}
                    <td className="px-3 py-3 text-end">
                      {subject.evidence.chaptersAttempted === 0 ? (
                        <span className="text-meta text-ink-faint">{t.standing.notStarted}</span>
                      ) : (
                        <span className="figure text-body text-ink">
                          {percent(subject.evidence.mastery)}
                        </span>
                      )}
                    </td>

                    {/* Practised: a share of a whole, so a bar. Never the same
                        shape as mastery, so the two cannot be misread as one
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

                    <td className="px-3 py-3 text-meta text-ink-muted">
                      {trendLabel[subject.trend]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SheetBody>
      </Sheet>

      {/* --- The only measure that did not come from inside this product ---- */}
      <div className="mt-5">
        <SchoolVsPredicted rows={compareMarks(standing.subjects, schoolMarks)} />
      </div>

      {/* --- Where marks keep going ----------------------------------------- */}
      <div className="mt-5">
        <RecurringLosses losses={losses} />
      </div>

      {/* --- Chapters, ranked -----------------------------------------------
          Migrated from /performance, which is where the subject table used to
          stop. Weakest leads because it is the actionable half; strongest sits
          beside it because "you are fine here" is worth knowing but is not
          work. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <ChapterRankList
          title={t.performance.weakTopics}
          chapters={rankChapters(progress, 8)}
          withAction
        />
        <ChapterRankList title={t.performance.strongTopics} chapters={rankStrongest(progress, 5)} />
      </div>

      {/* --- The programme itself -------------------------------------------
          Last because it is the reference, not the news. A student opening
          Progress wants to know where they stand; the map is what they come
          back to when they have decided to do something about it. */}
      <div className="mt-5">
        <BacMap subjects={standing.subjects} chapters={chapters} />
      </div>
    </>
  );
}
