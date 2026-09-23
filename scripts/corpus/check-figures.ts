/**
 * Are the figures a student is meant to see actually there?
 *
 *   npm run corpus:check-figures              # every key
 *   npm run corpus:check-figures -- --limit 50
 *
 * READ ONLY. A question that prints "Document 2" and shows nothing is worse
 * than one with no figure at all: the student is asked to read something that
 * is not on the screen. The database says which keys each question claims;
 * this fetches them from whatever storage this deployment is configured with
 * and reports what is missing, by subject.
 *
 * Only the legacy `content_images` path is checked here. Canonical visual
 * evidence (`question_visuals`) has its own smoke check in visual-smoke.ts.
 */
import { db } from '../../src/lib/db';
import { getObject } from '../../src/lib/storage';

const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? Number(process.argv[i + 1]) : 0;
})();

async function main() {
  const database = (await db.$queryRaw<Array<{ d: string }>>`SELECT current_database() AS d`)[0]!.d;
  console.log(`database ${database}\n`);

  const rows = await db.$queryRaw<Array<{ id: string; subject: string; track: string; images: string[] }>>`
    SELECT q.id::text, s.name AS subject, t.code::text AS track, q.content_images AS images
      FROM questions q
      JOIN chapters c ON c.id = q.chapter_id
      JOIN subjects s ON s.id = c.subject_id
      JOIN tracks t ON t.id = s.track_id
     WHERE array_length(q.content_images, 1) > 0
     ORDER BY s.name`;
  const sample = LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
  const keys = new Map<string, string>(); // key -> "track subject"
  for (const r of sample) for (const k of r.images) keys.set(k, `${r.track} ${r.subject}`);

  console.log(`${rows.length} question(s) claim a figure; ${keys.size} distinct key(s) to check\n`);

  const missing = new Map<string, string[]>();
  let found = 0;
  let bytes = 0;
  for (const [key, where] of keys) {
    try {
      const buf = await getObject(key);
      found += 1;
      bytes += buf.length;
    } catch {
      const list = missing.get(where) ?? [];
      list.push(key);
      missing.set(where, list);
    }
  }

  console.log(`present  ${found}`);
  console.log(`missing  ${[...missing.values()].reduce((n, l) => n + l.length, 0)}`);
  if (found) console.log(`average size ${Math.round(bytes / found / 1024)} kB`);
  if (missing.size) {
    console.log('\nmissing, by subject');
    for (const [where, list] of [...missing.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${String(list.length).padStart(4)}  ${where}   e.g. ${list[0]}`);
    }
  }
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
  await db.$disconnect();
});
