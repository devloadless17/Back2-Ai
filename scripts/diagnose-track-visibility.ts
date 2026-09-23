/**
 * Why a student sees only part of their syllabus.
 *
 *   npm run diagnose:visibility           this database, writes nothing
 *
 * ---------------------------------------------------------------------------
 * "Only the Arabic subjects appear in LH" has exactly two possible causes, and
 * they need different repairs, so this script reports both rather than guessing.
 *
 *   1. THE ACCOUNT. `subjectLanguagesFor('ar')` returns `['ar']` — by design,
 *      pinned by a test — because there is no all-Arabic Baccalaureate. A user
 *      whose `preferred_language` is 'ar' is therefore shown the Arabic
 *      humanities and no mathematics, physics, chemistry, biology or foreign
 *      language at all. Signup stopped offering that choice in acf3fe0, but
 *      that commit repaired nobody: it checked both databases, found none, and
 *      said so. An account made before it, or seeded, is still stranded, and
 *      the field is locked so nothing downstream will ever correct it.
 *
 *   2. THE CORPUS. If a track simply has no English or French subject rows,
 *      every account on it sees Arabic only and the account is innocent.
 *
 * Read-only on purpose. It is meant to be safe to point at production, which is
 * the database the question is usually being asked about.
 * ---------------------------------------------------------------------------
 */
import { PrismaClient } from '@prisma/client';

import { STUDY_LANGUAGES } from '../src/lib/i18n/config';

const db = new PrismaClient();

const isStudy = (language: string) => (STUDY_LANGUAGES as readonly string[]).includes(language);

/** What `subjectLanguagesFor` in src/lib/queries/taxonomy.ts does, kept in step. */
const languagesFor = (language: string) => (language === 'ar' ? ['ar'] : [language, 'ar']);

async function main() {
  const tracks = await db.track.findMany({
    select: {
      code: true,
      name: true,
      subjects: { select: { name: true, language: true }, orderBy: { name: 'asc' } },
      users: { select: { email: true, preferredLanguage: true }, orderBy: { email: 'asc' } },
    },
    orderBy: { code: 'asc' },
  });

  console.log('');
  console.log('  CORPUS — subject rows per track, by language');
  console.log('');

  for (const track of tracks) {
    const byLanguage = new Map<string, string[]>();
    for (const subject of track.subjects) {
      byLanguage.set(subject.language, [...(byLanguage.get(subject.language) ?? []), subject.name]);
    }

    console.log(`    ${track.code}  ${track.name}`);
    for (const language of ['en', 'fr', 'ar']) {
      const names = byLanguage.get(language) ?? [];
      const flag = names.length === 0 && isStudy(language) ? '   <- NONE' : '';
      console.log(`      .${language}  ${String(names.length).padStart(2)}  ${names.join(', ')}${flag}`);
    }
    console.log('');
  }

  console.log('  ACCOUNTS — what each student is actually shown');
  console.log('');

  const stranded: { email: string; track: string }[] = [];

  for (const track of tracks) {
    if (track.users.length === 0) continue;
    console.log(`    ${track.code}`);
    for (const user of track.users) {
      const shown = languagesFor(user.preferredLanguage);
      const count = track.subjects.filter((s) => shown.includes(s.language)).length;
      const strandedHere = !isStudy(user.preferredLanguage);
      if (strandedHere) stranded.push({ email: user.email, track: track.code });
      console.log(
        `      ${user.email.padEnd(28)} .${user.preferredLanguage}` +
          `  sees ${String(count).padStart(2)}/${track.subjects.length} subjects` +
          `${strandedHere ? '   <- STRANDED, not a study language' : ''}`,
      );
    }
    console.log('');
  }

  if (stranded.length === 0) {
    console.log('  No stranded account. If a student still sees Arabic only, read the CORPUS');
    console.log('  block above — their track is missing its English or French subject rows.');
  } else {
    console.log(`  ${stranded.length} stranded account(s). Each one was given the Arabic humanities`);
    console.log('  and no mathematics, physics, chemistry, biology or foreign language:');
    for (const s of stranded) console.log(`    ${s.track}  ${s.email}`);
    console.log('');
    console.log('  Repair with:  npm run repair:study-language -- --to en --apply');
  }
  console.log('');

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
