import type { Metadata } from 'next';
import Link from 'next/link';

import { Alert, Badge, EmptyAction, EmptyState } from '@/components/ui/feedback';
import { PageHeader, Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { subjectLanguagesFor } from '@/lib/queries/taxonomy';
import { LOCALE_LABELS } from '@/lib/i18n/config';
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
export default async function OldCyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const { subject: onlySubject } = await searchParams;
  const user = await requireUser();
  const { t } = await getTranslations();

  /*
   * The edition the student can read.
   *
   * The humanities are taught in Arabic and have one subject, which a
   * French-track student is shown — `subjectLanguagesFor('fr')` returns
   * `['fr', 'ar']`. The CRDP still prints those papers in three languages, and
   * until `exam_cycles.language` existed all three collapsed into one cycle, so
   * opening a philosophy paper showed the Arabic, French and English editions
   * stacked together.
   *
   * Now they are separate rows and the student is offered their own language
   * plus Arabic — the same pair `subjectLanguagesFor` already uses for
   * subjects, for the same reason. An English-track student is not shown the
   * French printing of a paper they cannot read.
   */
  const cycles = await db.examCycle.findMany({
    where: {
      subject: { trackId: user.trackId ?? undefined },
      language: { in: subjectLanguagesFor(user.preferredLanguage) },
      /*
       * Narrowed when the student arrived from a subject.
       *
       * The track filter still applies underneath, so a hand-edited id belonging
       * to another track returns nothing rather than papers this student is not
       * sitting. `undefined` — not a bare spread — because Prisma treats an
       * explicit `subjectId: undefined` as "no constraint", which is exactly the
       * unfiltered list we want when the parameter is absent.
       */
      subjectId: onlySubject || undefined,
    },
    select: {
      id: true,
      year: true,
      session: true,
      title: true,
      language: true,
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

      {/* A filtered list that does not say it is filtered reads as a subject
          with three past papers to its name — and when the filter matches
          nothing it reads as a product with no past papers at all, which is
          exactly when the way out matters most. So it does not depend on
          there being results. */}
      {onlySubject && (
        <p className="mb-4">
          <Link
            href="/old-cycles"
            className="text-meta font-semibold text-primary underline-offset-2 hover:underline"
          >
            {t.oldCycles.showAllSubjects}
          </Link>
        </p>
      )}

      {cycles.length === 0 ? (
        <EmptyState
          tone="pending"
          title={t.practice.noPapersTitle}
          body={t.practice.noPapersBody}
          action={<EmptyAction href="/practice" label={t.practice.noPapersCta} />}
        />
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
                          <p className="text-caption text-ink-faint">
                            {format(t.oldCycles.questionCount, { count: cycle._count.questions })}
                            {' · '}
                            {format(t.oldCycles.duration, { count: cycle.durationMinutes })}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {/* Which printing. A French-track student is offered
                              their own edition and the Arabic one, and the two
                              carry the same title — without this they are two
                              identical rows. */}
                          <Badge tone="primary">{LOCALE_LABELS[cycle.language]}</Badge>
                          <Badge tone="neutral">
                            {cycle.year}
                            {cycle.session ? ` · ${cycle.session}` : ''}
                          </Badge>
                        </div>
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
