/**
 * Removes the invented placeholder taxonomy once the real curriculum is loaded.
 *
 *   npm run db:prune            # apply
 *   npm run db:prune -- --dry   # report only
 *
 * Why this exists: the app shipped with a placeholder programme in
 * `seed-data.ts` under the track codes SG / SV / VSE, and the transcribed CRDP
 * books are filed under GS / LS / SE / LH. Loading both leaves two sets of
 * chapters — one real, one invented — and nothing downstream can tell which a
 * question belongs to. This deletes the invented one.
 *
 * The rule is simple and checkable: a subject is real when its
 * (track code, name, language) appears in `scripts/corpus/catalog.csv`, which
 * is generated from the books' own ingestion records. Everything else under the
 * four official codes is placeholder, and a track left with no subjects at all
 * is a dead placeholder track.
 *
 * Students are moved off a retired track before it goes, so no account is left
 * pointing at nothing. `users.track_id` is ON DELETE SET NULL, which would
 * quietly strand them with no curriculum at all — a broken account rather than
 * a loud failure, which is the worse outcome.
 *
 * Deleting a subject cascades to its units, chapters, questions, content chunks
 * and every attempt filed under them. On a database holding real student work
 * that is not a small thing, so the dry run prints exactly what would go.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { parseCsv, TRACK_NAMES } from './taxonomy-loader';

const db = new PrismaClient();
const CATALOG = path.join(path.resolve(__dirname, '..'), 'scripts', 'corpus', 'catalog.csv');

/** Track codes that were only ever placeholders. */
const RETIRED_TRACKS: Record<string, string> = { SG: 'GS', SV: 'LS', VSE: 'SE' };

async function main() {
  const dry = process.argv.includes('--dry');

  const catalog = parseCsv(await readFile(CATALOG, 'utf8'));

  // Every (track, subject, language) the real corpus vouches for.
  const real = new Set<string>();
  for (const row of catalog) {
    if (!row.subject || !row.language) continue;
    for (const code of row.tracks.split(';').map((t) => t.trim()).filter(Boolean)) {
      real.add(`${code}::${row.subject}::${row.language}`);
    }
  }

  console.log(`\nThe catalog vouches for ${real.size} (track, subject, language) combinations.\n`);

  // --- Move students off retired tracks -----------------------------------
  for (const [from, to] of Object.entries(RETIRED_TRACKS)) {
    const oldTrack = await db.track.findUnique({ where: { code: from }, select: { id: true } });
    if (!oldTrack) continue;

    const newTrack = await db.track.findUnique({ where: { code: to }, select: { id: true } });
    const affected = await db.user.count({ where: { trackId: oldTrack.id } });
    if (affected === 0) continue;

    if (!newTrack) {
      console.log(`  ! ${affected} user(s) on ${from} but no ${to} track to move them to — skipping`);
      continue;
    }

    console.log(`  ${dry ? 'would move' : 'moving'} ${affected} user(s) from ${from} to ${to}`);
    if (!dry) {
      await db.user.updateMany({ where: { trackId: oldTrack.id }, data: { trackId: newTrack.id } });
    }
  }

  // --- Drop placeholder subjects under the official codes ------------------
  const subjects = await db.subject.findMany({
    select: {
      id: true,
      name: true,
      language: true,
      track: { select: { code: true } },
      _count: { select: { chapters: true } },
    },
  });

  let droppedSubjects = 0;
  for (const subject of subjects) {
    const code = subject.track?.code;
    if (!code) continue;
    if (!(code in TRACK_NAMES)) continue; // retired tracks are handled wholesale below
    if (real.has(`${code}::${subject.name}::${subject.language}`)) continue;

    console.log(
      `  ${dry ? 'would drop' : 'dropping'} subject ${code}/${subject.name} (${subject.language}) — ${subject._count.chapters} chapters`,
    );
    droppedSubjects += 1;
    if (!dry) await db.subject.delete({ where: { id: subject.id } });
  }

  // --- Drop the retired tracks themselves ----------------------------------
  let droppedTracks = 0;
  for (const from of Object.keys(RETIRED_TRACKS)) {
    const track = await db.track.findUnique({
      where: { code: from },
      select: { id: true, _count: { select: { users: true, subjects: true } } },
    });
    if (!track) continue;

    if (track._count.users > 0) {
      console.log(`  ! ${from} still has ${track._count.users} user(s) — not dropping`);
      continue;
    }

    console.log(`  ${dry ? 'would drop' : 'dropping'} track ${from} (${track._count.subjects} subjects)`);
    droppedTracks += 1;
    if (!dry) await db.track.delete({ where: { id: track.id } });
  }

  console.log(
    `\n${dry ? 'Would drop' : 'Dropped'}: ${droppedSubjects} subject(s), ${droppedTracks} track(s).`,
  );

  const left = await db.$queryRaw<{ code: string; subjects: bigint; chapters: bigint }[]>`
    SELECT t.code,
           COUNT(DISTINCT s.id) AS subjects,
           COUNT(c.id)          AS chapters
    FROM tracks t
    LEFT JOIN subjects s ON s.track_id = t.id
    LEFT JOIN chapters c ON c.subject_id = s.id
    GROUP BY t.code
    ORDER BY t.code
  `;
  console.log('\nTracks now:');
  for (const r of left) {
    console.log(`  ${r.code.padEnd(4)} ${Number(r.subjects)} subjects, ${Number(r.chapters)} chapters`);
  }
}

main()
  .catch((error) => {
    console.error('Pruning failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
