# Deployment

One Hostinger VPS, one domain, Docker images on Docker Hub, GitHub Actions doing the
shipping. Caddy is the only thing listening on 80/443 and reverse-proxies to the Next.js
container; Postgres runs in the same compose stack and is not reachable from outside it.

**A release is:**

```bash
git push origin main            # CI runs the checks. Watch it go green.
git push origin main:production # same commit; this one deploys.
```

Nothing mechanically enforces that order — `production` is a normal branch. The habit is
the enforcement.

---

## Current state (22 Sep 2026)

Live at **https://backai.loadless.site**, serving the full corpus restored from
Neon. Verified on the day: TLS from Let's Encrypt, `db: "up"` at 1 ms, HTTP/3
advertised after measuring UDP/443, a nearest-neighbour query over 12,723
vectors answering in 4.7 ms off the HNSW index, `/api/cron` 404 from outside and
200 over loopback, and CSRF returning 401 rather than 403 — which is what proves
Caddy is passing `Host` through.

Row counts match Neon exactly: 4 tracks, 60 subjects, 1,192 chapters, 1,686 exam
cycles, 5,783 questions (all embedded), 12,723 content chunks (all embedded), 8
users, 269 attempts, 32 migrations.

Two things about the restored users, both deliberate:

- **`admin@bac2.local` was rotated on restore** and its password is in Ali's
  password manager, nowhere else. The literal in `prisma/seed.ts` no longer
  opens it; that was verified by trying it against the live login (401).
- **`student@bac2.local` and `demo@bac2.local` still use the passwords printed
  in `prisma/seed.ts`**, which is in a public repo. This is a known, accepted
  state, not an oversight: they are student-role, so an intruder reaches only
  those accounts' own fabricated data, and `demo@bac2.local` is the populated
  demo student whose password is shared for demos. Rotate or delete them before
  real students sign up — `npm run rotate:admin -- --email <addr> --apply` works
  for any account, not only admins.

One piece of inherited history worth recognising rather than fixing: the
`_prisma_migrations` table carries a row for `20260901090000_exam_cycle_language`
with `rolled_back_at` set, from a failure on Neon on 1 Sep. Prisma treats
rolled-back as resolved, `migrate deploy` exits 0, and the column that migration
wanted exists. Nothing to do; it just looks alarming in a count.

---

## Live environment

| | |
|---|---|
| Host | `152.239.121.8` (Hostinger VPS, Ubuntu) |
| Domain | `backai.loadless.site` |
| Deploy directory | `/home/deploy/bac2ai` |
| Images | `<DOCKER_USERNAME>/bac2ai` and `<DOCKER_USERNAME>/bac2ai-ops` |
| Daily SSH | `ssh bac2ai` (the `deploy` user) |
| Admin SSH | `ssh root@152.239.121.8` (key, or password as the never-locked-out fallback) |

Two shell aliases worth having on the server (`~/.bashrc`):

```bash
alias bac2='docker compose -f /home/deploy/bac2ai/docker-compose.prod.yml'
alias bac2ops='docker compose -f /home/deploy/bac2ai/docker-compose.prod.yml run --rm ops'
```

### Why there are two images

`prisma` is a devDependency that no route imports, so Next's file tracing never copies
the CLI into `.next/standalone` — and the runtime image's `nextjs` user has no home
directory, so `npx prisma` has nowhere to cache a download either. The runtime image has
the migrations but not the tool that applies them.

`bac2ai-ops` is the Dockerfile's `build` stage published as its own tag. It is the only
place where the Prisma CLI, `tsx`, `scripts/` and `src/` exist together, so it runs the
migrations and every one-off script. It costs nothing to produce — those layers are
already built on the way to the runtime image.

---

## GitHub secrets

Set on `devloadless17/Back2-Ai` → Settings → Secrets and variables → Actions. The deploy
job fails with the list of missing names before it touches the server.

### Infrastructure

| Secret | What | How to get it |
|---|---|---|
| `DOCKER_USERNAME` | Docker Hub username | |
| `DOCKER_SECRET` | Docker Hub access token | hub.docker.com → Account Settings → Personal access tokens → **Read & Write** |
| `VPS_HOST` | Server IP | `152.239.121.8` |
| `VPS_USER` | SSH account | `deploy` |
| `VPS_SSH_KEY_B64` | CI private key, base64, one line | `base64 -w0 ~/.ssh/bac2ai_deploy \| clip.exe` |
| `VPS_PORT` | Optional, defaults to 22 | omit |
| `FRONTEND_DOMAIN` | Bare hostname, no scheme, no trailing slash | `backai.loadless.site` |
| `API_DOMAIN` | **Same value** — see below | `backai.loadless.site` |
| `ACME_EMAIL` | Real inbox; Let's Encrypt sends expiry warnings here | |

`API_DOMAIN` and `FRONTEND_DOMAIN` must be **equal**. This app is a single service and
the Caddyfile has one site block; the deploy job asserts equality so that the day someone
genuinely splits the API onto its own hostname, CI says "add a second site block" instead
of Caddy quietly serving only one of them.

### Application

| Secret | What | How to generate |
|---|---|---|
| `POSTGRES_PASSWORD` | Password for the dockerized Postgres | **`openssl rand -hex 32`** |
| `SESSION_SECRET` | Session secret, min 16 chars | `openssl rand -base64 48` |
| `CRON_SECRET` | Bearer token for `/api/cron` | `openssl rand -hex 32` |
| `AI_PROVIDER` | Exactly `openai` or `anthropic` | `openai` |
| `OPENAI_API_KEY` | OpenAI key | platform.openai.com |
| `ANTHROPIC_API_KEY` | Anthropic key | console.anthropic.com — only needed if `AI_PROVIDER=anthropic` |
| `OPENAI_MODEL` / `OPENAI_MODEL_VERIFY` | Optional | `gpt-5.5` / `gpt-5.4-mini` |
| `EMBEDDING_PROVIDER` | `openai` \| `voyage` \| `local` | `openai` — **not `local`** |
| `EMBEDDING_MODEL` | | `text-embedding-3-small` |
| `EMBEDDING_DIM` | Must equal the `vector(N)` width in the database | `1536` — verify against the restored data |
| `S3_ENDPOINT` | Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_REGION` | | `auto` |
| `S3_BUCKET` | | `back-ai-production` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | R2 API token | Cloudflare → R2 → Manage API Tokens → **Object Read & Write**, scoped to the bucket |
| `RESEND_API_KEY` | Optional — unset means mail is only written to the log | resend.com |
| `EMAIL_FROM` | Optional but see below | `Bac II <no-reply@backai.loadless.site>` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web push | `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | Optional | `mailto:dev@loadless.ai` |
| `DEFAULT_LOCALE` | Optional, `fr` \| `en` \| `ar` | `en` |
| `AI_BUDGET_FREE_USD` / `_MONTHLY_` / `_ANNUAL_` | Optional per-user monthly ceilings | `1` / `10` / `10` |

`STORAGE_DRIVER`, `APP_URL`, `DATABASE_URL`, `NODE_ENV`, `POSTGRES_USER`, `POSTGRES_DB`,
`S3_FORCE_PATH_STYLE` and `IMAGE_TAG` are **derived by the workflow**, not secrets.
`APP_URL` in particular is built as `https://$FRONTEND_DOMAIN`, because a hand-typed one
is how a trailing slash or a missing scheme reaches production.

### Four traps in this table

1. **`POSTGRES_PASSWORD` must be hex.** It is interpolated raw into `DATABASE_URL`, and
   `/ @ : ? #` split a URL's authority section — so a base64 password produces a
   *valid-looking* URL pointing somewhere else, and Prisma reports a confusing host error
   rather than a bad password. The workflow rejects those characters.
2. **`OPENAI_API_KEY` is needed whenever `EMBEDDING_PROVIDER=openai`**, independently of
   `AI_PROVIDER`. `isAiConfigured()` and `isEmbeddingConfigured()` are separate checks; a
   deployment failing only the second boots fine and then refuses every retrieval, which
   reads like a corpus problem.
3. **No value may contain an apostrophe or a `$`.** Compose's env parser is not a shell:
   it has no escape inside single quotes, and it expands `$VAR` in unquoted values,
   silently truncating a secret at the first `$`. The workflow rejects apostrophes rather
   than trying to escape them. `openssl rand -hex` and `-base64` both avoid these.
4. **`EMAIL_FROM` unset means `onboarding@resend.dev`** — Resend's shared sandbox domain,
   which only delivers to the account owner. Every other recipient silently gets nothing,
   including password resets. Set it to an address on a domain verified in Resend.

---

## One-time server setup

Follow `~/playbooks/DEPLOY-PLAYBOOK.md` §2 and §3. In summary, as root: patch and reboot,
UTC, 2 GB swap, Docker from `get.docker.com` with json-file log rotation (20m × 5), a
`deploy` user in the `docker` group, UFW allowing only 22/80/443, fail2ban,
unattended-upgrades, and root reachable by **both** password and key.

Then from your machine:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/bac2ai_deploy -N "" -C "github-actions-bac2ai"
ssh-copy-id -i ~/.ssh/bac2ai_deploy.pub deploy@152.239.121.8
base64 -w0 ~/.ssh/bac2ai_deploy | clip.exe     # → VPS_SSH_KEY_B64
```

`~/.ssh/config` — alias and raw IP on one `Host` line so both spellings work:

```
Host bac2ai 152.239.121.8
  HostName 152.239.121.8
  User deploy
  IdentityFile ~/.ssh/bac2ai_deploy
  IdentitiesOnly yes
```

### The security boundary is the compose file, not UFW

Docker writes its own iptables rules and **bypasses UFW entirely for published ports**.
`ufw status` showing only 22/80/443 does not mean a published 5432 is unreachable — it
would be reachable from the whole internet. The real rule lives in
`deploy/docker-compose.prod.yml`: **only Caddy has a `ports:` key.** Review every change
to that file against it. The check that proves it:

```bash
ssh bac2ai 'ss -tlnp'   # before the first deploy: sshd only
```

### HTTP/3 — measured, and on

Caddy advertises `alt-svc: h3=":443"` by default and browsers cache that for up
to 30 days. If UDP/443 is not actually delivered, some clients intermittently
cannot open the site while others are fine — and the fix takes a month to
propagate. So it is measured, never assumed.

**Measured 2026-09-22 on this VPS: UDP/443 IS delivered.** A datagram sent from
outside arrived at a container publishing 443/udp. HTTP/3 is therefore enabled,
and three things agree: `443:443/udp` in the compose file, no `protocols` pin in
the Caddyfile, and `443/udp` allowed in UFW.

To re-measure after any provider or network change:

```bash
ssh bac2ai 'docker run --rm -p 443:443/udp alpine sh -c "timeout 12 nc -u -l -p 443"' &
sleep 12; for i in 1 2 3; do printf probe | nc -u -w1 152.239.121.8 443; sleep 1; done
```

If packets stop arriving, turn HTTP/3 off in all three places in one commit.

---

## First boot

1. **Migrations** run automatically. The `migrate` service applies them before `app` is
   allowed to start (`service_completed_successfully`), so a failed migration stops the
   release rather than serving against a stale schema.

2. **The database must be restored before the app is useful.** An empty database renders
   "Configuration incomplète" at `/signup`, because there are no `Track` rows.

   **`npm run db:seed:taxonomy` cannot fix this on the server.** It reads
   `corpus/taxonomy/<book>.json`, and `corpus/` is gitignored — 46,956 scanned pages that
   exist on one laptop and were never committed. `scripts/corpus/catalog.csv` *is*
   committed, so the loader reports the corpus as present, skips all 46 books, and writes
   nothing. Content reaches production through the restore below and no other way.

3. **First administrator, by hand** — sign up through the site, then:

   ```bash
   bac2 exec -T db psql -U bac2 -d bac2 \
     -c "UPDATE users SET role='admin' WHERE email='you@example.com';" </dev/null
   ```

   The `</dev/null` matters in any piped or scripted context: `exec` drains stdin.

4. **Rotate any seeded password.** `prisma/seed.ts` hardcodes `ChangeMeImmediately!2026`
   and that literal is in the repository, which is public. If the restored database has a
   seeded account:

   ```bash
   bac2ops npm run rotate:admin -- --email admin@bac2.local --apply
   ```

   It prints the new password once, stores it nowhere, and **revokes every live
   session** — a rotation that leaves an existing session signed in changed nothing for
   whoever already had access.

---

## Restoring from the Neon dump

Order matters: **restore into an empty database before `migrate deploy` has ever run.**
The dump carries `_prisma_migrations`, so afterwards the migrate step is a no-op.
Restoring over an already-migrated schema gives "relation already exists" on every object
and a *partially applied* dump — some tables full, some empty — which is hard to tell
apart from a good restore.

First, three facts from the source, because two of them decide whether the restore can
work at all:

```bash
psql "$NEON_URL" -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','pgcrypto');"
psql "$NEON_URL" -c "SELECT current_setting('server_version');"
psql "$NEON_URL" -c "SELECT format_type(atttypid, atttypmod) FROM pg_attribute
                     WHERE attrelid='content_chunks'::regclass AND attname='embedding';"
```

The third prints the **real** vector width. The first migration declares `vector(1536)`,
but `scripts/resize-embeddings.ts` exists precisely because that can have been changed —
`EMBEDDING_DIM` must equal whatever this says.

Dump with a PG16-or-newer client:

```bash
pg_dump "$NEON_URL" --format=custom --no-owner --no-privileges --no-comments \
        --file bac2-$(date +%F).dump
scp bac2-*.dump bac2ai:~/bac2ai/ops-in/
```

- `--no-owner` — Neon objects are owned by `neondb_owner`, which does not exist here.
  Without it every `ALTER … OWNER TO` fails and you get a schema whose tables loaded but
  whose sequences, defaults and constraints did not: a restore that *looks* like it
  worked.
- `--no-privileges` — Neon's `GRANT`s name roles this server does not have.
- `--no-comments` — `pg_dump` emits `COMMENT ON EXTENSION vector`, which only the
  extension's owner may run. Dropping comments removes the whole class of error.

Restore, with the app stopped:

```bash
ssh bac2ai && cd ~/bac2ai
bac2 up -d db && bac2 stop app caddy

bac2 exec -T db psql -U bac2 -d postgres -c "DROP DATABASE IF EXISTS bac2;" </dev/null
bac2 exec -T db psql -U bac2 -d postgres -c "CREATE DATABASE bac2 OWNER bac2;" </dev/null
bac2 exec -T db psql -U bac2 -d bac2 \
  -c 'CREATE EXTENSION IF NOT EXISTS "pgcrypto"; CREATE EXTENSION IF NOT EXISTS "vector";' </dev/null

# The target's pgvector must be >= the source's. An older one cannot parse HNSW
# index definitions written by a newer one, and it fails at the very END of a
# long restore, on the index build.
bac2 exec -T db psql -U bac2 -d bac2 -c "SELECT extname, extversion FROM pg_extension;" </dev/null

docker cp ops-in/bac2-*.dump bac2ai-db:/tmp/bac2.dump
bac2 exec -T db pg_restore -U bac2 -d bac2 --no-owner --no-privileges --no-comments \
      -j 4 --verbose /tmp/bac2.dump </dev/null 2>&1 | tee ~/restore.log
grep -i error ~/restore.log | grep -vi 'already exists' | head -40
```

`-j 4` parallelises the four HNSW index builds, which dominate the time. Do **not** pass
`--exit-on-error`: extension no-ops produce benign errors and you want the full list
rather than an abort on the first.

Verify **before** starting the app:

```bash
bac2 exec -T db psql -U bac2 -d bac2 </dev/null <<'SQL'
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 15;
SELECT count(*) AS migrations FROM "_prisma_migrations";
SELECT indexname FROM pg_indexes WHERE indexdef ILIKE '%hnsw%' ORDER BY 1;
SELECT count(*) AS chunks, count(embedding) AS embedded FROM content_chunks;
SELECT format_type(atttypid, atttypmod) FROM pg_attribute
  WHERE attrelid='content_chunks'::regclass AND attname='embedding';
SQL
```

Expect **32 migrations**, exactly **four** HNSW indexes, a vector width equal to
`EMBEDDING_DIM`, and `embedded` matching what the source reported. Then:

```bash
bac2 exec -T db psql -U bac2 -d bac2 -c "ANALYZE;" </dev/null
bac2 up -d
```

`ANALYZE` is not optional. `pg_restore` does not update planner statistics, and until it
runs, the vector searches and the GIN lexical indexes get sequential-scan plans and the
app is inexplicably slow.

---

## Scheduled maintenance

systemd timers on the host run `deploy/bin/bac2-cron`, which calls `/api/cron` on
**loopback inside the app container** via `docker exec`. `CRON_SECRET` is already in that
container's environment, so it never appears in a unit file, a crontab line, `ps` output
or shell history — and internal maintenance does not route out through DNS, ACME and the
public edge, so a certificate problem cannot stop exam papers being marked.

`/api/cron` is answered with 404 by Caddy for the same reason: nothing outside needs it.

Install once:

```bash
sudo cp /home/deploy/bac2ai/systemd/*.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bac2-cron-fast.timer bac2-cron-notify.timer \
                            bac2-cron-daily.timer bac2-cron-weekly.timer
systemctl list-timers 'bac2-*'
```

| Timer | Jobs | When |
|---|---|---|
| `bac2-cron-fast` | `auto_submit`, `mark` | every 2 minutes |
| `bac2-cron-notify` | `notify` | 05:30 Beirut |
| `bac2-cron-daily` | `readiness`, `difficulty` | 03:15 Beirut |
| `bac2-cron-weekly` | `sessions` | Sunday 04:00 Beirut |

The host clock is UTC; the Beirut times live in the `OnCalendar` lines, which is
something systemd can express and cron cannot. Job order within a tick is load-bearing:
`auto_submit` closes papers abandoned by students who shut the tab, and `mark` grades
them on the same pass.

When the app container is down, the same jobs run from the ops image instead:

```bash
bac2ops npm run cron -- auto_submit
```

---

## Running maintenance scripts

The ~87 npm scripts are `node --env-file=.env --import tsx …`, so they need that file on
disk. The `ops` service bind-mounts the deploy `.env` read-only at `/app/.env`, which
makes every one of them work verbatim.

```bash
bac2ops npm run rotate:admin -- --email admin@bac2.local --apply
bac2ops npm run account:test -- --email teacher@school.lb --track GS --language fr
bac2ops npm run ingest -- --embed-missing
bac2 exec db psql -U bac2 -d bac2                    # raw SQL, no published port
```

Files go in `/home/deploy/bac2ai/ops-in/`, visible to the container at `/app/ops-in`.
They are written as root, so `sudo chown -R $USER: ops-in` afterwards.

---

## Rollback

Every release is pushed as `:$GITHUB_SHA` as well as `:latest`, and the deploy pins
`IMAGE_TAG` to the SHA — so the tag **is** the version.

**From the Actions UI (preferred):** Actions → CI → Run workflow → branch `production` →
put the previous SHA in `image_tag` → Run. The build is skipped and that image is
deployed.

**From the server:**

```bash
ssh bac2ai 'cat ~/bac2ai/.deploy_current ~/bac2ai/.deploy_previous'
ssh bac2ai 'cd ~/bac2ai && sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG='"'"'$(cat .deploy_previous)'"'"'/" .env \
            && docker compose -f docker-compose.prod.yml up -d'
```

**Rollback restores code, never schema.** `migrate deploy` runs forward on every release
and is never reversed — Prisma has no down-migrations. So this is safe only while the
migrations in between were additive. A release containing a destructive migration is
one-way: take a `pg_dump` immediately before deploying it, and say so in the PR.

The deploy keeps the current tag, the previous tag and `:latest` on the box and prunes
the rest, so the rollback target is always present locally. Any older SHA can still be
pulled from Docker Hub.

---

## There is no wipe

This pipeline cannot destroy the database, and that is deliberate: no workflow
input, no `down -v`, nothing on a schedule. A deploy only ever pulls an image,
runs forward migrations and recreates containers. `docker compose down` without
`-v` leaves every named volume intact.

If a database genuinely has to be rebuilt one day, it is a deliberate, manual,
logged-in act with a fresh `pg_dump` taken first — never a checkbox on a deploy.

Two volumes to know about before running any `docker` command by hand:

- **`bac2ai_postgres_data`** — every account, attempt, upload record and all the
  exam content restored from Neon.
- **`bac2ai_caddy_data`** — the issued TLS certificates and the ACME account key.
  Losing this means re-issuing against a Let's Encrypt rate limit counted per
  domain per week, so the site would be without HTTPS in the meantime.

`docker compose down -v` takes both. Do not use the `-v` flag on this stack.

---

## Verifying a deploy

The deploy gates itself on container health **and** on `/api/health` reporting
`db: "up"` and a `revision` equal to the tag being deployed — so a deploy that silently
kept the old image fails rather than passing. Beyond that:

```bash
ssh bac2ai 'ss -tlnp | grep -E ":(80|443|5432|3000)\b"'   # 80 and 443 only
ssh bac2ai 'docker logs bac2ai-app 2>&1 | grep "\[storage\]"'  # no output = R2 is live

# CSRF survives the proxy. 401 is correct (bad credentials).
# 403 "Cross-site requests are not permitted" means Caddy is not passing Host through.
curl -si https://backai.loadless.site/api/auth/login \
  -H 'content-type: application/json' -H 'origin: https://backai.loadless.site' \
  -d '{"email":"nobody@example.com","password":"x"}' | head -1

curl -s -o /dev/null -w '%{http_code}\n' https://backai.loadless.site/api/cron  # 404
curl -sI https://backai.loadless.site/ | grep -ci 'strict-transport-security'   # 1
curl -s https://backai.loadless.site/signup | grep -c 'Configuration incomplète' # 0
```

Then, **in the deployed browser**: **log in → hard refresh → perform a write.**

The refresh is the load-bearing step. It discards whatever the app held in memory and
forces it to re-derive its credentials the way a cold visitor would. A dev machine cannot
reproduce this, because cookies ignore the port — `localhost:3000` and `localhost:3001`
are one cookie host, so a whole code path that never runs locally becomes the only path
that matters once the app is on a real domain. Run this check after any change to the
hosting shape.

`npm run smoke` is **not** that check. `scripts/smoke.mjs` hardcodes `student@bac2.local`
and `admin@bac2.local` with the seed password, so it only passes against a freshly seeded
database, never against restored production data.

---

## Local development

Unchanged, and deliberately untouched by any of the above:

```bash
docker compose up -d     # dev Postgres + pgvector on port 5442
cp .env.example .env
npm install && npm run db:deploy && npm run db:seed
npm run dev
```

`docker-compose.yml` at the repo root is the dev database.
`deploy/docker-compose.prod.yml` is the deployed stack. They share nothing.
