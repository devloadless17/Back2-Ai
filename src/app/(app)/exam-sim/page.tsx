import type { Metadata } from 'next';
import Link from 'next/link';

import { LinkButton } from '@/components/ui/button';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { isLiveSitting, remainingSeconds } from '@/lib/exam';
import { getTranslations } from '@/lib/i18n';
import { formatDate, formatDuration } from '@/lib/i18n/format';

export const metadata: Metadata = { title: 'Exam simulation' };

/**
 * Simulation index: what is running, and what has been sat.
 *
 * A live paper takes over the page. The clock is running on the server whether
 * or not this tab is open, so anything else on this screen would be a
 * distraction from the only thing that matters.
 */
export default async function ExamSimIndexPage() {
  const user = await requireUser();
  const { locale, t } = await getTranslations();

  const [inProgress, recent] = await Promise.all([
    db.examSimulation.findFirst({
      where: { userId: user.id, status: 'in_progress' },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        subject: { select: { name: true } },
        _count: { select: { questions: true } },
      },
    }),
    db.examSimulation.findMany({
      where: { userId: user.id, status: { in: ['submitted', 'graded'] } },
      select: {
        id: true,
        status: true,
        sourceMode: true,
        totalScore: true,
        maxScore: true,
        submittedAt: true,
        subject: { select: { name: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 10,
    }),
  ]);

  /*
   * LIVE, not merely unfinished.
   *
   * `status` alone is the wrong test. A paper whose deadline has passed keeps
   * `in_progress` until the sweep reaches it, and this page was reading that
   * as a sitting still under way: it hid the "new simulation" button and
   * offered Resume against a timer already at zero.
   *
   * `startSimulation` does not agree. It refuses a second paper only while the
   * first is genuinely live, and auto-submits a stale one before starting the
   * next — so the server would have allowed exactly the action the UI was
   * withholding. Same rule in both places now.
   */
  const live = isLiveSitting(inProgress) ? inProgress : null;

  return (
    <>
      <PageHeader
        title={t.examSim.title}
        description={t.examSim.subtitle}
        actions={
          live ? null : (
            <LinkButton href="/exam-sim/new" variant="primary">
              {t.examSim.newTitle}
            </LinkButton>
          )
        }
      />

      {live && (
        <Alert tone="warning" title={t.examSim.inProgressNotice} className="mb-5">
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm tabular-nums">
              {formatDuration(remainingSeconds(live))}
            </span>
            <LinkButton href={`/exam-sim/${live.id}`} variant="mark" size="sm">
              {t.examSim.resume}
            </LinkButton>
          </div>
        </Alert>
      )}

      {recent.length === 0 ? (
        <EmptyState
          tone="neutral"
          title={t.examSim.noSimulations}
          body={t.examSim.subtitle}
          action={
            live ? null : (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <LinkButton href="/exam-sim/new" variant="primary">
                  {t.examSim.newTitle}
                </LinkButton>
                {/* The other real route in. A student with no sittings yet may
                    not know a real paper is sittable, and past papers is where
                    they are already browsing. */}
                <LinkButton href="/old-cycles" variant="secondary">
                  {t.nav.oldCycles}
                </LinkButton>
              </div>
            )
          }
        />
      ) : (
        <Sheet>
          <SheetHeader title={t.examSim.resultsTitle} />
          <SheetBody className="p-0">
            <ul className="ruled">
              {recent.map((simulation) => {
                const total = simulation.totalScore === null ? null : Number(simulation.totalScore);
                const max = simulation.maxScore === null ? null : Number(simulation.maxScore);

                return (
                  <li key={simulation.id}>
                    <Link
                      href={`/exam-sim/${simulation.id}/results`}
                      className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors duration-150 hover:bg-paper-sunken"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {simulation.subject.name}
                        </p>
                        <p className="text-caption text-ink-faint">
                          {simulation.submittedAt ? formatDate(locale, simulation.submittedAt) : '—'}
                          {' · '}
                          {simulation.sourceMode === 'real_cycle'
                            ? t.examSim.modeRealCycle
                            : t.examSim.modeAiGenerated}
                        </p>
                      </div>

                      {simulation.status === 'graded' && total !== null && max ? (
                        <Badge
                          tone={
                            total / max >= 0.7 ? 'correct' : total / max >= 0.5 ? 'partial' : 'mark'
                          }
                        >
                          {total} / {max}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">{t.examSim.grading}</Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </SheetBody>
        </Sheet>
      )}
    </>
  );
}
