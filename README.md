# Bac II

Exam preparation for the Lebanese Baccalaureate, grounded in the official
curriculum. Next.js (App Router) + PostgreSQL/pgvector + a provider-neutral AI
layer.

The governing principle, which explains most of the design decisions below: the
system may only say things it can trace to real curriculum material. When it
cannot, it says so. A confident wrong answer to an exam candidate is worse than
no answer.

---

## Running it locally

Requires Node ≥ 20.10 and Docker.

```bash
docker compose up -d          # Postgres 16 + pgvector on port 5442
cp .env.example .env          # then fill in the values (see below)
npm install
npm run db:deploy             # apply migrations
npm run db:seed               # taxonomy, demo content, demo accounts
npm run dev                   # http://localhost:3000
```

Demo accounts (development only — change before any deployment):

| | |
|---|---|
| student | `student@bac2.local` / `ChangeMeImmediately!2026` |
| admin | `admin@bac2.local` / `ChangeMeImmediately!2026` |

**Showing the product to someone?** Run `npm run db:demo` for a fully loaded
account — 60 days of practice history, a marked paper, a deck due today and five
recorded tutoring conversations. Credentials and an eight-minute script are in
[docs/DEMO.md](docs/DEMO.md). Its content is illustrative rather than official
ministry material, and the account says so on its own dashboard.

### Environment

`SESSION_SECRET` and `DATABASE_URL` are required; the app will not boot without
them. Everything else has a working default.

**The AI keys are optional and the app is fully navigable without them.** With
no key configured, chat returns an explicit "not configured" notice, retrieval
refuses rather than guessing, generation reports the pool exhausted, and exam
marking records "needs human marking" instead of a zero. That is deliberate —
an unkeyed deployment should be inspectable, and should never quietly degrade
into invented content.

Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` with `AI_PROVIDER=openai`) plus an
embedding key to enable chat, generation, marking, OCR and ingestion.

---

## Scripts

| | |
|---|---|
| `npm run db:seed:taxonomy` | load the real curriculum from the transcribed books |
| `npm run db:prune` | remove the invented placeholder taxonomy |
| `npm run db:demo` | **loads the presentation account** — see [docs/DEMO.md](docs/DEMO.md) |
| `npm run dev` / `build` / `start` | the app |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unit tests (scoring, marking, scheduling — no DB or API key needed) |
| `npm run smoke` | end-to-end HTTP checks against a running server |
| `npm run db:seed` / `db:deploy` / `db:reset` / `db:studio` | database |
| `npm run ingest -- --file <path> --track GS --subject "Mathematics" --kind exam_paper --year 2023` | ingest a paper |
| `npm run ingest -- --embed-missing` | backfill embeddings for anything without a vector |
| `npm run ingest -- --recalibrate` | recompute question difficulty from observed attempts |
| `npm run eval` | retrieval eval harness — measures whether the tier thresholds fit the corpus |
| `npm run cron [job]` | scheduled maintenance; `job` is one of `auto_submit`, `notify`, `readiness`, `difficulty`, `sessions` |
| `npm run vector:resize` | after changing `EMBEDDING_MODEL`/`EMBEDDING_DIM` |

### Scheduled work

The maintenance jobs live in `src/lib/jobs.ts` and are runnable two ways: `npm
run cron` (OS cron / Task Scheduler, talks to the database directly) or
`POST /api/cron?job=…` with `Authorization: Bearer $CRON_SECRET` (platform
schedulers). Prefer the CLI where you can — `auto_submit` marks papers abandoned
by students who closed the tab, and those marks should not depend on the web
tier being reachable.

Suggested cadence: `auto_submit` every 5 minutes, `notify` daily and early,
`readiness` and `difficulty` daily off-peak, `sessions` weekly.

The CLI scripts run with `--conditions=react-server` so that `server-only`
resolves to its no-op rather than throwing. They are server code; the guard
exists to keep these modules out of the *client* bundle.

---

## Architecture notes

Things a reader would otherwise have to reverse-engineer.

**Auth is session-based, not JWT.** `sessions` stores a SHA-256 of an opaque
token; the raw token exists only in an httpOnly cookie. The trade is one indexed
lookup per request in exchange for instant revocation — for a product that
proctors exams, terminating a live session mid-attempt is a requirement, and a
stateless JWT cannot offer it.

**Retrieval is tiered and stops at the first hit** (`src/lib/retrieval.ts`):
near-exact past question (≥ 0.85) → chapter course material (≥ 0.72) → the
student's own uploaded documents (≥ 0.72) → explicit refusal. Every assistant
message records which tier fired and the similarity that triggered it, so the
thresholds can be tuned against real traffic. `npm run eval` measures them.

**Generated content is admin-gated.** A generated problem is written from real
questions in the same chapter, checked for near-duplicates by embedding, solved
independently by a second model, and only becomes visible to students when an
administrator approves it in the review queue. `published_at` is set in exactly
one place — the review-queue handler. No student-facing query selects a row
where it is null.

**The exam timer is server-authoritative.** `exam_simulations.expires_at` is
written at start and every write is validated against it. The browser countdown
is a display of that deadline. Barèmes are snapshotted onto the simulation at
composition time so later edits to a question cannot re-mark an already-sat
paper.

**A question that could not be marked is not a zero.** It is excluded from both
the awarded and the available total, stored with a null score, shown as awaiting
marking, kept out of the mastery calculation, and filed to the review queue.

**Old-cycle mode writes no attempts.** Reading a past paper with the solutions
to hand is legitimate revision, and it must not move a number the rest of the
product treats as evidence of unaided ability.

**Nothing in storage has a public URL.** Answer photos and personal documents
are served through `/api/files/[...key]`, which checks ownership from both the
key's shape and the row that references it.

**The curriculum is derived, not invented.** Subjects, units and chapters are
read out of the transcribed CRDP textbooks' own tables of contents and loaded by
`prisma/taxonomy-loader.ts`; which book serves which branch comes from each
book's ingestion record. The four branch codes are `GS`, `LS`, `SE`, `LH` — one
set, matching what every book is filed under. The placeholder programme in
`seed-data.ts` now only runs in a checkout without `corpus/`.

The loader refuses material it cannot vouch for: back matter ("Answers and
Hints") is dropped, a contents page that parsed into structural furniture
("Part D", "The Authors") seeds nothing and is named in the run output, and a
book whose list shrinks has its stranded chapters withdrawn — unless work is
already filed under them, in which case it says so and leaves them. A missing
subject is obviously missing and gets fixed; a subject full of "Part C" looks
like a working feature and does not. What is authoritative and what is still
open is written down in [docs/CURRICULUM.md](docs/CURRICULUM.md).

**Signup asks for country, section and language, and locks the last two.**
Country exists because every question in the corpus belongs to one national
curriculum: Lebanon is the only one ingested, so it is the only selectable
option. The others are listed and disabled rather than hidden — "not yet" is the
true answer and is more useful than a one-item dropdown. `POST /api/auth/signup`
re-checks it, since a `disabled` attribute is a hint to a browser and not a rule.

**No payment processor is connected, and the code says so in one place.**
`PAYMENTS_ENABLED` in `src/lib/billing.ts` is false; every screen that mentions
money reads it. A card can be entered at signup or under `/settings/billing` and
is validated (Luhn, brand, expiry) — but **the card number and security code
never leave the browser**. `cardSummary()` reduces the form to brand, last four
and expiry, and the API schemas are `.strict()`, so a client that posts a PAN is
rejected rather than quietly stored. Nothing is charged, the subscription row
stays `pending`, and **nothing in the product is gated on it**: gating study
material behind a payment that cannot be taken would lock students out of a
product that is not charging them. Wiring a processor later adds columns and a
call; it does not require unpicking any of this.

**Flashcards can be driven by weakness instead of by the clock.**
`?scope=weak` builds the session from the chapters the student's own attempts say
they are worst at — mastery below 0.7, and only past `MIN_ATTEMPTS_FOR_WEAKNESS`,
so one bad afternoon is not a diagnosis. Due cards in those chapters come first;
if there are too few, the session is topped up with cards that are not due yet,
nearest-due first, and each one is labelled *ahead of schedule*. That top-up is a
real cost — an early review earns an interval it has not quite proved — and it is
accepted only inside this scope, where the student has explicitly asked to drill.
With no qualifying chapter the page says so rather than congratulating them on
being caught up.

**Tutoring can work from the correction key.** A chat session may be anchored to
a marked attempt (`chat_sessions.attempt_id`), which hands the tutor what the
student actually wrote, the mark it earned and the barème it was marked against.
The prompt then tells it to find the first line that diverges from the official
solution and tie each lost mark to a criterion, rather than reciting the model
answer — which the student can already read. The question is always taken from
the attempt, so no one can pair one answer with another question's key.

**The design system is two files.** `src/app/globals.css` holds the tokens —
a light lavender canvas, violet/pink brand, chunky radii, spring easings — and
`tailwind.config.ts` maps them to semantic names. No component references a raw
colour, so retheming is still one `:root` block. Two constraints hold the
palette honest: status colours (correct / partial / mark) all clear 3:1 against
the card surface and are **never the only carrier of meaning** — green and amber
are the same colour under protanopia, so every band-coloured figure ships with
its number and a word; and the chart ramp `--viz-1..4` is a single violet hue,
monotone in lightness, validated rather than eyeballed.

**Everything animates except the paper being sat.** Entrances stagger in, figures
count up, arcs and bars draw themselves, the sidebar answers the pointer. Three
rules keep that usable: motion never carries information alone (every animated
value is also plain text), nothing is invisible until it animates (a reveal that
never fires leaves content on screen, not a blank page), and
`prefers-reduced-motion` wins — the global rule in `globals.css` collapses CSS
animation and `useReducedMotion` short-circuits the JS-driven ones. The live exam
runner is wrapped in `.calm`, which switches off every entrance and loop inside
it: a gradient panning beside a running clock is pressure, not personality.
Page transitions have no exit animation, deliberately — an exit taxes every
navigation with its own duration, and students move between these screens dozens
of times an evening.

**Locale follows the user, not the URL.** It is chosen at signup, locked
alongside track, and stored on `users.preferred_language`. There is no
`[locale]` route segment. Signed-out pages fall back to a cookie, then
`Accept-Language`, then `DEFAULT_LOCALE`. Changing a student's locked language
is an admin action under `/admin/users` and is audit-logged.

---

## Deliberate deviations from the execution plan

- **NextAuth → custom sessions**, for the revocation reason above.
- **ivfflat → HNSW** vector indexes. ivfflat needs a manual rebuild after
  ingestion, which is a step nobody remembers.
- **`GET /api/generation/practice` is pool-only.** The plan describes it as
  "serve from pool, or trigger live gen as fallback"; the fallback lives on
  POST, because a GET that spends money and writes rows is one a prefetch or a
  retry will fire by accident.
- **Five tables were added** beyond the plan's schema, each for a feature the
  plan specifies but gives nowhere to store: `sessions`, `audit_events`,
  `content_chunks` (without which retrieval tier 2 can never fire),
  `ingestion_jobs`, and MCQ options on `questions`.

---

## Known gaps

- **Billing takes no money.** Plans, the card-on-file panel and the signup
  payment step are all real UI over a table that no processor writes to. Before
  charging anyone: connect a processor, move card capture into its hosted fields
  or SDK (this codebase must stay out of PCI scope), set `subscriptions.status`
  from its webhooks rather than from the client, and only then decide what — if
  anything — a `pending` subscription should be prevented from doing.
- **The ingestion pipeline has never been run against a real scanned paper.** It
  is written and wired, but segmentation of a real exam PDF deserves a
  supervised first run before its output is trusted.
- **The rate limiter is in-process.** Fine for a single instance; back it with
  Redis before running multiple.
- **Ingestion continues after the HTTP response returns.** That holds on a
  long-running Node server, which is what this targets. On a platform that
  freezes the process after the response, move the job body to a queue worker —
  the job row and the polling UI stay as they are.
- **`sharp` is pinned via an npm override** to clear a libvips advisory. This
  app uses plain `<img>` rather than `next/image`, so the image-optimisation
  path is not exercised; remove the override once Next ships a patched pin.
