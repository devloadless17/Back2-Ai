import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import type { RecurringLoss } from '@/lib/queries/recurring-losses';

/**
 * Where marks keep going.
 *
 * Only what the record supports: the criterion as the examiner wrote it, how
 * many marked attempts it cost marks on, and how many marks. Not "recoverable
 * marks", not "you could gain 9" — no counterfactual exists and none is
 * implied. The framing is historical because the evidence is historical.
 *
 * The destination is the part worth being careful about. A criterion that was
 * lost in one chapter can send a student to that chapter. One that spans six
 * chapters cannot, and choosing one of them — the latest, the worst, whichever
 * is easiest to reach for — would be inventing a recommendation to solve a
 * layout problem. `lossScope` decides, over every occurrence rather than the
 * five the list keeps, and an insight with no honest destination is shown
 * without one.
 */
export async function RecurringLosses({ losses }: { losses: RecurringLoss[] }) {
  const { t } = await getTranslations();

  if (losses.length === 0) return null;

  return (
    <Sheet>
      <SheetHeader title={t.standing.whereMarksGo} description={t.standing.whereMarksGoNote} />
      <SheetBody className="p-0">
        <ul className="ruled">
          {losses.map((loss) => {
            const action =
              loss.scope.kind === 'chapter'
                ? {
                    href: `/practice/${loss.scope.subjectId}/${loss.scope.chapterId}`,
                    label: t.performance.practiseThis,
                  }
                : loss.scope.kind === 'subject'
                  ? {
                      href: `/practice/${loss.scope.subjectId}`,
                      label: t.standing.practiseSubject,
                    }
                  : null;

            return (
              <li key={`${loss.subjectName}-${loss.criterion}`} className="px-5 py-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  {/* Criterion wording wraps. It is often a full sentence of
                      examiner French or Arabic, and half of one is no use. */}
                  <p className="min-w-0 flex-1 break-words text-sm font-medium text-ink">
                    {loss.criterion}
                  </p>

                  {action && (
                    <a
                      href={action.href}
                      className="shrink-0 text-meta font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {action.label}
                    </a>
                  )}
                </div>

                <p className="mt-1 text-meta text-ink-muted">
                  {format(t.standing.affectedAttempts, { count: loss.times })}
                  {' · '}
                  {format(t.standing.marksLost, { count: loss.pointsLost })}
                  {' · '}
                  {loss.subjectName}
                </p>
              </li>
            );
          })}
        </ul>
      </SheetBody>
    </Sheet>
  );
}
