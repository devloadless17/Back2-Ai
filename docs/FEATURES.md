# How every feature works

The rules the product runs on, written out so you can change them. **Every value
marked `TUNABLE` is a decision, not a fact** — edit the number in the file named
beside it and the whole product follows.

Read this as a contract: if a rule here is wrong for the Lebanese Bac, say so
and it gets changed in one place.

---

## 1. Marking an answer

**Where:** `src/lib/grading.ts` · **Runs:** every practice attempt and every exam answer

A barème is a list of `{ criterion, points }`. The model is given the question,
the official solution, the barème and the student's working, and returns a mark
per criterion with a written justification.

Four rules the code enforces, not the model:

| Rule | Why |
|---|---|
| The model may only award against criteria it was given | It cannot invent a criterion to reward |
| Points are clamped to each criterion's maximum, server-side | A model returning 7 out of 4 cannot inflate a mark |
| Every criterion carries a written justification | A contested mark is reviewable by a human without re-running the model |
| A refusal or malformed reply becomes **"needs human marking"** | Never a zero |

**"Needs human marking" propagates properly.** The answer is excluded from both
the awarded total *and* the available total, stored with a null score, shown as
awaiting marking, kept out of mastery, and filed to the review queue.
`tallyMarks` in `src/lib/exam.ts` is where the exclusion happens.

> **TUNABLE — nothing here.** These are correctness rules. Changing them changes
> what a mark means.

---

## 2. Chapter mastery

**Where:** `src/lib/scoring/mastery.ts` · **Recomputed:** inline, on every attempt

```
mastery = Σ(credit × recency × difficulty) ÷ Σ(recency × difficulty)
recency = exp(−days_since_attempt / HALF_LIFE)
```

| Constant | Value | Meaning |
|---|---|---|
| `MASTERY_HALF_LIFE_DAYS` | **14** | `TUNABLE` — an attempt is worth half as much after two weeks |
| `MIN_ATTEMPTS_FOR_WEAKNESS` | **5** | `TUNABLE` — below this, a chapter is never named as a weakness |
| `DEFAULT_DIFFICULTY` | **0.5** | `TUNABLE` — used when a question has no calibrated difficulty |

**Credit per attempt:** MCQ is 1 or 0. A barème-marked answer earns
`score ÷ maxScore`, so 8/10 counts as 0.8 — collapsing that to "wrong" would
make mastery meaningless on the long-form questions that dominate the Bac. An
unmarked answer contributes **nothing** and is not counted as a failure.

**Old-cycle mode writes no attempts at all.** Reading a past paper with the
solutions visible cannot move mastery.

---

## 3. Predicted mark out of 20

**Where:** `src/lib/standing.ts`, `src/lib/scoring/readiness.ts`

```
readiness = 0.50 × mean chapter mastery
          + 0.30 × coverage (chapters with ≥5 attempts ÷ all chapters)
          + 0.20 × trend over the trailing 4 weeks

mark /20  = readiness × 20, to one decimal
```

| Constant | Value | Meaning |
|---|---|---|
| `READINESS_WEIGHTS` | **0.5 / 0.3 / 0.2** | `TUNABLE` — mastery / coverage / trend |
| `TREND_SATURATION` | **0.2** | `TUNABLE` — a ±0.2 mastery swing in 4 weeks maxes the trend term |
| `MIN_ATTEMPTS_FOR_READINESS` | **10** | `TUNABLE` — below this the subject shows **no mark at all** |
| `PASS_MARK` | **10** | The Lebanese pass |
| Bands | **<10 / <12 / <15 / ≥15** | `TUNABLE` — below pass, passing, good, strong |

**A subject with too little work shows nothing, never a low mark.** "We cannot
say yet" and "you are weak here" are different claims.

**The overall mark is the plain mean of reportable subjects.** Ministry
coefficients are not encoded — see §12. The UI says so on the page.

> **Chapters never attempted count as zero mastery**, deliberately: an untouched
> chapter is a real gap in readiness, not missing data.

---

## 4. Programme covered

**Where:** `src/lib/standing.ts`

```
coverage = chapters with ≥1 marked attempt ÷ chapters that HAVE questions
```

The denominator is **not** the whole syllabus. The chapter list comes from the
textbooks and runs ahead of the questions, which arrive through ingestion.
Dividing by the full programme would show a student 8% and blame them for a gap
in our corpus.

> **TUNABLE — the denominator.** If you want it against the full syllabus,
> change the `available` count in `getStanding` and relabel it.

---

## 5. Flashcards (spaced repetition)

**Where:** `src/lib/scoring/sm2.ts`, `src/lib/queries/flashcards.ts`

SM-2. A card **is** a question the student has already met in practice — the deck
cannot contain something they have never seen.

| Constant | Value | |
|---|---|---|
| `DEFAULT_EASINESS` | **2.5** | `TUNABLE` |
| `MIN_EASINESS` | **1.3** | `TUNABLE` — floor, so a hard card never collapses to daily forever |
| Session size | **40 cards** | `TUNABLE` — `getDueCards(..., limit = 40)` |

**Scopes:** whole curriculum · subject · unit · chapter · **where I am weakest**.

The weak scope draws from chapters the student's attempts say they are worst at:

| Constant | Value | |
|---|---|---|
| `WEAK_CHAPTER_LIMIT` | **5** | `TUNABLE` — how many weak chapters a session draws from |
| `WEAKNESS_MASTERY_CEILING` | **0.7** | `TUNABLE` — above this a chapter is not "weak", even if it is your worst |

Due cards come first; if there are too few, the session is topped up with cards
**not yet due**, nearest-due first, each labelled *ahead of schedule*. That is a
real cost — an early review earns an interval it has not quite proved — accepted
only in this scope and shown to the student rather than hidden.

---

## 6. The tutor (chat)

**Where:** `src/lib/retrieval.ts`, `src/lib/chat.ts`

Retrieval is **tiered and stops at the first hit**:

| Tier | Threshold | Source |
|---|---|---|
| 1 · exact match | **0.85** `TUNABLE` | A near-identical past question + its official solution |
| 2 · concept level | **0.72** `TUNABLE` | Chapter course material (definitions, methods, worked examples) |
| 3 · personal | **0.72** `TUNABLE` | The student's own uploaded documents |
| 4 · refusal | — | Says so, and names what the programme *does* cover |

**Nothing is generated before retrieval has decided what may be said.** There is
no path where the model answers from its own knowledge.

Every assistant message stores the tier, the similarity that triggered it, and
the sources cited — so thresholds can be tuned against real traffic
(`npm run eval`), and a wrong answer can be traced to the material that produced
it.

**Verification.** Tier 1 restates an official solution, so it is not re-checked.
Tiers 2 and 3 synthesised, so a second model checks the answer against the
context; if it fails, the answer is **withdrawn from the screen** and filed for
review.

**Correction-key mode.** A conversation can be anchored to a marked attempt, so
the tutor sees what the student wrote, the marks each criterion earned, and the
official solution. It is told to find the first line that diverges and tie each
lost mark to a criterion, not to recite the model answer.

---

## 7. Exam simulation

**Where:** `src/lib/exam.ts`

| Behaviour | Detail |
|---|---|
| Timer | **Server-authoritative.** `expires_at` is written at start; every write is validated against it. The browser countdown is a display of that deadline |
| Barème | **Snapshotted** onto the simulation at composition time, so later edits to a question cannot re-mark a sat paper |
| Answers | Typed, or photographed — the photo path runs an OCR self-consistency gate *before* marking |
| Abandoned papers | `npm run cron auto_submit`, every 5 minutes |
| Default duration | **180 min** `TUNABLE` (`DEFAULT_DURATION_MINUTES`) |
| AI paper size | **5 questions** `TUNABLE` (`AI_PAPER_QUESTION_COUNT`) |

**Real-cycle papers** take every question in that cycle, in `orderIndex` order.
**Generated papers** pick approved, published problems from the subject.

> **OPEN — Lebanese paper format.** See §13. Papers currently total whatever
> their barèmes sum to, not 20, and exercises have no sub-question structure in
> the database.

---

## 8. Generated practice problems

**Where:** `src/lib/generation.ts`

A generated problem is written from real questions in the same chapter, then:

1. embedded and checked for near-duplicates — `DUPLICATE_THRESHOLD` **0.95** `TUNABLE`
2. solved independently by a second model
3. **held until an administrator approves it** in the review queue

`published_at` is set in exactly one place — the review-queue handler — and no
student-facing query selects a row where it is null. Up to `MAX_ATTEMPTS` **3**
`TUNABLE` generations per request.

`GET /api/generation/practice` is **pool-only**. Live generation is on POST,
because a GET that spends money is one a prefetch or a retry will fire by
accident.

---

## 9. What to do next

**Where:** `src/lib/queries/next-up.ts`

A triage, in order. First match wins:

1. **Cards due** — spaced repetition only works on the day it is scheduled
2. **Weakest chapter** — once there is enough evidence to name one (§2)
3. **An untouched chapter** — with questions in it, so it is not a dead end
4. **A full paper** — for someone who has practised but never sat one
5. **Anything** — said plainly rather than inventing a task

> **TUNABLE — the order.** It is a list in one function.

---

## 10. Rate limits

**Where:** each route handler, via `rateLimit()` in `src/lib/api.ts`

| Action | Limit | Window |
|---|---|---|
| Marked attempts (AI) | 60 | 1 hour |
| Chat turns | 30 | 10 min |
| Generation | 5 | 1 hour |
| Uploads | 20 | 1 hour |
| Login | 10 | 5 min |
| Signup | 5 | 1 hour |

All `TUNABLE`. MCQ attempts are marked by string comparison, cost nothing, and
are deliberately not counted.

> **Single instance only.** The limiter is in-process. Two Node processes give
> each its own counters. Back it with Redis before scaling out.

---

## 11. Account, access and billing

- **Track and language are locked at signup.** Changing either invalidates a
  student's mastery history, so it is an admin action and audit-logged.
- **Country** is checked server-side against the ingested curricula. Only
  Lebanon today.
- **Sessions are stored, not JWTs** — so a session can be killed instantly
  mid-exam. TTL **14 days** `TUNABLE` (`SESSION_TTL_DAYS`).
- **Billing takes no money.** `PAYMENTS_ENABLED = false`. A card is validated in
  the browser and only brand, last four and expiry are ever sent. **Nothing is
  gated on payment** — gating study material behind a payment that cannot be
  taken would lock students out of a product that is not charging them.

---

## 12. Known gaps — decisions waiting on you

| Gap | Impact | What it needs |
|---|---|---|
| **Subject coefficients not encoded** | Overall mark is a plain mean; every subject counts once | The CRDP descriptor. Then one table |
| **Per-branch subject list unconfirmed** | Geography currently attaches to all four branches | Confirm against the ministry document — see `CURRICULUM.md` |
| **Six books have no chapter list** | English has no chapters in any branch | Re-run the TOC parser with overrides |
| **No questions ingested** | Only demo questions exist | Run `npm run ingest` on real papers |
| **Rate limiter in-process** | Single instance only | Redis |

---

## 13. Proposed — Lebanese paper structure

Real Bac papers are **exercises**, not flat question lists: *Premier exercice
(7 points)* with numbered sub-parts, and the paper totals **20**.

Today a "question" is one flat unit and a paper totals whatever its barèmes sum
to. Two ways to close that:

**A — presentation only (no schema change).** Each question *is* an exercise;
its sub-parts live in its text and its barème covers them. The UI labels it
"Exercise N (X points)" and shows the paper total out of 20. Cheap, and it looks
right. Sub-parts cannot be marked or reported on individually.

**B — real sub-questions (schema change).** Add `parent_id`, `part_label` and
`points` to `questions`. Then a paper is exercises containing parts, each part
marked and reported separately, and mastery can be attributed per part.

**Decision: Option B.** The presentation half of A is already in — exam questions
are labelled "Exercise N" — but the real structure is what the product will use.

The design, the three risks (marking cost multiplies fivefold; which chapter a
part belongs to; ingestion having to detect part numbering) and the five
questions that need answering before the marking path changes are written up in
**[EXERCISE-STRUCTURE.md](EXERCISE-STRUCTURE.md)**. Nothing is migrated yet.
