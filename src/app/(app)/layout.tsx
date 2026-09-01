import { TutorDock } from '@/components/chat/tutor-dock';
import { Sidebar, type SidebarCounts, type SidebarStanding } from '@/components/shell/sidebar';
import { requireSession } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getSidebarStanding } from '@/lib/queries/standing';
import { markOutOf20 } from '@/lib/standing';

/**
 * Authenticated shell.
 *
 * `requireSession` runs before anything renders, so no page under this layout
 * can leak data to a signed-out visitor even if its own guard were forgotten.
 * Individual pages still scope every query to `session.user.id`; this is the
 * outer gate, not the only one.
 *
 * The sidebar carries the two figures a candidate checks constantly — the
 * predicted mark out of 20, and how many days are left — so they are on every
 * screen without anyone having to navigate to them.
 *
 * Those two come from the nightly readiness snapshot rather than from a live
 * `getStanding`. This layout renders on every page in the app, and recomputing
 * the whole progress picture — every chapter in the track plus 120 days of
 * attempts — to print two numbers was the largest avoidable cost on the read
 * path. See `getSidebarStanding`.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const { user } = session;

  const [flashcardsDue, unreadNotifications, pendingReview, track, standing] = await Promise.all([
    db.flashcardState.count({
      where: { userId: user.id, dueDate: { lte: startOfToday() } },
    }),
    db.notification.count({ where: { userId: user.id, isRead: false } }),
    user.role === 'admin' ? db.reviewQueueItem.count({ where: { status: 'pending' } }) : Promise.resolve(0),
    user.trackId ? db.track.findUnique({ where: { id: user.trackId }, select: { code: true } }) : null,
    getSidebarStanding(user.id, user.trackId, user.preferredLanguage),
  ]);

  const counts: SidebarCounts = { flashcardsDue, unreadNotifications, pendingReview };
  const sidebarStanding: SidebarStanding = {
    mark: standing.mark,
    scale: markOutOf20(1),
    daysToExam: standing.daysToExam,
  };

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar
        user={{
          displayName: user.displayName,
          email: user.email,
          role: user.role,
          trackCode: track?.code ?? null,
        }}
        counts={counts}
        standing={sidebarStanding}
      />

      {/*
        The tutor, on every page under this layout.

        It used to be mounted per page, on four of them, with a comment arguing
        that a dock in the layout would have to know which route it was on and
        hide itself inside an exam. That argument was wrong about this codebase:
        the exam runner lives in the `(exam)` route group, which has its own
        layout and never renders this one. So the exclusion is structural rather
        than a condition someone has to remember — a paper under a running clock
        cannot acquire an assistant by accident, whatever is added here later.

        What is lost is the per-page anchor: the dashboard used to open the
        tutor already pointed at the student's weakest chapter. Following them
        everywhere is worth more than that, and the anchored path still exists
        where it matters most — beside a marked answer, and on a past paper.
      */}
      <TutorDock
        tutorName={user.tutorName}
        firstName={user.displayName?.split(' ')[0] ?? null}
      />

      <main className="min-w-0 flex-1">
        {/* No centred column. Reading measure is held where it belongs — by
            `.prose-exam` at 68ch on the pages that are prose — so capping the
            whole shell only ever produced dead margin either side of grids and
            tables that would happily have used the room. The page fills the
            window; padding steps down to the phone rather than up from it. */}
        <div className="w-full px-3 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
