/**
 * Repository audit — finds what is dead, dangling, untested or unreachable.
 *
 *   node scripts/detect.mjs
 *
 * Static only: it reads the tree and reports. It never writes, so it is safe to
 * run at any time and safe to ignore. Every finding names the file, because a
 * finding you cannot locate is a finding nobody acts on.
 *
 * Deliberately not a linter. It looks for the things that actually go wrong in
 * this codebase — a translation key nobody reads, a route nothing links to, a
 * scoring module with no test behind it — none of which ESLint has an opinion
 * about.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';

// `import.meta.dirname` is Node 20.11+; this repo's engines floor is 20.10.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'src');

const findings = [];
function report(severity, area, message) {
  findings.push({ severity, area, message });
}

/** Every file we care about, with its text, read once. */
async function collect(dir, out = new Map()) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', '.git'].includes(entry.name)) continue;
      await collect(full, out);
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
      out.set(full, await readFile(full, 'utf8'));
    }
  }
  return out;
}

const files = await collect(SRC);
for (const extra of ['prisma', 'scripts', 'tests']) {
  await collect(path.join(ROOT, extra), files).catch(() => undefined);
}

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

// ---------------------------------------------------------------------------
// 1. Exports nothing imports
// ---------------------------------------------------------------------------
for (const [file, text] of files) {
  if (!file.includes(`${path.sep}src${path.sep}`)) continue;
  if (/[\\/]app[\\/]/.test(file)) continue; // route files export by convention

  const exported = [
    ...text.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm),
    ...text.matchAll(/^export\s+const\s+([A-Za-z0-9_]+)/gm),
  ].map((m) => m[1]);

  for (const symbol of exported) {
    // Used anywhere else at all — another file, or a test.
    let usedElsewhere = false;
    for (const [other, otherText] of files) {
      if (other === file) continue;
      if (new RegExp(`\\b${symbol}\\b`).test(otherText)) {
        usedElsewhere = true;
        break;
      }
    }
    if (usedElsewhere) continue;

    // Used inside its own file beyond the definition itself?
    const occurrences = (text.match(new RegExp(`\\b${symbol}\\b`, 'g')) ?? []).length;
    if (occurrences > 1) continue;

    report('info', 'dead code', `${symbol} is exported from ${rel(file)} and never used`);
  }
}

// ---------------------------------------------------------------------------
// 2. Translation keys defined but never read
// ---------------------------------------------------------------------------
const enPath = path.join(SRC, 'lib', 'i18n', 'dictionaries', 'en.ts');
const en = files.get(enPath) ?? '';
const consumers = [...files]
  .filter(([f]) => !f.includes('dictionaries'))
  .map(([, t]) => t)
  .join('\n');

let section = null;
for (const line of en.split('\n')) {
  const sectionMatch = line.match(/^  ([A-Za-z0-9_]+): \{/);
  if (sectionMatch) {
    section = sectionMatch[1];
    continue;
  }
  const keyMatch = line.match(/^    ([A-Za-z0-9_]+):\s*['"`]/);
  if (!keyMatch || !section) continue;

  const key = keyMatch[1];

  /*
   * Dynamic access defeats a plain search.
   *
   * `t.flashcards[`${value}Hint`]` reads againHint, hardHint, goodHint and
   * easyHint without any of those strings appearing in the source. Reporting
   * them as dead — and acting on it — deleted four keys that were very much in
   * use, so any key whose name ends in a suffix used inside a template literal
   * is treated as read.
   */
  const dynamicSuffix = [...consumers.matchAll(/\$\{[^}]*\}([A-Za-z0-9_]+)`\]/g)].map((m) => m[1]);
  const reachedDynamically = dynamicSuffix.some((suffix) => key.endsWith(suffix));

  const used =
    reachedDynamically ||
    new RegExp(`\\b${section}\\.${key}\\b`).test(consumers) ||
    new RegExp(`\\b${key}\\b`).test(consumers.replace(/\bt\.[A-Za-z0-9_.]+/g, ''));
  if (!used) report('info', 'i18n', `${section}.${key} is defined but never read`);
}

// ---------------------------------------------------------------------------
// 3. Pages nothing links to
// ---------------------------------------------------------------------------
const routes = [...files.keys()]
  .filter((f) => /[\\/]app[\\/].*page\.tsx$/.test(f))
  .map((f) =>
    rel(f)
      .replace(/^src\/app/, '')
      .replace(/\/page\.tsx$/, '')
      .replace(/\/\([^)]+\)/g, '') || '/',
  )
  .filter((r) => !r.includes('['));

const allText = [...files.values()].join('\n');
for (const route of routes) {
  if (route === '/' || route === '/dashboard' || route === '/login') continue;
  const linked = new RegExp(`["'\`]${route}(["'\`?/])`).test(allText);
  if (!linked) report('warn', 'routing', `${route} exists but nothing links to it`);
}

// ---------------------------------------------------------------------------
// 4. Scoring and rules modules with no test
// ---------------------------------------------------------------------------
const testText = [...files]
  .filter(([f]) => f.includes(`${path.sep}tests${path.sep}`))
  .map(([, t]) => t)
  .join('\n');

for (const [file] of files) {
  if (!/[\\/]lib[\\/](scoring|standing|grading|billing|gamification)/.test(file)) continue;
  const name = path.basename(file, path.extname(file));
  if (!new RegExp(`lib/${name}|scoring/${name}`).test(testText)) {
    report('warn', 'tests', `${rel(file)} has no test importing it`);
  }
}

// ---------------------------------------------------------------------------
// 5. Configuration that is dangerous if it reaches production unchanged
// ---------------------------------------------------------------------------
const envText = files.get(path.join(SRC, 'lib', 'env.ts')) ?? '';
for (const [, key, dflt] of envText.matchAll(/([A-Z0-9_]+):\s*z\.string\(\)\.default\('([^']*)'\)/g)) {
  if (key.includes('SECRET') || key.includes('KEY')) {
    if (dflt === '') report('info', 'config', `${key} defaults to empty — must be set in production`);
  }
}
if (/SESSION_SECRET/.test(envText) && !/min\(\d+/.test(envText)) {
  report('warn', 'config', 'SESSION_SECRET has no minimum length');
}

// ---------------------------------------------------------------------------
// 6. Data integrity — only with --data, because it needs the database
//
// The static pass cannot see the failure that matters most in this product: a
// corpus with no embeddings. Retrieval scores every tier by cosine similarity,
// so with no vectors every question falls through to "not covered" and the
// tutor refuses everything, correctly and uselessly.
// ---------------------------------------------------------------------------
if (process.argv.includes('--data')) {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();

  try {
    const [
      questions,
      questionsNoVector,
      chunks,
      chunksNoVector,
      mcqNoAnswer,
      openNoBareme,
      baremeNoSolution,
      emptyChapters,
      emptySubjects,
      emptyCycles,
      usersNoTrack,
      baremeImpossible,
      starvedChapters,
      schemeAsQuestion,
      backMatterChapters,
      groundTruth,
    ] = await Promise.all([
      db.question.count(),
      db.$queryRaw`SELECT COUNT(*)::int AS n FROM questions WHERE embedding IS NULL`,
      db.contentChunk.count(),
      db.$queryRaw`SELECT COUNT(*)::int AS n FROM content_chunks WHERE embedding IS NULL`,
      db.question.count({ where: { questionType: 'mcq', correctOptionId: null } }),
      db.question.count({ where: { questionType: { not: 'mcq' }, bareme: { equals: Prisma.DbNull } } }),
      db.question.count({ where: { bareme: { not: Prisma.DbNull }, officialSolution: null } }),
      db.chapter.count({ where: { questions: { none: {} } } }),
      db.subject.count({ where: { chapters: { none: {} } } }),
      db.examCycle.count({ where: { questions: { none: {} } } }),
      db.user.count({ where: { trackId: null } }),
      /*
       * The checks below exist because each one was a real, live defect that
       * nothing in this repository reported. They are cheap SQL, and the
       * absence of them is why every one had to be found by a person.
       *
       * The scheme-detector below is deliberately narrow, and was narrowed
       * after it over-reached. "corrig[ée]" looked like a reasonable way to
       * catch a French answer key and instead matched "corriger" — the verb
       * "to correct", which appears in perfectly good questions asking a
       * student to correct false statements. It flagged 56, of which 53 were
       * real questions. A health check that tells somebody to delete a
       * question bank is worse than no health check, so this matches only
       * phrases that name an answer key and cannot be part of a question.
       */
      db.$queryRaw`
        SELECT COUNT(*)::int AS n FROM (
          SELECT (SELECT SUM((c->>'points')::numeric)
                    FROM jsonb_array_elements(bareme::jsonb) c) AS pts
            FROM questions WHERE bareme IS NOT NULL
        ) t WHERE pts IS NULL OR pts <= 0 OR pts > 20`,
      db.$queryRaw`
        SELECT COUNT(*)::int AS n, COALESCE(SUM(q),0)::int AS questions FROM (
          SELECT c.id, COUNT(DISTINCT l.chunk_id) AS p, COUNT(DISTINCT qq.id) AS q
            FROM chapters c
            LEFT JOIN chapter_content_chunks l ON l.chapter_id = c.id
            LEFT JOIN questions qq ON qq.chapter_id = c.id
                  AND qq.verified_status <> 'rejected'
           GROUP BY c.id
        ) t WHERE q > 0 AND p < 5`,
      db.$queryRaw`
        SELECT COUNT(*)::int AS n FROM questions
         WHERE verified_status <> 'rejected'
           AND content_text ~* '(expected answers|answer key|éléments de réponse)'`,
      db.$queryRaw`
        SELECT COUNT(*)::int AS n FROM chapters
         WHERE name ~* '(auto-?[ée]valuation|r[ée]ponses et indication|answers and hints|solutions?$|index$)'`,
      db.$queryRaw`
        SELECT COUNT(*)::int AS verified,
               (SELECT COUNT(*)::int FROM questions WHERE verified_status <> 'rejected') AS live
          FROM questions WHERE verified_status = 'verified'`,
    ]);

    const qNull = questionsNoVector[0]?.n ?? 0;
    const cNull = chunksNoVector[0]?.n ?? 0;

    if (questions > 0 && qNull === questions) {
      report('error', 'retrieval', `no question has an embedding (${questions} rows) — tier 1 can never fire, so the tutor refuses everything. Run: npm run ingest -- --embed-missing`);
    } else if (qNull > 0) {
      report('warn', 'retrieval', `${qNull} of ${questions} questions have no embedding and are invisible to retrieval`);
    }

    if (chunks > 0 && cNull === chunks) {
      report('error', 'retrieval', `no course-material chunk has an embedding (${chunks} rows) — tier 2 can never fire`);
    } else if (cNull > 0) {
      report('warn', 'retrieval', `${cNull} of ${chunks} chunks have no embedding`);
    }

    if (mcqNoAnswer > 0) report('error', 'content', `${mcqNoAnswer} MCQ question(s) have no correct option — they cannot be marked`);
    if (openNoBareme > 0) report('warn', 'content', `${openNoBareme} open/problem question(s) have no barème — an attempt is recorded but never scored`);
    if (baremeNoSolution > 0) report('warn', 'content', `${baremeNoSolution} question(s) have a barème but no official solution — marking has nothing to compare against`);
    if (emptyCycles > 0) report('info', 'content', `${emptyCycles} exam cycle(s) contain no questions`);
    if (emptyChapters > 0) report('info', 'content', `${emptyChapters} chapter(s) have no questions (expected until ingestion runs)`);
    if (emptySubjects > 0) report('warn', 'content', `${emptySubjects} subject(s) have no chapters at all`);
    if (usersNoTrack > 0) report('error', 'accounts', `${usersNoTrack} user(s) have no track — they see no curriculum`);

    // Each of the following was live in this database and reported by nothing.
    const impossible = baremeImpossible[0]?.n ?? 0;
    if (impossible > 0) {
      report('error', 'content',
        `${impossible} question(s) carry a barème totalling 0 or more than 20 marks — a Lebanese paper is marked out of twenty, so these show a student a mark out of a number that does not exist. 292 were live before anyone checked, one of them out of 173.`);
    }

    const starved = starvedChapters[0]?.n ?? 0;
    const stranded = starvedChapters[0]?.questions ?? 0;
    if (starved > 0) {
      report('warn', 'retrieval',
        `${starved} chapter(s) hold ${stranded} question(s) but fewer than 5 passages — retrieval cannot reach their material and the tutor answers from a neighbouring chapter, fluently and with a citation. Run: npm run report:stranded`);
    }

    const schemes = schemeAsQuestion[0]?.n ?? 0;
    if (schemes > 0) {
      report('error', 'content',
        `${schemes} question(s) are marking schemes, not questions — a student practising one is shown the answer as the question. Retire them with "x" in npm run label:chapters`);
    }

    const backMatter = backMatterChapters[0]?.n ?? 0;
    if (backMatter > 0) {
      report('warn', 'content',
        `${backMatter} chapter(s) are a book's back matter (answer keys, indexes) rather than syllabus — questions filed there are grounded against a solutions appendix`);
    }

    const verified = groundTruth[0]?.verified ?? 0;
    const live = groundTruth[0]?.live ?? 0;
    if (live > 0 && verified < 100) {
      report('warn', 'measurement',
        `only ${verified} of ${live} questions carry a human judgement. Every retrieval and filing number in this repository is the embedding grading its own earlier decision until this reaches the hundreds. Run: npm run judge:passages`);
    }
  } catch (error) {
    report('warn', 'data', `could not read the database: ${error instanceof Error ? error.message : error}`);
  } finally {
    await db.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const order = { error: 0, warn: 1, info: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.area.localeCompare(b.area));

const counts = findings.reduce((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }), {});

console.log(`\nScanned ${files.size} files.\n`);
let lastArea = '';
for (const f of findings) {
  if (f.area !== lastArea) {
    console.log(`\n${f.area.toUpperCase()}`);
    lastArea = f.area;
  }
  console.log(`  [${f.severity}] ${f.message}`);
}

console.log(
  `\n${findings.length} finding(s): ${counts.error ?? 0} error, ${counts.warn ?? 0} warn, ${counts.info ?? 0} info\n`,
);
