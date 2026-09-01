# Hardening audit — exam-season load

Read against the code on 24 August 2026. Every finding names a file and line and
carries the smallest fix that closes it. No redesigns: everything below is a
change to an existing function, an index, or a call site.

Ranked by **impact under load × ease of fix**. The first three decide whether an
exam-season evening holds up.

| # | Finding | Impact | Effort | Status |
|---|---|---|---|---|
| 1 | Marking runs inline inside the submit request | Critical | Medium | **Fixed** |
| 2 | A half-marked paper is never recovered | Critical | Small | **Fixed** |
| 3 | Autosave failures are not retried | High | Small | **Fixed** |
| 4 | `recomputeChapterMastery` reads unbounded history on every attempt | High | Small | **Fixed** |
| 5 | Sidebar recomputes the whole progress picture on every navigation | High | Small | **Fixed** |
| 6 | Rate limiter is per-process | High at >1 instance | Small | Open |
| 7 | Track-global counts computed per user per request | Medium | Small | **Fixed** |
| 8 | `sendBeacon` flush can be rejected by the origin check | Medium | Small | Open |
| 9 | Missing index for flashcard scope queries | Medium | Small | Open |
| 10 | Exam runner over-fetches | Low | Small | Open |

> Six of ten closed on 24 August 2026. What each fix actually did is recorded at
> the end of this document; the findings below are left as written so the
> reasoning behind them survives.

---

## 1. Marking runs inline inside the submit request — CRITICAL

`src/lib/exam.ts:524` — `submitSimulation` loops over every slot and awaits
`gradeAgainstBareme` **serially**, inside the HTTP request from
`src/app/api/exam-sim/[id]/submit/route.ts:25`.

A five-question paper is five sequential model calls. At the effort this product
marks on, that is comfortably 60–180 seconds of wall clock in one request.

Under exam-season load it fails three ways at once:

- **Connection occupancy.** Every submitting student holds a request handler for
  minutes. Two hundred students finishing inside the same ten minutes is two
  hundred concurrent long-lived handlers.
- **Gateway timeouts.** Most proxies and platform routers cut at 30–60s. The
  student sees a failure on the single most consequential action in the product.
- **Provider limits.** Hundreds of simultaneous marking calls hit
  organisation-level token limits; the 429s land mid-loop — see finding 2.

**Smallest fix.** Split submit from marking. `submitSimulation` already writes
`status: 'submitted'` before marking (`exam.ts:508`) — return at that point and
move the marking loop into a job the existing `npm run cron` runner drives,
alongside `auto_submit`. The results page already renders "awaiting marking" per
criterion, so the UI needs no change: a student lands on results and watches
marks appear.

Cheaper follow-on once that lands: mark the slots concurrently with a bounded
pool of 4–6 rather than one at a time. Serial is only defensible while this sits
in a request.

---

## 2. A half-marked paper is never recovered — CRITICAL

`src/lib/exam.ts:725` — `autoSubmitExpired` selects only
`status: 'in_progress'`.

If the request in finding 1 dies mid-loop — timeout, deploy, 429, crash — the
paper is left at `status: 'submitted'` with some answers marked and some not.
Nothing ever picks it up again. The sweep cannot see it, and the student's
results page shows a partial mark indefinitely.

**Smallest fix.** Widen the sweep to include papers stuck in `submitted`:

```ts
where: {
  OR: [
    { status: 'in_progress', expiresAt: { lte: new Date() } },
    { status: 'submitted', submittedAt: { lte: fiveMinutesAgo } },
  ],
}
```

`submitSimulation` is already idempotent for `graded` (`exam.ts:498`) but not for
a partially-marked `submitted` paper. Make the marking loop skip slots that
already carry `answer.gradedAt`, and it becomes safely re-runnable.

---

## 3. Autosave failures are not retried — HIGH

`src/components/exam/exam-runner.tsx:131` — `save()` catches, sets a notice, and
drops the write. The debounce effect only re-fires when `answers` changes
(`exam-runner.tsx:147`), so a student who types a paragraph, hits a failed save,
then stops to think has that paragraph only in memory.

Under load is exactly when saves fail.

**Smallest fix.** Keep a dirty set rather than relying on the next keystroke:

- On failure, re-queue that `slotId` and retry three times at 2s / 5s / 15s.
- Clear the optimistic `savedAnswer` only once the server confirms.
- Keep the notice, but say "not saved — retrying". The current copy tells a
  student something went wrong and gives them nothing to do about it.

---

## 4. `recomputeChapterMastery` reads unbounded history — HIGH

`src/lib/queries/progress.ts:235` loads **every attempt the student has ever
made in that chapter**, with no time bound, then recomputes in memory.

It runs on the write path of every attempt
(`src/app/api/attempts/route.ts:167`) and once per touched chapter after marking
(`exam.ts:632`). The cost grows across the whole school year and is paid on every
answer a student submits.

`getProgressForUser` already bounds its own read at `RECENCY_HORIZON_DAYS = 120`
(`progress.ts:71`) with the reasoning written out: an attempt 120 days old
contributes `exp(-120/14) ≈ 0.0002`. The same argument applies here and was not
applied.

**Smallest fix.** Add the same horizon to the `where`:

```ts
attemptedAt: { gte: new Date(Date.now() - RECENCY_HORIZON_DAYS * 86_400_000) },
```

One line, bounded forever, and numerically indistinguishable from today's result.

---

## 5. The sidebar recomputes everything on every navigation — HIGH

`src/app/(app)/layout.tsx:30` calls `getStanding`, which calls
`getProgressForUser` (`standing.ts:49`) — two queries loading every chapter in
the track plus 120 days of attempts — plus three further counts, **on every page
render in the authenticated app**, to show two numbers in the sidebar.

Every navigation, for every student, pays a full progress recomputation.

**Smallest fix.** The sidebar needs `mark` and `daysToExam` and nothing else.
Read them from the `readiness_scores` snapshot the nightly `readiness` job
already writes (`jobs.ts:30`), falling back to the live computation only when no
row exists. Five queries become one indexed read on `(userId, subjectId)`.

---

## 6. Rate limiter is per-process — HIGH the moment there are two instances

`src/lib/api.ts:107` — an in-process `Map`. Documented as such at line 103, so
this is a known gap rather than a discovery. It belongs on the list because exam
season is exactly when a second instance gets added.

Two instances silently double every limit: marked attempts 60/hour becomes 120,
and generation 5/hour becomes 10 — which is the one that costs money.

**Smallest fix.** Back `rateLimit` with Redis behind the same signature. The
comment at `api.ts:105` is right that no call site changes.

---

## 7. Track-global counts computed per user per request — MEDIUM

`src/lib/queries/standing.ts:56` counts chapters that have questions, filtered by
track. **The answer is identical for every student in that track** and changes
only when ingestion runs, yet it is computed inside every `getStanding` call.

Same shape: `listSubjects`, the taxonomy and the chapter tree are static between
ingestion runs and are re-read per request.

**Smallest fix.** Wrap the track-global reads in `unstable_cache` with a tag and
revalidate that tag at the end of an ingestion run. Note there is currently **no
caching anywhere in the app** — the only `cache()` calls are React
request-scoped memoisation in `session.ts:80` and `i18n/index.ts:30`.

---

## 8. `sendBeacon` flush can be rejected by the origin check — MEDIUM

`src/components/exam/exam-runner.tsx:180` flushes unsaved answers with
`navigator.sendBeacon` on `visibilitychange`. That endpoint calls
`assertSameOrigin` (`answers/route.ts:29`), which rejects when both `Origin` and
`Referer` are absent (`api.ts:150`).

`sendBeacon` with a `Blob` does not reliably carry either header across browsers.
Where it does not, the last-second flush — the thing protecting a student whose
phone locks mid-exam — returns 403 and the final sentence is lost silently,
because `sendBeacon` is fire-and-forget and nothing reports the failure.

**Smallest fix.** Confirm per browser, then accept `Sec-Fetch-Site:
same-origin` as a third fallback in `assertSameOrigin`. Worth an explicit test —
this path is invisible when it breaks.

---

## 9. Missing index for flashcard scope queries — MEDIUM

`src/lib/queries/flashcards.ts:51` — `scopeWhere` filters `flashcard_state` by
`question.chapterId`, and now by `chapterId: { in: [...] }` for multi-chapter
sessions. `flashcard_state` is indexed on `(userId, dueDate)` and `questions` on
`(chapterId, difficulty)`, so the join resolves — but a scoped session reads
every one of the student's card rows before filtering.

`/flashcards/review` is a named spike path, and the new on-demand top-up doubles
the reads per session.

**Smallest fix.** Denormalise `chapterId` onto `flashcard_state` — it is
immutable for the life of a card, since a card *is* a question — and index
`(userId, chapterId, dueDate)`. One column, one backfill, no logic change beyond
the `where`.

---

## 10. Exam runner over-fetches — LOW

`src/lib/exam.ts:287` — `SIMULATION_INCLUDE` pulls `officialSolution`,
`generatedSolution` and the whole `answer` row including `baremeResult`, for
every slot, on every runner page load.

The page correctly **drops** the solutions when building `ExamSlot`
(`(exam)/exam-sim/[examSimulationId]/page.tsx:34`), so nothing leaks to the
client — but the rows still cross the wire from Postgres on a page a student may
reload several times under a running clock.

**Smallest fix.** A second, leaner include for the runner path with the solution
fields and `baremeResult` omitted. Keep `SIMULATION_INCLUDE` for results and
marking, which genuinely need them.

---

## What is already right

Recorded so a later pass does not "fix" it:

- **The clock is server-authoritative.** `expiresAt` is written at start and
  validated on every write (`exam.ts:400`); the browser countdown is a display of
  that deadline.
- **Mastery is read, not recomputed, on the read path.** `progress.ts:82` carries
  the proof that a stored mastery does not drift while a student is inactive.
- **The rate-limit map is evicted** on a 60-second timer (`api.ts:173`), so it is
  bounded rather than a leak.
- **Attempt reads are indexed** on `(userId, attemptedAt)`, and the dashboard
  batches its reads into one `Promise.all` rather than sequencing them.
- **The OCR consistency gate runs during the sitting** (`answers/route.ts:14`),
  which is the only moment a student can act on it.
- **No N+1 in the page loads.** The only `await`-in-loop patterns outside marking
  are in `jobs.ts`, which is already off the request path.

---

## Suggested order

1. **#2** — one `where` clause, and papers stop being lost. First, because it
   also de-risks #1.
2. **#4** — one line, removes an unbounded read from the hottest write path.
3. **#3** — autosave retry. Small, and it is the difference between losing a
   paragraph and not.
4. **#1** — move marking off the request. The largest change here, and the one
   that decides whether submission survives a spike.
5. **#5** and **#7** — the sidebar read and caching, together.
6. **#6** — Redis, before the second instance rather than after.
7. **#8**, **#9**, **#10** — as capacity allows.

Nothing above requires a schema redesign, a new service, or a framework change.

---

## Out of scope, flagged

`question_bank`, `skill_tags` and `weakness_scores` from
[ARCHITECTURE.md](ARCHITECTURE.md) **do not exist in the database yet** —
verified against `information_schema`. There is nothing to audit there. When the
bank is built, two things from this audit apply to it directly: approved rows are
the single most cacheable object in the product (immutable once approved, read on
every quiz), and generation must be a background job from day one rather than
something that starts on a student's click.

---

## What was fixed, 24 August 2026

**#1 — marking moved off the request.** `submitSimulation` now closes the paper
and returns; `markSimulation` does the marking. A measured submit went from
holding the connection for the length of every model call to **0.76s**, with the
paper fully marked a few seconds later.

Marking runs two ways, and the pairing is the point. The submit route kicks it
off without awaiting it, so a student is not left watching an empty results page
until a cron tick; the new `mark` job in `jobs.ts` then exists to finish papers
whose inline pass died — a timeout, a deploy mid-pass, a provider 429 — and to
catch papers closed by `auto_submit`. Both are safe to run at once because
marking skips slots that already carry `gradedAt`. The job, not the inline call,
is the guarantee: on a host that freezes the process after the response the
inline pass simply does nothing and the tick picks the paper up.

Two things fell out of this. `SubmitInput.locale` turned out to be **dead** —
marking reads `simulation.subject.language`, not the caller's locale — so it was
removed along with a hardcoded `locale: 'fr'` at `exam.ts:73`. And the first cut
of the sweep delayed marking by five minutes to avoid restarting an in-flight
pass, which would have made every student wait five minutes for marking to
*begin*; that guard is gone and overlap is handled per slot instead.

**#2 — the sweep sees stuck papers.** `markSubmitted` picks up anything at
`status: 'submitted'`, oldest first. Marking skips slots that already carry
`gradedAt`, so a pass that died halfway **resumes** rather than restarting or
double-marking. `tests/exam-submit.test.ts` pins the property that matters: a
resumed paper totals identically to one marked in a single pass, because
otherwise a student whose first pass timed out would quietly get a different mark
from an identical paper that did not.

**#3 — autosave retries.** Failures re-queue and retry at 2s / 5s / 15s with an
`unsaved` set tracking what the server has not confirmed. The hide-flush now
drains that set rather than diffing against the initially loaded answer, so a
retry still in flight when the tab goes away is still beaconed. The notice says
"not saved — retrying" rather than a generic error, because a generic error
invites a student to do something and there is nothing to do.

**#4 — mastery recompute bounded.** One `attemptedAt` clause, using the
`RECENCY_HORIZON_DAYS` constant already defined in the same file. Removes an
unbounded read from the write path of every attempt.

**#5 — sidebar reads the snapshot.** `getSidebarStanding` takes two indexed
reads from `readiness_scores` instead of a full `getStanding`, falling back to
the live computation when no snapshot exists so a new account is not shown a
blank sidebar on its first evening.

**#7 — a cache layer, deliberately narrow.** `src/lib/cache.ts` wraps
track-global curriculum reads, invalidated explicitly by ingestion rather than by
a timer. The file states what must never enter it: anything user-scoped, the exam
clock, and anything on a write path.

### Still open

**#6** (Redis-backed rate limiting), **#8** (`sendBeacon` origin check), **#9**
(flashcard scope index) and **#10** (runner over-fetch). None is a correctness
risk today; #6 becomes one the day a second instance is added.
