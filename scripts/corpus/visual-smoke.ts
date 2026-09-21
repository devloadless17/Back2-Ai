/**
 * Read-only smoke check of canonical visual evidence in a live database.
 *
 *   npm run corpus:visual-smoke                    # against DATABASE_URL + configured storage
 *
 * WRITES NOTHING. It answers, for real papers, the rollout questions:
 *   - does the selector return the crop, and are the bytes in storage the
 *     bytes the asset row says (sha256)?
 *   - does Nour's loader receive exactly those bytes, in the same order?
 *   - is solution material unreachable as question evidence?
 *   - does a proven-wrong legacy page stay suppressed, and a permitted one
 *     still fall back?
 *
 * The HTTP checks (a student's session against /api/files and
 * /api/visuals/solution) need a deployed URL and a signed-in cookie; the
 * script prints the exact storage keys and occurrence ids to test them with.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '../../src/lib/db';
import { loadSourceFigures } from '../../src/lib/figures';
import { getObject } from '../../src/lib/storage';
import { selectVisualsFor, visualKeysFor } from '../../src/lib/visual-evidence';

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Real papers, chosen from the C3 artifact: one per subject, plus a panel group. */
const TARGETS: Array<{ label: string; paper: string; ordinal: number }> = [
  { label: 'Biology document (Document 1, question-level)', paper: 'ls/2018 2/bio_en.pdf', ordinal: 4 },
  { label: 'Physics figure (Figure 3, question II.1)', paper: 'gs/2005 1/gs physics_en 1.pdf', ordinal: 2 },
  { label: 'Maths figure (adjacent figure)', paper: 'gs/2019/math_en.pdf', ordinal: 5 },
  { label: 'Chemistry document + multi-panel group (Document-2)', paper: 'gs/2017 1/chem_en.pdf', ordinal: 2 },
];

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
}

async function exerciseRows(paper: string, ordinal: number) {
  const exams = JSON.parse(readFileSync(path.join(process.cwd(), 'corpus/exams.json'), 'utf-8')) as Array<{
    path: string; sha256: string; exercises: Array<{ index: number | null }>;
  }>;
  const exam = exams.find((e) => e.path.replace(/\\/g, '/') === paper);
  if (!exam) return [];
  const ex = exam.exercises[ordinal - 1];
  if (!ex) return [];
  const subjects = await db.subject.findMany({ select: { id: true } });
  const refs = subjects.map((s) => sha256(`${s.id}:${exam.sha256}:${ex.index}:${ordinal - 1}`));
  return db.question.findMany({ where: { sourceRef: { in: refs } }, select: { id: true, contentText: true, contentImages: true } });
}

async function main() {
  const database = (await db.$queryRaw<Array<{ d: string }>>`SELECT current_database() AS d`)[0]!.d;
  console.log(`database: ${database}\n`);

  // --- counts -----------------------------------------------------------
  const [assets, occ, rel, audits] = await Promise.all([
    db.visualAsset.count(),
    db.visualOccurrence.groupBy({ by: ['access'], _count: true }),
    db.questionVisual.groupBy({ by: ['status', 'tier'], _count: true }),
    db.legacyImageAudit.groupBy({ by: ['verdict'], _count: true }),
  ]);
  console.log('counts');
  console.log(`  assets ${assets}`);
  console.log(`  occurrences ${JSON.stringify(Object.fromEntries(occ.map((o) => [o.access, o._count])))}`);
  console.log(`  relations ${JSON.stringify(rel.map((r) => `${r.status}/${r.tier}: ${r._count}`))}`);
  console.log(`  legacy audits ${JSON.stringify(Object.fromEntries(audits.map((a) => [a.verdict, a._count])))}\n`);

  // --- solution isolation, over every row -------------------------------
  console.log('solution isolation');
  const misplaced = await db.visualOccurrence.count({ where: { access: 'solution', NOT: { storageKey: { startsWith: 'solution-images/' } } } });
  check('every solution occurrence is stored under solution-images/', misplaced === 0, `${misplaced} are not`);
  const leaked = await db.questionVisual.count({
    where: { status: 'active', NOT: { role: 'solution_material' }, occurrence: { access: 'solution' } },
  });
  check('no active question-evidence relation points at a solution occurrence', leaked === 0, `${leaked} do`);
  const questionKeysInSolutionScope = await db.visualOccurrence.count({ where: { access: 'question', storageKey: { startsWith: 'solution-images/' } } });
  check('no question occurrence is stored in the solution scope', questionKeysInSolutionScope === 0);
  const sol = await db.visualOccurrence.findFirst({ where: { access: 'solution' }, select: { id: true, storageKey: true } });
  if (sol) {
    console.log(`  for the HTTP check: solution occurrence ${sol.id}, key ${sol.storageKey}`);
    console.log('    expect 404 as a student on /api/files/<key> and on /api/visuals/solution/<id> before submitting');
  }
  console.log();

  // --- every active crop exists and is the right bytes -------------------
  console.log('storage integrity (every active relation)');
  const active = await db.questionVisual.findMany({
    where: { status: 'active' },
    select: { occurrence: { select: { storageKey: true, asset: { select: { contentHash: true } } } } },
  });
  const keys = new Map(active.map((a) => [a.occurrence.storageKey, a.occurrence.asset.contentHash]));
  let missing = 0;
  let wrong = 0;
  for (const [key, hash] of keys) {
    try {
      if (sha256(await getObject(key)) !== hash) wrong += 1;
    } catch {
      missing += 1;
    }
  }
  check(`${keys.size} distinct active keys present in storage`, missing === 0, `${missing} missing`);
  check('stored bytes match their asset hash', wrong === 0, `${wrong} differ`);
  console.log();

  // --- real papers: student and model receive the same crop --------------
  for (const t of TARGETS) {
    console.log(`${t.label} — ${t.paper} #${t.ordinal}`);
    const rows = await exerciseRows(t.paper, t.ordinal);
    check('exercise row found', rows.length > 0);
    for (const q of rows) {
      const student = (await visualKeysFor([q])).get(q.id)!;
      const selection = (await selectVisualsFor([q])).get(q.id)!;
      check(`canonical crops selected (${selection.source}, ${student.length})`, selection.source === 'canonical' && student.length > 0);
      check('student keys = model keys, same order', JSON.stringify(student) === JSON.stringify(selection.keys));
      const loaded = await loadSourceFigures([
        { id: q.id, kind: 'question', label: 'smoke', similarity: 1, text: q.contentText, images: selection.keys,
          imageGroups: selection.visuals.map((v) => (v.groupKey && v.groupSize ? { groupKey: v.groupKey, size: v.groupSize } : null)) },
      ]);
      const sent = loaded.images.map((i) => sha256(Buffer.from(i.base64, 'base64')));
      const stored = await Promise.all(loaded.refs.map(async (r) => sha256(await getObject(r.key))));
      check('bytes Nour receives = bytes the student is served', JSON.stringify(sent) === JSON.stringify(stored) && sent.length > 0);
      const groups = selection.visuals.filter((v) => v.groupKey);
      if (groups.length) {
        const sizes = new Map<string, number>();
        groups.forEach((g) => sizes.set(g.groupKey!, (sizes.get(g.groupKey!) ?? 0) + 1));
        check('panel groups delivered whole', groups.every((g) => sizes.get(g.groupKey!) === g.groupSize));
      }
      console.log(`    keys: ${student.join(', ')}`);
    }
    console.log();
  }

  // --- legacy fallback and suppression -----------------------------------
  console.log('legacy');
  const permitted = await db.legacyImageAudit.findFirst({
    where: { verdict: { in: ['no_crop_on_page', 'unresolved'] }, question: { visuals: { none: { status: 'active' } } } },
    select: { question: { select: { id: true, contentText: true, contentImages: true } } },
  });
  if (permitted) {
    const s = (await selectVisualsFor([permitted.question])).get(permitted.question.id)!;
    check(`permitted legacy page still falls back (${permitted.question.id})`,
      s.source === 'legacy' && JSON.stringify(s.keys) === JSON.stringify(permitted.question.contentImages));
  } else check('a permitted legacy row exists to test', false);
  const wrongRow = await db.legacyImageAudit.findFirst({
    where: { verdict: { in: ['wrong_exercise', 'wrong_page', 'header_only'] }, question: { visuals: { none: { status: 'active' } } } },
    select: { verdict: true, question: { select: { id: true, contentText: true, contentImages: true } } },
  });
  if (wrongRow) {
    const s = (await selectVisualsFor([wrongRow.question])).get(wrongRow.question.id)!;
    check(`${wrongRow.verdict} legacy page stays suppressed (${wrongRow.question.id})`, s.keys.length === 0 && s.legacySuppressed);
  } else check('a suppressed legacy row with no canonical crop exists to test', false);

  console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} SMOKE CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
