import { randomBytes } from 'node:crypto';

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';

/**
 * Replaces a seeded password with one that was never in the repository.
 *
 *   npm run rotate:admin -- --email admin@bac2.local
 *
 * `prisma/seed.ts` sets every seeded account to the same literal, and that
 * literal is in git — in the seed file, and it was in README.md and
 * LAUNCH-PLAN.md until those were untracked. Removing a file from the tree does
 * not remove it from history, so the only thing that actually closes this is a
 * new password.
 *
 * It matters more now than it did: there is a real account on this database for
 * someone outside the team, so "only we can reach it" stopped being true.
 *
 * SESSIONS ARE REVOKED TOO. A rotated password with a live session cookie still
 * signed in is a rotation that changed nothing for whoever already had access.
 *
 * The new password is printed once and stored nowhere. Same generator as
 * `create-test-account.ts`, with the ambiguous glyphs left out because somebody
 * has to type it.
 */

const APPLY = process.argv.includes('--apply');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(24);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 6), chars.slice(6, 12), chars.slice(12, 18)]
    .map((group) => group.join(''))
    .join('-');
}

async function main() {
  const email = (arg('email') ?? 'admin@bac2.local').trim().toLowerCase();

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, role: true, email: true },
  });
  if (!user) {
    console.error(`  No account for ${email}.`);
    process.exit(1);
  }

  const sessions = await db.session.count({ where: { userId: user.id } });

  console.log('');
  console.log(`    account   ${user.email}  (${user.role})`);
  console.log(`    sessions  ${sessions} live, all of which will be revoked`);

  if (!APPLY) {
    console.log('\n  Nothing changed. Re-run with --apply.\n');
    await db.$disconnect();
    return;
  }

  const password = generatePassword();
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  });
  await db.session.deleteMany({ where: { userId: user.id } });

  console.log('');
  console.log('  Rotated. This is shown once and stored nowhere.');
  console.log('');
  console.log(`    email     ${user.email}`);
  console.log(`    password  ${password}`);
  console.log('');
  console.log('  prisma/seed.ts still contains the old literal. A re-seed against');
  console.log('  a database that already has this account will not overwrite it,');
  console.log('  but the literal remains the default for any NEW seeded account.');
  console.log('');

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
