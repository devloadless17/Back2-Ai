# Verification debt

Grouped by surface. Every box here is something nobody has run or looked at.

## Status

| | |
|---|---|
| **Implementation** | code-complete for Nour, Practice + Examiner, and Progress + Bac Map |
| **Verification** | runtime and visual QA pending, all of it |

Those are separate things and the distinction is the point of this file. The
machine this was built on has no Docker and no browser, so no query has run
against real rows and no pixel has been rendered. Typecheck, the test suite and
the production build all pass, and none of that exercises either.

Code being complete is not a claim that it works. Nothing below may be ticked
without someone actually doing it.

---

# NOUR

Two things blocked verification: **Docker was not running**, so the provenance
SQL has never executed, and **no browser was available**, so every visual claim
is reasoned from code.

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

# PRACTICE / EXAMINER

Same conditions: no Docker, no browser.

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

# PROGRESS / BAC MAP

Covers the readiness v2 decomposition, the coverage split, the `/performance`
merge, recurring losses and the Bac Map.

## DATA QA

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
- [ ] a large track — a GS account has 243 chapters across the map; confirm the
      page is not absurd and the two chapter queries hold up

## VISUAL QA

- [ ] 360 / 390 / 430 — the subject list is the stacked one, NOT the table
- [ ] sm and up — the table appears, with its contained sideways scroll
- [ ] a long Arabic chapter name in an expanded Bac Map subject at 390px
- [ ] a long French criterion in the recurring-loss list, wrapping not truncated
- [ ] Arabic interface, RTL — `Meter` captions, the `details` disclosure
      triangle, and column order in the table
- [ ] every subject expanded at once in the Bac Map
- [ ] a subject with zero chapters returned
- [ ] dark mode, all of the above

## ROUTING QA

- [ ] an old `/performance` bookmark with no query string lands on `/progress`
- [ ] the same with `?subject=<id>`, and the parameter survives
- [ ] a recurring criterion confined to one chapter offers its chapter, and the
      link opens that chapter
- [ ] one spanning chapters in a subject offers the subject, and names no
      chapter anywhere in the row
- [ ] one spanning subjects offers nothing — unreachable today, see below
- [ ] a material-only chapter's link reaches real reading, not an empty page
- [ ] an inert chapter is not a link at all
- [ ] no internal navigation passes through the `/performance` redirect

## Known limitations, recorded not fixed

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

## Available, deliberately unsurfaced

- **`pastPaperCoverage`** is defined and correct: chapters with indexed
  past-paper questions over all chapters in the track. It is a fact about the
  corpus, not about a student, and it is deliberately absent from `/progress`.
  Available for a future admin or content-health experience. Building a screen
  for it during this phase would have been manufacturing work to justify a
  query, so it was not built.
- **Recommendation copy.** The decision logic is shared through `getNextUp`, so
  Dashboard and Progress cannot recommend different things. Presentation copy
  remains independently mapped on each surface and should be consolidated when
  the Dashboard file is safe to edit — it currently carries unrelated in-flight
  work.

---

# STUDY PLAN / SCHEDULE

`/todos` redirects into `/schedule`. Todos remain a distinct persisted thing —
undated intention — and are read as a backlog on the planning page.

## DATA QA

- [ ] no plan at all — Today's empty state, and the backlog hidden rather than
      shown empty
- [ ] one session today
- [ ] several sessions today, mixed planned / done / skipped
- [ ] a week with empty days
- [ ] a completed session **with** answers in its chapter — reads "3 answers
      marked"
- [ ] a completed session with **none** — reads "No answers recorded", and
      must not read as an accusation
- [ ] a completed session with **no chapter** — `answersMarked` is null and the
      line is absent entirely. Null and zero must not render the same
- [ ] answers marked at 22:30 Beirut on the session's day, which is the next
      UTC day — must still count, which is the whole reason the window is 48h
- [ ] answers marked three days later — must NOT count
- [ ] a past incomplete session, still tickable inside the seven-day tail
- [ ] a session moved to another day, and the move persisting
- [ ] a manual session beside an `ai_suggested` one — provenance visibly
      different
- [ ] a backlog item given a date: session created, todo gone, nothing
      duplicated if the request is retried
- [ ] a backlog item with a linked action, and one without
- [ ] no exam date — the plan builder's own state, no invented countdown
- [ ] exam date present — the ramp and the exam-subject focus
- [ ] an account with no evidence at all — `NO_PROGRESS_YET`
- [ ] a mature account — `NOTHING_WEAK` when every practised chapter is above
      the ceiling
- [ ] due flashcards driving a flashcards session rather than a quiz
- [ ] Dashboard Today and the plan's Today showing the same sessions

## DATE / TIMEZONE QA

The boundary is fixed in code and pinned in `tests/calendar.test.ts`. What no
one has done is watch it behave against a real clock and a real database.

- [ ] open the app at **23:30 Beirut** — the plan shows today, not tomorrow
- [ ] open it at **00:30 Beirut** — the plan has rolled over, and Today is the
      new day. This is the case that was broken
- [ ] the same two moments in **winter** (UTC+2) and **summer** (UTC+3)
- [ ] a session dated today displays on today, not shifted a day either way
- [ ] yesterday's session still appears in the seven-day tail
- [ ] tomorrow's session does not appear in Today
- [ ] a session on the **1st of a month**, viewed on the last day of the
      previous one
- [ ] a session on **1 January**, viewed on 31 December
- [ ] the reminder cron firing while Beirut and UTC are on different days —
      it must select the sessions the student will see when they wake up
- [ ] the exam countdown across a midnight, and on the exam day itself
- [ ] the weekly agenda's weekday labels with the browser set to a timezone
      **west** of UTC — the day must not render as the previous one
- [ ] a browser clock deliberately wrong by a day — the page must follow the
      server, because `todayKey` comes from it

## VISUAL QA

- [ ] 360 / 390 / 430 — Today first, then the recommendation, then the week
- [ ] desktop week
- [ ] a long Arabic session title wrapping in Today
- [ ] Arabic interface with a French subject in a session title
- [ ] French interface with an Arabic chapter name
- [ ] the date input under RTL, and the move control inside a session row
- [ ] dark mode: today's highlight, a completed session, a skipped one, a past
      one, an `ai_suggested` badge
- [ ] the move control at 360px — it sits under the row, not in a dialog

## ROUTING / ACTION QA

- [ ] an old `/todos` bookmark lands on `/schedule`, with and without a query
- [ ] a quiz session with a chapter opens that chapter, not the practice index
- [ ] a session with no chapter opens `/practice` and is not a dead button
- [ ] flashcards and exam-drill sessions reach their real routes
- [ ] no internal navigation still points at `/todos`
- [ ] Move: picking a date actually moves the session, and the week re-renders
- [ ] Move: opening the control and closing it again changes nothing
- [ ] Move: a date in the past — the input allows it; decide whether that is
      wanted or whether it needs a floor
- [ ] Move is offered only on `planned` sessions, never on done or skipped
- [ ] Move on an `ai_suggested` session the student accepted behaves the same
      as on their own
- [ ] a failed Move — the error is visible and the session does not appear to
      have moved
- [ ] two rows with their Move panels open at once is impossible (single
      `movingId`)

## ACCESSIBILITY QA

Audited in source this phase; none of it has been driven with a keyboard or a
screen reader.

- [ ] tab through the week: nav buttons, each session's Done and Move, the
      date input, in a sensible order
- [ ] the previous/next week buttons announce as "previous"/"next" rather than
      as a bracket glyph
- [ ] today announces via `aria-current="date"` in both layouts
- [ ] today is identifiable **without colour** — the word is present in both
      the agenda and the board
- [ ] session status is readable without colour: "✓ Done", "Skipped"
- [ ] the day headings (`h4`) nest correctly under the week heading (`h3`)
- [ ] the Move and Give-a-date buttons expose `aria-expanded` correctly
- [ ] the date inputs are announced with their label
- [ ] focus is visible on every control, in both themes
- [ ] the backlog's error is announced (`role="alert"`)
- [ ] a completed session is still readable — not struck through into noise

## Known limitations, recorded not fixed

- **FIXED this phase: the Beirut/UTC day boundary.** `src/lib/calendar.ts`
  owns it now. The note below is kept for the record of what was wrong.
- **Not migrated to the shared calendar, deliberately:** `sm2.ts` and the
  flashcard interval arithmetic. Those add whole days to an already-stored due
  date, which is timezone-free; they were out of the brief's list and changing
  them would touch the flashcard scheduler for no correctness gain.
- **Reminder language comes from `preferred_language`.** A student who changed
  language with the picker but never saved it to their profile gets reminders
  in the account language. Smaller lie than English for everyone; worth closing
  when the picker writes through.
- **Everything is UTC and the students are in Lebanon.** `startOfTodayUtc`,
  `toDateKey`, the rest-day check and the reminder job all use UTC days. Between
  midnight and 03:00 local, "today" is still yesterday. Sessions carry no time
  of day, so this is a date-boundary problem rather than a time-shifting one,
  and it is consistent across the product. Pinned in `tests/plan.test.ts` so the
  assumption is visible; **not fixed** — the fix belongs in one shared place and
  touches the planner, the reminder job and standing.
- **The chapter picker ships the track's chapters to the client, and that is
  now a measured decision rather than an oversight.** A GS track is 243
  chapters, about 22 kB uncompressed — not the thousand-plus I first claimed,
  which was the four-track corpus misread. A searchable endpoint would add a
  round trip per keystroke on a Lebanese mobile connection to fix a problem the
  number does not support. Kept.
- **Dashboard Today links generically.** `TodayTasks` sends a quiz to
  `/practice` rather than the session's chapter, because the dashboard selects
  `chapterId` but not the subject, and `/practice/[subjectId]/[chapterId]`
  needs both. Fixing it means editing a file that carries unrelated in-flight
  work. The plan's own Today does link correctly.
- **The reminder notification is hardcoded English.** `lib/jobs.ts` writes
  "Today's session: …" directly rather than through the dictionaries.
- **Completion still does not feed mastery or readiness, by design.** Ticking a
  session is a self-report; `answersMarked` is what the product saw. Neither is
  mastery and no surface says otherwise.

---

# MOCK EXAM / EXAM SIMULATION

## IMPLEMENTATION DEBT — not built

Distinct from everything else in this file, which is built but unseen. These
are things that do not exist yet.

- **Desktop `lg+` navigator sidebar.** The question navigator is a horizontal
  strip at every width; on a wide screen it should be a vertical list beside
  the paper. **Deferred due to active concurrent ownership** —
  `exam-runner.tsx` carries the colleague's uncommitted RTL paper-direction
  work, and a layout change means interleaving substantial edits with their
  hunks. The near-miss earlier in this phase, where their work was nearly
  committed under my name, is the evidence that line-level surgery here has
  reached diminishing returns. To implement later: a `lg:` two-column shell
  with a vertical navigator, controlled reading measure for the question, the
  existing identity and timer preserved, and mobile/tablet unchanged.
- **Exam history beyond the last ten sittings.** `/exam-sim` lists ten, newest
  first, with score and date. There is no trend and there should not be one
  until normalisation across different papers is shown to be valid. Deferred
  as product work, not as a defect.
- **Official durations for the corpus.** See the limitations below — a
  corpus-data task needing an authoritative source.

## Existing implementation judged sufficient

Audited this pass and deliberately NOT changed:

- **Autosave presentation.** Debounce, retry with backoff, an `unsaved` set, a
  `saving` indicator, `saveRetrying` and `saveFailed` notices, and a
  `sendBeacon` flush on `visibilitychange`/`pagehide` that catches a retry
  still in flight when the tab goes away. Quiet on success — no permanent
  "Saved" badge. It already communicates saving, failure and unsaved
  truthfully.
- **Submission.** Explicit confirm dialog with a focus trap, Escape to cancel,
  focus restored afterwards, the unanswered count stated factually, and the
  cancel path disabled while submitting.
- **Active-exam behaviour.** The index hides "new simulation" while a paper is
  live and offers Resume with the remaining time.


Partially addressed. The audit is in `EXAM-AUDIT.md`; most of this surface was
already correct, and what changed is listed in the commits.

## RUNTIME QA — built, unseen

### DATA QA

- [ ] an official paper ingested **without** a duration — the sitting runs our
      standard length and both the setup screen and the header say so
- [ ] an official paper ingested **with** `--duration` — reads "as printed on
      the paper" and runs that length
- [ ] a seeded cycle (Maths SG 240, Chimie 120) — official, and the right clock
- [ ] a composed `real_mixed` mock — no standard-sitting marker, because there
      is no printed paper to differ from
- [ ] an `ai_generated` paper — same
- [ ] a generated problem's solution reads **Model answer**, never "Official
      solution". This was live: the results page headed every solution official
- [ ] a past-exam question's solution reads **Official solution**
- [ ] a textbook-sourced question in a sim — must NOT read official
- [ ] a question with no solution at all — the result still reads as complete
- [ ] a paper with no official barème — the existing "treat the mark as an
      indication" copy still appears
- [ ] `awaitingMarking` > 0 — the total excludes them and says so

## DATE / TIMING QA

- [ ] refresh mid-exam — answers and remaining time both survive
- [ ] close and reopen the browser — same
- [ ] the clock crossing local midnight during a sitting
- [ ] expiry while the tab is backgrounded — the cron submits it
- [ ] expiry while the tab is open — the client submits
- [ ] loading the desk after expiry — redirects to results, not a dead paper
- [ ] starting a second paper while one is live — refused
- [ ] starting one while a stale expired paper exists — the old one is
      auto-submitted first

## ROUTING / ACTION QA

- [ ] an **expired but unswept** sitting — the index offers "new simulation"
      rather than Resume against a zero timer. This was wrong: the UI withheld
      an action `startSimulation` would have allowed
- [ ] a genuinely live sitting — Resume is offered and starting another is not
- [ ] the empty state offers both a new simulation and Past Papers
- [ ] the setup picker on a full track — four queries, not three per subject
- [ ] **Sit this paper** from a past paper lands on setup with that paper and
      its subject already chosen
- [ ] the same link when the cycle belongs to a different subject than the
      default — the subject must follow the paper
- [ ] `?cycle=` naming a cycle the student's track cannot see — falls back
      without crashing
- [ ] the result's next action matches what Progress and the Dashboard show
- [ ] autosave failure — the unsaved marker appears and the retry succeeds
- [ ] submitting with unanswered questions — the count is factual

## VISUAL / ACCESSIBILITY QA

- [ ] the timer does not announce every second; it goes `polite` only under
      five minutes
- [ ] the standard-sitting marker at 360px, where the header is already tight
- [ ] Arabic interface with a French paper title in the header
- [ ] the duration line in Arabic — "4 ساعة" reads correctly, not "4h"
- [ ] dark mode across the desk, the navigator and the result
- [ ] keyboard navigation through the question navigator

## RESULT / MARKING QA

- [ ] a fully graded paper — the `/20` appears beside the raw score
- [ ] a paper with **any** question awaiting a human — NO `/20`, and the count
      is stated. This is the rule: the denominator excludes unmarked questions,
      so scaling a partial paper to 20 would be a familiar number from an
      unfamiliar denominator
- [ ] the grading-completeness line on a whole paper ("12 of 12 marked")
- [ ] a provisional paper — the caveat appears BEFORE the marks, not under them
- [ ] a mixed paper: some criteria provisional, some not
- [ ] `ExaminerMark` rendering exam criteria — ✓ ◐ × glyphs, Nour's note only
      where marks were lost, per-criterion provisional
- [ ] the same criterion rendered in Practice and in a mock result — they must
      look identical, because they are now one component
- [ ] the result hero's provenance line for each of the three source modes
- [ ] question review collapsed by default, with the first mark-losing question
      open
- [ ] a paper where nothing lost marks — nothing auto-opens, and that reads as
      success rather than as a bug
- [ ] twelve questions at 390px — the page is scannable without expanding

## ACCESSIBILITY QA (exam)

- [ ] a navigator chip announces its number, marks AND whether it is answered.
      It announced only the number and the marks; answered was visual-only
- [ ] moving Next/Previous moves focus to the new question's heading, and a
      screen reader announces the change
- [ ] focus does NOT land in the textarea on transition — the mobile keyboard
      must not open on every question
- [ ] the initial page load does not steal focus to the heading
- [ ] the timer still announces only under five minutes
- [ ] the review `<details>` are keyboard-operable and announce expanded state

## Known limitations, recorded not fixed

- **RESOLVED: the second grading UI is gone.** The result renders
  `ExaminerMark`, and `mark-explanation.tsx` is deleted rather than left
  unused — a component with no call sites is one somebody reaches for later.
  The shapes were already identical, so nothing was dropped in the move.
- **Official durations are still unrecorded for the whole corpus.** Existing
  historical papers use BAC2 standard sitting durations unless an official
  duration has been explicitly ingested. Populating them is a corpus-data task
  needing an authoritative source; it must not be inferred from subject
  convention. When real data arrives, set `duration_minutes` with
  `duration_is_official = true` per paper — never a global flip.
- **The exam desk and result were audited in source this pass** for RTL
  (no physical-direction classes), dark mode (tokens only, no hardcoded
  colours) and accessibility (two defects found and fixed). Nothing has been
  seen rendered, and a static audit cannot substitute for that.
- **No pause, and no flag-for-review.** Neither exists. The navigator can
  therefore only show answered / unanswered / current, which is what it should
  show anyway.
- **`duration_is_official` is false for the whole existing corpus.** That is
  the honest backfill — nothing recorded a duration, so nothing claims one —
  but it means every real past paper currently reads "standard sitting" until
  durations are supplied.

---

# GLOBAL / MIXED RTL

Cases that belong to no single surface. Each list above keeps its own
direction and dark-mode rows; these are the ones that only fail when two
surfaces are used together, or when a language and an interface disagree.

- [ ] **Arabic content inside an LTR interface**, across Nour, Practice and
      Progress in one session — the subject-language rule creates this state on
      purpose and it has never been seen
- [ ] **French content inside an Arabic interface**, the mirror case
- [ ] mixed script inside one line: an Arabic chapter name beside a Latin
      figure, which is every Bac Map row for an Arabic subject
- [ ] numerals under RTL — marks out of 20, percentages and chapter counts must
      not reverse
- [ ] `Meter` fill direction under RTL, everywhere it appears: subject rows,
      Bac Map chapters, chapter rank lists
- [ ] the `<details>` disclosure triangle under RTL in the Bac Map
- [ ] contained sideways scroll under RTL — the subject table and the
      school-marks table must start at the correct edge
- [ ] dark mode across a whole session rather than one screen at a time
- [ ] font fallback for Arabic diacritics in chapter and criterion names
- [ ] a language change mid-session: cached curriculum names are keyed by
      language, and nothing has confirmed the switch is clean
- [ ] bottom navigation and the composer together at 360px with the keyboard
      open, in Arabic

---

## Earlier entry — mastery and coverage first surfaced

Kept for the record. Superseded in part by the sections above: the second
coverage percentage it worried about has since been removed from Progress, and
the `evidenceReading` thresholds it describes were deleted.

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
