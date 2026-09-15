#!/bin/bash
# classify.sh — determines what actually needs deploying by diffing the
# CURRENTLY DEPLOYED SHAs (read from the server's .deploy-state.json) against
# the target SHA (origin/main HEAD), per-app.
#
# Prints:
#   TARGET_SHA=<sha>
#   API_SHA_PREV=<sha>
#   WEB_SHA_PREV=<sha>
#   API_CHANGED=true|false
#   WEB_CHANGED=true|false
#   SCHEMA_CHANGED=true|false
#   CLASSIFICATION=API_ONLY|WEB_ONLY|API_AND_WEB|NO_RUNTIME_CHANGE
#
# Fails closed: any ambiguity (missing state, unreachable history, corrupt
# JSON) is a hard error with nonzero exit and NO classification printed.
# Run this from a machine with git history + ssh access to the server —
# a dev machine or the CI runner, never the production droplet itself.

set -u
SERVER="${DEPLOY_SERVER:-root@46.101.255.243}"
REPO_DIR="${1:-.}"

cd "$REPO_DIR" || { echo "ERROR: cannot cd to repo dir $REPO_DIR" >&2; exit 1; }

git fetch origin --quiet || { echo "ERROR: git fetch origin failed" >&2; exit 1; }
TARGET_SHA=$(git rev-parse origin/main) || { echo "ERROR: cannot resolve origin/main" >&2; exit 1; }

STATE_JSON=$(ssh -o ConnectTimeout=10 "$SERVER" "cat /var/www/codeclinic/.deploy-state.json" 2>/dev/null)
if [ -z "$STATE_JSON" ]; then
  echo "ERROR: could not read .deploy-state.json from $SERVER — refusing to classify without knowing what's currently deployed. Bootstrap the state file first (see DEPLOYMENT.md)." >&2
  exit 1
fi

API_SHA_PREV=$(echo "$STATE_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).api_sha||'')}catch(e){}})")
WEB_SHA_PREV=$(echo "$STATE_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).web_sha||'')}catch(e){}})")

if [ -z "$API_SHA_PREV" ] || [ -z "$WEB_SHA_PREV" ]; then
  echo "ERROR: .deploy-state.json is missing api_sha or web_sha — refusing to classify. State was: $STATE_JSON" >&2
  exit 1
fi

for sha in "$API_SHA_PREV" "$WEB_SHA_PREV"; do
  git cat-file -e "$sha" 2>/dev/null || { echo "ERROR: SHA $sha from deploy state is not present in local git history — fetch more history or investigate a possible force-push before deploying." >&2; exit 1; }
done

API_CHANGED=false
if ! git diff --quiet "$API_SHA_PREV" "$TARGET_SHA" -- apps/api packages/database 2>/dev/null; then
  API_CHANGED=true
fi

WEB_CHANGED=false
if ! git diff --quiet "$WEB_SHA_PREV" "$TARGET_SHA" -- apps/web 2>/dev/null; then
  WEB_CHANGED=true
fi

SCHEMA_CHANGED=false
if ! git diff --quiet "$API_SHA_PREV" "$TARGET_SHA" -- packages/database/prisma/migrations packages/database/prisma/schema.prisma 2>/dev/null; then
  SCHEMA_CHANGED=true
fi

if [ "$API_CHANGED" = "true" ] && [ "$WEB_CHANGED" = "true" ]; then
  CLASSIFICATION=API_AND_WEB
elif [ "$API_CHANGED" = "true" ]; then
  CLASSIFICATION=API_ONLY
elif [ "$WEB_CHANGED" = "true" ]; then
  CLASSIFICATION=WEB_ONLY
else
  CLASSIFICATION=NO_RUNTIME_CHANGE
fi

echo "TARGET_SHA=$TARGET_SHA"
echo "API_SHA_PREV=$API_SHA_PREV"
echo "WEB_SHA_PREV=$WEB_SHA_PREV"
echo "API_CHANGED=$API_CHANGED"
echo "WEB_CHANGED=$WEB_CHANGED"
echo "SCHEMA_CHANGED=$SCHEMA_CHANGED"
echo "CLASSIFICATION=$CLASSIFICATION"
