/**
 * Backfills canonical visual evidence from the pinned C1/C2/C3 artifacts.
 *
 *   npm run corpus:visuals                                   # dry run (default): report only
 *   npm run corpus:visuals -- --paper "ls/2017 2/bio_fr.pdf" # restrict to papers containing this
 *   npm run corpus:visuals -- --subject Biology              # restrict by DB subject name
 *   npm run corpus:visuals -- --run <sha256>                 # refuse unless the artifact is this run
 *   npm run corpus:visuals -- --apply --confirm-db <dbname>  # write
 *   npm run corpus:visuals -- --rollback <sha256> --confirm-db <dbname>
 *
 * DRY RUN UNLESS TOLD OTHERWISE. `--apply` writes nothing unless `--confirm-db`
 * names the database the connection actually points at, so a wrong
 * DATABASE_URL cannot be written to by accident.
 *
 * FOUR SEPARATE DECISIONS. The asset existing, the occurrence existing, the
 * academic relation existing, and that relation being ACTIVE are decided
 * separately. Held and review material gets assets and occurrences; only
 * DIRECT_REFERENCE / CORROBORATED that pass every gate get an active relation.
 * CONTEXTUAL is written PENDING (gated or review) and never activated here.
 * AMBIGUOUS, UNRESOLVED, C2 contradictions and second-pass containers get no
 * relation at all.
 *
 * IDEMPOTENT. Every write is keyed on a natural key — asset by content hash,
 * occurrence by (paper, crop), relation by (exercise row, occurrence), legacy
 * audit by question — and compared before writing, so the same artifact
 * applied twice changes nothing the second time. Rows a reviewer decided
 * (`tier = human`) are never touched, by apply or by rollback.
 *
 * NEVER WRITES `questions`. Not `content_images`, not any column: the legacy
 * verdict lives in `legacy_image_audits`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Prisma } from '@prisma/client';

import { db } from '../../src/lib/db';
import { putContentAddressed } from '../../src/lib/storage';
import { partFingerprint, visualStorageKey, type ConsumerLocator } from '../../src/lib/visual-selection';

import { canonicalJson, secondPassOrdinals } from './visual-backfill-rules';

const ROOT = process.cwd();
const C1 = path.join(ROOT, 'corpus/.mapping/positioned-structure.json');
const C2 = path.join(ROOT, 'corpus/.mapping/figure-candidates.json');
const C3 = path.join(ROOT, 'corpus/.mapping/figure-ownership.json');
const EXAMS = path.join(ROOT, 'corpus/exams.json');

const OWNED = new Set(['DIRECT_REFERENCE', 'CORROBORATED', 'CONTEXTUAL']);
const MEDIA: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const APPLY = process.argv.includes('--apply');
const SKIP_UPLOAD = process.argv.includes('--skip-upload');
const ROLLBACK = arg('rollback');
const CONFIRM_DB = arg('confirm-db');
const ONLY_PAPER = arg('paper');
const ONLY_SUBJECT = arg('subject');
const EXPECT_RUN = arg('run');
const REPORT = arg('report');

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------
type C2Occ = {
  occurrenceId: string; pdfSha256: string; crop: string; contentHash: string; page: number | null;
  pageHeight?: number; pageWidth?: number; bbox: { x: number; y: number; w: number; h: number } | null;
  order: number; eligibility: string; geometricConfidence: string | null;
};
type C3Occ = {
  occurrenceId: string; pdfSha256: string; crop: string; page: number | null; papers: string[]; family?: string;
  scope: string; ownershipLevel: string; semanticConfidence: string | null;
  semanticOwner: { containerOrdinals: number[]; consumedBy?: string[]; introducedInStimulus?: boolean } | null;
  visualIdentity: { kind: string; number: number | null; suffix: string | null; text: string } | null;
  c2: { geometricConfidence: string | null; candidates: Array<{ ordinal: number; relation: string; structuralConfidence: string }> };
  multiPartVisual?: number; c2Contradiction?: unknown; evidence: string[];
};
type Exercise = { index: number | null; title?: string; statement?: string; marks?: number | null; parts?: Array<{ label: string; text: string }> };
type ExamRow = { path: string; sha256: string; exercises: Exercise[] };

function loadArtifacts() {
  const c3Raw = readFileSync(C3);
  const run = sha256(c3Raw);
  const c3 = JSON.parse(c3Raw.toString('utf-8')) as { inputs: { figureCandidatesSha256: string; positionedStructureSha256: string }; occurrences: C3Occ[] };
  const c2Raw = readFileSync(C2);
  const c1Raw = readFileSync(C1);
  // The chain must be the one C3 was computed from.
  if (sha256(c2Raw) !== c3.inputs.figureCandidatesSha256) throw new Error('figure-candidates.json is not the one figure-ownership.json was built from');
  if (sha256(c1Raw) !== c3.inputs.positionedStructureSha256) throw new Error('positioned-structure.json is not the one figure-ownership.json was built from');
  if (EXPECT_RUN && EXPECT_RUN !== run) throw new Error(`artifact is run ${run}, not the pinned ${EXPECT_RUN}`);
  const c2 = JSON.parse(c2Raw.toString('utf-8')) as { occurrences: C2Occ[] };
  const c1 = JSON.parse(c1Raw.toString('utf-8')) as Array<{ sha256: string; containers: Array<{ ordinal: number; alignment: { status: string } }> }>;
  const exams = (JSON.parse(readFileSync(EXAMS, 'utf-8')) as ExamRow[]).filter((e) => e.sha256);
  return { run, c1, c2, c3, exams };
}

// ---------------------------------------------------------------------------
// Rules carried over from the C4 policy
// ---------------------------------------------------------------------------
const ROLE: Record<string, 'question_evidence' | 'exercise_shared' | 'exercise_context' | 'paper_shared'> = {
  QUESTION: 'question_evidence',
  SUBQUESTION: 'question_evidence',
  EXERCISE_SHARED: 'exercise_shared',
  EXERCISE_CONTEXT: 'exercise_context',
  EXERCISE: 'exercise_context',
  PAPER_SHARED: 'paper_shared',
};

const lower = (s: string | null | undefined) => (s ? s.toLowerCase() : null);
const GEO: Record<string, string> = { UNIQUE_GEOMETRIC: 'unique', MULTIPLE_GEOMETRIC: 'multiple', WEAK_GEOMETRIC: 'weak', NO_GEOMETRIC: 'none' };

function locatorsFor(ex: Exercise, labels: string[]): ConsumerLocator[] {
  const parts = ex.parts ?? [];
  const out: ConsumerLocator[] = [];
  for (const label of labels) {
    const idx = parts.findIndex((p) => p.label === label || p.label.startsWith(`${label}.`));
    if (idx < 0) continue;
    const part = parts[idx]!;
    const labelOccurrence = parts.slice(0, idx).filter((p) => p.label === part.label).length;
    out.push({ label, labelOccurrence, fingerprint: partFingerprint(part.text) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
type PlannedAsset = { contentHash: string; mediaType: string; byteSize: number; file: string };
type PlannedOccurrence = {
  key: string; paperSha256: string; cropName: string; contentHash: string; page: number;
  bboxX: number; bboxY: number; bboxW: number; bboxH: number; pageWidth: number | null; pageHeight: number | null;
  readingOrder: number; access: 'question' | 'solution'; storageKey: string;
  identityKind: 'document' | 'figure' | null; identityNumber: number | null; identitySuffix: string | null; identityText: string | null;
  groupKey: string | null; groupPart: number | null; papers: string[];
};
type PlannedRelation = {
  questionId: string; occurrenceKey: string; role: string; consumers: ConsumerLocator[] | null; introducedInStimulus: boolean;
  structuralConfidence: string; geometricConfidence: string; semanticConfidence: string;
  tier: 'automatic' | 'gated' | 'review'; status: 'active' | 'pending'; category: string;
};

async function plan() {
  const { run, c1, c2, c3, exams } = loadArtifacts();
  const c2By = new Map(c2.occurrences.map((o) => [o.occurrenceId, o]));
  const examBySha = new Map<string, ExamRow>();
  for (const e of exams) if (!examBySha.has(e.sha256)) examBySha.set(e.sha256, e);
  const c1Status = new Map<string, string>();
  for (const p of c1) for (const c of p.containers) c1Status.set(`${p.sha256}#${c.ordinal}`, c.alignment.status);

  // Exercise rows: recompute source_ref exactly as load-exams.ts does.
  const subjects = await db.subject.findMany({ select: { id: true, name: true } });
  const refTo = new Map<string, { sha: string; ordinal: number }>();
  for (const e of exams) {
    e.exercises.forEach((ex, order) => {
      for (const s of subjects) refTo.set(sha256(`${s.id}:${e.sha256}:${ex.index}:${order}`), { sha: e.sha256, ordinal: order + 1 });
    });
  }
  const rows = await db.question.findMany({
    where: { sourceRef: { in: [...refTo.keys()] } },
    select: { id: true, sourceRef: true, contentImages: true, chapter: { select: { subject: { select: { name: true } } } } },
  });
  const questionsFor = new Map<string, Array<{ id: string; subject: string }>>();
  for (const r of rows) {
    const t = refTo.get(r.sourceRef!)!;
    const k = `${t.sha}#${t.ordinal}`;
    questionsFor.set(k, [...(questionsFor.get(k) ?? []), { id: r.id, subject: r.chapter.subject.name }]);
  }

  const subjectOk = (sha: string) => {
    if (!ONLY_SUBJECT) return true;
    const e = examBySha.get(sha);
    if (!e) return false;
    return e.exercises.some((_, i) => (questionsFor.get(`${sha}#${i + 1}`) ?? []).some((q) => q.subject.toLowerCase() === ONLY_SUBJECT.toLowerCase()));
  };
  const paperOk = (papers: string[]) => !ONLY_PAPER || papers.some((p) => p.includes(ONLY_PAPER));

  const assets = new Map<string, PlannedAsset>();
  const occurrences = new Map<string, PlannedOccurrence>();
  const relations: PlannedRelation[] = [];
  const counts = { occurrences: 0, byAccess: {} as Record<string, number>, relationCategories: {} as Record<string, number>, noRelation: {} as Record<string, number>, conflicts: [] as string[] };
  const bump = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n; };

  // Panel order within a group follows reading order.
  const groupMembers = new Map<string, Array<{ id: string; order: number }>>();
  for (const r of c3.occurrences) {
    if (!r.multiPartVisual || !r.visualIdentity || !r.semanticOwner) continue;
    const g = `${r.pdfSha256.slice(0, 12)}:${r.semanticOwner.containerOrdinals[0]}:${r.visualIdentity.kind}:${r.visualIdentity.number}${r.visualIdentity.suffix ?? ''}`;
    groupMembers.set(g, [...(groupMembers.get(g) ?? []), { id: r.occurrenceId, order: c2By.get(r.occurrenceId)!.order }]);
  }
  const groupOf = new Map<string, { key: string; part: number }>();
  for (const [g, members] of groupMembers) {
    members.sort((a, b) => a.order - b.order).forEach((m, i) => groupOf.set(m.id, { key: g, part: i + 1 }));
  }

  for (const r of c3.occurrences) {
    if (!['C3', 'c2-none', 'position-uncertain'].includes(r.scope)) continue; // textbooks, unextracted PDFs, banners
    if (!paperOk(r.papers) || !subjectOk(r.pdfSha256)) continue;
    const o = c2By.get(r.occurrenceId)!;
    if (!o.bbox || o.page === null) continue;

    const file = path.join(ROOT, r.crop);
    if (!existsSync(file)) { counts.conflicts.push(`crop file missing: ${r.crop}`); continue; }
    const mediaType = MEDIA[path.extname(file).toLowerCase()];
    if (!mediaType) { counts.conflicts.push(`unsupported media: ${r.crop}`); continue; }
    const bytes = readFileSync(file);
    if (sha256(bytes) !== o.contentHash) { counts.conflicts.push(`bytes changed since C2: ${r.crop}`); continue; }
    assets.set(o.contentHash, { contentHash: o.contentHash, mediaType, byteSize: bytes.length, file });

    const access: 'question' | 'solution' = r.ownershipLevel === 'SOLUTION_MATERIAL' ? 'solution' : 'question';
    const ident = r.visualIdentity;
    const group = groupOf.get(r.occurrenceId) ?? null;
    const key = `${r.pdfSha256}|${r.crop.split('/').pop()!.split('.')[0]}`;
    occurrences.set(key, {
      key, paperSha256: r.pdfSha256, cropName: r.crop.split('/').pop()!.split('.')[0]!, contentHash: o.contentHash,
      page: o.page, bboxX: o.bbox.x, bboxY: o.bbox.y, bboxW: o.bbox.w, bboxH: o.bbox.h,
      pageWidth: o.pageWidth ?? null, pageHeight: o.pageHeight ?? null, readingOrder: o.order, access,
      storageKey: visualStorageKey(access, o.contentHash, mediaType),
      identityKind: ident ? (ident.kind === 'figure' ? 'figure' : 'document') : null,
      identityNumber: ident?.number ?? null, identitySuffix: ident?.suffix ?? null, identityText: ident?.text ?? null,
      groupKey: group?.key ?? null, groupPart: group?.part ?? null, papers: r.papers,
    });
    counts.occurrences += 1;
    bump(counts.byAccess, access);

    // --- relation decision, separate from the occurrence ---
    if (r.scope !== 'C3') { bump(counts.noRelation, r.c2Contradiction ? 'C2 contradiction' : r.ownershipLevel === 'SOLUTION_MATERIAL' ? 'solution material (no exercise owner yet)' : `C2 ${r.scope}`); continue; }
    if (!r.semanticConfidence || !OWNED.has(r.semanticConfidence) || !r.semanticOwner) {
      bump(counts.noRelation, `${r.semanticConfidence ?? 'none'}${r.family === 'geography-ar' ? ' (Arabic Geography)' : ''}`);
      continue;
    }
    const exam = examBySha.get(r.pdfSha256)!;
    const second = secondPassOrdinals(exam.exercises);
    if (r.semanticOwner.containerOrdinals.some((c) => second.has(c))) { bump(counts.noRelation, 'second-pass container'); continue; }

    const sem = r.semanticConfidence;
    const geo = r.c2.geometricConfidence ?? 'NO_GEOMETRIC';
    let tier: PlannedRelation['tier'];
    let status: PlannedRelation['status'];
    let category: string;
    if (sem === 'DIRECT_REFERENCE' || sem === 'CORROBORATED') {
      tier = 'automatic'; status = 'active'; category = `automatic/${sem.toLowerCase()}`;
    } else {
      const owner = r.semanticOwner.containerOrdinals[0]!;
      const structural = c1Status.get(`${r.pdfSha256}#${owner}`);
      if (geo === 'UNIQUE_GEOMETRIC' && structural === 'EXACT') { tier = 'gated'; status = 'pending'; category = 'gated/contextual'; }
      else { tier = 'review'; status = 'pending'; category = `review/contextual (${geo.toLowerCase()}, ${String(structural).toLowerCase()})`; }
    }

    for (const ordinal of r.semanticOwner.containerOrdinals) {
      const qs = questionsFor.get(`${r.pdfSha256}#${ordinal}`) ?? [];
      if (qs.length === 0) { counts.conflicts.push(`no exercise row for ${r.papers[0]} #${ordinal} (${r.occurrenceId})`); continue; }
      const ex = exam.exercises[ordinal - 1]!;
      const consumed = r.semanticOwner.consumedBy ?? [];
      const locators = consumed.length > 0 ? locatorsFor(ex, consumed) : null;
      for (const q of qs) {
        if (ONLY_SUBJECT && q.subject.toLowerCase() !== ONLY_SUBJECT.toLowerCase()) continue;
        relations.push({
          questionId: q.id, occurrenceKey: key, role: ROLE[r.ownershipLevel] ?? 'exercise_context',
          consumers: locators && locators.length > 0 ? locators : null,
          introducedInStimulus: Boolean(r.semanticOwner.introducedInStimulus),
          structuralConfidence: lower(c1Status.get(`${r.pdfSha256}#${ordinal}`)) ?? 'unresolved',
          geometricConfidence: GEO[geo] ?? 'none',
          semanticConfidence: sem.toLowerCase(),
          tier, status, category,
        });
        bump(counts.relationCategories, category);
      }
    }
  }

  // --- legacy content_images: verdict per traceable row ---
  const legacyRows = await db.question.findMany({
    where: { NOT: { contentImages: { isEmpty: true } } },
    select: { id: true, sourceRef: true, contentImages: true, chapter: { select: { subject: { select: { name: true } } } } },
  });
  const byPage = new Map<string, C3Occ[]>();
  const ownedPages = new Map<string, Set<number>>();
  for (const r of c3.occurrences) {
    const k = `${r.pdfSha256}|${r.page}`;
    byPage.set(k, [...(byPage.get(k) ?? []), r]);
    if (r.semanticConfidence && OWNED.has(r.semanticConfidence)) {
      for (const o of r.semanticOwner?.containerOrdinals ?? []) {
        const ok = `${r.pdfSha256}#${o}`;
        ownedPages.set(ok, new Set([...(ownedPages.get(ok) ?? []), r.page!]));
      }
    }
  }
  const positioned = new Set(c1.map((p) => p.sha256));
  const activeQuestions = new Set(relations.filter((r) => r.status === 'active').map((r) => r.questionId));
  const legacy: Array<{ questionId: string; verdict: string; treatment: string }> = [];
  for (const row of legacyRows) {
    const t = row.sourceRef ? refTo.get(row.sourceRef) : undefined;
    const m = /-p(\d+)\.png$/.exec(row.contentImages[0] ?? '');
    let verdict: string;
    if (!t || !m) verdict = 'untraceable';
    else if (!positioned.has(t.sha)) verdict = 'no_position_source';
    else verdict = legacyVerdict(t.ordinal, byPage.get(`${t.sha}|${Number(m[1])}`) ?? [],
      [...(ownedPages.get(`${t.sha}#${t.ordinal}`) ?? [])].some((p) => p !== Number(m[1])));
    if (ONLY_PAPER && !(t && (examBySha.get(t.sha)?.path ?? '').replace(/\\/g, '/').includes(ONLY_PAPER))) continue;
    if (ONLY_SUBJECT && row.chapter.subject.name.toLowerCase() !== ONLY_SUBJECT.toLowerCase()) continue;
    // A legacy page that shows only marking-scheme material must never stay a
    // pre-answer fallback. None exist in the C3 audit; if one appears it is a
    // conflict to resolve by hand, not something to classify quietly.
    if (t && m && verdict === 'unresolved') {
      const recs = byPage.get(`${t.sha}|${Number(m[1])}`) ?? [];
      if (recs.length > 0 && recs.every((r) => r.ownershipLevel === 'SOLUTION_MATERIAL')) {
        counts.conflicts.push(`legacy page of question ${row.id} shows only solution material`);
      }
    }
    const treatment =
      verdict === 'untraceable' ? 'cannot trace'
        : ['wrong_exercise', 'wrong_page', 'header_only'].includes(verdict) ? 'legacy fallback suppressed'
          : verdict === 'correct' && activeQuestions.has(row.id) ? 'precise crop replaces legacy'
            : 'legacy retained as fallback';
    legacy.push({ questionId: row.id, verdict, treatment });
  }

  return { run, assets, occurrences, relations, legacy, counts };
}

/** Port of audit_legacy_figures.verdict: what the crops on the legacy page say. */
function legacyVerdict(ordinal: number, pageRecs: C3Occ[], ownedElsewhere: boolean): string {
  if (pageRecs.length === 0) return 'no_crop_on_page';
  const owners = new Set<number>();
  for (const r of pageRecs) {
    if (r.semanticConfidence && OWNED.has(r.semanticConfidence)) for (const o of r.semanticOwner?.containerOrdinals ?? []) owners.add(o);
  }
  if (owners.has(ordinal)) return 'correct';
  if (owners.size > 0) return 'wrong_exercise';
  if (ownedElsewhere) return 'wrong_page';
  if (pageRecs.every((r) => r.ownershipLevel === 'SOLUTION_MATERIAL')) return 'unresolved';
  if (pageRecs.every((r) => r.scope === 'non-academic')) return 'header_only';
  return 'unresolved';
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
type Tally = { inserted: number; updated: number; unchanged: number; skipped: number; protected: number };
const tally = (): Tally => ({ inserted: 0, updated: 0, unchanged: 0, skipped: 0, protected: 0 });

async function currentDatabase(): Promise<string> {
  const rows = await db.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  return rows[0]!.current_database;
}

async function apply(p: Awaited<ReturnType<typeof plan>>) {
  const result = { assets: tally(), occurrences: tally(), relations: tally(), legacyAudits: tally(), uploads: { written: 0, unchanged: 0 } };

  // Bytes first: a relation must never point at a key with nothing behind it.
  if (!SKIP_UPLOAD) {
    const byKey = new Map<string, PlannedOccurrence>();
    for (const o of p.occurrences.values()) byKey.set(o.storageKey, o);
    for (const o of byKey.values()) {
      const a = p.assets.get(o.contentHash)!;
      const outcome = await putContentAddressed(o.storageKey, readFileSync(a.file), a.mediaType);
      result.uploads[outcome] += 1;
    }
  }

  await db.$transaction(async (tx) => {
    // Assets
    const hashes = [...p.assets.keys()];
    const existingAssets = new Map((await tx.visualAsset.findMany({ where: { contentHash: { in: hashes } } })).map((a) => [a.contentHash, a]));
    const newAssets = [...p.assets.values()].filter((a) => !existingAssets.has(a.contentHash));
    for (const a of p.assets.values()) {
      const e = existingAssets.get(a.contentHash);
      if (!e) continue;
      if (e.mediaType !== a.mediaType || e.byteSize !== a.byteSize) throw new Error(`asset ${a.contentHash} disagrees with the stored row`);
      result.assets.unchanged += 1;
    }
    if (newAssets.length) await tx.visualAsset.createMany({ data: newAssets.map(({ file: _f, ...a }) => a) });
    result.assets.inserted += newAssets.length;
    const assetId = new Map((await tx.visualAsset.findMany({ where: { contentHash: { in: hashes } }, select: { id: true, contentHash: true } })).map((a) => [a.contentHash, a.id]));

    // Occurrences
    const shas = [...new Set([...p.occurrences.values()].map((o) => o.paperSha256))];
    const existingOcc = new Map((await tx.visualOccurrence.findMany({ where: { paperSha256: { in: shas } } })).map((o) => [`${o.paperSha256}|${o.cropName}`, o]));
    const toCreate: Prisma.VisualOccurrenceCreateManyInput[] = [];
    for (const o of p.occurrences.values()) {
      const data = {
        assetId: assetId.get(o.contentHash)!, paperSha256: o.paperSha256, cropName: o.cropName, page: o.page,
        bboxX: o.bboxX, bboxY: o.bboxY, bboxW: o.bboxW, bboxH: o.bboxH, pageWidth: o.pageWidth, pageHeight: o.pageHeight,
        readingOrder: o.readingOrder, access: o.access, storageKey: o.storageKey, identityKind: o.identityKind,
        identityNumber: o.identityNumber, identitySuffix: o.identitySuffix, identityText: o.identityText,
        groupKey: o.groupKey, groupPart: o.groupPart,
      };
      const e = existingOcc.get(o.key);
      if (!e) { toCreate.push({ ...data, evidenceRun: p.run }); continue; }
      const differs = (Object.keys(data) as Array<keyof typeof data>).some((k) => e[k] !== data[k]);
      if (differs) { await tx.visualOccurrence.update({ where: { id: e.id }, data }); result.occurrences.updated += 1; }
      else result.occurrences.unchanged += 1;
    }
    if (toCreate.length) await tx.visualOccurrence.createMany({ data: toCreate });
    result.occurrences.inserted += toCreate.length;
    const occId = new Map((await tx.visualOccurrence.findMany({ where: { paperSha256: { in: shas } }, select: { id: true, paperSha256: true, cropName: true } })).map((o) => [`${o.paperSha256}|${o.cropName}`, o.id]));

    // Relations
    const qids = [...new Set(p.relations.map((r) => r.questionId))];
    const existingRel = new Map((await tx.questionVisual.findMany({ where: { questionId: { in: qids } } })).map((r) => [`${r.questionId}|${r.occurrenceId}`, r]));
    const relCreate: Prisma.QuestionVisualCreateManyInput[] = [];
    for (const r of p.relations) {
      const occurrenceId = occId.get(r.occurrenceKey)!;
      const data = {
        role: r.role as Prisma.QuestionVisualCreateManyInput['role'],
        consumers: r.consumers ? (r.consumers as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        introducedInStimulus: r.introducedInStimulus,
        structuralConfidence: r.structuralConfidence as Prisma.QuestionVisualCreateManyInput['structuralConfidence'],
        geometricConfidence: r.geometricConfidence as Prisma.QuestionVisualCreateManyInput['geometricConfidence'],
        semanticConfidence: r.semanticConfidence as Prisma.QuestionVisualCreateManyInput['semanticConfidence'],
        tier: r.tier, status: r.status, evidenceRun: p.run,
      };
      const e = existingRel.get(`${r.questionId}|${occurrenceId}`);
      if (!e) { relCreate.push({ questionId: r.questionId, occurrenceId, ...data }); continue; }
      if (e.tier === 'human') { result.relations.protected += 1; continue; }
      const same =
        e.role === data.role && e.introducedInStimulus === data.introducedInStimulus &&
        e.structuralConfidence === data.structuralConfidence && e.geometricConfidence === data.geometricConfidence &&
        e.semanticConfidence === data.semanticConfidence && e.tier === data.tier && e.status === data.status &&
        e.evidenceRun === data.evidenceRun && canonicalJson(e.consumers ?? null) === canonicalJson(r.consumers ?? null);
      if (same) { result.relations.unchanged += 1; continue; }
      await tx.questionVisual.update({ where: { id: e.id }, data });
      result.relations.updated += 1;
    }
    if (relCreate.length) await tx.questionVisual.createMany({ data: relCreate });
    result.relations.inserted += relCreate.length;

    // Legacy audits
    const existingAudit = new Map((await tx.legacyImageAudit.findMany({ where: { questionId: { in: p.legacy.map((l) => l.questionId) } } })).map((a) => [a.questionId, a]));
    const auditCreate: Prisma.LegacyImageAuditCreateManyInput[] = [];
    for (const l of p.legacy) {
      const e = existingAudit.get(l.questionId);
      const verdict = l.verdict as Prisma.LegacyImageAuditCreateManyInput['verdict'];
      if (!e) { auditCreate.push({ questionId: l.questionId, verdict, evidenceRun: p.run }); continue; }
      if (e.verdict === verdict && e.evidenceRun === p.run) { result.legacyAudits.unchanged += 1; continue; }
      await tx.legacyImageAudit.update({ where: { questionId: l.questionId }, data: { verdict, evidenceRun: p.run } });
      result.legacyAudits.updated += 1;
    }
    if (auditCreate.length) await tx.legacyImageAudit.createMany({ data: auditCreate });
    result.legacyAudits.inserted += auditCreate.length;
  }, { timeout: 600_000, maxWait: 60_000 });

  return result;
}

async function rollback(run: string) {
  return db.$transaction(async (tx) => {
    const relations = await tx.questionVisual.deleteMany({ where: { evidenceRun: run, NOT: { tier: 'human' } } });
    const audits = await tx.legacyImageAudit.deleteMany({ where: { evidenceRun: run } });
    // Occurrences this run created, unless a surviving (human) relation still uses them.
    const occurrences = await tx.visualOccurrence.deleteMany({ where: { evidenceRun: run, relations: { none: {} } } });
    const assets = await tx.visualAsset.deleteMany({ where: { occurrences: { none: {} } } });
    return { relations: relations.count, legacyAudits: audits.count, occurrences: occurrences.count, assets: assets.count };
  }, { timeout: 600_000 });
}

// ---------------------------------------------------------------------------
async function main() {
  const database = await currentDatabase();
  const writes = APPLY || ROLLBACK;
  if (writes && CONFIRM_DB !== database) {
    throw new Error(`refusing to write: connected to "${database}", --confirm-db says "${CONFIRM_DB ?? '(none)'}"`);
  }

  /*
   * A REMOTE DATABASE NEEDS REMOTE BYTES. Active relations take precedence over
   * a question's legacy page, so relations pointing at crops that were written
   * to this machine's ./uploads — or not written at all — would replace working
   * pages with broken images for every exercise they cover. Against anything but
   * a local database: S3 storage is required, and --skip-upload is refused.
   */
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? '').hostname;
    } catch {
      return '';
    }
  })();
  const localDb = host === 'localhost' || host === '127.0.0.1';
  if (APPLY && !localDb) {
    if (SKIP_UPLOAD) throw new Error('refusing --skip-upload against a non-local database: relations would point at missing crops');
    if (process.env.STORAGE_DRIVER !== 's3' || !process.env.S3_ACCESS_KEY_ID) {
      throw new Error('refusing to apply against a non-local database without STORAGE_DRIVER=s3 and S3 credentials');
    }
  }

  if (ROLLBACK) {
    const out = await rollback(ROLLBACK);
    console.log(JSON.stringify({ database, rollback: ROLLBACK, deleted: out }, null, 2));
    return;
  }

  const p = await plan();
  const count = (xs: Array<Record<string, unknown>>, k: string) =>
    xs.reduce<Record<string, number>>((acc, x) => ({ ...acc, [String(x[k])]: (acc[String(x[k])] ?? 0) + 1 }), {});
  const report: Record<string, unknown> = {
    database,
    mode: APPLY ? 'apply' : 'dry-run',
    evidenceRun: p.run,
    filters: { paper: ONLY_PAPER, subject: ONLY_SUBJECT },
    planned: {
      assets: p.assets.size,
      occurrences: p.occurrences.size,
      occurrencesByAccess: p.counts.byAccess,
      distinctStorageObjects: new Set([...p.occurrences.values()].map((o) => o.storageKey)).size,
      relations: p.relations.length,
      relationsByCategory: p.counts.relationCategories,
      relationsByStatus: count(p.relations as unknown as Array<Record<string, unknown>>, 'status'),
      relationsByRole: count(p.relations as unknown as Array<Record<string, unknown>>, 'role'),
      occurrencesWithoutRelation: p.counts.noRelation,
      legacyByVerdict: count(p.legacy, 'verdict'),
      legacyByTreatment: count(p.legacy, 'treatment'),
      conflicts: p.counts.conflicts.length,
    },
  };
  if (APPLY) report.applied = await apply(p);
  if (p.counts.conflicts.length) report.conflictSamples = p.counts.conflicts.slice(0, 20);
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (REPORT) (await import('node:fs')).writeFileSync(REPORT, text + '\n');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
