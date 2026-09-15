#!/bin/bash
# deploy-api.sh [target_sha] — deploys ONLY the API, atomically.
#
# WHY LOCAL BUILD: The production server (46.101.255.243) has 2 GB RAM.
# TypeScript (tsc) crashes with OOM on that machine. All API compilation
# happens here, on the machine running this script; only the compiled dist/
# is uploaded.
#
# This script NEVER touches codeclinic-web. It uploads dist/ into a fresh,
# uniquely-named release directory (never overwriting the live one), then
# the remote script atomically swaps a symlink, restarts codeclinic-api,
# health-checks it, and rolls back automatically on failure.
#
# Schema migrations remain an explicit, operator-controlled step (see
# DEPLOYMENT.md) — this script regenerates the Prisma client to match
# schema.prisma but never runs `prisma migrate deploy` or `db push`.
#
# Usage (from repo root, in Git Bash):
#   bash deploy-api.sh              # deploys origin/main HEAD
#   bash deploy-api.sh <sha>        # deploys a specific commit
#
# Prerequisites: pnpm installed locally, ssh key access to root@46.101.255.243,
# local checkout clean and AT the target commit (never deploys uncommitted work).

set -e
SERVER=root@46.101.255.243
REMOTE_DIR=/var/www/codeclinic

git fetch origin --quiet
TARGET_SHA="${1:-$(git rev-parse origin/main)}"
git cat-file -e "$TARGET_SHA" 2>/dev/null || { echo "[deploy-api] ERROR: $TARGET_SHA not found — fetch or push first"; exit 1; }

CURRENT_SHA=$(git rev-parse HEAD)
if [ "$CURRENT_SHA" != "$TARGET_SHA" ]; then
  echo "[deploy-api] ERROR: local checkout is at $CURRENT_SHA but target is $TARGET_SHA."
  echo "[deploy-api]        git checkout main && git pull, then retry — never build from a mismatched tree."
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "[deploy-api] ERROR: uncommitted local changes present. Commit and push first — never deploy uncommitted work."
  exit 1
fi

echo "[deploy-api] Building API locally (tsc) @ $TARGET_SHA..."
NODE_OPTIONS='--max-old-space-size=3072' pnpm --filter api build

RELEASE_NAME="${TARGET_SHA:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
echo "[deploy-api] Uploading compiled dist as release $RELEASE_NAME..."
ssh "$SERVER" "mkdir -p $REMOTE_DIR/apps/api/releases/$RELEASE_NAME"
(cd apps/api && tar -czf - dist) | ssh "$SERVER" "cd $REMOTE_DIR/apps/api/releases/$RELEASE_NAME && tar -xzf -"

echo "[deploy-api] Copying Prisma schema to server (schema.prisma only — no migration is applied here)..."
scp packages/database/prisma/schema.prisma "$SERVER:$REMOTE_DIR/packages/database/prisma/schema.prisma"

echo "[deploy-api] Deploying API @ $TARGET_SHA (web untouched)..."
ssh "$SERVER" "cd $REMOTE_DIR && bash scripts/deploy/remote-release-api.sh $TARGET_SHA $RELEASE_NAME"
RESULT=$?

echo "[deploy-api] Done (exit $RESULT)."
exit $RESULT
