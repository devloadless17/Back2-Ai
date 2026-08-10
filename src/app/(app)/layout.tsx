import { PageTransition } from '@/components/shell/page-transition';
import { Sidebar, type SidebarCounts } from '@/components/shell/sidebar';
import { AmbientBalloons, CelebrationLayer } from '@/components/ui/balloons';
import { ToastProvider } from '@/components/ui/toast';
import { requireSession } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { getProgressSnapshot } from '@/lib/queries/gamification';

/**
 * Authenticated shell.
 *
 * `requireSession` runs before anything renders, so no page under this layout
 * can leak data to a signed-out visitor even if its own guard were forgotten.
 * Individual pages still scope every query to `session.user.id`; this is the
 * outer gate, not the only one.
 *
 * Three things live here because they must exist on every page and exactly
 * once: the toast provider (progress feedback fires from a dozen surfaces), the
 * ambient balloons (behind everything, pointer-events-none), and the
 * celebration layer that listens for level-ups. None of the three is inside the
 * exam route group — that shell is deliberately still.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const { user } = session;

  const [flashcardsDue, unreadNotifications, pendingReview, track, progress] = await Promise.all([
    db.flashcardState.count({
      where: { userId: user.id, dueDate: { lte: startOfToday() } },
    }),
    db.notification.count({ where: { userId: user.id, isRead: false } }),
    user.role === 'admin' ? db.reviewQueueItem.count({ where: { status: 'pending' } }) : Promise.resolve(0),
    user.trackId ? db.track.findUnique({ where: { id: user.trackId }, select: { code: true } }) : null,
    getProgressSnapshot(user.id),
  ]);

  const counts: SidebarCounts = { flashcardsDue, unreadNotifications, pendingReview };

  return (
    <ToastProvider>
      <AmbientBalloons />
      <CelebrationLayer />

      <div className="flex min-h-dvh flex-col lg:flex-row">
        <Sidebar
          user={{
            displayName: user.displayName,
            email: user.email,
            role: user.role,
            trackCode: track?.code ?? null,
          }}
          counts={counts}
          level={{
            level: progress.levelState.level,
            progress: progress.levelState.progress,
            streak: progress.streak,
            goalProgress: progress.goal.progress,
          }}
        />

        <main className="min-w-0 flex-1">
          {/* max-w keeps line length readable on wide monitors; the page body
              itself must never scroll horizontally. */}
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
