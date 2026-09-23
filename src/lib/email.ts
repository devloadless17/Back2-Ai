import 'server-only';

import { env } from '@/lib/env';

/**
 * Sending mail.
 *
 * One function, three backends, and the fallback is the interesting half.
 *
 * With `SMTP_HOST` set, mail goes out over SMTP; failing that, `RESEND_API_KEY`
 * sends through Resend. With neither, the message is written to the server log
 * and reported as sent. That is deliberate: every flow built on top of this —
 * confirming an address, resetting a password, the nightly reminder — has to
 * work end to end on a laptop with no mail account, or nobody can develop
 * against it and the first time it runs for real is in production. The logged
 * form carries the link, so a developer can follow it.
 *
 * SMTP comes first because it is the one a deployment is most likely to have
 * deliberately configured: a Resend key left in the environment from an earlier
 * host should not quietly outrank the mail account someone just set up.
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
  const e = env();
  return e.SMTP_HOST.length > 0 || e.RESEND_API_KEY.length > 0;
}

/*
 * One transport, reused.
 *
 * Nodemailer keeps a connection pool behind a transport, so building a fresh
 * one per message means a fresh TCP connect, TLS handshake and AUTH for every
 * reminder in a nightly run of forty. Built on first use rather than at import
 * so that a deployment with no SMTP configured never constructs one, and so
 * this module stays importable when `env()` would throw.
 */
let transport: import('nodemailer').Transporter | null = null;

async function smtpTransport() {
  if (transport) return transport;
  const e = env();
  const nodemailer = await import('nodemailer');

  transport = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    // 465 is wrapped in TLS from the first byte; 587 and friends open in the
    // clear and upgrade, which `requireTLS` makes non-optional rather than
    // best-effort — an SMTP key must never cross the wire unencrypted.
    secure: e.SMTP_PORT === 465,
    requireTLS: e.SMTP_PORT !== 465,
    auth: { user: e.SMTP_USER, pass: e.SMTP_PASSWORD },
  });
  return transport;
}

async function sendViaSmtp(mail: Mail, from: string): Promise<boolean> {
  try {
    const sender = await smtpTransport();
    await sender.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
    return true;
  } catch (error) {
    /*
     * The transport is dropped on failure. A pooled connection that has gone
     * bad — the relay restarted, the key was revoked — stays bad for every
     * later send if it is kept, and rebuilding one is cheap next to never
     * delivering again until the process restarts.
     */
    transport = null;
    console.error('[email] smtp send failed', error);
    return false;
  }
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

  if (e.SMTP_HOST.length > 0) return sendViaSmtp(mail, e.EMAIL_FROM);

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
