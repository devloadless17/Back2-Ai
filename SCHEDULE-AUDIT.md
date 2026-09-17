# Study Plan + Schedule — audit

Step A. Written 2026-09-17, before any design work, because the brief asks the
right question: what is actually here, and what can this product honestly say?

Nothing below has been run. Docker is unavailable and there is no browser.
Every statement is read off the source and names the file it came from.

**Headline: there is far more real machinery here than expected, and two
genuine product ambiguities that need a decision before any UI is built.**

---

## 1. What exists, classified

| Thing | Class | Where |
|---|---|---|
| `StudySession` — dated, typed, durationed, statused, sourced | **REAL + PERSISTED** | `schema.prisma:1157` |
| `Todo` — free text, optional chapter, optional launch action, done flag | **REAL + PERSISTED** | `schema.prisma:1195` |
| `UpcomingExam` — date, optional subject, `isBacExam` | **REAL + PERSISTED** | `schema.prisma:1179` |
| `buildPlan` — whole-programme rule-based planner | **REAL + DERIVED** | `lib/planner.ts` |
| `scheduling.ts` — single-exam planner, deterministic split, LLM phrasing | **REAL + DERIVED** | `lib/scheduling.ts` |
| `getNextUp` — single next action | **REAL + DERIVED** | `lib/queries/next-up.ts` |
| Add / delete session, set status, set date, set duration, set title | **REAL + PERSISTED** | `api/schedule/[id]`, `api/schedule` |
| Add exam date | **REAL + PERSISTED** | `api/exams`, `schedule-planner.tsx:189` |
| Daily minutes + rest weekday, asked of the student | **REAL + PERSISTED per request** | `plan-builder.tsx:84` |
| `schedule_reminder` notification + push delivery | **REAL + PERSISTED** | `lib/jobs.ts:181` |
| Dashboard Today | **REAL + DERIVED from `studySession`** | `dashboard/page.tsx:113` |
| **Move a session to another day** | **UNSUPPORTED IN UI** — API accepts it, nothing calls it | `api/schedule/[id]` PATCH |
| **Todos anywhere but `/todos`** | **UNSUPPORTED** — never read by Dashboard or Today | — |
| Time of day on a session | **UNSUPPORTED** — `scheduledDate` is `@db.Date` | `schema.prisma:1162` |
| Student availability beyond minutes/day + one rest day | **UNSUPPORTED** | — |
| Completion feeding mastery or readiness | **UNSUPPORTED** | no reference in `lib/scoring/` |

### Things the brief expected that are better than expected

- **The planner is not an LLM.** `buildPlan` is pure arithmetic over mastery,
  attempts, due cards and the exam date, with every constant marked `TUNABLE`
  and its reasoning written down. `scheduling.ts` allocates deterministically
  and uses a model *only to phrase a session title*, and says so in its own
  header comment.
- **Nothing is written without an explicit accept.** `/api/schedule/generate`
  previews by default; `apply: true` is the accept. Applying only deletes
  `ai_suggested` sessions still `planned` and dated today or later, so a
  student's own entries are never touched and history is never rewritten.
- **The copy does not overclaim.** "Weighted to your weakest chapters, ramping
  up as the exam gets closer" is exactly what the code does. No "optimised",
  no "personalised by AI".
- **Reminders genuinely exist**, as notifications plus push delivery.

---

## 2. What `/schedule` and `/todos` actually are

They are **not** two views of one thing, and they are **not** incompatible.

- **`StudySession`** is a *commitment*: a date, usually a chapter, an activity
  type, a duration, a status, and a provenance.
- **`Todo`** is an *intention*: free text, an optional chapter, an optional
  launch action, done or not. **It has no date field at all.**

So the honest model is capture versus commitment. The problem is not that both
exist — it is that a `Todo` is written into a drawer nobody opens. It appears
on `/todos` and nowhere else: not on the Dashboard, not in Today, not in any
count. A student who writes one has filed it away from themselves.

---

## 3. Three ranking systems already exist

This matters for the brief's "one recommendation brain" rule, because the
product is already past one.

| | Ranks | Used by |
|---|---|---|
| `getNextUp` | a ladder: due cards → weakest chapter → untried chapter → no paper sat → anything | Dashboard, Progress |
| `chapterWeight` (`planner.ts`) | `(1 − mastery) × evidence × examFocusRamp`, chapters at or above the weakness ceiling dropped | `/api/schedule/generate` |
| `scheduling.ts` | sessions per chapter for one exam, consolidation tail | `/api/schedule/suggest` |

They do not contradict each other in spirit — both put due cards and weak
chapters first — but they are three separate implementations of "what matters
most", and nothing tests that they agree. **A fourth must not be written.**

---

## 4. Timezone: everything is UTC, and the product is Lebanese

`toDateKey` is `toISOString().slice(0, 10)`; `addDays` uses `setUTCDate`; the
rest-day check is `getUTCDay()`; `startOfToday` in both the schedule page and
`standing.ts` builds a UTC midnight. Sessions are stored as `@db.Date` at
`T00:00:00.000Z`.

Lebanon is UTC+2 in winter and UTC+3 in summer. So between 00:00 and 03:00
local, "today" in Beirut is still *yesterday* in UTC. A student opening the app
at 1am sees the previous day's plan as today's, and the reminder job — which
matches `scheduledDate: today` in UTC — fires against a UTC day boundary.

Because sessions carry no time of day, this is a **date-boundary** bug rather
than a time-shifting one, and it is consistent across the product.

**FIXED.** `src/lib/calendar.ts` now owns the decision. It separates the two
operations that were being conflated — deciding what today IS, which is a
Beirut question, from reading a day that is already STORED, which is a UTC
question because a `DATE` round-trips as midnight UTC. DST comes from the IANA
database through `Intl` rather than a hardcoded offset, because Lebanon has
moved its clocks at short notice before. `tests/calendar.test.ts` pins the
23:30/00:30 cases, month and year boundaries, and both sides of a DST change.

The fix reached every academic-day caller: the plan, the planner's anchor, the
reminder job, the exam countdown, the due-card badge, the tutor's planning
context, the deck queries, the subject hub and Dashboard Today — most of them
through the one shared `startOfToday` they already imported.

---

## 5. Query architecture, as it stands

Both `/schedule` and `/todos` load **every chapter in the track** into the
client to populate a picker — `db.chapter.findMany({ where: { subject: {
trackId } } })` with no take.

**Measured before acting, and the first estimate here was wrong.** A GS track
holds **243 chapters**, not a thousand — 1,193 is the corpus across all four
tracks (GS, LS, SE, LH), which is the figure `taxonomy.ts` cites and which I
misread as a per-track number. At roughly ninety bytes a row that is about
22 kB uncompressed, a few kB gzipped.

So the picker stays. The real duplication was that `/todos` loaded the same
list again for its own picker, and both pages read their sessions and todos
separately; `getPlan` removes that.

---

## 6. Stop conditions from §37

Two triggered, and both are product decisions rather than implementation
choices. They are set out in the handover message rather than here.

Not triggered:

- `/schedule` and `/todos` are not incompatible models.
- The planner is not LLM output presented as optimisation.
- Durations are typed constants, not invented precision.
- Dashboard Today already reads `studySession` — same source of truth.
- Calendar placement asks the student for minutes a day and a rest day, and
  never claims a time of day, because none is stored.
