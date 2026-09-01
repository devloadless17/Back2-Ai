# Bac II

Exam preparation for the Lebanese Baccalaureate, grounded in the official
curriculum. Next.js (App Router) + PostgreSQL/pgvector + a provider-neutral AI
layer.

The governing principle, which explains most of the design decisions below: a
student always knows where an answer came from. Anything traced to real
curriculum material is cited and badged as such; anything the model supplied
from its own knowledge is answered under a notice that says so, in the answer
itself. A confident wrong answer to an exam candidate is worse than no answer,
and an unlabelled one is how a confident wrong answer gets believed.

This used to read "the system may only say things it can trace to curriculum
material; when it cannot, it says nothing." That was the right rule while the
corpus was the only thing worth standing behind, but it does not survive contact
with a corpus that covers a fraction of the syllabus: in practice the product
spent most of its refusals declining to explain a definition it knew perfectly
well, to a candidate three weeks from an exam. Labelling the answer keeps the
guarantee the refusal was protecting — you can still tell which answers to quote
to a corrector — without charging the student for a gap in our material.

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
| `npm run cron [job]` | scheduled maintenance; `job` is one of `auto_submit`, `mark`, `notify`, `readiness`, `difficulty`, `sessions` |
| `npm run vector:resize` | after changing `EMBEDDING_MODEL`/`EMBEDDING_DIM` |

### Scheduled work

The maintenance jobs live in `src/lib/jobs.ts` and are runnable two ways: `npm
run cron` (OS cron / Task Scheduler, talks to the database directly) or
`POST /api/cron?job=…` with `Authorization: Bearer $CRON_SECRET` (platform
schedulers). Prefer the CLI where you can — `auto_submit` marks papers abandoned
by students who closed the tab, and those marks should not depend on the web
tier being reachable.

Suggested cadence: `auto_submit` and `mark` every 2 minutes, `notify` daily and
early, `readiness` and `difficulty` daily off-peak, `sessions` weekly.

`mark` is the one that matters during an exam window, and it is a **safety net
rather than the primary path**. Submitting a paper closes it, returns
immediately, and starts marking in the background; the job exists to finish
papers whose marking pass died — a timeout, a deploy mid-pass, a 429 from the
provider — and to catch papers auto-submitted by `auto_submit`.

Run it every couple of minutes during an exam window anyway. It is safe to run
concurrently with itself and with the inline pass: marking skips slots that
already carry a mark, so an overlap costs a read and finds nothing to do. It is
also the reason nothing is lost if the host freezes the process after a
response — see the note on ingestion in the known gaps below.

The CLI scripts run with `--conditions=react-server` so that `server-only`
resolves to its no-op rather than throwing. They are server code; the guard
exists to keep these modules out of the *client* bundle.

---

## Deploying to Vercel

Two paths. The first is for an MVP or a demo and takes about twenty minutes; the
second is what has to be true before real students use it.

### Demo / MVP

`vercel.json` and the route `maxDuration`s are set so this deploys on **any
plan**, Hobby included. One caveat worth knowing rather than discovering: Vercel
Hobby forbids commercial use, so the moment this stops being a demo it has to
move to Pro.

**1 — Postgres with pgvector.** Neon's free tier works. The first migration runs
`CREATE EXTENSION "vector"` and `"pgcrypto"`, and three tables hold
`vector(1536)`. Take the connection string.

**2 — Migrate and seed, from your machine.**

```bash
export DATABASE_URL="<your neon url>"
npx prisma migrate deploy
npm run db:seed:taxonomy   # the real curriculum: tracks, subjects, chapters
npm run db:demo            # Maya Haddad, a populated Grade 12 account
```

`db:demo` is the one that makes this worth showing. An empty product demos
terribly — every screen here is built around a history, and with none they all
correctly render their empty states. It builds 60 days of practice weighted so
some chapters are visibly weak, a deck with cards due today, a marked paper with
a barème breakdown including one answer awaiting human marking, and five
tutoring conversations of which one is a refusal. It carries its own content, so
**no corpus ingestion is needed for a demo**.

Sign in as `demo@bac2.local` / `DemoDay2026!`.

Skipping `db:seed:taxonomy` is not survivable: with no `Track` rows `/signup`
renders "Configuration incomplète" and nobody can register at all.

A shell-level `DATABASE_URL` takes precedence over the `--env-file=.env` these
scripts load, so exporting it really does redirect them.

**3 — Import the repo on Vercel and set four variables.**

| Variable | Value |
|---|---|
| `DATABASE_URL` | the same URL |
| `SESSION_SECRET` | 32+ random bytes. Required, no default — the app throws without it |
| `APP_URL` | the deployment URL |
| `AI_PROVIDER` + that provider's key | omit it and every AI surface renders its "not configured" state, which is honest but dull to demo |

Everything else has a working default. `CRON_SECRET` can wait — without it
`/api/cron` returns 503 and nothing else changes.

**4 — Deploy.** That is the whole demo path.

**What is degraded, and it is better to know than to find out on stage:**

* **Uploads do not persist.** `STORAGE_DRIVER` defaults to the local driver,
  which writes to a per-invocation `/tmp`; the file is gone by the next request.
  The write *appears* to succeed. Either skip the photo-answer and reference-
  document features, or set up R2 and `STORAGE_DRIVER=s3`.
* **"Generate 10 cards" returns two or three.** The demo seed gives most
  chapters a single textbook passage, and the writer can only draw so many
  distinct cards from one. It works; it just will not produce ten.
* **Cron runs daily at 03:00**, because Hobby allows two jobs at daily
  granularity. Marking happens inline when a paper is submitted, so the job is
  only a safety net — fine for a demo, not for an exam window.

### Production

Everything above, plus the four below. None of them matter at demo scale and all
of them matter with real students.

**Plan.** Hobby forbids commercial use. Pro also lifts `maxDuration` to 300s
and cron to any schedule — raise the 60 in `src/app/api/cron/route.ts` and the
daily schedule in `vercel.json` once you are on it. A `maxDuration` above the
plan's ceiling *fails the deployment* rather than being clamped, so change those
two together.

**Storage.** Set `STORAGE_DRIVER=s3` and real `S3_*` credentials — R2 or S3.
`S3_FORCE_PATH_STYLE=false` for AWS, `true` for R2 and MinIO. This is the one
that fails silently: the local driver accepts every write and loses the file.

**Connection pooling.** Every serverless invocation is its own process with its
own Prisma client, so a direct Postgres URL opens a connection per concurrent
request and exhausts `max_connections` under ordinary load. Point `DATABASE_URL`
at a pooler — Neon's pooled endpoint, Supabase's `6543`, PgBouncer, or Prisma
Accelerate — with `?pgbouncer=true&connection_limit=1` where the pooler is in
transaction mode. Keep the **direct** URL for migrations.

**Migrations stay manual.** `vercel.json` deliberately does not run
`prisma migrate deploy` in the build command: a build cannot tell a preview from
production, so putting migrations there points every pull-request preview at the
production database.

**A first administrator.** There is no bootstrap script, on purpose. Sign up
through `/signup` like a student, then promote that row once:

```bash
echo "UPDATE users SET role = 'admin' WHERE email = 'you@example.com';" \
  | npx prisma db execute --url "<direct>" --stdin
```

`db execute` needs `--url` or `--schema` explicitly; it does not read
`DATABASE_URL` from the environment the way the other commands here do.

**The corpus.** Until this runs the library holds only the demo content and the
assistant correctly refuses everything else. It is a long batch job needing the
corpus files on disk, so run it from a workstation or the container — never from
Vercel:

```bash
DATABASE_URL="<direct>" npm run ingest
DATABASE_URL="<direct>" npm run ingest -- --embed-missing   # backfill vectors
```

**Cron belongs off Vercel.** `vercel.json`'s schedule is a fallback. The
argument above still stands: `auto_submit` marks papers abandoned by students
who closed the tab, and those marks should not depend on the web tier being
reachable. Run `npm run cron` on a machine you control, every couple of minutes
during an exam window.

Verify whichever you use — Vercel Cron sends GET with the secret as a bearer
token, which is why the route exports both verbs:

```bash
curl -i -H "authorization: Bearer $CRON_SECRET" https://<app>/api/cron
```

A 401 means the secret differs between your shell and the deployment; a 405
means the GET export was lost.

**`EMBEDDING_PROVIDER=local` does not work on Vercel**, deliberately. The ONNX
runtime behind it is 69 MB of native binaries, and tracing it into every
function that can reach `lib/ai/embeddings.ts` spent a quarter of the 250 MB
function limit on a path a hosted-embeddings deployment never executes. The
import is opaque to the bundler so the weight stays out, and the module throws a
named error if the provider is `local` and the package is absent. Embed from the
container, which is where that batch job belongs.

**The rate limiter counts in process memory.** `rateLimit` in `src/lib/api.ts`
is documented as needing Redis before multi-instance production, and a
serverless deploy *is* multi-instance: each instance keeps its own map, so the
effective limit multiplies by the number of warm instances — including the
six-per-hour cap on card generation, the most expensive endpoint here. Nothing
in it is a security control, but the cost control is weaker than it reads.

## Architecture notes

Things a reader would otherwise have to reverse-engineer.

**Auth is session-based, not JWT.** `sessions` stores a SHA-256 of an opaque
token; the raw token exists only in an httpOnly cookie. The trade is one indexed
lookup per request in exchange for instant revocation — for a product that
proctors exams, terminating a live session mid-attempt is a requirement, and a
stateless JWT cannot offer it.

**Retrieval is tiered and stops at the first hit** (`src/lib/retrieval.ts`):
near-exact past question (≥ 0.85) → chapter course material (≥ 0.72) → the
student's own uploaded documents (≥ 0.72). Every assistant message records which
tier fired and the similarity that triggered it, so the thresholds can be tuned
against real traffic. `npm run eval` measures them.

**Below the last threshold there are three outcomes, not one** (`src/lib/chat.ts`):

| The message | What happens | Tier recorded |
|---|---|---|
| A greeting, a courtesy, a question about the tutor | Answered as chat, no grounding claimed, no badge shown | `conversational` |
| A question about their own revision — "am I behind?", "what should I do next?" | Answered from their schedule, mastery and exam date | `study_record` |
| A comprehension question about a passage nobody supplied | Asks for the passage | `ungrounded_refused` |
| Any other subject question | Answered from the model's own knowledge, under a notice saying it is not from their course material | `general_knowledge` |

Intent is decided before retrieval (`src/lib/chat-intent.ts`) by rules rather
than by a model, because it runs on the critical path of every question asked.
The tables are matched as substrings, so they are bounded by a length ceiling:
above thirty words a message is treated as a curriculum question whatever phrase
it contains. That is not a guess — of the 5,297 past-exam questions in the
corpus, 22 contained a stray "what is this" or "من انت" in their body and were
being answered with a description of the tutor instead of with help. Students
paste exam papers constantly; it is the commonest way they ask anything here.

The planning lane reads the same queries the dashboard and sidebar read, so the
tutor cannot tell a student they are 12 days from the exam while the sidebar
says 11. It is forbidden from teaching, from predicting a result, and from
changing a schedule — plans are applied only when a student accepts one on the
schedule page.

The notice is prepended in code rather than requested in the prompt. A model
asked to flag its own uncertainty complies most of the time, and the times it
does not are exactly the confident wrong answers the label exists to catch.
It is also stored on the message, so the label is still there after a reload
rather than living only in the stream.

That lane runs its own prompt with its own limits — no citations, no page or
chapter references, no barème, nothing about the student's own progress — and
reports `verified: false`, because `verifyAgainstContext` has no context to
check anything against. Comprehension is the one kind held back from it: there
is no general-knowledge answer to "what does the author mean in line 4", so
labelling one would not make it less invented.

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
