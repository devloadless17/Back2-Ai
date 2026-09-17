# Nour — verification debt

**Status: implementation complete, runtime verification pending.**

Written 2026-09-18. Nothing in this file has been checked. It is a list of what
somebody must actually run and actually look at before the Nour phase can be
called verified.

Two things blocked verification on the machine this was built on:

- **Docker was not running**, so the local database was unavailable. The
  provenance SQL has never executed.
- **No browser was available**, so every visual claim is reasoned from code.

Typecheck, 381 tests and the production build all pass. None of that exercises
a query against real rows or renders a pixel.

---

## Database QA — the provenance query has never run

`src/lib/vector.ts` (`searchQuestions`) and `src/lib/queries/cited-sources.ts`.

Run each against representative real records and check the structured
provenance reaching the client is correct:

- [ ] official exam question — `official: true`, year and session present
- [ ] exam question **with barème** — `marks` summed correctly from the criteria
- [ ] question **with official solution** — `hasSolution: true`
- [ ] textbook passage — `official: false`, `chunkKind` populated
- [ ] mixed official + textbook in one answer — ordering puts official first
- [ ] historical conversation — reload, evidence identical to the streamed answer
- [ ] missing/deleted source id — the answer shows fewer sources, never breaks
- [ ] **malformed / non-array barème** — see below

### The malformed-barème case is the one that matters

`jsonb_array_elements` is evaluated **before** any `WHERE` that was meant to
guard it, and it **raises** on a non-array. A single question whose barème was
stored as an object would have failed the entire search, not just that row.

It is now wrapped in a `CASE`, which short-circuits. That fix is reasoned, not
observed. Confirm it with a row whose `bareme` is a JSON object rather than an
array — and if none exists, make one in a scratch database rather than assuming
none ever will.

### Also unconfirmed

- The three-table id lookup in `citedSources` assumes a uuid cannot collide
  across `questions`, `content_chunks` and `user_references`. That is true of
  `gen_random_uuid()`, but has never been exercised.
- `marks` arrives from Postgres as a numeric and is coerced with `Number()`.
  Check a decimal barème (`2.5`) survives.

---

## Visual QA — nobody has seen any of this

Widths, at minimum 360 / 390 / 430 / desktop:

- [ ] long streaming answer
- [ ] equation-heavy answer, KaTeX inline and display
- [ ] very long answer
- [ ] very short answer

Language and direction:

- [ ] Arabic interface
- [ ] **Arabic answer inside an LTR interface** — the case the subject-language
      rule creates on purpose
- [ ] French answer in an English interface
- [ ] mixed script in one answer
- [ ] long Arabic chapter name in expanded Evidence
- [ ] long French chapter name in expanded Evidence

Evidence:

- [ ] one source
- [ ] many sources
- [ ] official + textbook together
- [ ] textbook only
- [ ] student upload
- [ ] marks absent · year absent · session absent · no solution · no barème
- [ ] expanded panel at 360px — **the truncation this component was built to
      remove must not reappear inside it**

States:

- [ ] `needsPassage` refusal
- [ ] `offProgramme` refusal, with the subject list
- [ ] `retracted` — an answer written and then withdrawn
- [ ] technical failure, and the retry actually resending
- [ ] fresh conversation, no subject chosen
- [ ] conversation with history

Streaming and scroll:

- [ ] streaming while at the bottom — follows
- [ ] **scrolling upward mid-stream — must NOT be dragged back**
- [ ] jump-to-latest appears only while streaming and away from the bottom
- [ ] no height jump when the answer completes

Mobile specifics:

- [ ] keyboard open, composer reachable
- [ ] composer subject chip does not wrap badly at 360px
- [ ] bottom navigation does not overlap the composer
- [ ] dark mode, every state above

---

## Known-unbuilt, deliberately

- **"Explain more simply" / "Ask why"** — needs a composer prefill mechanism
  that does not exist. Not built rather than faked.
- **Paper number / question number on the paper** — not in the schema. Must stay
  missing rather than become invented UI.

---

# Practice + Examiner Mode — added 2026-09-18

Same conditions: no Docker, no browser. Implementation and static verification
only.

## Database QA

- [ ] `repeatedCriteria` returns real counts after a second failure of the same
      criterion — the attempt is persisted before it runs, so a criterion failed
      twice must report **2**, not 1
- [ ] a criterion failed once returns nothing (threshold is 2)
- [ ] `marksOf` sums a decimal barème (`2.5`) correctly
- [ ] a question with `source_exam_id` shows year and session in the masthead
- [ ] a textbook question shows **no** official masthead
- [ ] a generated problem shows no official masthead

## Visual QA

Question:

- [ ] official masthead — subject, year, session, marks
- [ ] textbook question — no masthead, chapter name instead
- [ ] Arabic question body, French question body, mixed script
- [ ] equation-heavy question, inline and display
- [ ] question with images/figures
- [ ] MCQ vs open vs problem
- [ ] very long criterion text in Examiner Mode

Marking:

- [ ] `✓` earned / `◐` partial / `×` lost, each with its colour
- [ ] Nour's note appears **only** where a mark was lost
- [ ] a fully-earned criterion stays a single concise row
- [ ] mixed provisional / non-provisional criteria in one result
- [ ] recurring-loss line appears only at 2+ and reads correctly
- [ ] `needs_human_review` — the new copy, not the old provider-key message
- [ ] barème only / solution only / both / neither
- [ ] dark mode, all of the above

## Layout and actions — added after the restructure

The four gaps above are now closed in code. None of it has been seen.

- [ ] **360 / 390 / 430** — the stacked sequence reads question, answer, mark,
      criteria, model answer, action, in that order
- [ ] **xl and above** — question and answer on the left, result on the right;
      the eye moves between them without scrolling
- [ ] **1024-1279** — deliberately still stacked. Confirm the single column at
      that width is not wasteful enough to want `lg`
- [ ] very wide desktop — the question does not become an absurd line of prose
- [ ] long mathematical question beside a long barème at xl
- [ ] long submitted answer preserved and readable after marking
- [ ] long French criterion, long Arabic criterion, no horizontal overflow
- [ ] Arabic question inside an English interface, at xl — the left/right
      comparison must stay comprehensible
- [ ] model answer expanded — long solution inside `<details>`
- [ ] `solutionIsOfficial` false on a generated problem: heading reads "Model
      answer", NOT "Official solution"
- [ ] no solution at all — the result still feels complete
- [ ] `needs_human_review` inside the new layout, not dressed as a final mark
- [ ] mixed provisional criteria after the restructure
- [ ] recurring-loss callout after the restructure
- [ ] first / middle / **final** question — `next` on the last lands on the
      completion state rather than a dead button
- [ ] the flag control still reachable in the marked state

## Known not done

- **No "try again".** Nothing in the runner or the API supports re-marking an
  attempt, and a button that silently created a second one would misrepresent
  the record. Left unbuilt rather than faked.

---

## Progress + Bac Map (2026-09-17)

Docker is unavailable and no browser is available, so none of this has been run
against a database or seen rendered. All of it is read off the source.

### Data states nobody has looked at

- [ ] mastery 100% / practised 10% — the narrow-but-strong account, the whole
      reason the two figures are separate
- [ ] mastery low / practised high — the opposite, broad and weak
- [ ] a subject with no attempts at all — must read "Not started", never 0%
- [ ] an untouched chapter in the Bac Map — same rule, against a chapter name
- [ ] a material-only chapter — "Study material available · No indexed
      past-paper questions", and the link reaching real reading
- [ ] a chapter with questions and no attempts — the count and "Start practice"
- [ ] a chapter practised whose questions were later rejected — evidence still
      shown, no practice offered
- [ ] a recurring criterion confined to one chapter — chapter link
- [ ] a recurring criterion spanning chapters in one subject — subject link,
      and NO chapter named anywhere in the row
- [ ] a recurring criterion spanning subjects — no destination at all. Note
      this cannot currently arise: the grouping key includes the subject. The
      branch is tested as a pure function.
- [ ] a criterion lost more than five times whose first five occasions share a
      chapter but whose later ones do not — routing must still refuse the
      chapter link. This is the case `occasions` being capped at five would
      have got wrong.
- [ ] an old `/performance` bookmark, with and without query parameters
- [ ] Dashboard and Progress side by side — the next action must read the same
- [ ] a large track — a GS account has more than a thousand chapters across the
      map; confirm the page is not absurd and the two chapter queries hold up

### Visual, unseen

- [ ] 360 / 390 / 430 — the subject list is the stacked one, NOT the table
- [ ] sm and up — the table appears, with its contained sideways scroll
- [ ] a long Arabic chapter name in an expanded Bac Map subject at 390px
- [ ] a long French criterion in the recurring-loss list, wrapping not truncated
- [ ] Arabic interface, RTL — `Meter` captions, the `details` disclosure
      triangle, and column order in the table
- [ ] every subject expanded at once in the Bac Map
- [ ] a subject with zero chapters returned
- [ ] dark mode, all of the above

### Known limitations, recorded not fixed

- **Criterion identity is the raw examiner string**, normalised for whitespace,
  numbering, kashida, case and trailing punctuation, keyed with the subject.
  Trivial wording differences split what a reader would call one criterion. The
  error is always under-counting, so a real pattern can fall below the
  two-occurrence floor and go unshown; it cannot invent one. Fuzzy matching
  would fix the splitting and introduce the opposite failure — two different
  criteria merged into one confident insight — which is a worse lie than
  silence. Documented in `recurring-losses.ts`, not solved.
- **The dashboard still maps `NextUp` to its own copy inline.** Both surfaces
  read the same `getNextUp`, so the recommendation cannot differ, but the
  wording is derived in two places. Extracting it means editing a file that
  carries unrelated in-flight work, so it was left alone.
- **`pastPaperCoverage` has no surface.** The calculation was preserved and
  correctly named when it came off Progress, but nothing renders it yet. It
  belongs in a content-health view.

---

## Progress — mastery and coverage surfaced (2026-09-17)

Docker is unavailable, so none of the following has been seen against a
database. All of it is read off the source.

**Unverified, needs a real account:**

- The reading sentence on a live track. `evidenceReading` is unit-tested, but
  which of the five readings a real student actually lands on is unknown — the
  0.65 / 0.6 thresholds are a judgement, not a fit. If most accounts read
  `early`, the sentence is useless and the thresholds want moving.
- `trackMastery` across subjects. It weights each subject by chapters
  attempted, which is exact arithmetic, but nobody has looked at what it reads
  for an account with one heavily worked subject and four untouched ones.
- The subject table at 42rem on a 360px phone. The sideways scroll is
  contained and was already there, but five columns is two more than it held
  and I have not seen it render.
- The Arabic column order and the `Meter` caption under RTL.
- `attemptsNeeded` copy for a subject at nine attempts — the one attempt short
  case, which is where the wording matters most.

**Known limitation, not debt:** the "Programme covered" stat tile counts
*questions available*, while the new "Practised" column counts *chapters
attempted*. They are different denominators and both labels say so, but two
coverage-shaped numbers on one page is a real risk of confusion. Worth
resolving when `/performance` is merged in.
