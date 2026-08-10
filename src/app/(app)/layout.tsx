import { PageTransition } from '@/components/shell/page-transition';
import { Sidebar, type SidebarCounts } from '@/components/shell/sidebar';
import { requireSession } from '@/lib/auth/guards';
import { db } from '@/lib/db';

/**
 * Authenticated shell.
 *
 * `requireSession` runs before anything renders, so no page under this layout
 * can leak data to a signed-out visitor even if its own guard were forgotten.
 * Individual pages still scope every query to `session.user.id`; this is the
 * outer gate, not the only one.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const { user } = session;

  const [flashcardsDue, unreadNotifications, pendingReview, track] = await Promise.all([
    db.flashcardState.count({
      where: { userId: user.id, dueDate: { lte: startOfToday() } },
    }),
    db.notification.count({ where: { userId: user.id, isRead: false } }),
    user.role === 'admin' ? db.reviewQueueItem.count({ where: { status: 'pending' } }) : Promise.resolve(0),
    user.trackId ? db.track.findUnique({ where: { id: user.trackId }, select: { code: true } }) : null,
  ]);

  const counts: SidebarCounts = { flashcardsDue, unreadNotifications, pendingReview };

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
      />

      <main className="min-w-0 flex-1">
        {/* max-w keeps line length readable on wide monitors; the page body
            itself must never scroll horizontally. */}
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
    </div>
  );
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
