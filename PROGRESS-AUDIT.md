# Progress + Bac Map — data audit

Step A of the phase. Written 2026-09-18, before any UI work, because the brief
asks the right question: **what exactly makes each number true?**

Nothing here has been run against a database — Docker is unavailable. Every
statement is read off the source, and the file names where.

---

## 1. Readiness — the number the whole product rests on

`src/lib/scoring/readiness.ts`, `computeReadiness`.

```
readiness = 0.5 × mastery
          + 0.3 × coverage
          + 0.2 × trend
```

| Term | Definition | Source |
|---|---|---|
| `mastery` | mean `masteryScore` over **every chapter in the subject** | `computeReadiness` |
| `coverage` | share of chapters with **≥ 5 attempts** (`MIN_ATTEMPTS_FOR_WEAKNESS`) | same |
| `trend` | `0.5 + (Δ4-week mastery ÷ 0.2) × 0.5`, clamped to 0..1 | same |
| reportable | `totalAttempts ≥ 10` (`MIN_ATTEMPTS_FOR_READINESS`) **and** the subject has chapters | same |

`markOutOf20(readiness) = readiness × MARK_SCALE`, rounded to one decimal
(`src/lib/standing.ts`).

### Dashboard and Progress already agree

Both `/progress` and `/performance` call `getStanding`, which calls
`getProgressForUser`, which calls `computeReadiness`. The dashboard uses the
same path. There is one calculation, so §34 of the brief is satisfied by
construction — **no centralisation work is needed.**

---

## 2. THE FINDING: mastery already contains coverage

`getProgressForUser` (`src/lib/queries/progress.ts`) builds its chapter list
from **every chapter in the subject**, and a chapter with no `chapter_mastery`
row is included as:

```ts
masteryScore: Number(stored?.masteryScore ?? 0),
attemptsCount: stored?.attemptsCount ?? 0,
```

So an untouched chapter enters the mean as **zero mastery**, not as absent.

Consequences:

- A student who has answered five chapters perfectly out of twenty has
  `mastery = 5/20 = 0.25`, not `1.0`. The number reads as "poor" when the truth
  is "excellent, narrow".
- `coverage` is then added again at 0.3 weight, so **coverage is counted
  twice** — once inside mastery and once beside it.
- §14 of the brief asks for mastery and coverage to be distinct concepts. In
  the current model they are not, and no UI change can separate them.

**This is a model question, not a design question.** Two defensible options:

1. **Leave it.** Readiness is a readiness score, and a student who has not
   touched three quarters of the syllabus is genuinely not ready. The number is
   fit for its stated purpose and only the *label* is misleading.
2. **Split it.** `mastery` becomes the mean over chapters **with evidence**, and
   coverage carries the breadth on its own. This changes every readiness figure
   in the product — dashboard, progress, report, the nightly snapshot — and the
   historical `readiness_scores` rows would no longer be comparable with new
   ones.

I have not chosen. It needs a decision from the product owner, and doing it
silently inside a UI phase would be the wrong way to make it.

**What I would do in the meantime:** present mastery and coverage as separate
figures in the UI, and stop describing the readiness mean as "mastery" in
student-facing copy, since it is really "mastery across the whole programme".

---

## 3. Trend contributes 0.1 to a brand-new account

With no history, `masteryFourWeeksAgo` is null, `delta` is 0, and
`trendComponent` is `0.5`. That is 0.2 × 0.5 = **0.1 of readiness before the
student has answered anything.**

It never surfaces, because `reportable` is false below ten attempts — but it
means the raw score is not zero-based, and anything that reads `readiness.score`
without checking `reportable` would print a mark for a student with no work.
Worth knowing before building a chart on it.

---

## 4. What `/progress` and `/performance` currently are

| Route | Shows |
|---|---|
| `/progress` | four stat tiles, per-subject standing, coverage |
| `/performance` | weakest chapters, strongest chapters |

**They are not duplicates. They are two halves of one story that got split at
the subject/chapter boundary.** Progress stops exactly where Performance
starts.

**Recommendation:** one page. Readiness → subjects → chapters → recurring
losses, with `/performance` redirecting into it. That is one navigation entry
instead of two that each answer half a question, and it removes the case where
a student reads "Mathematics 14.8" on one page and has to find another to learn
which chapter is dragging it.

**Not executed** — see §7.

---

## 5. What exists for the Bac Map

The real hierarchy is **Track → Subject → Chapter → Question**. There is no
skill or topic level in the schema, and the brief is right that one must not be
invented.

Already available without new queries:

- `listChapters(subjectId, userId)` — name, unit, order, `questionCount` (via
  `alsoHasQuestions`), mastery, attempts
- `hasReading` — added earlier this week, distinguishes a chapter with textbook
  material from an empty one
- exam frequency per chapter — the years a chapter has been set

**310 chapters have reading material and no exam questions.** That state already
renders honestly in the practice index ("Reading — no questions yet") and the
Bac Map must reuse that language rather than showing `0 questions`.

**A Bac Map does not exist under another name.** `/practice/[subjectId]` is the
closest thing — a chapter list with mastery — and the map should probably be an
upgrade of that route rather than a new one, per §19.

---

## 6. Recurring losses are ready to aggregate

`recurringLosses(userId, { subjectId?, limit? })` already returns criterion,
times, `pointsLost`, subjectName and the occasions with chapter names. It is
used per-attempt in Examiner Mode via `repeatedCriteria`.

For Progress it needs no new query — only a presentation. The honest framing is
historical: *"3 attempts · 9 marks lost"*. Not recoverable marks, not a
prediction, not a time window unless one is queried.

**One caveat for §11:** a criterion can span several chapters. `occasions[]`
carries a chapter name per occurrence, so a single "practise this chapter" link
is only truthful when every occasion shares one chapter. Otherwise the evidence
should be shown without a corrective destination.

---

## 7. What I did not do, and why

This audit is step A of ten. I stopped here rather than beginning the UI,
because:

- the mastery/coverage finding in §2 changes what the subject decomposition
  should *say*, and building the decomposition first would bake in the current
  conflation;
- merging `/progress` and `/performance` is a real IA change that deserves the
  owner's agreement, not a unilateral commit at the end of a long session.

**Nothing in Progress or Bac Map has been implemented.**
