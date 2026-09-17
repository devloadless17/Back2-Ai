import { LinkButton } from '@/components/ui/button';
import { Sheet, SheetBody, SheetHeader } from '@/components/ui/sheet';
import { getTranslations } from '@/lib/i18n';
import { format } from '@/lib/i18n/format';
import type { PlanSession } from '@/lib/queries/plan';

/**
 * Today.
 *
 * The first thing on the planning page, because "what am I meant to be doing
 * now" is the question the page exists for and everything else is context for
 * it.
 *
 * COMPLETION IS TWO SEPARATE FACTS and this is the only place in the product
 * that shows both. `status = done` is what the student said. `answersMarked`
 * is what the product saw: answers marked in that chapter inside the
 * reconciliation window. Neither is mastery and the copy never suggests it is.
 *
 * A ticked session with no answers behind it is not an accusation — a student
 * may have read the chapter, worked on paper, or sat with a tutor, none of
 * which this product can see. It says what it knows and stops there.
 */
export async function PlanToday({ sessions }: { sessions: PlanSession[] }) {
  const { t } = await getTranslations();

  const planned = sessions.filter((s) => s.status === 'planned');

  const taskLabel = {
    quiz: t.schedule.taskQuiz,
    flashcards: t.schedule.taskFlashcards,
    exam_drill: t.schedule.taskExamDrill,
    review: t.schedule.taskReview,
  } as const;

  return (
    <Sheet hero>
      <SheetHeader
        title={t.schedule.today}
        description={
          sessions.length === 0
            ? t.schedule.todayNothing
            : format(t.schedule.todayCount, {
                planned: planned.length,
                minutes: planned.reduce((n, s) => n + (s.durationMinutes ?? 0), 0),
              })
        }
      />

      {/* Nothing today is a normal state, not a failure, and it gets one real
          action rather than a lecture. The recommendation card sits directly
          below this on the page and already answers "what should I do
          instead", so repeating it here would be the same answer twice. */}
      {sessions.length === 0 && (
        <SheetBody className="flex flex-wrap items-center gap-3 pt-0">
          <LinkButton href="#add-session" variant="secondary" size="sm">
            {t.schedule.addSession}
          </LinkButton>
        </SheetBody>
      )}

      {sessions.length > 0 && (
        <SheetBody className="p-0">
          <ul className="ruled">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-2 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  {/* Session titles carry a subject and a chapter name and are
                      often Arabic or French. They wrap. */}
                  <p className="break-words text-sm font-medium text-ink">{session.title}</p>

                  <p className="mt-0.5 text-meta text-ink-muted">
                    {session.taskType ? taskLabel[session.taskType] : t.schedule.planned}
                    {session.durationMinutes !== null && (
                      <>
                        {' · '}
                        {format(t.schedule.minutes, { count: session.durationMinutes })}
                      </>
                    )}
                    {/* Only a reason the planner actually recorded. */}
                    {session.rationale && (
                      <>
                        {' · '}
                        {session.rationale}
                      </>
                    )}
                  </p>

                  {session.status !== 'planned' && (
                    <p className="mt-0.5 text-caption text-ink-faint">
                      {session.status === 'done' ? t.schedule.done : t.schedule.skipped}
                      {session.status === 'done' && session.answersMarked !== null && (
                        <>
                          {' · '}
                          {session.answersMarked > 0
                            ? format(t.schedule.answersMarked, { count: session.answersMarked })
                            : t.schedule.noAnswersRecorded}
                        </>
                      )}
                    </p>
                  )}
                </div>

                {/* A real destination or none. The chapter is known here, so
                    the link lands on the chapter rather than the practice
                    index — the generic version made the student find again
                    what the plan had already decided. */}
                {session.status === 'planned' && (
                  <LinkButton
                    href={destinationFor(session)}
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                  >
                    {t.schedule.start}
                  </LinkButton>
                )}
              </li>
            ))}
          </ul>
        </SheetBody>
      )}
    </Sheet>
  );
}

/**
 * Where a session actually sends the student.
 *
 * Flashcards and exam drills have one destination each. A quiz or a review
 * belongs to its chapter when we know it, and only falls back to the practice
 * index when the session has no chapter — a hand-written "revise integration"
 * with nothing linked.
 */
export function destinationFor(session: {
  taskType: PlanSession['taskType'];
  chapterId: string | null;
  subjectId: string | null;
}): string {
  if (session.taskType === 'flashcards') return '/flashcards/review';
  if (session.taskType === 'exam_drill') return '/exam-sim';
  if (session.subjectId && session.chapterId) {
    return `/practice/${session.subjectId}/${session.chapterId}`;
  }
  return '/practice';
}
