import { randomBytes } from 'node:crypto';

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';

/**
 * Creates one ordinary student account for someone outside the team to try.
 *
 *   npm run account:test -- --email teacher@school.lb --track GS --language en
 *   npm run account:test -- --email teacher@school.lb --track GS --budget 2
 *
 * WHAT THIS ACCOUNT CANNOT DO, which is the point of it.
 *
 *   It is `role: student`. Every admin page calls `requireAdmin`, which
 *   redirects a student to the dashboard, and the admin API routes check the
 *   same role, so the pages are not merely hidden. It cannot see the review
 *   queue, the audit log, the ingestion controls, or anybody's account.
 *
 *   Every student-facing query is scoped by `userId`, and retrieval is scoped to
 *   the subjects of the account's own track. There is no screen on which one
 *   student can read another student's attempts, mastery, chats or uploads.
 *
 *   Its AI spending is capped by `aiBudgetMicros` — a per-account ceiling, not
 *   the plan default — so the worst case is a bounded number of dollars rather
 *   than an open tab. `--budget` sets it; the default is deliberately small.
 *
 * WHY THE EMAIL IS MARKED VERIFIED HERE RATHER THAN BY EMAIL. `emailVerifiedAt`
 * is the login gate, not a decoration, and production has no RESEND_API_KEY —
 * so an account left unverified is an account nobody can ever log into. Set
 * directly, with the address taken on trust because a person we know is handing
 * it over.
 *
 * THE PASSWORD IS GENERATED, NEVER CHOSEN. It is printed once, hashed with the
 * same scrypt the app uses, and never stored anywhere else. Nothing in this
 * script writes it to a file.
 *
 * Refuses rather than overwrites if the address already exists: re-running this
 * against a real account would lock its owner out.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Readable, and still 62 bits of entropy.
 *
 * Someone has to type this into a phone. Ambiguous glyphs are removed — no
 * O/0, l/1/I — because a password that cannot be transcribed gets replaced by
 * a worse one the moment it frustrates somebody.
 */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(24);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 6), chars.slice(6, 12), chars.slice(12, 18)]
    .map((group) => group.join(''))
    .join('-');
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const trackCode = (arg('track') ?? 'GS').toUpperCase();
  const language = arg('language') ?? 'en';
  const budgetUsd = Number(arg('budget') ?? '2');
  const displayName = arg('name') ?? null;

  if (!email || !email.includes('@')) {
    console.error('  --email is required, and must be an address.');
    process.exit(1);
  }
  if (!['fr', 'en', 'ar'].includes(language)) {
    console.error(`  --language must be fr, en or ar. Got "${language}".`);
    process.exit(1);
  }
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    console.error('  --budget must be a positive number of dollars.');
    process.exit(1);
  }

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.error(`  ${email} already exists. Refusing to overwrite it.`);
    process.exit(1);
  }

  const track = await db.track.findFirst({ where: { code: trackCode }, select: { id: true, name: true } });
  if (!track) {
    const all = await db.track.findMany({ select: { code: true } });
    console.error(`  No track "${trackCode}". Available: ${all.map((t) => t.code).join(', ')}`);
    process.exit(1);
  }

  const password = generatePassword();
  const user = await db.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: 'student',
      trackId: track.id,
      preferredLanguage: language as 'fr' | 'en' | 'ar',
      country: 'LB',
      displayName,
      // The login gate. See the note above on why it is set here.
      emailVerifiedAt: new Date(),
      // A tester should not be emailed by a revision planner they are not using.
      emailReminders: false,
      pushReminders: false,
      subscription: {
        create: {
          plan: 'free',
          status: 'active',
          aiBudgetMicros: BigInt(Math.round(budgetUsd * 1_000_000)),
        },
      },
    },
    select: { id: true },
  });

  console.log('');
  console.log('  Account created. The password is shown once and is not stored anywhere.');
  console.log('');
  console.log(`    email     ${email}`);
  console.log(`    password  ${password}`);
  console.log('');
  console.log(`    track     ${trackCode} — ${track.name}`);
  console.log(`    language  ${language}`);
  console.log(`    role      student (no admin access)`);
  console.log(`    AI cap    $${budgetUsd.toFixed(2)} for this account alone`);
  console.log(`    id        ${user.id}`);
  console.log('');
  console.log('  To revoke it later, set is_active = false on that id, or delete the row —');
  console.log('  every attempt, chat and upload it made cascades away with it.');
  console.log('');

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
