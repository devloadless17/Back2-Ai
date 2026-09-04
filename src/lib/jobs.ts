import 'server-only';

import { purgeExpiredSessions } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { autoSubmitExpired, markSubmitted } from '@/lib/exam';
import { recalibrateDifficulty } from '@/lib/ingestion';
import { startOfToday } from '@/lib/queries/flashcards';
import { getProgressForUser } from '@/lib/queries/progress';
import { appLink, sendEmail } from '@/lib/email';

/**
 * Scheduled maintenance, as plain functions.
 *
 * Kept out of the route handler so they can be driven two ways: by a platform
 * scheduler hitting `/api/cron`, or by `npm run cron` from OS cron or Task
 * Scheduler. The second matters — a deployment that requires the web tier to be
 * reachable in order to mark abandoned exam papers has put a student's marks
 * behind a health check.
 */

export type JobName = 'auto_submit' | 'mark' | 'readiness' | 'notify' | 'difficulty' | 'sessions';

export const JOB_NAMES: JobName[] = [
  'auto_submit',
  'mark',
  'readiness',
  'notify',
  'difficulty',
  'sessions',
];

/**
 * Writes the readiness snapshot.
 *
 * The pages compute readiness live; this table is the history that makes
 * "your readiness has been climbing for three weeks" answerable later.
 */
export async function refreshReadinessCache(): Promise<number> {
  const users = await db.user.findMany({
    where: { isActive: true, trackId: { not: null } },
    select: { id: true, trackId: true, preferredLanguage: true },
  });

  let rows = 0;

  for (const user of users) {
    const progress = await getProgressForUser(user.id, user.trackId, user.preferredLanguage);

    for (const subject of progress) {
      if (!subject.readiness.reportable) continue;

      await db.readinessScore.upsert({
        where: { userId_subjectId: { userId: user.id, subjectId: subject.subjectId } },
        create: {
          userId: user.id,
          subjectId: subject.subjectId,
          score: subject.readiness.score,
          masteryComponent: subject.readiness.masteryComponent,
          coverageComponent: subject.readiness.coverageComponent,
          trendComponent: subject.readiness.trendComponent,
        },
        update: {
          score: subject.readiness.score,
          masteryComponent: subject.readiness.masteryComponent,
          coverageComponent: subject.readiness.coverageComponent,
          trendComponent: subject.readiness.trendComponent,
          computedAt: new Date(),
        },
      });
      rows += 1;
    }
  }

  return rows;
}

/**
 * Delivers one reminder outside the app, if the student asked for it.
 *
 * The in-app notification is always written; this is the part that reaches
 * someone who is not looking at the site, which is the whole point of a
 * reminder. A student who has not opened the app in three days is exactly the
 * one it is for.
 *
 * Never sent to an unconfirmed address. Nobody has proved they read that
 * mailbox, and a nightly message to a mistyped one is both useless and the
 * quickest way to have the sending domain treated as a spammer.
 *
 * Never throws. This runs inside a loop over every user with something due, and
 * one undeliverable reminder must not stop the forty behind it.
 */
async function deliver(userId: string, subject: string, body: string, href: string) {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true, emailReminders: true, isActive: true },
    });
    if (!user?.isActive || !user.emailReminders || !user.emailVerifiedAt) return;

    await sendEmail({
      to: user.email,
      subject,
      text: [body, '', appLink(href), '', 'You can turn these off in your settings.'].join('\n'),
    });
  } catch {
    // A reminder is not worth failing a nightly run over.
  }
}

/**
 * Due-card and session reminders.
 *
 * One notification per user per day per kind — a student who opens the app
 * twice should not find six reminders about the same twelve cards. That guard
 * covers the email too, since delivery happens beside the row that records it.
 */
export async function sendReminders(): Promise<number> {
  const today = startOfToday();
  let created = 0;

  const dueCounts = await db.flashcardState.groupBy({
    by: ['userId'],
    where: { dueDate: { lte: today } },
    _count: { questionId: true },
  });

  for (const row of dueCounts) {
    const already = await db.notification.findFirst({
      where: { userId: row.userId, type: 'flashcards_due', createdAt: { gte: today } },
      select: { id: true },
    });
    if (already) continue;

    const message = `${row._count.questionId} flashcard(s) are due today.`;
    await db.notification.create({
      data: {
        userId: row.userId,
        type: 'flashcards_due',
        message,
        href: '/flashcards/review',
      },
    });
    await deliver(row.userId, 'Your flashcards are due', message, '/flashcards/review');
    created += 1;
  }

  const sessions = await db.studySession.findMany({
    where: { scheduledDate: today, status: 'planned' },
    select: { userId: true, title: true },
  });

  const byUser = new Map<string, string[]>();
  for (const session of sessions) {
    const list = byUser.get(session.userId) ?? [];
    list.push(session.title);
    byUser.set(session.userId, list);
  }

  for (const [userId, titles] of byUser) {
    const already = await db.notification.findFirst({
      where: { userId, type: 'schedule_reminder', createdAt: { gte: today } },
      select: { id: true },
    });
    if (already) continue;

    const message =
      titles.length === 1
        ? `Today's session: ${titles[0]}`
        : `You have ${titles.length} study sessions planned today.`;
    await db.notification.create({
      data: { userId, type: 'schedule_reminder', message, href: '/schedule' },
    });
    await deliver(userId, 'Your study plan for today', message, '/schedule');
    created += 1;
  }

  return created;
}

/**
 * Runs one job, or all of them.
 *
 * Each job is isolated: one failing must not stop the rest, because the one
 * most likely to fail (readiness, which walks every user) is also the least
 * urgent, and the most urgent (auto-submitting abandoned papers) must run.
 */
export async function runJobs(job: JobName | 'all'): Promise<Record<string, number | string>> {
  const results: Record<string, number | string> = {};

  const steps: [JobName, string, () => Promise<number>][] = [
    ['auto_submit', 'autoSubmitted', () => autoSubmitExpired()],
    /*
     * Marking. Runs often and takes a small bite each time.
     *
     * `auto_submit` must come first in an `all` run: it closes expired papers,
     * and this then marks them on the same pass rather than leaving a student
     * whose clock ran out waiting for the next tick.
     *
     * The batch is deliberately small. Each paper is several model calls, and a
     * cron tick that tried to clear a whole exam-season backlog at once would
     * hit the same provider limits that made marking-in-request untenable.
     */
    ['mark', 'papersMarked', () => markSubmitted()],
    ['readiness', 'readinessRows', () => refreshReadinessCache()],
    ['notify', 'notifications', () => sendReminders()],
    ['difficulty', 'difficultyUpdated', () => recalibrateDifficulty()],
    ['sessions', 'sessionsPurged', () => purgeExpiredSessions()],
  ];

  for (const [name, key, run] of steps) {
    if (job !== 'all' && job !== name) continue;

    try {
      results[key] = await run();
    } catch (err) {
      console.error(`[cron] job "${name}" failed`, err);
      results[key] = `failed: ${err instanceof Error ? err.message : 'unknown'}`;
    }
  }

  return results;
}
