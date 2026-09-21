# Visual evidence model

C4 design, as implemented in C5A (`prisma/migrations/20260921120000_visual_evidence`,
`src/lib/visual-selection.ts`, `src/lib/visual-evidence.ts`). Evidence: C1 `5f875e1`,
C2 `c215846`, C3 `7b33b39`, and the measurements below.

## Corrections made before implementation (C5 prechecks) — these override the sections below

1. **Access policy is per occurrence, not per asset.** Over all 3,222 occurrences:
   1,900 content hashes appear only in question context, 633 only in solution
   context, 635 only elsewhere (textbooks, banners) — and **1 appears in both**
   (`89a1da6e…`: lh/2015 1/phy_fr.pdf page 1 as a statement figure, se/2015 1/phy_en.pdf
   page 6 in solution-labelled territory). A byte-level exposure would put one
   policy on two contexts. `VisualOccurrence.access` holds it; the storage key is
   derived from (access, hash), so identical bytes under two policies are two
   objects in two scopes. This is also the cleaner model regardless of today's
   data: authorisation belongs to where and why something was printed, not to
   its pixels.
2. **A stale child locator never broadens evidence.** When a `question_evidence`
   relation's only locator no longer matches the text, consumer specificity is
   unavailable: for a part-targeted selection the visual is left out and reported
   in `unresolvedConsumers`; it is never re-read as exercise context. Its
   exercise-level ownership stands — a whole-exercise selection still includes it.
   Visuals independently classified `exercise_context` / `exercise_shared` still
   accompany any part.
3. **Enums follow the schema's house style** (lowercase snake values, `@@map`).
   Geometric values lose the `_GEOMETRIC` suffix (`unique | multiple | weak | none`);
   the tier is `automatic | gated | review | human` — `human` marks reviewer
   decisions that no backfill or rollback touches, and the unused `LEGACY_VERIFIED`
   is gone. The C1/C2/C3 artifacts remain the detailed authority; the tables keep
   only what a runtime decision needs plus `evidenceRun` to reach the artifact.
4. **The legacy verdict is a 1:1 table (`legacy_image_audits`), not a `questions`
   column**, so no backfill or rollback ever writes a `questions` row.
5. **Storage keys are two segments**, `question-images/<sha256>.<ext>` and
   `solution-images/<sha256>.<ext>`: `ownerFromKey` finds no owner in them, and the
   file route additionally refuses `solution-images/*` to non-admins outright.
   Solution bytes are served only by `/api/visuals/solution/[occurrenceId]`, after
   the server finds a submitted attempt or exam simulation for the exercise.

## Facts the design rests on

| Fact | Measured | Consequence |
|---|---|---|
| A DB `Question` row is a whole exercise (title + statement + all parts) | `load-exams.ts`: one row per `exam.exercises` entry | child questions are not persisted entities |
| Part labels are not stable across extractor versions | 24 Aug → 8 Sep: 2,632 / 3,522 exercises kept identical labels (75%); 7 → 8 Sep: 99.4% | no foreign key may point at a part |
| Part labels are not unique inside an exercise | 732 exercises repeat a label; 1,182 have no parts | a label cannot even identify a part |
| `sourceRef` hashes `subjectId:sha:index:order` | 99 of the 828 legacy rows no longer resolve | the backfill must re-derive rows, never trust stored refs |
| Identical bytes printed twice | 106 crops share content with another crop (53 hashes) | asset ≠ occurrence |
| Multi-part visuals | 153 crops are panels of 45+ captioned groups | a logical group above the occurrence |
| Crops are local only | `corpus/` is gitignored; `storage.ts` keys are `randomUUID()` | backfill must publish bytes under content-addressed keys |
| `question-images` is readable by any signed-in student | `api/files/[...key]/route.ts` skips ownership for that scope | solution bytes must not live there |
| Student and model already share one key rule | `figures.ts` `readFigure` = `QuestionBody` rule (`/` → public, else storage) | keep a single key per asset, resolved once |

## Entities

Three tables and one column. Everything else is derivable or audit-only.

### `VisualAsset` — what the bytes are
| Field | Why |
|---|---|
| `contentHash` (sha256, unique) | 106 duplicate crops must share one stored object; idempotent upload key |
| `storageKey` (unique) | content-addressed: `question-images/v/<hash>.<ext>` or `solution-images/v/<hash>.<ext>`; the one string both renderer and model resolve |
| `mediaType`, `byteSize` | `figures.ts` refuses unknown types and > 5 MB before base64 |
| `exposure` (`QUESTION` \| `SOLUTION_ONLY`) | decides the storage scope; `SOLUTION_ONLY` bytes are unreachable through the open `question-images` route |

### `VisualOccurrence` — where it was printed
| Field | Why |
|---|---|
| `assetId` | many occurrences → one asset |
| `paperSha256`, `cropName` (unique together) | stable natural key: the PDF's hash and `sha256(url)[:16]` — neither depends on the parser |
| `page`, `bboxX/Y/W/H`, `pageWidth/Height` | re-check geometry; crops stay precise, never whole pages |
| `readingOrder` | display and model order |
| `identityKind` (`DOCUMENT` \| `FIGURE`), `identityNumber`, `identitySuffix`, `identityText` | "Document 2" is how questions name visuals; `numberRaw` for unreadable Arabic numerals stays in `identityText` and `identityNumber` stays null |
| `groupKey`, `groupPart` | panels of one logical visual (below) |

### `QuestionVisual` — typed academic relation
| Field | Why |
|---|---|
| `questionId` → `Question` (exercise row), `occurrenceId` | one relation table instead of one per role |
| `role` | `QUESTION_EVIDENCE` (one part consumes it), `EXERCISE_SHARED` (2+ parts), `EXERCISE_CONTEXT` (stimulus-only or geometry-only), `PAPER_SHARED`, `SOLUTION_MATERIAL` |
| `consumers` (jsonb, advisory) | `[{label, labelOccurrence, fingerprint}]` — parts are not durable (75% label stability, 15% duplicate labels), so this is a validated hint, never a key |
| `introducedInStimulus` | 442 visuals are introduced in the stimulus and named by no question |
| `structuralConfidence`, `geometricConfidence`, `semanticConfidence` | three enums, never flattened |
| `tier` (`AUTO` \| `GATED` \| `REVIEWED` \| `LEGACY_VERIFIED`), `status` (`ACTIVE` \| `PENDING` \| `REJECTED`) | trust policy is data, not code |
| `evidenceRun` | sha256 of the `figure-ownership.json` that produced the row: the audit trail stays in the reproducible artifact, not the hot table |

### One column on `Question`
`legacyImagesVerdict` (nullable enum): the C3 audit verdict on the row's existing `contentImages`, so a verified-wrong legacy page is not served as a fallback.

## Child-question representation

The current extraction does **not** provide a stable part identifier (75% label
stability across two weeks; 15% of exercises repeat labels). So:

- ownership is persisted at the durable level, the exercise row;
- part consumption is an advisory locator `{label, labelOccurrence, fingerprint}`
  (fingerprint = normalised first 40 characters of the part's own question text);
- at read time a locator is honoured only if the fingerprint still matches the
  exercise's current part; otherwise the relation silently behaves as
  `EXERCISE_CONTEXT`. Nothing breaks when the parser improves; precision
  degrades to the exercise, which is still correct.

## Trust / backfill policy

Over the 1,750 C3-scope crops:

| Tier | Rule | Crops | Written as |
|---|---|---|---|
| AUTO | `DIRECT_REFERENCE` or `CORROBORATED`, owner not a second-pass container, no identity conflict | 1,150 (791 + 353 + 6 Geography direct) | `ACTIVE` |
| GATED | `CONTEXTUAL`, C2 `UNIQUE` on C1 `EXACT`, not second-pass | 376 | `PENDING`; promoted in bulk only after a pre-registered stratified audit of 50 passes with ≤ 1 error |
| REVIEW | `CONTEXTUAL` from C2 `MULTIPLE` (9), or on C1 `STRONG` (29) | 38 | `PENDING`, per-item review |
| EXCLUDED | owner is a second-pass container | 4 | not written |
| HOLD | `AMBIGUOUS` (21), `UNRESOLVED` (161) | 182 | occurrence + asset only, no relation |

**Second-pass container** (the CONTEXTUAL failure class): a run of ≥ 3
consecutive canonical containers, with ≥ 2 distinct mark values, that repeats an
earlier run's marks exactly — a second pass over the same exercises (a scheme,
or another copy). It flags exactly 4 owned crops, all answer-key text
(ls/2006 1/bio_en.pdf #8 "they die (1)", ls/2005 1/bio_en.pdf #5, lh/2006 1/bio_fr.pdf #7),
and zero DIRECT/CORROBORATED crops. Answer-mark text alone is **not** used: its
7 hits are genuine statements with scheme text appended to their last part.

Never written as question evidence: C2 `NONE` (747), position-uncertain (90),
`c2Contradiction` (10).

## Solution material

- Occurrences in scheme territory: 656. Written with `exposure = SOLUTION_ONLY`
  only when two signals agree (C1 scheme territory **and** the extractor's page
  split files the page as scheme): 631. The other 25 have one signal (another
  language copy is possible — se/2015 1/phy_en.pdf page 6 is the French
  statement) and are stored but never exposed, before or after reveal, until
  reviewed.
- Bytes live under `solution-images/`, which the open file route does not
  serve (it only waives ownership for `question-images`); a dedicated route
  serves them only for an attempt that has been submitted or revealed.
- No `SOLUTION_MATERIAL` relation is written yet: C3 does not assign scheme
  crops to exercises. The role exists for that later phase.
- Runtime rule, enforced twice: pre-answer selection filters
  `role <> SOLUTION_MATERIAL` **and** `asset.exposure = QUESTION`. An asset whose
  bytes also appear as question evidence (identical reprint) is `QUESTION`.

## Retrieval semantics

One resolver, `visualsFor(questionId, { part?, revealed })`, used by the student
renderer **and** by retrieval, so both receive the same `storageKey`s:

1. `status = ACTIVE`, `asset.exposure = QUESTION`, role ≠ `SOLUTION_MATERIAL`
   (unless `revealed` and the solution route is the caller).
2. No part known (today's case — a retrieved source is a whole exercise): every
   such visual of the exercise, in `readingOrder`.
3. Part known and its locator validates: `EXERCISE_CONTEXT` + `EXERCISE_SHARED`
   + `PAPER_SHARED` + `QUESTION_EVIDENCE` whose consumers include the part;
   `QUESTION_EVIDENCE` of sibling parts is dropped.
4. Never a visual of another exercise of the same paper unless it is related to
   this one (`PAPER_SHARED`).
5. A group (panels) is atomic under the `MAX_FIGURES` budget: all panels or
   none, and a dropped group is named in the manifest as missing evidence.
6. No `ACTIVE` relation → fall back to `contentImages`, unless
   `legacyImagesVerdict` marks it wrong.

Parity path: exercise → `QuestionVisual` → `VisualOccurrence` → `VisualAsset.storageKey`
→ (a) `QuestionBody` → `/api/files/<key>` → `getObject`; (b) `loadSourceFigures`
→ `readFigure(key)` → `getObject` → `AiRequest.images`. Same key, same bytes.

## Multi-part panels

One logical visual made of several crops (45+ groups, 153 crops): same caption
identity, same owner, same page, consecutive reading order. Each crop stays its
own occurrence and asset (no merged bytes); `groupKey` =
`<paperSha12>:<ordinal>:<kind>:<number><suffix>` and `groupPart` = position.
They are sent together, labelled "Document 2, panel 1 of 3". Split groups
(pages apart) are identity conflicts and were already held by C3.

## C2 contradictions (10)

| Paper | Crops | Finding |
|---|---|---|
| ls/2005 1/bio_fr.pdf | 5 | canonical under-extraction: one container for a 4-question paper; the crops belong to printed Questions II–IV; "named by container 1" is a numbering collision |
| ls/2007 1/bio_fr.pdf | 4 | same |
| se/2015 1/phy_en.pdf | 1 | another-language copy (French statement after the reprinted header), legitimately outside the extracted copy |

Policy: never persisted as relations; re-extraction of those two papers is the
fix. The third case also shows why a paper-header-only solution label needs a
second signal.

## Legacy 828

| Category | Rows | Treatment |
|---|---|---|
| Verified correct, crop available | 412 | write crop relations (AUTO/GATED as their tier says); `legacyImagesVerdict = CORRECT`; runtime prefers the crops; `contentImages` untouched |
| Previous/next or other exercise | 42 | `WRONG_EXERCISE`; the wrong page is no longer a fallback; the right exercise gets its crop relations |
| Wrong page | 1 | `WRONG_PAGE`; same |
| Header only | 2 | `HEADER_ONLY`; banner never served |
| Unresolved | 5 | `UNRESOLVED`; legacy page stays the fallback |
| No crop on page | 172 | `NO_CROP_ON_PAGE`; keep (likely vector art Mathpix did not crop) |
| No positioned source | 95 | `NO_POSITION_SOURCE`; keep |
| Untraceable `source_ref` | 99 | `UNTRACEABLE`; keep; re-trace after the next load re-keys rows |

Nothing is deleted. `contentImages` is legacy compatibility only.

## Proposed Prisma diff (not applied)

```prisma
enum VisualExposure { QUESTION  SOLUTION_ONLY }
enum VisualIdentityKind { DOCUMENT  FIGURE }
enum VisualRole { QUESTION_EVIDENCE  EXERCISE_SHARED  EXERCISE_CONTEXT  PAPER_SHARED  SOLUTION_MATERIAL }
enum StructuralConfidence { EXACT  STRONG  AMBIGUOUS  UNRESOLVED }
enum GeometricConfidence { UNIQUE_GEOMETRIC  MULTIPLE_GEOMETRIC  WEAK_GEOMETRIC  NO_GEOMETRIC }
enum SemanticConfidence { DIRECT_REFERENCE  CORROBORATED  CONTEXTUAL  AMBIGUOUS  UNRESOLVED }
enum VisualTier { AUTO  GATED  REVIEWED  LEGACY_VERIFIED }
enum VisualStatus { ACTIVE  PENDING  REJECTED }
enum LegacyImageVerdict { CORRECT  WRONG_EXERCISE  WRONG_PAGE  HEADER_ONLY  UNRESOLVED  NO_CROP_ON_PAGE  NO_POSITION_SOURCE  UNTRACEABLE }

model VisualAsset {
  id          String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  contentHash String         @unique @map("content_hash")
  storageKey  String         @unique @map("storage_key")
  mediaType   String         @map("media_type")
  byteSize    Int            @map("byte_size")
  exposure    VisualExposure
  createdAt   DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)

  occurrences VisualOccurrence[]

  @@map("visual_assets")
}

model VisualOccurrence {
  id             String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  assetId        String              @map("asset_id") @db.Uuid
  paperSha256    String              @map("paper_sha256")
  cropName       String              @map("crop_name")
  page           Int
  bboxX          Int                 @map("bbox_x")
  bboxY          Int                 @map("bbox_y")
  bboxW          Int                 @map("bbox_w")
  bboxH          Int                 @map("bbox_h")
  pageWidth      Int?                @map("page_width")
  pageHeight     Int?                @map("page_height")
  readingOrder   Int                 @map("reading_order")
  identityKind   VisualIdentityKind? @map("identity_kind")
  identityNumber Int?                @map("identity_number")
  identitySuffix String?             @map("identity_suffix")
  identityText   String?             @map("identity_text")
  groupKey       String?             @map("group_key")
  groupPart      Int?                @map("group_part")
  createdAt      DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)

  asset     VisualAsset      @relation(fields: [assetId], references: [id], onDelete: Restrict)
  relations QuestionVisual[]

  @@unique([paperSha256, cropName])
  @@index([paperSha256, page])
  @@index([groupKey])
  @@map("visual_occurrences")
}

model QuestionVisual {
  id                   String               @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  questionId           String               @map("question_id") @db.Uuid
  occurrenceId         String               @map("occurrence_id") @db.Uuid
  role                 VisualRole
  /// Advisory part locators [{label, labelOccurrence, fingerprint}] — parts are not durable.
  consumers            Json?
  introducedInStimulus Boolean              @default(false) @map("introduced_in_stimulus")
  structuralConfidence StructuralConfidence @map("structural_confidence")
  geometricConfidence  GeometricConfidence  @map("geometric_confidence")
  semanticConfidence   SemanticConfidence   @map("semantic_confidence")
  tier                 VisualTier
  status               VisualStatus
  evidenceRun          String               @map("evidence_run")
  createdAt            DateTime             @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime             @updatedAt @map("updated_at") @db.Timestamptz(6)

  question   Question         @relation(fields: [questionId], references: [id], onDelete: Cascade)
  occurrence VisualOccurrence @relation(fields: [occurrenceId], references: [id], onDelete: Cascade)

  @@unique([questionId, occurrenceId])
  @@index([questionId, status, role])
  @@index([occurrenceId])
  @@index([evidenceRun])
  @@map("question_visuals")
}

model Question {
  // … existing fields unchanged, including contentImages (legacy) …
  legacyImagesVerdict LegacyImageVerdict? @map("legacy_images_verdict")
  visuals             QuestionVisual[]
}
```

Deletion: a deleted exercise row cascades its relations only; occurrences and
assets survive (they are facts about the PDF). An asset cannot be deleted while
an occurrence uses it (`Restrict`).

## Backfill plan (not implemented)

`scripts/corpus/backfill-visuals.ts`:

- Inputs: the three artifacts, pinned by sha256 (`evidenceRun`), plus exams.json.
- `--dry-run` by default; `--apply` to write; `--subject`, `--paper` filters.
- Question rows are found by recomputing `sourceRef` exactly as `load-exams.ts`
  does; a crop whose exercise row does not exist is a reported conflict, never
  guessed.
- Upserts by natural key: asset by `contentHash`, occurrence by
  `(paperSha256, cropName)`, relation by `(questionId, occurrenceId)`. Storage
  upload by content-addressed key, skipped when the object already exists with
  the same checksum. Same artifact twice → zero changes on the second run.
- Report: inserts / updates / unchanged / skipped (with reason) / conflicts, per
  table and per subject.
- A relation row that exists with a different tier/status is never downgraded
  silently: `REVIEWED` and `REJECTED` rows are human decisions and are left alone.
- Rollback: delete `question_visuals` where `evidence_run = X`, then orphaned
  occurrences and assets; canonical `questions` rows and `contentImages` are
  never written except `legacy_images_verdict`, which is nulled by the same
  rollback. Storage objects are content-addressed and left for a separate sweep.
- Out of scope: textbook crops (581, no exam container), Arabic Geography
  unresolved crops (stored as assets/occurrences with no relation).

## Acceptance tests (to write before implementation)

1. **Exercise-context figure** — lh/2021 2/bio_fr.pdf-style: a Document introduced in the stimulus → role `EXERCISE_CONTEXT`, sent whenever the exercise is.
2. **Question-owned figure** — gs/2005 1/gs physics_en 1.pdf Fig. 3 → `QUESTION_EVIDENCE` consumer II.1; with part II.2 targeted it is not sent.
3. **Shared by siblings** — se/2009 1/geo.pdf Document 1 (Q2, Q3, Q5) → `EXERCISE_SHARED`, sent for each.
4. **Several figures, one question** — synthetic: part B.2 names figures 2 and 3 → both sent for B.2. The real paper this comes from (gs/2015 1/phy_en.pdf) currently fails it: Mathpix captioned the Fig. 3 crop `Fig. 1`, so only Fig. 2 attaches to B.2 — a known caption-source limit, kept visible as an expected failure.
5. **Multi-part panel** — ls/2017 2/bio_fr.pdf Document 2 (5 panels) → all panels or none under the budget.
6. **Solution excluded pre-submit** — a `SOLUTION_ONLY` asset never appears in `visualsFor(…, {revealed:false})`, nor via `/api/files/solution-images/...` for a student.
7. **Same solution after reveal** — the reveal route serves exactly that asset for a submitted attempt, and 404 for an unsubmitted one.
8. **Duplicate content** — two occurrences, one asset, one stored object; both relations resolve the same key.
9. **Legacy correct upgraded** — a `CORRECT` row now renders the crop, not the page; `contentImages` unchanged in the DB.
10. **Legacy wrong repaired** — lh/2015 2/bio_fr.pdf exercise 3 no longer shows exercise 2's Document 2; exercise 2 shows it.
11. **Unresolved preserved** — an `UNRESOLVED` legacy row still falls back to its page; an unresolved crop has no relation.
12. **Parity** — for one exercise, the keys rendered to the student and the bytes in `AiRequest.images` are identical (sha256 of bytes compared).
13. **Idempotence** — backfill twice on the same artifact: second run reports zero inserts/updates.
14. **Rollback** — rollback of an `evidenceRun` leaves `questions` byte-identical (row checksum before/after).
