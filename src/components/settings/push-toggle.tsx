'use client';

import { useEffect, useState } from 'react';

import { Alert } from '@/components/ui/feedback';
import { useI18n } from '@/lib/i18n/client';

/**
 * Turning lock-screen reminders on for this device.
 *
 * Per-device, not per-account, and the label says so. A student with a phone
 * and a school laptop has to enable it on each, because the subscription lives
 * in the browser — presenting one account-wide switch would leave them
 * wondering why the phone stayed quiet.
 *
 * Permission is only requested when the switch is turned on. Asking on page
 * load is how sites get permanently blocked by browsers that remember a
 * dismissed prompt, and a student who has not asked for notifications has not
 * agreed to be interrupted.
 *
 * A denied permission is a dead end this cannot undo — the browser will not ask
 * again from script — so it says to change it in browser settings rather than
 * leaving a switch that silently refuses to move.
 */
type State = 'checking' | 'unsupported' | 'denied' | 'off' | 'on';

export function PushToggle({ publicKey }: { publicKey: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<State>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function look() {
      if (
        !publicKey ||
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        if (!cancelled) setState('unsupported');
        return;
      }

      if (Notification.permission === 'denied') {
        if (!cancelled) setState('denied');
        return;
      }

      try {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        const existing = await registration?.pushManager.getSubscription();
        if (!cancelled) setState(existing ? 'on' : 'off');
      } catch {
        if (!cancelled) setState('off');
      }
    }

    void look();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  async function enable() {
    setBusy(true);
    setError(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      // `register` resolves before the worker is usable on a first install.
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        // Required by every browser: a push that cannot be shown is not allowed
        // to be sent silently.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(publicKey),
      });

      const raw = subscription.toJSON();
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          p256dh: raw.keys?.p256dh ?? '',
          auth: raw.keys?.auth ?? '',
        }),
      });
      if (!response.ok) throw new Error('subscribe failed');

      setState('on');
    } catch {
      setError(t.common.unknownError);
      setState('off');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js');
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        /*
         * Tell the server before unsubscribing in the browser.
         *
         * The endpoint is the only thing that identifies the row, and
         * `unsubscribe()` destroys it — doing that first would leave a row
         * nothing can delete, still receiving pushes the browser now discards.
         */
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      setState('off');
    } catch {
      setError(t.common.unknownError);
    } finally {
      setBusy(false);
    }
  }

  if (state === 'checking') return null;

  if (state === 'unsupported') {
    return <p className="text-caption text-ink-muted">{t.settings.pushUnsupported}</p>;
  }

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={state === 'on'}
          disabled={busy || state === 'denied'}
          onChange={(event) => void (event.target.checked ? enable() : disable())}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-rule-strong text-primary disabled:opacity-50"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">{t.settings.pushReminders}</span>
          <span className="block text-caption text-ink-muted">{t.settings.pushRemindersHint}</span>
        </span>
      </label>

      {state === 'denied' && <Alert tone="warning">{t.settings.pushBlocked}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/**
 * The VAPID key, as `subscribe` wants it.
 *
 * `applicationServerKey` takes raw bytes; the key is distributed as base64url,
 * which is not what `atob` reads. Padding is restored and the two substituted
 * characters put back before decoding.
 *
 * Returns the buffer rather than the view: `applicationServerKey` is typed as
 * BufferSource, and a Uint8Array is only assignable to it when TypeScript can
 * see it is not backed by a SharedArrayBuffer.
 */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const raw = window.atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return buffer;
}
