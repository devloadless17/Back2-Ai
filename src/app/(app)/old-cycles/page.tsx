import type { Metadata } from 'next';
import Link from 'next/link';

import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';

export const metadata: Metadata = { title: 'Past papers' };

/**
 * Past papers, grouped by subject and newest first.
 *
 * This mode is unscored on purpose and says so before the student opens
 * anything — reading an official paper with the solutions to hand is a
 * legitimate way to study, and it should not quietly move a mastery number that
 * the rest of the product treats as evidence of what they can do unaided.
 */
export default async function OldCyclesPage() {
  const user = await requireUser();
  const { t } = await getTranslations();

  const cycles = await db.examCycle.findMany({
    where: { subject: { trackId: user.trackId ?? undefined } },
    select: {
      id: true,
      year: true,
      session: true,
      title: true,
      durationMinutes: true,
      subject: { select: { id: true, name: true } },
      _count: { select: { questions: true } },
    },
    orderBy: [{ year: 'desc' }, { session: 'asc' }],
  });

  const bySubject = new Map<string, typeof cycles>();
  for (const cycle of cycles) {
    bySubject.set(cycle.subject.name, [...(bySubject.get(cycle.subject.name) ?? []), cycle]);
  }

  return (
    <>
      <PageHeader title={t.oldCycles.title} description={t.oldCycles.subtitle} />

      <Alert tone="info" className="mb-5">
        {t.oldCycles.unscoredNotice}
      </Alert>

      {cycles.length === 0 ? (
        <EmptyState tone="pending" title={t.oldCycles.noCycles} body={t.practice.noQuestionsHint} />
      ) : (
        <div className="space-y-5">
          {[...bySubject.entries()].map(([subjectName, subjectCycles]) => (
            <Sheet key={subjectName}>
              <SheetHeader title={subjectName} />
              <SheetBody className="p-0">
                <ul className="ruled">
                  {subjectCycles.map((cycle) => (
                    <li key={cycle.id}>
                      <Link
                        href={`/old-cycles/${cycle.id}`}
                        className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors duration-150 hover:bg-paper-sunken"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{cycle.title}</p>
                          <p className="text-[12px] text-ink-faint">
                            {format(t.oldCycles.questionCount, { count: cycle._count.questions })}
                            {' · '}
                            {format(t.oldCycles.duration, { count: cycle.durationMinutes })}
                          </p>
                        </div>
                        <Badge tone="neutral">
                          {cycle.year}
                          {cycle.session ? ` · ${cycle.session}` : ''}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </SheetBody>
            </Sheet>
          ))}
        </div>
      )}
    </>
  );
}
