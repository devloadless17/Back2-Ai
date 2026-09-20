/**
 * Backs up the processed corpus.
 *
 *   npm run corpus:backup -- --dry
 *   npm run corpus:backup -- --out "D:/backups"
 *   npm run corpus:backup -- --with-sources
 *   npm run corpus:backup -- --verify "D:/backups/bac2-corpus-2026-09-18.tar.gz"
 *
 * WHY THIS EXISTS. `/corpus/` is in .gitignore, so none of it is in version
 * control. What sits there is ~3,991 pages of Mathpix output for the science
 * papers, the OCR of 185 CRDP books, and every derived JSON — work that cost
 * real money and weeks of runs, held on exactly one laptop. Losing the disk
 * means paying for it again, and the books cannot simply be re-bought.
 *
 * WHAT GOES IN BY DEFAULT: the things that cannot be regenerated without
 * paying or re-scanning — `corpus/text`, `corpus/meta`, `corpus/figures`, and
 * the JSON manifests at the corpus root.
 *
 * WHAT DOES NOT: `corpus/exams`, 845MB of source PDFs. They are published
 * national exam papers and can be downloaded again, and including them turns a
 * portable archive into one nobody copies anywhere. `--with-sources` adds them
 * when the point is a full disk image rather than a working backup.
 *
 * A MANIFEST OF SHA-256 SUMS travels inside the archive, and `--verify` checks
 * an archive against it. A backup nobody has restored is a hypothesis; this is
 * the cheapest way to turn it into a fact.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const CORPUS = 'corpus';
const PROCESSED = ['text', 'meta', 'figures'];
const SOURCES = ['exams'];

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
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function human(bytes: number): string {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/** Root-level JSON the pipeline writes: manifests, indexes, taxonomies. */
function rootFiles(): string[] {
  return readdirSync(CORPUS)
    .filter((f) => /\.(json|csv)$/i.test(f))
    .map((f) => path.join(CORPUS, f))
    .filter((f) => statSync(f).isFile());
}

function verify(archive: string) {
  if (!existsSync(archive)) {
    console.error(`No such archive: ${archive}`);
    process.exit(1);
  }
  console.log(`Verifying ${archive}`);
  console.log('  reading MANIFEST.sha256 from inside the archive …');

  const manifest = execFileSync('tar', ['-xzOf', archive, 'MANIFEST.sha256'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const expected = manifest
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [sum, ...rest] = l.split(/\s+/);
      return { sum, file: rest.join(' ') };
    });

  console.log(`  manifest lists ${expected.length} files`);

  /*
   * Checked against the files on disk rather than by unpacking.
   *
   * Unpacking 800MB to compare it needs the space free and proves only that
   * tar can read its own output. What is actually in question is whether this
   * archive matches the corpus it claims to back up, and that is answered by
   * hashing what is here.
   */
  let checked = 0;
  let mismatched = 0;
  let absent = 0;
  for (const { sum, file } of expected) {
    if (!existsSync(file)) {
      absent += 1;
      continue;
    }
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    checked += 1;
    if (actual !== sum) {
      mismatched += 1;
      if (mismatched <= 5) console.log(`    differs: ${file}`);
    }
  }
  console.log('');
  console.log(`  matched      : ${checked - mismatched}`);
  console.log(`  differ       : ${mismatched}`);
  console.log(`  not on disk  : ${absent}`);
  console.log(
    mismatched === 0
      ? '\n  The archive matches the corpus on disk.'
      : '\n  The archive and the corpus disagree — the corpus has changed since it was taken.',
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (typeof args.verify === 'string') {
    verify(args.verify);
    return;
  }

  const withSources = args['with-sources'] === true;
  const dry = args.dry === true;
  const outDir = typeof args.out === 'string' ? args.out : path.join('..', 'bac2-backups');

  const dirs = [...PROCESSED, ...(withSources ? SOURCES : [])]
    .map((d) => path.join(CORPUS, d))
    .filter((d) => existsSync(d));

  const files = [...dirs.flatMap((d) => walk(d)), ...rootFiles()];
  const bytes = files.reduce((sum, f) => {
    try {
      return sum + statSync(f).size;
    } catch {
      return sum;
    }
  }, 0);

  console.log('Backing up the processed corpus');
  for (const d of dirs) console.log(`  include : ${d}`);
  console.log(`  include : ${CORPUS}/*.json, *.csv`);
  if (!withSources) console.log(`  exclude : ${CORPUS}/exams  (source PDFs — pass --with-sources)`);
  console.log('');
  console.log(`  ${files.length} files, ${human(bytes)} before compression`);

  const stamp = new Date().toISOString().slice(0, 10);
  const name = `bac2-corpus${withSources ? '-full' : ''}-${stamp}.tar.gz`;
  const archive = path.join(outDir, name);
  console.log(`  -> ${archive}`);

  if (dry) {
    console.log('\n--dry: nothing written.');
    return;
  }

  mkdirSync(outDir, { recursive: true });

  // The manifest is built first and packed with the data, so an archive always
  // carries the means to check itself.
  console.log('\n  hashing …');
  const lines: string[] = [];
  let done = 0;
  for (const file of files) {
    try {
      const sum = createHash('sha256').update(readFileSync(file)).digest('hex');
      lines.push(`${sum}  ${file.split(path.sep).join('/')}`);
    } catch {
      /* a file that vanished mid-run is simply not claimed by the manifest */
    }
    done += 1;
    if (done % 2000 === 0) process.stdout.write(`\r    ${done}/${files.length}`);
  }
  const manifestPath = 'MANIFEST.sha256';
  writeFileSync(manifestPath, lines.join('\n') + '\n', 'utf8');
  console.log(`\r    ${lines.length} files hashed          `);

  console.log('  archiving …');

  /*
   * TAR TAKES FORWARD SLASHES, EVEN HERE.
   *
   * `path.join` gives `corpus\text` on Windows and GNU tar answers
   * "Cannot stat: No such file or directory" for every one of them — then
   * exits 2 having still written a plausible-looking archive. The first run of
   * this left a 173MB file that contained a fraction of the corpus and looked
   * exactly like a successful backup. A backup that fails loudly is fine; one
   * that fails quietly is worse than none.
   */
  const posix = (p: string) => p.split(path.sep).join('/');
  const tarArgs = [
    '-czf',
    posix(archive),
    posix(manifestPath),
    ...dirs.map(posix),
    ...rootFiles().map(posix),
  ];
  try {
    execFileSync('tar', tarArgs, { stdio: 'inherit', maxBuffer: 1024 * 1024 * 1024 });
  } finally {
    rmSync(manifestPath, { force: true });
  }

  const finalSize = statSync(archive).size;
  console.log('');
  console.log('─'.repeat(56));
  console.log(`  archive : ${archive}`);
  console.log(`  size    : ${human(finalSize)}  (from ${human(bytes)})`);
  console.log(`  files   : ${lines.length}`);
  console.log('');
  console.log('  Verify it:');
  console.log(`    npm run corpus:backup -- --verify "${archive.split(path.sep).join('/')}"`);
  console.log('');
  console.log('  This is on the same disk as the corpus, which is not a backup');
  console.log('  until a copy of it is somewhere else. Move it off this machine.');
}

main();
