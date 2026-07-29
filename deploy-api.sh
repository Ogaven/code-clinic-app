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
# tar | ssh is used instead of scp -r because:
#   1. scp on Windows Git Bash silently skips unchanged files (no fresh copy guarantee)
#   2. scp can't create new nested subdirectories if the parent didn't exist before
# tar creates the full directory tree atomically and correctly every time.
ssh "$SERVER" "rm -rf $REMOTE_DIR/apps/api/dist"
(cd apps/api && tar -czf - dist) | ssh "$SERVER" "cd $REMOTE_DIR/apps/api && tar -xzf -"

# startup.js runs `prisma db push --schema=<this file>` on every restart.
# Without copying the schema here, the server keeps an old schema and drops
# any tables/columns added since the last manual schema update.
echo '[deploy-api] Copying Prisma schema to server...'
scp packages/database/prisma/schema.prisma "$SERVER:$REMOTE_DIR/packages/database/prisma/schema.prisma"

# Regenerate Prisma client on the server so the runtime types match the new schema.
# Without this, any newly added model fields cause "Unknown argument" Prisma errors.
echo '[deploy-api] Regenerating Prisma client on server...'
ssh "$SERVER" "cd $REMOTE_DIR && packages/database/node_modules/.bin/prisma generate --schema=packages/database/prisma/schema.prisma"

echo '[deploy-api] Restarting API on server...'
ssh "$SERVER" "pm2 restart codeclinic-api"

echo '[deploy-api] Verifying...'
sleep 4
ssh "$SERVER" "pm2 show codeclinic-api 2>&1 | grep -E 'status|uptime'"

echo '[deploy-api] Done.'
