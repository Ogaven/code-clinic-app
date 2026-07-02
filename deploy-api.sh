#!/bin/bash
# deploy-api.sh — Build API locally and deploy compiled output to production.
#
# WHY LOCAL BUILD: The production server (46.101.255.243) has 2 GB RAM.
# TypeScript (tsc) crashes with OOM on that machine. All API compilation
# must happen here on the dev machine; only the compiled dist/ is sent.
#
# Usage (from repo root, in Git Bash):
#   bash deploy-api.sh
#
# Prerequisites: pnpm installed locally, ssh key access to root@46.101.255.243

set -e

SERVER=root@46.101.255.243
REMOTE_DIR=/var/www/codeclinic

echo '[deploy-api] Building API locally (tsc)...'
# tsc requires extra heap on large codebases — 3 GB should be enough on any dev machine
NODE_OPTIONS='--max-old-space-size=3072' pnpm --filter api build

echo '[deploy-api] Copying compiled dist/ to server...'
scp -r apps/api/dist "$SERVER:$REMOTE_DIR/apps/api/"

echo '[deploy-api] Restarting API on server...'
ssh "$SERVER" "pm2 restart codeclinic-api"

echo '[deploy-api] Verifying...'
sleep 4
ssh "$SERVER" "pm2 show codeclinic-api 2>&1 | grep -E 'status|uptime'"

echo '[deploy-api] Done.'
