/**
 * Give a stranded student their syllabus back.
 *
 *   npm run repair:study-language -- --to en            report only, writes nothing
 *   npm run repair:study-language -- --to en --apply    writes
 *   npm run repair:study-language -- --to fr --apply --email someone@example.com
 *
 * ---------------------------------------------------------------------------
 * `users.preferred_language` is not a display preference. It is the language a
 * candidate sits their sciences in, it is locked at signup, and
 * `subjectLanguagesFor` reads it to decide which subjects exist for that
 * student at all. Set to 'ar' it returns `['ar']`, so the account is shown the
 * Arabic humanities and nothing else — no mathematics, physics, chemistry,
 * biology or foreign language. Signup stopped offering 'ar' in acf3fe0; this
 * repairs the accounts that were made before it, which that commit did not.
 *
 * It only ever moves 'ar' to a real study language. It will not move a student
 * from 'en' to 'fr' or back: that is a claim about which school they attend,
 * nobody here knows it, and getting it wrong swaps their whole science corpus.
 *
 * The interface language is untouched — it is a cookie, not this column — so a
 * student repaired to 'en' still reads Arabic menus if that is what they chose.
 * ---------------------------------------------------------------------------
 */
import { PrismaClient } from '@prisma/client';

import { AuditAction } from '../src/lib/audit';
import { STUDY_LANGUAGES, type StudyLanguage } from '../src/lib/i18n/config';

const db = new PrismaClient();

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const to = arg('--to');
  const email = arg('--email');

  if (!to || !(STUDY_LANGUAGES as readonly string[]).includes(to)) {
    console.error(`  --to must be one of: ${STUDY_LANGUAGES.join(', ')}`);
    console.error('  It is the language the student sits their sciences in. Ask before guessing.');
    await db.$disconnect();
    process.exit(1);
  }

  const stranded = await db.user.findMany({
    where: {
      preferredLanguage: 'ar',
      ...(email ? { email } : {}),
    },
    select: {
      id: true,
      email: true,
      track: { select: { code: true, _count: { select: { subjects: true } } } },
    },
    orderBy: { email: 'asc' },
  });

  console.log('');
  if (stranded.length === 0) {
    console.log(`  No account on .ar${email ? ` matching ${email}` : ''}. Nothing to repair.`);
    console.log('');
    await db.$disconnect();
    return;
  }

  console.log(`  ${stranded.length} account(s) on .ar, to be moved to .${to}:`);
  for (const user of stranded) {
    console.log(
      `    ${user.email.padEnd(28)} ${user.track?.code ?? '(no track)'}` +
        `  ${user.track?._count.subjects ?? 0} subjects on that track`,
    );
  }
  console.log('');

  if (!apply) {
    console.log('  DRY RUN — nothing was written. Re-run with --apply.');
    console.log('');
    await db.$disconnect();
    return;
  }

  /*
   * One audit row per student, not one for the batch. The product already
   * treats a change to this field as an event worth recording — the admin
   * editor writes `user.language.changed` — and a repair run by a script is
   * exactly the case someone will later want to find.
   */
  for (const user of stranded) {
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { preferredLanguage: to as StudyLanguage } }),
      db.auditEvent.create({
        data: {
          action: AuditAction.USER_LANGUAGE_CHANGED,
          targetType: 'user',
          targetId: user.id,
          // No actor: this was not an admin at a keyboard, and saying so is the
          // point of the row.
          metadata: { from: 'ar', to, by: 'scripts/repair-study-language.ts' },
        },
      }),
    ]);
  }

  console.log(`  repaired: ${stranded.length} account(s) now on .${to}.`);
  console.log(`  Each one's subject list grows from the Arabic humanities to the full track.`);
  console.log('');
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
