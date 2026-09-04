import 'server-only';

import { env } from '@/lib/env';

/**
 * Sending mail.
 *
 * One function, two backends, and the fallback is the interesting half.
 *
 * With `RESEND_API_KEY` set, mail goes to Resend. Without it, the message is
 * written to the server log and reported as sent. That is deliberate: every
 * flow built on top of this — confirming an address, resetting a password, the
 * nightly reminder — has to work end to end on a laptop with no mail account,
 * or nobody can develop against it and the first time it runs for real is in
 * production. The logged form carries the link, so a developer can follow it.
 *
 * It never throws. A reminder that cannot be delivered must not fail the cron
 * run that generated forty others, and a signup must not fail because the
 * confirmation could not be sent — the account exists and the address can be
 * confirmed later. Callers get `false` and decide; none of them treat it as
 * fatal, which is why the return value is a boolean rather than an exception.
 */
export type Mail = {
  to: string;
  subject: string;
  /** Plain text. Every message here is short enough not to need HTML. */
  text: string;
};

export function isEmailConfigured(): boolean {
  return env().RESEND_API_KEY.length > 0;
}

export async function sendEmail(mail: Mail): Promise<boolean> {
  const e = env();

  if (!isEmailConfigured()) {
    /*
     * The whole message, not a summary. A confirmation link that is truncated
     * in the log is a flow that cannot be tested without a mail account, which
     * is the situation this branch exists to avoid.
     */
    console.info(
      `[email] not configured; would have sent to ${mail.to}\n` +
        `  subject: ${mail.subject}\n` +
        mail.text.replace(/^/gm, '  '),
    );
    return true;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${e.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: e.EMAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
      }),
    });

    if (!response.ok) {
      // The body carries Resend's reason — an unverified sending domain, most
      // often — and without it the log says only that mail is not arriving.
      console.error(`[email] resend ${response.status}: ${await response.text()}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[email] send failed', error);
    return false;
  }
}

/**
 * Links are absolute and built from APP_URL.
 *
 * A relative link in an email goes nowhere: there is no page it is relative to.
 * APP_URL is the one place that knows where this deployment lives.
 */
export function appLink(path: string): string {
  return new URL(path, env().APP_URL).toString();
}
