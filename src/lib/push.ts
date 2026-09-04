import 'server-only';

import webpush from 'web-push';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

/**
 * Web push, for a phone that is not currently on the site.
 *
 * The counterpart to the reminder email: a student revising on a phone gets a
 * notification on the lock screen instead of a message they will read tomorrow.
 * Browsers only. No Apple push certificate is involved — on iOS this works
 * through Safari once the site is added to the home screen, and where it does
 * not work nothing breaks, because email is still sent.
 *
 * Silently disabled when no VAPID key pair is configured, rather than throwing.
 * A deployment without keys should send email and skip push, not fail its
 * nightly run; `isPushConfigured` is what callers check when they want to know
 * why nothing arrived.
 */
export function isPushConfigured(): boolean {
  const e = env();
  return e.VAPID_PUBLIC_KEY.length > 0 && e.VAPID_PRIVATE_KEY.length > 0;
}

export type PushMessage = {
  title: string;
  body: string;
  href: string;
};

/**
 * Sends one message to every device a student has registered.
 *
 * Returns how many actually went out, which is not the same as how many were
 * tried: a student with a laptop and a phone has two subscriptions, and one of
 * them may have been revoked since.
 *
 * A 404 or 410 from the push service means the browser threw the subscription
 * away — the user cleared site data, uninstalled the PWA, or revoked
 * permission. Those rows are deleted rather than retried, because they can
 * never succeed again and a table of dead endpoints slows every later send.
 * Any other failure is left alone; a push service having a bad afternoon is not
 * a reason to make a student re-enable notifications.
 */
export async function sendPush(userId: string, message: PushMessage): Promise<number> {
  if (!isPushConfigured()) return 0;

  const e = env();
  webpush.setVapidDetails(e.VAPID_SUBJECT, e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY);

  const subscriptions = await db.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  const payload = JSON.stringify(message);
  let delivered = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
      );
      delivered += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => {
          // Already gone. Two nightly runs can race on the same dead endpoint.
        });
      }
    }
  }

  return delivered;
}
