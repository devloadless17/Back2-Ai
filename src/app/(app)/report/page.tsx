import type { Metadata } from 'next';

import { PrintButton } from '@/components/progress/print-button';
import { BackLink } from '@/components/ui/back-link';
import { requireUser } from '@/lib/auth/guards';
import { getTranslations } from '@/lib/i18n';
import { formatDate } from '@/lib/i18n/format';
import { readinessReport } from '@/lib/queries/readiness-report';

export const metadata: Metadata = { title: 'Readiness report' };

/**
 * One page a school can print and hand to a parent.
 *
 * WHY PRINT AND NOT A PDF LIBRARY. A browser already renders this page, already
 * embeds the Arabic fonts, already lays out right-to-left, and already offers
 * "Save as PDF". A PDF library would mean re-solving all four, adding a
 * dependency, and producing a document that drifts from what the screen shows.
 * `window.print()` is the whole feature.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY. No "predicted grade" language and no
 * certainty it has not earned: a subject with too little marked work prints
 * "not enough marked work yet" rather than a number, because a figure on a
 * printed page handed to a parent will be read as a fact long after the caveat
 * on the screen is forgotten. The dashboard can afford to be approximate; paper
 * cannot.
 *
 * Every figure here is stored, not generated. No model is called, so printing
 * twice costs nothing and produces the same document.
 */
export default async function ReadinessReportPage() {
  const user = await requireUser();
  const { locale, t } = await getTranslations();
  const report = await readinessReport(user.id, user.trackId, user.preferredLanguage);

  const identity = [
    report.studentName ?? user.email,
    report.trackName,
    formatDate(locale, report.generatedAt),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      {/*
        Printed on every sheet and never shown on screen — the styling and the
        reason both live in the print block of globals.css, under
        `.print-running-head`. `hidden` is what keeps it off the screen, where
        the same three facts already sit under the title.
      */}
      <div className="print-running-head hidden" aria-hidden>
        {t.report.title}
        {' — '}
        {identity}
      </div>

      {/* Navigation and the button itself are screen-only — see `print:hidden`. */}
      <div className="print:hidden">
        <BackLink href="/progress" label={t.nav.performance} />
      </div>

      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">{t.report.title}</h1>
          <p className="mt-1 text-caption text-ink-faint">{identity}</p>
        </div>
        <PrintButton label={t.report.print} />
      </div>

      {/* --- The headline, and the caveat that has to travel with it -------- */}
      <section className="mb-6 rounded-lg border border-rule p-5 break-inside-avoid">
        <p className="text-caption uppercase tracking-wider text-ink-faint">{t.report.overall}</p>
        {report.overallMark === null ? (
          <p className="mt-1 text-sm text-ink-muted">{t.report.notEnough}</p>
        ) : (
          <p className="mt-1 figure text-title">
            {report.overallMark.toFixed(1)} <span className="text-base text-ink-faint">/ 20</span>
          </p>
        )}
        <p className="mt-2 max-w-prose text-caption leading-relaxed text-ink-faint">
          {t.report.disclaimer}
        </p>
      </section>

      {/* --- Per subject ---------------------------------------------------- */}
      <div className="space-y-5">
        {report.subjects.map((subject) => (
          <section
            key={subject.subjectName}
            // `break-inside-avoid` so a subject is never split across two sheets
            // of paper, which is the difference between a report and a printout.
            className="rounded-lg border border-rule p-5 break-inside-avoid"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">{subject.subjectName}</h2>
              <span className="text-sm text-ink">
                {subject.mark === null ? (
                  <span className="text-caption text-ink-faint">{t.report.notEnough}</span>
                ) : (
                  <>
                    {subject.mark.toFixed(1)}
                    <span className="text-caption text-ink-faint"> / 20</span>
                  </>
                )}
              </span>
            </div>

            <p className="mt-1 text-caption text-ink-faint">
              {t.report.coverage
                .replace('{started}', String(subject.chaptersStarted))
                .replace('{total}', String(subject.chaptersTotal))}
              {' · '}
              {t.report.attempts.replace('{count}', String(subject.attempts))}
            </p>

            {subject.priority.length > 0 && (
              <>
                <p className="mt-4 text-caption font-semibold uppercase tracking-wider text-ink-faint">
                  {t.report.focus}
                </p>
                <ul className="mt-1.5 divide-y divide-rule">
                  {subject.priority.map((chapter) => (
                    <li
                      key={chapter.chapterName}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
                    >
                      <span className="min-w-0 flex-1 text-sm text-ink">{chapter.chapterName}</span>
                      {/*
                        Exam frequency beside mastery, which is the point of the
                        page: a weak chapter still being set is a priority, and
                        a weak chapter abandoned in 2011 is not.
                      */}
                      <span className="text-caption text-ink-faint">
                        {t.report.examined
                          .replace('{recent}', String(chapter.recentYears))
                          .replace('{last}', String(chapter.examYears[0] ?? ''))}
                      </span>
                      <span className="w-14 text-end text-caption text-ink-muted">
                        {chapter.attemptsCount === 0
                          ? t.report.notStarted
                          : `${Math.round(chapter.masteryScore * 100)}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ))}
      </div>

      <p className="mt-6 text-caption text-ink-faint">{t.report.footer}</p>
    </>
  );
}
