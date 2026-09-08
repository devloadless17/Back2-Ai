import Link from 'next/link';

import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { getTranslations } from '@/lib/i18n';
import type { FirstSteps as Steps } from '@/lib/queries/first-steps';

/**
 * Three things to try, for a student who has just signed up.
 *
 * Signup ends by handing over a dashboard of empty rings and zeroes — the least
 * legible screen in the product for the one person who has never seen it. This
 * sits above it until the student has used the tutor, answered an exercise and
 * reviewed a card, then never appears again.
 *
 * Each row is a link into the real page rather than a tooltip pointing at one.
 * A tour teaches someone where the buttons are; doing the thing once teaches
 * them what the product is, and leaves a mark on the dashboard they came from —
 * which is the actual problem, because a first session that ends with every
 * number still at zero looks like nothing happened.
 *
 * A completed row stays, ticked, rather than disappearing. Three items that
 * vanish one by one read as a list that is breaking; three that fill in read as
 * progress, and the card leaves on its own once the last one lands.
 */
export async function FirstSteps({ steps }: { steps: Steps }) {
  const { t } = await getTranslations();
  if (steps.done) return null;

  const rows = [
    {
      done: steps.askedTutor,
      href: '/chat',
      title: t.firstSteps.askTitle,
      note: t.firstSteps.askNote,
    },
    {
      done: steps.answeredQuestion,
      href: '/practice',
      title: t.firstSteps.practiceTitle,
      note: t.firstSteps.practiceNote,
    },
    // Only once there is a deck to review. See `hasCards`.
    ...(steps.hasCards
      ? [
          {
            done: steps.reviewedCard,
            href: '/flashcards/review',
            title: t.firstSteps.cardTitle,
            note: t.firstSteps.cardNote,
          },
        ]
      : []),
  ];

  const remaining = rows.filter((row) => !row.done).length;

  return (
    <Sheet>
      <SheetHeader
        title={t.firstSteps.title}
        description={t.firstSteps.subtitle.replace('{n}', String(remaining))}
      />
      <SheetBody>
        <ol className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.href}>
              <Link
                href={row.href}
                aria-current={row.done ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 transition',
                  'border-border hover:border-accent hover:bg-accent/5',
                  row.done && 'opacity-60',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full border text-xs',
                    row.done
                      ? 'border-transparent bg-emerald-600 text-white'
                      : 'border-border text-muted',
                  )}
                >
                  {row.done ? (
                    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-sm font-medium', row.done && 'line-through')}>
                    {row.title}
                  </span>
                  <span className="block text-xs text-muted">{row.note}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </SheetBody>
    </Sheet>
  );
}
