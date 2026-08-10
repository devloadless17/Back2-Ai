import type { Metadata } from 'next';
import Link from 'next/link';

import { LinkButton } from '@/components/ui/button';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { remainingSeconds } from '@/lib/exam';
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

  return (
    <>
      <PageHeader
        title={t.examSim.title}
        description={t.examSim.subtitle}
        actions={
          inProgress ? null : (
            <LinkButton href="/exam-sim/new" variant="primary">
              {t.examSim.newTitle}
            </LinkButton>
          )
        }
      />

      {inProgress && (
        <Alert tone="warning" title={t.examSim.inProgressNotice} className="mb-5">
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm tabular-nums">
              {formatDuration(remainingSeconds(inProgress))}
            </span>
            <LinkButton href={`/exam-sim/${inProgress.id}`} variant="mark" size="sm">
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
            inProgress ? null : (
              <LinkButton href="/exam-sim/new" variant="primary">
                {t.examSim.newTitle}
              </LinkButton>
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
                        <p className="text-[12px] text-ink-faint">
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
