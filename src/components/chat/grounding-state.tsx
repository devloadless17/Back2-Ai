'use client';

import Link from 'next/link';

import { TutorAvatar } from '@/components/chat/tutor-avatar';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

/**
 * Nour declining to answer, and what to do about it.
 *
 * A REFUSAL IS THE PRODUCT WORKING. Every other tutoring tool answers
 * everything; this one is built so a Lebanese candidate can tell which answers
 * they may put in front of a corrector. When nothing in their material supports
 * a claim, saying so IS the feature — and it was being presented in rose, the
 * examiner's pen, the colour this product uses everywhere else to mean lost
 * marks. A student reading that learns the tutor failed. They should learn that
 * it refused.
 *
 * So: neutral ground, Nour's own face, and the recovery beneath it. No alert
 * styling, no warning triangle, no red.
 *
 * TWO REFUSALS, NOT ONE, because the backend already distinguishes them and
 * they send a student to opposite places:
 *
 *   needsPassage — a comprehension question about a text nobody handed over.
 *                  The topic IS on the programme; the extract is not in front
 *                  of us. "Not covered" would be false here.
 *   offProgramme — a concept question with nothing behind it in this track's
 *                  material. The subject list is the useful context, and the
 *                  server already appends it to the message text.
 *
 * WHAT IT WILL NOT SAY. No threshold, no similarity, no "retrieval", no tier.
 * The student learns what is missing and what would fix it, in their own
 * vocabulary.
 *
 * DISTINCT FROM A TECHNICAL FAILURE, which is not this component — see
 * `TechnicalError`. Conflating them would teach a student to read a genuine
 * outage as "the tutor is being careful", which is the one misreading that
 * would actually cost them.
 */

export type RefusalKind = 'needsPassage' | 'offProgramme' | 'retracted';

export function GroundingState({
  kind,
  text,
  subjectHref,
}: {
  kind: RefusalKind;
  /** The server's own sentence, which already carries the subject list. */
  text: string;
  /** Where to pick a subject, when the conversation has not named one. */
  subjectHref?: string | null;
}) {
  const { t } = useI18n();

  return (
    <section
      className={cn(
        'rounded-2xl border border-rule bg-paper-raised px-5 py-4',
        // No tone, deliberately. See the note above.
      )}
    >
      <div className="flex gap-3.5">
        <span
          aria-hidden
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-sunken text-ink-muted"
        >
          {/*
            `attentive` rather than `idle`: it is looking at the problem, not
            waiting. There is no "sorry" mood and there should not be — the
            avatar's states are facts about the system, and nothing has gone
            wrong here.
          */}
          <TutorAvatar mood="attentive" ink="paper" size={22} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-ink">
            {kind === 'needsPassage'
              ? t.chat.refusalNeedsPassageTitle
              : kind === 'retracted'
                ? t.chat.refusalRetractedTitle
                : t.chat.refusalOffProgrammeTitle}
          </p>

          {/* The server's sentence, which for the off-programme case already
              names the student's own subjects. Not rewritten here — it is the
              one place that knows what they actually sit. */}
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{text}</p>

          <Recovery kind={kind} subjectHref={subjectHref} />
        </div>
      </div>
    </section>
  );
}

/**
 * What the student can actually do next.
 *
 * Only routes that exist. The brief is explicit that a fake action is worse
 * than none, and every entry here is either a real page or an instruction the
 * composer below can carry out.
 */
function Recovery({ kind, subjectHref }: { kind: RefusalKind; subjectHref?: string | null }) {
  const { t } = useI18n();

  const actions: { label: string; href?: string }[] = [];

  if (kind === 'needsPassage') {
    // Both are real: the composer takes a photo and a document, as of this week.
    actions.push({ label: t.chat.recoveryAttach });
  } else if (kind === 'offProgramme') {
    if (subjectHref) actions.push({ label: t.chat.recoveryPickSubject, href: subjectHref });
    actions.push({ label: t.chat.recoveryNameChapter });
  }

  if (actions.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {actions.map((action) => (
        <li key={action.label}>
          {action.href ? (
            <Link
              href={action.href}
              className="inline-flex h-8 items-center rounded-lg border border-rule px-3 text-caption font-medium text-ink transition-colors hover:border-primary hover:bg-paper-sunken"
            >
              {action.label}
            </Link>
          ) : (
            /* Not a button: there is nothing to click. It is the instruction
               that makes the composer below usable, and dressing it as a
               control would promise an action that does not exist. */
            <span className="inline-flex h-8 items-center rounded-lg bg-paper-sunken px-3 text-caption text-ink-muted">
              {action.label}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Something actually broke.
 *
 * Kept apart from `GroundingState` on purpose. A refusal is the product working
 * and an outage is the product failing; presenting them the same way teaches a
 * student to read a real failure as caution, which is the one misreading that
 * costs them. This one gets the error tone, because it IS an error, and it gets
 * a retry, because retrying is the thing that might work.
 */
export function TechnicalError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-mark/25 bg-mark-soft px-4 py-3">
      <p className="min-w-0 flex-1 text-sm text-ink">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 shrink-0 items-center rounded-lg border border-mark/30 bg-paper-raised px-3 text-caption font-medium text-ink transition-colors hover:bg-paper-sunken"
        >
          {t.common.retry}
        </button>
      )}
    </div>
  );
}
