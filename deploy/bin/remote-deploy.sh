#!/usr/bin/env bash
# Runs ON THE VPS, piped into `bash -s` by the deploy job.
#
# Secrets arrive as `KEY=value` assignment lines prepended to this script on
# stdin — never on the command line, because argv is world-readable through `ps`
# for the whole duration of the deploy. Everything else comes in as ssh env.
#
# EVERY `docker compose run/exec` BELOW ENDS WITH `</dev/null`. This script is
# being read from stdin; `run` and `exec` attach to stdin and drain it, which
# would swallow the remainder of this file. The symptom is not an error: the
# deploy goes GREEN with the old container still serving, because `up -d` and
# the health gate simply never ran.
set -euo pipefail

: "${DEPLOY_DIR:?}" "${DOCKER_USERNAME:?}" "${DOCKER_SECRET:?}"
: "${SITE_DOMAIN:?}" "${IMAGE_TAG:?}"

cd "$DEPLOY_DIR"
C=(docker compose -f docker-compose.prod.yml)

# The image repo may be private, and the deploy user's ~/.docker/config.json
# starts empty — an anonymous pull then fails with an auth error that reads like
# the tag does not exist. Logging in every time is cheap.
printf '%s' "$DOCKER_SECRET" | docker login -u "$DOCKER_USERNAME" --password-stdin

PREV_TAG="$(cat .deploy_current 2>/dev/null || true)"

echo "==> Pulling images"
"${C[@]}" pull --quiet

echo "==> Starting the database"
"${C[@]}" up -d db
health=""
for _ in $(seq 1 24); do
  health="$("${C[@]}" ps --format '{{.Health}}' db 2>/dev/null || echo starting)"
  [ "$health" = "healthy" ] && break
  sleep 3
done
if [ "$health" != "healthy" ]; then
  echo "::error::postgres never became healthy"
  "${C[@]}" logs --tail 60 db
  exit 1
fi

# Caddy is not recreated by `up -d` when its own definition is unchanged, so a
# freshly-shipped Caddyfile would not take effect on its own. Reload it while the
# current app is still serving: a reload is graceful and atomic — an invalid
# Caddyfile is rejected and the running config kept — so this cannot break the
# live proxy.
if "${C[@]}" ps --status running --services 2>/dev/null | grep -qx caddy; then
  echo "==> Reloading Caddy config"
  "${C[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile </dev/null \
    || echo "::warning::caddy reload failed — Caddy kept its previous config; check the Caddyfile"
fi

# `up -d` runs this too (app depends_on migrate: service_completed_successfully),
# but running it explicitly first means a migration failure is reported AS a
# migration failure, before anything touches the serving container.
echo "==> Applying migrations"
"${C[@]}" run --rm -T migrate </dev/null

echo "==> Starting the stack"
"${C[@]}" up -d --remove-orphans

echo "==> Health gate"
for i in $(seq 1 40); do
  status="$(docker inspect --format='{{.State.Health.Status}}' bac2ai-app 2>/dev/null || echo not_found)"
  echo "  ($i/40) app=$status"
  if [ "$status" = "healthy" ]; then
    # Container health only proves the process answers. Read the body too: `db`
    # proves it can reach its data, and `revision` proves the NEW build is live
    # rather than that A container is up — without it a deploy that silently
    # kept the old image would pass this gate.
    echo "==> Verifying revision and database"
    docker exec bac2ai-app node -e '
      fetch("http://127.0.0.1:3000/api/health").then(r=>r.json()).then(j=>{
        console.log("  " + JSON.stringify(j));
        if (j.db !== "up")            { console.error("::error::app is up but the database is unreachable"); process.exit(1); }
        if (j.revision !== process.argv[1]) { console.error("::error::serving revision " + j.revision + ", expected " + process.argv[1]); process.exit(1); }
        process.exit(0);
      }).catch(e=>{ console.error("::error::health body unreadable: " + e.message); process.exit(1); });
    ' "$IMAGE_TAG"

    echo "$IMAGE_TAG" > .deploy_current
    if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$IMAGE_TAG" ]; then
      echo "$PREV_TAG" > .deploy_previous
    fi

    # Keep this release, the previous one and :latest; drop the rest. These
    # images are large and a retired project accumulated 16 GB in five weeks.
    # The previous tag must survive — it is the rollback target.
    KEEP=" $IMAGE_TAG $PREV_TAG latest "
    for repo in "$DOCKER_USERNAME/bac2ai" "$DOCKER_USERNAME/bac2ai-ops"; do
      docker images "$repo" --format '{{.Tag}}' | sort -u | while read -r t; do
        case "$KEEP" in
          *" $t "*) : ;;
          *) docker rmi "$repo:$t" >/dev/null 2>&1 || true ;;
        esac
      done
    done
    docker image prune -f >/dev/null 2>&1 || true

    echo "==> Public TLS check"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$SITE_DOMAIN/api/health" || echo 000)"
    if [ "$code" = "200" ]; then
      echo "  https://$SITE_DOMAIN/api/health -> 200"
    else
      echo "::warning::container is healthy but https://$SITE_DOMAIN returned $code — Caddy may still be completing the ACME challenge; recheck in a minute"
    fi

    "${C[@]}" ps
    echo "DEPLOY OK ($IMAGE_TAG)"
    exit 0
  fi
  sleep 5
done

echo "::error::Health gate FAILED. Roll back with:"
echo "  ssh bac2ai 'cd $DEPLOY_DIR && sed -i \"s/^IMAGE_TAG=.*/IMAGE_TAG=\$(cat .deploy_previous)/\" .env && docker compose -f docker-compose.prod.yml up -d'"
"${C[@]}" logs --tail 100 app >&2
exit 1
