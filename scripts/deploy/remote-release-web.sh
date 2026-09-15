#!/bin/bash
# remote-release-web.sh <target_sha> — runs ON THE SERVER (root@ the droplet).
# Builds a complete, self-contained web release, validates it, smoke-tests it
# on a scratch port BEFORE touching production, only then atomically flips
# the `current` symlink and restarts codeclinic-web — with automatic rollback
# if the post-restart smoke test fails. See DEPLOYMENT.md.
#
# Never partially overwrites the live release: the live `current` symlink is
# only ever repointed after a fully-built, fully-verified release exists.

set -u
cd /var/www/codeclinic || exit 1
# shellcheck source=./lib.sh
source scripts/deploy/lib.sh

TARGET_SHA="${1:?usage: remote-release-web.sh <target_sha>}"
WEB_DIR=apps/web
RELEASES_DIR=$WEB_DIR/releases
SCRATCH_PORT=3001

acquire_lock "web-release to $TARGET_SHA"

log "Fetching and checking out $TARGET_SHA..."
git fetch origin --quiet || die "git fetch failed"
git checkout main --quiet 2>/dev/null || git checkout -b main origin/main --quiet
git reset --hard "$TARGET_SHA" --quiet || die "could not check out $TARGET_SHA"
ACTUAL_SHA=$(git rev-parse HEAD)
[ "$ACTUAL_SHA" = "$TARGET_SHA" ] || die "checked-out SHA $ACTUAL_SHA does not match requested $TARGET_SHA"

log "Building web (this rebuilds the scratch $WEB_DIR/.next dir, NOT the live release)..."
NODE_OPTIONS='--max-old-space-size=1200' pnpm --filter web build \
  || die "pnpm --filter web build failed — live release untouched, nothing to roll back"

log "Validating build output..."
[ -f "$WEB_DIR/.next/BUILD_ID" ] || die "build did not produce .next/BUILD_ID"
[ -d "$WEB_DIR/.next/server" ] || die "build did not produce .next/server"
[ -d "$WEB_DIR/.next/static" ] || die "build did not produce .next/static"
[ -d "$WEB_DIR/.next/standalone" ] || die "build did not produce .next/standalone"
[ -d "$WEB_DIR/public" ] || die "source tree is missing $WEB_DIR/public"
BUILD_ID=$(cat "$WEB_DIR/.next/BUILD_ID")
log "Build OK: BUILD_ID=$BUILD_ID"

RELEASE_DIR="$RELEASES_DIR/${TARGET_SHA:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
log "Assembling release at $RELEASE_DIR..."
mkdir -p "$RELEASE_DIR"
cp -r "$WEB_DIR/.next/standalone/." "$RELEASE_DIR/"

log "Copying static assets into release (Next.js standalone output does not do this automatically)..."
mkdir -p "$RELEASE_DIR/apps/web/.next/static"
cp -r "$WEB_DIR/.next/static/." "$RELEASE_DIR/apps/web/.next/static/"

log "Copying public folder into release..."
mkdir -p "$RELEASE_DIR/apps/web/public"
cp -r "$WEB_DIR/public/." "$RELEASE_DIR/apps/web/public/"

log "Validating release completeness..."
[ -f "$RELEASE_DIR/apps/web/server.js" ] || die "release missing apps/web/server.js"
[ -f "$RELEASE_DIR/apps/web/.next/BUILD_ID" ] || die "release missing .next/BUILD_ID"
[ -d "$RELEASE_DIR/apps/web/.next/server" ] || die "release missing .next/server"
[ -d "$RELEASE_DIR/apps/web/.next/static" ] || die "release missing .next/static"
[ -d "$RELEASE_DIR/apps/web/public" ] || die "release missing public"

cleanup_scratch() { [ -n "${SCRATCH_PID:-}" ] && kill "$SCRATCH_PID" 2>/dev/null; }
trap 'cleanup_scratch; release_lock' EXIT

log "Starting candidate release on scratch port $SCRATCH_PORT for pre-flight smoke test..."
PORT=$SCRATCH_PORT HOSTNAME=127.0.0.1 NODE_ENV=production \
  node "$RELEASE_DIR/apps/web/server.js" > "/tmp/web-scratch-$SCRATCH_PORT.log" 2>&1 &
SCRATCH_PID=$!

ready=0
for _ in $(seq 1 20); do
  if curl -s -o /dev/null --max-time 2 "http://localhost:$SCRATCH_PORT/login"; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" = "1" ] || { cat "/tmp/web-scratch-$SCRATCH_PORT.log"; die "candidate release did not come up on scratch port $SCRATCH_PORT within 20s — see log above"; }

if ! bash scripts/deploy/smoke-test-web.sh "$SCRATCH_PORT" "$RELEASE_DIR"; then
  log "Pre-flight smoke test FAILED. Live production was never touched. Removing bad candidate release."
  cleanup_scratch
  rm -rf "$RELEASE_DIR"
  die "web deploy of $TARGET_SHA FAILED pre-flight smoke test — production unchanged"
fi
log "Pre-flight smoke test passed."
cleanup_scratch
SCRATCH_PID=""

# --- Cutover -----------------------------------------------------------
PREV_TARGET=""
if [ -L "$WEB_DIR/current" ]; then
  PREV_TARGET=$(readlink -f "$WEB_DIR/current")
  ln -sfn "$PREV_TARGET" "$WEB_DIR/previous"
fi

log "Cutting over: $WEB_DIR/current -> $RELEASE_DIR"
ln -sfn "$(cd "$RELEASE_DIR" && pwd)" "$WEB_DIR/current"

log "Restarting codeclinic-web..."
pm2 restart codeclinic-web --update-env >/dev/null

sleep 4
if bash scripts/deploy/smoke-test-web.sh 3000 "$RELEASE_DIR"; then
  log "Post-restart smoke test passed. Deployment SUCCESS."
  prune_releases "$RELEASES_DIR" 3 "$WEB_DIR/current" "$WEB_DIR/previous"
  write_state web_sha "$ACTUAL_SHA" web_build_id "$BUILD_ID"
  echo "WEB_DEPLOY_RESULT=SUCCESS"
  echo "WEB_SHA=$ACTUAL_SHA"
  echo "WEB_BUILD_ID=$BUILD_ID"
  exit 0
fi

log "Post-restart smoke test FAILED. Rolling back..."
if [ -n "$PREV_TARGET" ]; then
  ln -sfn "$PREV_TARGET" "$WEB_DIR/current"
  pm2 restart codeclinic-web --update-env >/dev/null
  sleep 4
  if bash scripts/deploy/smoke-test-web.sh 3000 "$PREV_TARGET"; then
    log "Rollback to previous release succeeded."
    echo "WEB_DEPLOY_RESULT=FAILED_ROLLED_BACK"
  else
    log "CRITICAL: rollback ALSO failed smoke test. Manual intervention required immediately."
    echo "WEB_DEPLOY_RESULT=FAILED_ROLLBACK_ALSO_FAILED"
  fi
else
  log "CRITICAL: no previous release to roll back to. codeclinic-web is running an unverified candidate."
  echo "WEB_DEPLOY_RESULT=FAILED_NO_PREVIOUS_RELEASE"
fi
exit 1
