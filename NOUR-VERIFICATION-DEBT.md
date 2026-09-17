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
