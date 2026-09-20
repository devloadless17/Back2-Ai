# Bac II

Exam preparation for the Lebanese Baccalaureate. Next.js (App Router),
PostgreSQL + pgvector, and a provider-neutral AI layer.

One rule shapes most of the design: a student always knows where an answer came
from. Anything traced to real curriculum material is cited and badged; anything
the model supplied from its own knowledge is answered under a notice that says
so, in the answer itself.

## Running it locally

Needs Node >= 20.10 and Docker.

```bash
docker compose up -d      # Postgres 16 + pgvector on port 5442
cp .env.example .env      # then fill in the values
npm install
npm run db:deploy         # apply migrations
npm run db:seed           # taxonomy, demo content, demo accounts
npm run dev               # http://localhost:3000
```

Development accounts — change them before any deployment:

| | |
|---|---|
| student | `student@bac2.local` / `ChangeMeImmediately!2026` |
| admin | `admin@bac2.local` / `ChangeMeImmediately!2026` |

`npm run db:demo` loads a fully populated account (`demo@bac2.local` /
`DemoDay2026!`) with practice history, a marked paper and cards due today. Every
screen is built around a history, so an empty database demos badly.

## Environment

`SESSION_SECRET` and `DATABASE_URL` are required; the app will not boot without
them. Everything else has a working default.

The AI keys are optional and the app is fully navigable without them. With no
key, chat returns a "not configured" notice, retrieval refuses rather than
guessing, and exam marking records "needs human marking" instead of a zero. Set
`ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` with `AI_PROVIDER=openai`) plus an
embedding key to enable chat, generation, marking, OCR and ingestion.

## Scripts

| | |
|---|---|
| `npm run dev` / `build` / `start` | the app |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unit tests — no database or API key needed |
| `npm run smoke` | end-to-end HTTP checks against a running server |
| `npm run db:deploy` / `db:seed` / `db:reset` / `db:studio` | database |
| `npm run db:seed:taxonomy` | load the real curriculum from the transcribed books |
| `npm run db:demo` | load the populated demo account |
| `npm run ingest -- --file <path> --track GS --subject "Mathematics" --kind exam_paper --year 2023` | ingest a paper |
| `npm run ingest -- --embed-missing` | backfill embeddings |
| `npm run eval` | retrieval eval harness |
| `npm run cron [job]` | maintenance: `auto_submit`, `mark`, `notify`, `readiness`, `difficulty`, `sessions` |

The `corpus:*` scripts in `package.json` are the ingestion pipeline (OCR,
extraction, chunk loading, chapter linking). They run against files on disk and
are not needed to run the app.

CLI scripts run with `--conditions=react-server` so `server-only` resolves to a
no-op. They are server code; the guard keeps these modules out of the client
bundle.

### Scheduled work

Jobs live in `src/lib/jobs.ts` and run two ways: `npm run cron` (talks to the
database directly) or `POST /api/cron?job=…` with `Authorization: Bearer
$CRON_SECRET`. Prefer the CLI — `auto_submit` marks papers abandoned by students
who closed the tab, and those marks should not depend on the web tier being up.

Suggested cadence: `auto_submit` and `mark` every 2 minutes, `notify` daily and
early, `readiness` and `difficulty` daily off-peak, `sessions` weekly.

Marking happens inline when a paper is submitted; the `mark` job is a safety net
for passes that died. It is safe to run concurrently — marking skips slots that
already carry a mark.

## Things worth knowing before you change anything

**Auth is session-based, not JWT.** `sessions` stores a SHA-256 of an opaque
token; the raw token exists only in an httpOnly cookie. The trade is one indexed
lookup per request in exchange for instant revocation, which a product that
proctors exams needs.

**Retrieval is tiered and stops at the first hit** (`src/lib/retrieval.ts`):
near-exact past question (>= 0.85), then chapter course material (>= 0.72), then
the student's own uploaded documents (>= 0.72). Every assistant message records
which tier fired and the similarity that triggered it.

**Below the last threshold there are four outcomes, not one** (`src/lib/chat.ts`):
a greeting is answered as chat, a question about the student's own revision is
answered from their schedule, a comprehension question about a passage nobody
supplied asks for the passage, and anything else is answered from the model's own
knowledge under a notice saying it is not from their course material. Intent is
decided by rules before retrieval (`src/lib/chat-intent.ts`), not by a model,
because it runs on the critical path of every question.

**The exam timer is server-authoritative.** `exam_simulations.expires_at` is
written at start and every write is validated against it. Barèmes are
snapshotted at composition time so later edits cannot re-mark a sat paper.

**A question that could not be marked is not a zero.** It is excluded from both
totals, stored with a null score, kept out of mastery, and filed to review.

**Generated content is admin-gated.** `published_at` is set in exactly one place
— the review-queue handler — and no student-facing query selects a null row.

**The curriculum is derived, not invented.** Subjects, units and chapters are
read out of the transcribed CRDP textbooks' tables of contents and loaded by
`prisma/taxonomy-loader.ts`. The four branch codes are `GS`, `LS`, `SE`, `LH`.
The Markdown files under `scripts/corpus/toc-overrides/` and
`scripts/corpus/transcriptions/` are that source data, not documentation.

**Nothing in storage has a public URL.** Answer photos and personal documents go
through `/api/files/[...key]`, which checks ownership.

**Locale follows the user, not the URL.** Chosen at signup, stored on
`users.preferred_language`. There is no `[locale]` route segment.

**The design system is two files.** `src/app/globals.css` holds the tokens and
`tailwind.config.ts` maps them to semantic names. No component references a raw
colour. Status colours are never the only carrier of meaning, and
`prefers-reduced-motion` switches off every animation.

## Deploying

`vercel.json` and the route `maxDuration`s are set to deploy on any Vercel plan.
Provision Postgres with pgvector (Neon's free tier works — the first migration
runs `CREATE EXTENSION "vector"` and `"pgcrypto"`), then from your machine:

```bash
export DATABASE_URL="<your url>"
npx prisma migrate deploy
npm run db:seed:taxonomy   # without Track rows, /signup renders "Configuration incomplète"
npm run db:demo
```

Set `DATABASE_URL`, `SESSION_SECRET`, `APP_URL` and `AI_PROVIDER` plus that
provider's key in the project. Everything else has a default.

Before real students use it:

- **Storage.** `STORAGE_DRIVER` defaults to a local driver that writes to a
  per-invocation `/tmp` — the write appears to succeed and the file is gone by
  the next request. Set `STORAGE_DRIVER=s3` with real `S3_*` credentials.
- **Connection pooling.** Each serverless invocation is its own Prisma client.
  Point `DATABASE_URL` at a pooler with `?pgbouncer=true&connection_limit=1`,
  and keep the direct URL for migrations.
- **Migrations stay manual.** `vercel.json` deliberately does not run
  `prisma migrate deploy` in the build — a build cannot tell a preview from
  production.
- **The rate limiter counts in process memory** (`rateLimit` in
  `src/lib/api.ts`). Back it with Redis before running multiple instances.
- **`EMBEDDING_PROVIDER=local` does not work on Vercel**, deliberately — the
  ONNX runtime is 69 MB of native binaries. Embed from a container.
- **The first administrator** is made by hand. Sign up through `/signup`, then:

  ```bash
  echo "UPDATE users SET role = 'admin' WHERE email = 'you@example.com';" \
    | npx prisma db execute --url "<direct>" --stdin
  ```

## Known gaps

- **Billing takes no money.** The card panel is real UI over a table no
  processor writes to. Card numbers never leave the browser and nothing in the
  product is gated on payment.
- **The ingestion pipeline has never been run against a real scanned paper**
  end to end. Segmentation deserves a supervised first run.
- **Ingestion continues after the HTTP response returns.** Fine on a
  long-running Node server; move it to a queue worker on a platform that freezes
  the process.
- **`sharp` is pinned via an npm override** to clear a libvips advisory. Remove
  it once Next ships a patched pin.
