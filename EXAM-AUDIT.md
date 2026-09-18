# Mock Exam / Exam Simulation — audit

Step 1. Written 2026-09-18, before any design work.

Nothing here has been run: no Docker, no browser. Every statement is read off
the source and names where.

**Headline: this is the most carefully built surface in the product, and one
thing in it is not true.** The timer on an official paper is a schema default.

---

## 1. What exists, classified

| Thing | Class | Where |
|---|---|---|
| `ExamSimulation` — mode, status, duration, scores, timestamps | **REAL + PERSISTED** | `schema.prisma:827` |
| **`expiresAt` — server-authoritative deadline** | **REAL + PERSISTED** | `schema.prisma:838` |
| `ExamSimulationQuestion.baremeSnapshot` — barème frozen at composition | **REAL + PERSISTED** | `schema.prisma:864` |
| `ExamAnswer` — typed or photo, OCR text, consistency verdict, barème result | **REAL + PERSISTED** | `schema.prisma:877` |
| `ExamCycle` — subject, year, session, language, title | **REAL + PERSISTED** | `schema.prisma:654` |
| **`ExamCycle.durationMinutes`** | **UNSUPPORTED in practice** — see §4 | `schema.prisma:665` |
| Autosave: debounce, retry with backoff, unsaved set | **REAL + PERSISTED** | `exam-runner.tsx:140` |
| Resume after refresh / close — answers and clock both reload | **REAL + DERIVED** | desk page, `remainingSeconds` |
| Auto-submit on expiry, by cron | **REAL + PERSISTED** | `exam.ts:1194` |
| One live paper at a time, enforced at start | **REAL + PERSISTED** | `exam.ts:65` |
| Mock answers write `Attempt` rows with `context: 'exam_sim'` | **REAL + PERSISTED** | `exam.ts:1063` |
| Unmarkable questions excluded from the total, and counted | **REAL + DERIVED** | results page |
| Focused exam mode via a separate `(exam)` route group | **REAL** | `src/app/(exam)/layout.tsx` |
| Countdown display | **CLIENT-ONLY, and says so** — server validates | `schema.prisma:835` |
| Pause | **UNSUPPORTED** — none exists |  |
| Flag-a-question-for-review | **UNSUPPORTED** — no persisted state |  |
| Launching a past paper into simulation from `/old-cycles` | **UNSUPPORTED** — no link |  |

### Things already right that the brief worried about

- **No solution or barème reaches the client before submission.** The desk
  page maps each slot to content, chapter, max score and the student's own
  saved answer. Nothing else. §AK is satisfied by construction, not by luck.
- **The timer is not client-trusted.** `expiresAt` is a column, the countdown
  is explicitly display-only, and submission validates against the column.
- **Refresh does not reset anything.** Answers come from `ExamAnswer`, the
  clock from `expiresAt`.
- **Grading gaps are already honest.** A paper with no official barème says so
  in as many words — "not the examiner's own. Treat the mark as an indication."
- **The result does not normalise to /20.** It shows raw `total / max`. That is
  the safe choice and no invented normalisation exists to remove.
- **Mock results are not confused with readiness.** The mock shows its own
  score; the attempts it writes feed mastery through the normal pipeline.

---

## 2. The taxonomy already exists, and it is correct

`ExamSourceMode`, `schema.prisma:80`, with the distinctions the brief asks for
already written into the enum's own comments:

| Mode | Means |
|---|---|
| `real_cycle` | One official paper, sat as it was printed |
| `real_mixed` | A mock assembled from real past-exam questions the student has not met. No model writes anything |
| `ai_generated` | Model-written problems, each approved through the review queue first |

Provenance is recoverable per question too: a slot carries either `questionId`
or `generatedProblemId`, never both. **§B needs no new vocabulary** — it needs
the existing one surfaced.

---

## 3. `/old-cycles` and `/exam-sim` are not duplicates

- **`/old-cycles`** is *unscored study*: reading an official paper with the
  solutions to hand. It deliberately writes no attempt row — `AttemptContext`
  says so explicitly, because an unscored read "would otherwise poison
  mastery".
- **`/exam-sim`** is *timed, scored simulation*.

Both are defensible and both should stay. **What is missing is the bridge**:
there is no way to launch the paper you are looking at into simulation mode.
`startFromRealCycle` already takes a cycle id, so the data supports it and only
the link is absent.

---

## 4. THE PROBLEM: every official paper is 180 minutes

`ExamCycle.durationMinutes` is `Int @default(180)`. Its own doc comment says
"a real cycle's duration is a property of the paper, not of the student's run",
which is exactly right.

**The bulk corpus loader never sets it.** `scripts/corpus/load-exams.ts:491`
upserts each cycle with `update: {}` and a `create` block containing subject,
year, session, language and title — and no duration. So every ingested official
paper takes the default.

The mechanism is not missing. `scripts/ingest.ts` accepts `--duration`, and the
seed data proves the team knows durations vary:

| Seeded paper | Minutes |
|---|---|
| Mathématiques SG | 240 |
| Physique SG | 180 |
| Chimie SG | 120 |
| Sciences de la Vie SV | 180 |
| Philosophie LH | 180 |

A Lebanese Bac Maths SG paper is four hours. A student sitting the real 2023
paper under the label **"An official paper, exactly as it was sat"** gets three.

**Mitigating, but not enough:** the setup screen does not currently display the
duration — `durationMinutes` is passed into the form's props and never
rendered. So the number is not printed next to the word "official". But the
clock runs on it, the paper is described as sat exactly as it was, and the
timer is the single most consequential thing on the screen.

This is §AR's first stop condition: *timer duration is arbitrary but presented
as official*. It is a data and schema question, not a UI one, so it is raised
rather than styled around.

---

## 5. Stop conditions: one of ten triggered

| § | Condition | Status |
|---|---|---|
| 1 | Duration arbitrary but presented as official | **TRIGGERED** — §4 |
| 2 | Refresh resets exam time | No — `expiresAt` is a column |
| 3 | Submission/expiration ambiguous | No — cron auto-submits, start auto-submits a stale one |
| 4 | Solutions leak pre-submit | No — not in the client payload |
| 5 | Generated and official indistinguishable | No — `sourceMode` plus per-slot ids |
| 6 | Score normalisation invalid | No — it does not normalise |
| 7 | Completed mock does not reach readiness | No — writes `Attempt` with `context: 'exam_sim'` |
| 8 | Multiple active exams ambiguous | No — one live paper, enforced |
| 9 | Grading gaps make the total misleading | No — unmarkable questions excluded and counted |
| 10 | Collision with protected colleague work | Not yet — nothing edited |

---

## 6. Smaller findings, not blocking

- **No pause.** Probably correct for an exam, but it means a student who has to
  stop loses the time. Worth a decision eventually, not now.
- **No flag-for-review.** The navigator can therefore show answered / unanswered
  / current and nothing else, which is what §N wants anyway.
- **Answer input is typed text or a photo** with an OCR self-consistency gate
  that rejects unreadable shots rather than marking garbage. There is no
  dedicated maths input; typed answers are plain text.
