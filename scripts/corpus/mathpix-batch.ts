/**
 * Runs Mathpix over a set of exam papers, under a hard spend ceiling.
 *
 *   npm run corpus:mathpix:batch -- --dry
 *   npm run corpus:mathpix:batch -- --max-usd 20
 *   npm run corpus:mathpix:batch -- --max-usd 0.05 --limit 2 --pages 1-5
 *
 * THE CEILING IS CHECKED BEFORE EVERY SUBMIT, against that file's own page
 * count, and the spend is only booked once a file has actually completed. An
 * estimate made before the work is a guess about a distribution nobody has
 * seen; this repo has twice started a paid job on a number that turned out to
 * be wrong. The run stops the moment the next file would cross the line and
 * says what is left rather than finishing "approximately".
 *
 * RESUMABLE AT NO COST. `mathpix.ts` writes its output under the file's own
 * sha256, so a paper that already has `document.mmd` is skipped without being
 * uploaded. An interrupted run restarts for free, and re-running after a crash
 * cannot double-charge.
 *
 * WHAT IT WILL NOT SEND. Accommodation papers (ehteyejet / makfufin /
 * mokhtasa) are sat under a different and shorter specification and are
 * excluded from this corpus everywhere else — a run that quietly pulled them
 * back in would undo that. Solution and bareme sidecars are not question
 * papers. Arabic editions are excluded by default because Mathpix is here for
 * the LaTeX and Arabic prose belongs on the Document AI path.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

/** Mathpix v3/pdf, 0–1M pages. Confirmed against mathpix.com/pricing/api. */
const USD_PER_PAGE = 0.005;

const EXAMS = path.join('corpus', 'exams');

const SUBJECTS: [string, RegExp][] = [
  ['Mathematics', /^(math|maths|mathematiques)$/],
  ['Physics', /^(phy|phys|physics|physique)$/],
  ['Chemistry', /^(chem|chemistry|chimie|chim)$/],
  ['Biology', /^(bio|biology|biologie)$/],
  ['Geography', /^(geo|geography|geographie)$/],
  ['History', /^(tarekh|terekh|tarikh|history|histoire)$/],
  ['Philosophy', /^(falsafe|falsafa|philo|philosophie)$/],
  ['Civics', /^(tarbeya|tarbia|tarbiya)$/],
  ['Economics', /^(ektesad|esktesad|eco|economics)$/],
  ['Sociology', /^(ejteme3|ejtema3|socio)$/],
  ['Arabic', /^(arabe|arabic|ar)$/],
  ['French', /^(fr|french|francais|fran)$/],
  ['English', /^(eng|english|en)$/],
];

/**
 * The default scope, kept as it was: the subjects whose value is the notation.
 *
 * `--subjects` narrows or widens it. The table above lists every subject so a
 * paper is always classified — a paper the classifier does not recognise is
 * one that silently never gets read, which is exactly how Geography went
 * unnoticed until somebody asked where its maps were.
 */
const DEFAULT_SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology'];

/**
 * Subjects whose Arabic editions are not wanted, by decision rather than by
 * cost.
 *
 * The science papers are sat in Arabic as well as English and French, and the
 * owner ruled the Arabic editions out entirely — the students these are for
 * sit the sciences in English or French. That is a product decision, not a
 * budget one, so it survives a larger budget and is not re-offered.
 *
 * Written here rather than left to whoever remembers, because `--subjects`
 * otherwise takes the language filter off and a later run asking for
 * Mathematics would quietly pay to read 35 papers nobody wants. `--arabic`
 * still forces them in for anyone who has a reason.
 */
const LATIN_ONLY_SUBJECTS = new Set(['mathematics', 'physics', 'chemistry', 'biology']);

/** Stripped before subject matching, or "SV" reads as a subject. */
const TRACK_PREFIX = /^(svsg|selh|sv|sg|se|lh|ls|gs)[_\- ]/;
const ACCOMMODATION = /ehte[uy]ejet|ehtiyejet|ehteyejet|makfuf|makfouf|makfof|mu5tasa|mokhtasa|mukhtasar/;
const NOT_A_PAPER = /_sol(?![a-z])|solution|bareme|bar_me/;

const LANGUAGES: Record<string, string[]> = {
  en: ['en', 'eng', 'english'],
  fr: ['fr', 'french', 'francais', 'fran'],
  ar: ['ar', 'arabe', 'arabic'],
};

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.toLowerCase().endsWith('.pdf')) out.push(full);
  }
  return out;
}

function classify(filename: string): { subject: string | null; language: string | null } {
  const base = filename.replace(/\.pdf$/i, '').toLowerCase();
  const stem = base.replace(TRACK_PREFIX, '').replace(/20\d\d/g, ' ');
  const tokens = stem.split(/[_\- ]+/).filter(Boolean);

  let subject: string | null = null;
  for (const [label, pattern] of SUBJECTS) {
    if (tokens.some((t) => pattern.test(t))) {
      subject = label;
      break;
    }
  }

  let language: string | null = null;
  for (const [code, words] of Object.entries(LANGUAGES)) {
    if (tokens.some((t) => words.includes(t))) {
      language = code;
      break;
    }
  }

  /*
   * NO SUFFIX MEANS ARABIC, and the absence is the evidence.
   *
   * A paper sat in more than one language carries the language in its name —
   * `math_en.pdf`, `falsafe_fr.pdf` — because the same exam exists twice. The
   * humanities papers are sat in Arabic only, so there is nothing to
   * distinguish and the filename is simply `geo.pdf`, `tarekh.pdf`,
   * `tarbeya.pdf`.
   *
   * Requiring a token therefore skipped every one of them. Geography came back
   * as 5 papers out of 99, and the 94 that vanished were exactly the ones whose
   * maps and graphs are the reason for reading the subject at all. Treated as
   * unclassifiable rather than as Arabic, they are silently never read — which
   * is the failure mode this whole exercise keeps rediscovering.
   */
  return { subject, language: language ?? 'ar' };
}

type Candidate = {
  file: string;
  rel: string;
  subject: string;
  language: string;
  pages: number;
  sha256: string;
  done: boolean;
};

async function buildList(args: Args): Promise<Candidate[]> {
  const chosen =
    typeof args.subjects === 'string'
      ? args.subjects.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      : DEFAULT_SUBJECTS.map((s) => s.toLowerCase());

  /*
   * Naming a subject means wanting its papers, whatever they are written in.
   *
   * Arabic is off by default because Mathpix was bought for LaTeX and Arabic
   * prose belongs on the Document AI path. That reasoning does not survive
   * being asked for Geography: those papers are maps, graphs and tables, and
   * most of them are printed in Arabic. So an explicit --subjects takes the
   * language filter off unless --latin-only puts it back.
   */
  const explicit = typeof args.subjects === 'string';
  const wantArabic = args.arabic === true || (explicit && args['latin-only'] !== true);
  const out: Candidate[] = [];

  for (const file of walk(EXAMS).sort()) {
    const name = path.basename(file);
    const low = name.toLowerCase();
    if (ACCOMMODATION.test(low) || NOT_A_PAPER.test(low)) continue;

    const { subject, language } = classify(name);
    if (!subject) continue;
    if (!chosen.includes(subject.toLowerCase())) continue;
    if (!language) continue;
    if (language === 'ar' && LATIN_ONLY_SUBJECTS.has(subject.toLowerCase()) && args.arabic !== true) {
      continue;
    }
    if (language === 'ar' && !wantArabic) continue;

    const bytes = readFileSync(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    let pages = 0;
    try {
      pages = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
    } catch {
      // A file pdf-lib cannot open is one Mathpix is unlikely to price the way
      // we think. Skipped rather than sent blind.
      console.warn(`  ! could not read, skipping: ${file}`);
      continue;
    }

    out.push({
      file,
      rel: path.relative(EXAMS, file).split(path.sep).join('/'),
      subject,
      language,
      pages,
      sha256,
      done: existsSync(path.join('corpus', 'text', sha256, 'document.mmd')),
    });
  }

  return out;
}

/*
 * No single paper may wedge the run.
 *
 * `mathpix.ts` has its own 45-minute ceiling, and a batch has to assume that
 * ceiling can fail: it did, once, because the guard was checked after a fetch
 * that never returned and one paper held the run for 54 minutes. A wall clock
 * out here does not depend on anything inside the child being correct.
 *
 * Generous, because a long paper legitimately takes minutes — this is a
 * backstop, not a schedule.
 */
const CHILD_TIMEOUT_MS = 10 * 60_000;

function runOne(file: string, pageRange: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    const argv = [
      '--conditions=react-server',
      '--env-file=.env',
      '--import',
      'tsx',
      path.join('scripts', 'corpus', 'mathpix.ts'),
      '--file',
      file,
      ...(pageRange ? ['--pages', pageRange] : []),
    ];
    const child = spawn(process.execPath, argv, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    let timedOut = false;

    const killer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CHILD_TIMEOUT_MS);

    child.stdout.on('data', () => undefined);
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      if (timedOut) {
        console.log(`      timed out after ${CHILD_TIMEOUT_MS / 60_000} min — moving on`);
        resolve(false);
        return;
      }
      if (code !== 0) {
        console.log(`      failed: ${stderr.trim().split('\n').slice(-2).join(' ').slice(0, 200)}`);
      }
      resolve(code === 0);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dry = args.dry === true;
  const maxUsd = Number(args['max-usd'] ?? 20);
  const limit = args.limit ? Number(args.limit) : Infinity;
  const pageRange = typeof args.pages === 'string' ? args.pages : null;

  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    console.error('--max-usd must be a positive number.');
    process.exit(1);
  }

  /*
   * A PARTIAL RUN POISONS THE RESUME CHECK.
   *
   * `mathpix.ts` writes `document.mmd` under the paper's sha256 whether it
   * read three pages or thirty, and this script's "already done" test is the
   * existence of that file. So a cheap `--pages 1-5` trial over real papers
   * would silently mark them complete, and the full run would skip them —
   * leaving five pages of a ten-page paper in the corpus with nothing on
   * screen to say so.
   *
   * Refused rather than warned about, because the damage is invisible until
   * somebody asks the tutor about page seven.
   */
  if (pageRange && args['allow-partial'] !== true) {
    console.error(
      [
        '--pages writes a partial document.mmd, which this script would then read',
        'as "already done" and skip on the full run.',
        '',
        'To trial the pipeline, point --file at one paper with corpus:mathpix instead,',
        'or pass --allow-partial and delete corpus/text/<sha256>/ afterwards.',
      ].join('\n'),
    );
    process.exit(1);
  }

  console.log('Building the list …');
  const all = await buildList(args);
  const todo = all.filter((c) => !c.done);
  const done = all.filter((c) => c.done);

  const pagesOf = (list: Candidate[]) =>
    list.reduce((sum, c) => sum + (pageRange ? Math.min(c.pages, 5) : c.pages), 0);

  console.log('');
  console.log(`  in scope      : ${all.length} papers, ${pagesOf(all)} pages`);
  console.log(`  already done  : ${done.length} papers, ${pagesOf(done)} pages`);
  console.log(`  to process    : ${todo.length} papers, ${pagesOf(todo)} pages`);
  console.log(`  at $${USD_PER_PAGE}/page : $${(pagesOf(todo) * USD_PER_PAGE).toFixed(2)}`);
  console.log(`  ceiling       : $${maxUsd.toFixed(2)}`);
  console.log('');

  const bySubject = new Map<string, { n: number; pages: number }>();
  for (const c of todo) {
    const row = bySubject.get(c.subject) ?? { n: 0, pages: 0 };
    row.n += 1;
    row.pages += c.pages;
    bySubject.set(c.subject, row);
  }
  for (const [subject, row] of [...bySubject].sort()) {
    console.log(
      `    ${subject.padEnd(13)} ${String(row.n).padStart(4)} papers  ${String(row.pages).padStart(5)} pages  $${(row.pages * USD_PER_PAGE).toFixed(2)}`,
    );
  }
  console.log('');

  if (dry) {
    console.log('--dry: nothing submitted, nothing charged.');
    return;
  }

  let spent = 0;
  let processed = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  const skippedForBudget: Candidate[] = [];

  /*
   * STOP WHEN IT IS CLEARLY THE NETWORK, NOT THE PAPER.
   *
   * Observed: 106 papers in a row succeeded, then 127 in a row failed with
   * "fetch failed" — a connection error, not an HTTP one — and the run kept
   * going, marching through the list and marking everything failed. That is
   * the worst outcome available: it looks like work, it empties the queue, and
   * the only way to tell it apart from a finished run is to read the log.
   *
   * A paper that genuinely cannot be read fails alone. Failures in a row are a
   * statement about the connection, so the run stops and says so while the
   * remaining papers are still untried and can simply be re-run.
   */
  const MAX_CONSECUTIVE_FAILURES = 5;

  for (const candidate of todo) {
    if (processed >= limit) break;

    const pages = pageRange ? Math.min(candidate.pages, 5) : candidate.pages;
    const cost = pages * USD_PER_PAGE;

    /*
     * Checked BEFORE the submit, against this file's own page count. Once the
     * next paper would cross the line the run stops: it does not look for a
     * smaller one to squeeze in, because a run that reorders itself around a
     * budget is one nobody can resume predictably.
     */
    if (spent + cost > maxUsd) {
      skippedForBudget.push(candidate);
      console.log('');
      console.log(
        `Ceiling reached. Next paper needs $${cost.toFixed(2)} and $${(maxUsd - spent).toFixed(2)} is left.`,
      );
      break;
    }

    process.stdout.write(
      `[${String(processed + 1).padStart(3)}/${todo.length}] ${candidate.rel} (${pages}p, $${cost.toFixed(3)}) … `,
    );

    const exited = await runOne(candidate.file, pageRange);

    /*
     * A CHILD THAT DIED IS NOT NECESSARILY WORK THAT DID NOT HAPPEN.
     *
     * Twice now a paper has hung *after* Mathpix finished and the output was
     * fully written — the process simply never exited, and the wall clock
     * killed it. Mathpix billed those pages. Booking nothing for them makes
     * the ledger read low, and the ledger is what the ceiling is enforced
     * against, so the drift is in the one direction that matters.
     *
     * So the disk is the authority, not the exit code: if the paper's output
     * is complete it counts as done and is charged for, however the process
     * ended.
     */
    const landed =
      !exited &&
      !pageRange &&
      existsSync(path.join('corpus', 'text', candidate.sha256, 'document.mmd')) &&
      readdirSync(path.join('corpus', 'text', candidate.sha256)).filter((f) =>
        /^page-\d+\.md$/.test(f),
      ).length === candidate.pages;

    if (landed) {
      console.log('(process hung, but the output is complete — counted and charged)');
    }

    const ok = exited || landed;
    if (ok) {
      // Booked only on success. A failed submit is not billed for output we
      // did not receive, and re-running it must not count twice.
      spent += cost;
      processed += 1;
      consecutiveFailures = 0;
      console.log(`ok   spent $${spent.toFixed(2)} / $${maxUsd.toFixed(2)}`);
    } else {
      failed += 1;
      consecutiveFailures += 1;
      console.log('FAILED (not charged against the ceiling)');

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log('');
        console.log(
          `Stopping: ${consecutiveFailures} papers failed in a row. That is the ` +
            'connection, not the corpus.',
        );
        console.log('Nothing after this point was attempted. Re-run when it is back.');
        break;
      }
    }
  }

  const remaining = todo.length - processed - failed;
  console.log('');
  console.log('─'.repeat(60));
  console.log(`  processed : ${processed} papers`);
  console.log(`  failed    : ${failed}`);
  console.log(`  remaining : ${remaining}`);
  console.log(`  SPENT     : $${spent.toFixed(2)} of $${maxUsd.toFixed(2)}`);
  if (skippedForBudget.length > 0 || remaining > 0) {
    console.log('');
    console.log('  Re-run with a higher --max-usd to continue. Everything already');
    console.log('  written is skipped, so nothing is paid for twice.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
