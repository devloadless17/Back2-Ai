# BAC2 — launch QA

Release mode, 2026-09-18. Branch `demo`, head `7d8dcf5` plus today's hardening.

**No runtime environment is available on this machine — no Docker, no browser.**
Everything below marked `BLOCKED` is a check that must be executed by a human
after deploy. A static code audit is not runtime QA and is not recorded as one.

---

## Release status: **AMBER**

No known P0 in correctness, authorization, data integrity or build. Two
deployment preconditions and the entire runtime matrix are unverified.

AMBER, not GREEN, for exactly two reasons:

1. **Nothing has been executed against a database or a browser.**
2. **A CLI deploy from this working tree would ship a colleague's uncommitted
   work.** See *Deployment preconditions*.

---

## P0 — must be true before deploy

| # | Condition | State |
|---|---|---|
| 1 | `prisma migrate deploy` run **before** the new code goes live | **ACTION REQUIRED** |
| 2 | Deploy from a clean checkout, not this working tree | **ACTION REQUIRED** |
| 3 | `DATABASE_URL` set in production | verify |
| 4 | `SESSION_SECRET` set, ≥16 chars | verify |
| 5 | `OPENAI_API_KEY` set | verify — Nour and all grading depend on it |
| 6 | `CRON_SECRET` set | verify — without it the nightly cron 401s **silently**, so expired papers are never auto-submitted and no reminders send |
| 7 | `S3_*` set | verify — defaults point at `localhost:9000`; photo answers and uploads fail without them |
| 8 | `APP_URL` set to the real origin | verify — used in emails and links |

Items 3–8 are `verify` because this machine cannot read the production
environment. Any one of them missing is a launch blocker.

### Why item 1 is ordered

`20260918090000_exam_cycle_duration_provenance` adds
`exam_cycles.duration_is_official`. The new code SELECTs it. If code ships
first, **every exam query fails**. The migration is additive
(`ADD COLUMN NOT NULL DEFAULT FALSE`), so the old code runs happily against the
new column — migrate first is safe in both directions.

---

## Deployment preconditions

**The Vercel CLI uploads the working directory, not the git tree.** There are
42 uncommitted entries belonging to another developer — in-flight RTL paper
direction, admin chapter management, worksheet work, and two untracked
migrations.

Deploying from here ships all of it, unreviewed.

Required: deploy from a clean checkout of the committed branch, **or** wait for
the colleague to commit and re-verify. This is a release-process decision, not
something to work around.

---

## Runtime QA matrix — BLOCKED, execute after deploy

### Auth and session
- [ ] sign up, land on track selection
- [ ] select track, land on dashboard
- [ ] sign out, sign in, session persists
- [ ] a signed-out user hitting `/dashboard` is sent to sign-in
- [ ] a student hitting `/admin` is refused

### Core academic loop
- [ ] dashboard shows a real next action
- [ ] open Practice, a question renders with its maths
- [ ] submit an answer, it is marked
- [ ] criteria show ✓ ◐ × with marks
- [ ] Progress reflects the new attempt
- [ ] ask Nour, answer streams, evidence is listed
- [ ] Nour refuses an off-programme question **differently** from an error
- [ ] schedule a session, it appears in Today

### Mock
- [ ] start a real past paper — reads "standard sitting", not an official duration
- [ ] answer, refresh mid-paper — answer and remaining time both survive
- [ ] submit with an unanswered question — the count is stated
- [ ] result: raw score, `/20` only if nothing awaits a human
- [ ] a generated solution reads **Model answer**, never Official

### Truthfulness
- [ ] a brand-new account shows `—`, never `0/20`, never "0% mastery"
- [ ] below 10 marked answers, no `/20` anywhere
- [ ] no screen says "predicted", "on track" or "will score"

### Mobile, 390 × 844
- [ ] dashboard, Nour, Practice, Progress, Schedule, Mock desk, Mock result
- [ ] no horizontal scroll on the page body
- [ ] the Nour composer is reachable with the keyboard open
- [ ] the Mock submit button is reachable

### Language
- [ ] Arabic interface: layout mirrors, numerals correct
- [ ] Arabic content inside an English interface renders right-to-left
- [ ] French content inside an Arabic interface
- [ ] weekday and date names follow the interface language

### Failure behaviour
- [ ] with the model unavailable, Nour shows a retry, not a stack trace
- [ ] with the model unavailable, a Practice submission does **not** record zero

---

## Verified statically today

These were read in source and are **not** runtime-verified.

| Area | Finding |
|---|---|
| Ownership | Every `[id]` API route scopes to the caller. `/api/progress/[userId]` and `/api/readiness/[userId]` require self-or-admin and answer 404, not 403, so they cannot confirm another account exists. |
| File proxy | `/api/files/[...key]` checks ownership against the student's own references and their own exam answers. |
| Page guards | Every page under `(app)` and `(exam)` calls `requireUser`, except three that are pure redirects to guarded pages. |
| Cron | Refuses everything when `CRON_SECRET` is unset, constant-time compare, GET for Vercel and POST for self-hosted. |
| Client env | No `NEXT_PUBLIC_*` anywhere. No secret can reach the browser through config. |
| Exam integrity | No solution, barème, justification or explanation in the sitting payload. Guarded by test. |
| Idempotency | Exam submit is server-side idempotent (`ALREADY_SUBMITTED`). Both runners disable their submit while in flight. |
| Copy | Dictionaries are free of mojibake and of predictive claims. Guarded by test. |

---

## Post-deploy smoke test — 10 to 15 minutes

Run in this order. Stop at the first failure.

1. Load the site. Sign in with a known account.
2. Dashboard renders, shows a next action.
3. Open Nour, ask a real subject question. Answer streams; evidence appears.
4. Open Practice, answer one question, confirm it is marked.
5. Open Progress, confirm the attempt is reflected and no `/20` appears if the
   account is below ten marked answers.
6. Open Schedule, add a session for today, confirm it appears in Today.
7. Start a Mock. Confirm the duration line reads "standard sitting".
8. Type an answer, refresh the page, confirm the answer and the clock survived.
9. Submit the Mock. Confirm the result renders and the solution heading is
   correct for the question's provenance.
10. Switch the interface to Arabic. Confirm the layout mirrors and the dashboard
    is readable.
11. Repeat steps 2–4 on a phone at 390px width.
12. Sign out and back in. Confirm the work from step 4 is still there.

---

## Rollback

Deployment is Vercel, project `bac2ai`, via the CLI.

- **Identify the last good deployment:** `vercel ls bac2ai` — the previous
  production deployment above today's.
- **Roll back code:** `vercel rollback <deployment-url>`, or promote the previous
  deployment from the Vercel dashboard.
- **Database:** the only migration in this release is additive with a default.
  **It is backward compatible** — the previous code does not reference
  `duration_is_official` and runs unchanged against the new column. No database
  rollback is needed, and none should be attempted.

---

## Deliberately not done today

Feature work is frozen. Deferred, with reasons already recorded in
`NOUR-VERIFICATION-DEBT.md`: the desktop Mock navigator sidebar, deeper Mock
history, official duration ingestion, and the Report redesign.
