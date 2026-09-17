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

## Known not done in this phase

- **Mobile sequential flow** and **desktop two-column comparison** are NOT
  implemented. The result still appears below the question in one column at
  every width. The brief asked for progressive disclosure on mobile and a
  side-by-side comparison on desktop; neither was built.
- **Post-marking actions** were not audited or reorganised.
- **Official solution placement** was not changed — it still renders after the
  marking, which happens to match the intended hierarchy, but was not
  deliberately designed.
