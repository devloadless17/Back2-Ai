import { env } from '@/lib/env';
import { isEmailConfigured, sendEmail } from '@/lib/email';

/**
 * Sends one real message, to prove the mail path works before a student needs it.
 *
 *   npm run email:test -- --to you@example.com
 *
 * WHY THIS EXISTS. `sendEmail` never throws and returns false instead, because
 * a signup must not 500 when the relay is down. The cost of that choice is that
 * a misconfigured mailer is invisible: signup succeeds, the confirmation goes
 * nowhere, and the first report is a student who cannot log in. This is the one
 * place that reads the boolean and says so.
 *
 * It goes through `sendEmail` rather than opening its own connection, so what
 * it proves is the path the app actually uses — the same backend selection, the
 * same from-address, the same transport. A test that built its own SMTP client
 * could pass while every real message failed.
 *
 * WHEN IT REPORTS A FAILURE, the reason is on the line above it, logged by the
 * mailer itself. The ones worth recognising:
 *
 *   535 authentication failed   SMTP_USER is not the relay login, or the key is
 *                               wrong. The login is NOT your from-address; for
 *                               Brevo it looks like xxxxxxxxx@smtp-brevo.com.
 *   550 sender not verified     EMAIL_FROM is an address the provider has not
 *                               verified. Verify the sender, or its domain.
 *   ETIMEDOUT / ECONNREFUSED    Nothing is listening on SMTP_PORT, or outbound
 *                               25/465/587 is blocked from this host.
 *
 * A pass here means the relay accepted the message, which is not the same as it
 * reaching an inbox. Check the provider's log for the delivery itself.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = arg('to');
  if (!to) {
    console.error('Usage: npm run email:test -- --to you@example.com');
    process.exit(1);
  }

  const e = env();
  const backend =
    e.SMTP_HOST.length > 0
      ? `smtp (${e.SMTP_HOST}:${e.SMTP_PORT})`
      : e.RESEND_API_KEY.length > 0
        ? 'resend'
        : 'none — messages are only logged';

  console.log('');
  console.log(`  backend:  ${backend}`);
  console.log(`  from:     ${e.EMAIL_FROM}`);
  console.log(`  to:       ${to}`);
  console.log(`  app url:  ${e.APP_URL}`);
  console.log('');

  if (!isEmailConfigured()) {
    /*
     * Not an error. This is the documented local default, and saying so plainly
     * is more useful than a send that "succeeds" and leaves someone waiting for
     * a message that was only ever written to this terminal.
     */
    console.log('  Mail is not configured, so nothing will be delivered — the message');
    console.log('  below is what would have been sent. Set SMTP_HOST (or RESEND_API_KEY)');
    console.log('  in .env to send for real.');
    console.log('');
  }

  const sent = await sendEmail({
    to,
    subject: 'Bac II test message',
    text: [
      'This is a test message from the Bac II mailer.',
      '',
      `Backend: ${backend}`,
      `Sent at: ${new Date().toISOString()}`,
      '',
      'If you are reading this in an inbox, registration and password-reset',
      'mail will arrive the same way.',
    ].join('\n'),
  });

  if (sent && isEmailConfigured()) {
    console.log('  ACCEPTED by the provider. Check the inbox, then the provider log.');
    console.log('');
    return;
  }

  if (!sent) {
    console.error('  FAILED. The reason is logged above this block.');
    console.error('');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
