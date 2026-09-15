#!/bin/bash
# deploy.sh [--yes] [--api-only|--web-only] — the single entrypoint for
# routine Code Clinic deploys. Classifies what actually changed since the
# last deploy and deploys ONLY that.
#
#   API-only change   -> deploy-api.sh only, codeclinic-api restarted, web untouched
#   Web-only change    -> deploy-web.sh only, codeclinic-web restarted, api untouched
#   Both changed        -> both, independently, each with its own rollback
#   No runtime change   -> nothing deploys, nothing restarts
#
# Without --yes this is a dry run: it prints the classification and the exact
# commands it would run, but does not execute them. Read DEPLOYMENT.md before
# using this for the first time.
#
# Usage:
#   bash deploy.sh                 # dry run — show the plan only
#   bash deploy.sh --yes           # execute the plan
#   bash deploy.sh --yes --api-only   # force API deploy regardless of classification
#   bash deploy.sh --yes --web-only   # force web deploy regardless of classification

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

EXECUTE=false
FORCE=""
for arg in "$@"; do
  case "$arg" in
    --yes) EXECUTE=true ;;
    --api-only) FORCE=API_ONLY ;;
    --web-only) FORCE=WEB_ONLY ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

echo "[deploy] Classifying changes..."
CLASSIFY_OUTPUT=$(bash "$SCRIPT_DIR/scripts/deploy/classify.sh") || { echo "$CLASSIFY_OUTPUT" >&2; echo "[deploy] Classification failed — aborting (fail closed). Nothing was deployed." >&2; exit 1; }
eval "$CLASSIFY_OUTPUT"

echo "[deploy] TARGET_SHA=$TARGET_SHA"
echo "[deploy] currently deployed: api=$API_SHA_PREV web=$WEB_SHA_PREV"
echo "[deploy] classification: $CLASSIFICATION (api_changed=$API_CHANGED web_changed=$WEB_CHANGED schema_changed=$SCHEMA_CHANGED)"

EFFECTIVE="$CLASSIFICATION"
[ -n "$FORCE" ] && EFFECTIVE="$FORCE" && echo "[deploy] override: forcing $FORCE regardless of classification"

DO_API=false
DO_WEB=false
case "$EFFECTIVE" in
  API_ONLY) DO_API=true ;;
  WEB_ONLY) DO_WEB=true ;;
  API_AND_WEB) DO_API=true; DO_WEB=true ;;
  NO_RUNTIME_CHANGE)
    echo "[deploy] Nothing to deploy — production already matches $TARGET_SHA. No restarts."
    exit 0
    ;;
esac

echo "[deploy] Deployment matrix:"
echo "[deploy]   API deploy=$DO_API restart=$DO_API"
echo "[deploy]   Web deploy=$DO_WEB restart=$DO_WEB"

if [ "$SCHEMA_CHANGED" = "true" ]; then
  echo "[deploy] *** SCHEMA CHANGE DETECTED (packages/database/prisma) ***"
  echo "[deploy] This script will regenerate the Prisma CLIENT to match schema.prisma but will NOT run"
  echo "[deploy] 'prisma migrate deploy' or 'db push'. Apply the migration yourself first, after a DB"
  echo "[deploy] backup, via the controlled migration procedure in DEPLOYMENT.md — then re-run this deploy."
fi

if [ "$EXECUTE" != "true" ]; then
  echo "[deploy] DRY RUN — pass --yes to execute this plan. Nothing was deployed."
  exit 0
fi

FAILED=false
if [ "$DO_API" = "true" ]; then
  echo "[deploy] === Deploying API ==="
  bash "$SCRIPT_DIR/deploy-api.sh" "$TARGET_SHA" || FAILED=true
fi
if [ "$DO_WEB" = "true" ]; then
  echo "[deploy] === Deploying Web ==="
  bash "$SCRIPT_DIR/deploy-web.sh" "$TARGET_SHA" || FAILED=true
fi

if [ "$FAILED" = "true" ]; then
  echo "[deploy] One or more deploys FAILED — see output above. Failed components were rolled back automatically by their own release script." >&2
  exit 1
fi

echo "[deploy] Done. api_restart=$DO_API web_restart=$DO_WEB pm2_restart_all_used=NO"
