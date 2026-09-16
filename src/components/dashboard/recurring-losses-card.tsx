import Link from 'next/link';

import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import type { RecurringLoss } from '@/lib/queries/recurring-losses';

/**
 * The marks this student keeps losing for the same reason.
 *
 * Every other number on this dashboard tells a student WHERE they are weak — a
 * chapter, a subject, a percentage. This one tells them WHAT they are doing
 * wrong, in the examiner's own words, and how many marks it has cost. It is the
 * difference between "you are at 11/20 in philosophy" and "you have lost 27
 * marks by not stating the problematic, on these three questions".
 *
 * THE CRITERION IS QUOTED, NOT PARAPHRASED. It is the line a Lebanese examiner
 * reads off the barème while marking, and a student who recognises that wording
 * on the day is a student who knows what the marker is looking for. Rewriting it
 * in friendlier language would throw away the only thing that makes it
 * authoritative.
 *
 * ABSENT RATHER THAN EMPTY when there is nothing to show. A student with no
 * repeated weakness is the good case, and a card reading "no patterns found"
 * turns that into a blank space that looks like a broken feature. It appears
 * when it has something to say.
 */
export function RecurringLossesCard({
  losses,
  labels,
}: {
  losses: RecurringLoss[];
  labels: {
    title: string;
    subtitle: string;
    timesLost: string;
    marksLost: string;
    practise: string;
  };
}) {
  if (losses.length === 0) return null;

  return (
    <Sheet>
      <SheetHeader title={labels.title} description={labels.subtitle} />
      <SheetBody className="p-0">
        <ul className="ruled">
          {losses.map((loss) => (
            <li key={`${loss.subjectName}-${loss.criterion}`} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-caption font-semibold uppercase tracking-wider text-ink-faint">
                  {loss.subjectName}
                </span>
                <span className="text-caption text-danger">
                  {labels.marksLost.replace('{points}', String(loss.pointsLost))}
                </span>
              </div>

              {/* The examiner's wording, quoted. See the note above. */}
              <p className="mt-1.5 text-sm leading-relaxed text-ink">“{loss.criterion}”</p>

              <p className="mt-1.5 text-caption text-ink-faint">
                {labels.timesLost.replace('{times}', String(loss.times))}
                {' · '}
                {[...new Set(loss.occasions.map((o) => o.chapterName))].slice(0, 3).join(' · ')}
              </p>

              {/*
                Straight to one of the questions it happened on, rather than to
                the chapter. The student has just been told they keep failing a
                specific move; the useful next click is the question where they
                failed it, with their own answer beside the official one.
              */}
              {loss.occasions[0]?.questionId && (
                <Link
                  href={`/chat?question=${loss.occasions[0].questionId}`}
                  className="mt-2 inline-block text-meta font-medium text-primary underline-offset-2 hover:underline"
                >
                  {labels.practise}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </SheetBody>
    </Sheet>
  );
}
