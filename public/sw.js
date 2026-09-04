/*
 * The service worker, which exists only to show notifications.
 *
 * Deliberately does not cache anything. An offline cache for a study app that
 * reads a student's live mastery would serve yesterday's readiness and
 * yesterday's due cards, and a stale answer about what to revise is worse than
 * no answer. If offline support is wanted later it belongs in its own worker
 * with its own thought about staleness, not bolted on here.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // A push we cannot read is not worth a blank notification on someone's
    // lock screen.
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Bac II', {
      body: payload.body || '',
      // Same tag for every reminder, so a student who was away for a week finds
      // one notification rather than seven stacked on the lock screen.
      tag: 'bac2-reminder',
      renotify: true,
      data: { href: payload.href || '/dashboard' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || '/dashboard';
  const target = new URL(href, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Reuse a tab that is already open. Opening a second copy of the app
      // loses whatever the student had on screen.
      for (const client of windows) {
        if (client.url === target && 'focus' in client) return client.focus();
      }
      for (const client of windows) {
        if ('navigate' in client) return client.focus().then(() => client.navigate(target));
      }
      return self.clients.openWindow(target);
    }),
  );
});
