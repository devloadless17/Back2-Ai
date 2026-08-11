import { Sidebar, type SidebarCounts, type SidebarStanding } from '@/components/shell/sidebar';
import { requireSession } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getStanding } from '@/lib/queries/standing';
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
    getStanding(user.id, user.trackId),
  ]);

  const counts: SidebarCounts = { flashcardsDue, unreadNotifications, pendingReview };
  const sidebarStanding: SidebarStanding = {
    mark: standing.overall,
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

      <main className="min-w-0 flex-1">
        {/* max-w keeps line length readable on wide monitors; the page body
            itself must never scroll horizontally. */}
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
