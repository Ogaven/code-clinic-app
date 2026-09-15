#!/bin/bash
# remote-release-api.sh <target_sha> <release_name> — runs ON THE SERVER.
#
# Expects the caller (deploy-api.sh, run on a dev machine or CI runner — NEVER
# on this 2GB droplet, tsc OOMs here) to have already uploaded a compiled
# dist/ into apps/api/releases/<release_name>/dist/ via scp/tar before
# invoking this script. This script only: checks out matching source (for
# schema.prisma + any non-compiled runtime files), regenerates the Prisma
# client, atomically swaps the dist symlink, restarts codeclinic-api, health
# checks it, and rolls back automatically on failure.
#
# Never touches codeclinic-web.

set -u
cd /var/www/codeclinic || exit 1
# shellcheck source=./lib.sh
source scripts/deploy/lib.sh

TARGET_SHA="${1:?usage: remote-release-api.sh <target_sha> <release_name>}"
RELEASE_NAME="${2:?usage: remote-release-api.sh <target_sha> <release_name>}"
API_DIR=apps/api
RELEASES_DIR=$API_DIR/releases
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"

acquire_lock "api-release to $TARGET_SHA"

[ -f "$RELEASE_DIR/dist/main.js" ] || die "expected uploaded dist at $RELEASE_DIR/dist/main.js — did the scp step run?"

log "Fetching and checking out $TARGET_SHA (for schema.prisma and non-compiled runtime files)..."
git fetch origin --quiet || die "git fetch failed"
git checkout main --quiet 2>/dev/null || git checkout -b main origin/main --quiet
git reset --hard "$TARGET_SHA" --quiet || die "could not check out $TARGET_SHA"
ACTUAL_SHA=$(git rev-parse HEAD)
[ "$ACTUAL_SHA" = "$TARGET_SHA" ] || die "checked-out SHA $ACTUAL_SHA does not match requested $TARGET_SHA"

log "Regenerating Prisma client against current schema..."
packages/database/node_modules/.bin/prisma generate --schema=packages/database/prisma/schema.prisma \
  || die "prisma generate failed — live API dist untouched"

PREV_TARGET=""
if [ -L "$API_DIR/dist" ]; then
  PREV_TARGET=$(readlink -f "$API_DIR/dist")
  ln -sfn "$PREV_TARGET" "$API_DIR/previous_dist"
fi

log "Cutting over: $API_DIR/dist -> $RELEASE_DIR/dist"
ln -sfn "$(cd "$RELEASE_DIR/dist" && pwd)" "$API_DIR/dist"

log "Restarting codeclinic-api..."
pm2 restart codeclinic-api --update-env >/dev/null

sleep 4
health_ok=0
for _ in $(seq 1 10); do
  body=$(curl -s --max-time 3 http://localhost:4000/health)
  if echo "$body" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
      try { const j = JSON.parse(d); process.exit(j.status==='ok' && j.checks && j.checks.database==='ok' ? 0 : 1); }
      catch(e){ process.exit(1); }
    });"; then
    health_ok=1
    break
  fi
  sleep 2
done

if [ "$health_ok" = "1" ]; then
  log "Health check passed. Deployment SUCCESS."
  prune_releases "$RELEASES_DIR" 3 "$API_DIR/dist" "$API_DIR/previous_dist"
  write_state api_sha "$ACTUAL_SHA"
  echo "API_DEPLOY_RESULT=SUCCESS"
  echo "API_SHA=$ACTUAL_SHA"
  exit 0
fi

log "Health check FAILED. Rolling back..."
if [ -n "$PREV_TARGET" ]; then
  ln -sfn "$PREV_TARGET" "$API_DIR/dist"
  pm2 restart codeclinic-api --update-env >/dev/null
  sleep 4
  body=$(curl -s --max-time 3 http://localhost:4000/health)
  if echo "$body" | grep -q '"status":"ok"'; then
    log "Rollback to previous API release succeeded."
    echo "API_DEPLOY_RESULT=FAILED_ROLLED_BACK"
  else
    log "CRITICAL: rollback ALSO failed health check. Manual intervention required immediately."
    echo "API_DEPLOY_RESULT=FAILED_ROLLBACK_ALSO_FAILED"
  fi
else
  log "CRITICAL: no previous API release to roll back to."
  echo "API_DEPLOY_RESULT=FAILED_NO_PREVIOUS_RELEASE"
fi
exit 1
