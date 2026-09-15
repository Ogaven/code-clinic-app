#!/bin/bash
# deploy-web.sh [target_sha] — deploys ONLY the web app, atomically.
#
# The server now ALWAYS builds from git history (git fetch + checkout of
# target_sha), never from files pushed over rsync/tar/scp. If your commit
# isn't on origin, this fails fast instead of silently deploying something
# nobody can reproduce — that gap (rsync shipping uncommitted local edits)
# is exactly how production's working tree drifted from its own git history
# before, and how the 2026-09-15 raw-HTML incident happened (a manual
# rsync+build was interrupted before the static/public copy step, and
# because production wasn't rebuilt from a validated release directory,
# nothing caught it). Commit and push before running this. See DEPLOYMENT.md.
#
# This script NEVER touches codeclinic-api. It builds a complete new release,
# smoke-tests it on a scratch port before going live, then atomically swaps
# it in with automatic rollback if the post-switch smoke test fails.
#
# Usage (from repo root, in Git Bash):
#   bash deploy-web.sh              # deploys origin/main HEAD
#   bash deploy-web.sh <sha>        # deploys a specific commit

set -e
SERVER=root@46.101.255.243

git fetch origin --quiet
TARGET_SHA="${1:-$(git rev-parse origin/main)}"
git cat-file -e "$TARGET_SHA" 2>/dev/null || { echo "[deploy-web] ERROR: $TARGET_SHA not found — fetch or push first"; exit 1; }

echo "[deploy-web] Deploying web @ $TARGET_SHA (API untouched)..."
ssh "$SERVER" "cd /var/www/codeclinic && bash scripts/deploy/remote-release-web.sh $TARGET_SHA"
RESULT=$?

echo "[deploy-web] Done (exit $RESULT)."
exit $RESULT
