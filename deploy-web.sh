#!/bin/bash
# deploy-web.sh — Build web on the server and restart.
#
# WHY SERVER BUILD: Windows can't create pnpm symlinks (EPERM), which breaks
#   the Next.js standalone output. The server (Linux, Node 20, pnpm 10) builds
#   cleanly. Source files are pushed first, then built in place.
#
# NOTE: the rsync step below pushes whatever is in the LOCAL working directory,
#   not what's committed to git — it will happily ship uncommitted or
#   not-yet-pushed local edits. That already caused production's working tree
#   to drift from its own git history once. Final production deployment for
#   a reviewed release should use the git-based method instead (fetch, then
#   `git merge --ff-only origin/main`, then build on the server), not this
#   script, until it's redesigned to sync via git rather than rsync.
#
# Usage (from repo root, in Git Bash):
#   bash deploy-web.sh

set -e

SERVER=root@46.101.255.243
REMOTE_WEB=/var/www/codeclinic/apps/web
REMOTE_STANDALONE=$REMOTE_WEB/.next/standalone/apps/web

echo '[deploy-web] Pushing changed source files to server...'
rsync -az --exclude='.next' --exclude='node_modules' \
  apps/web/ "$SERVER:$REMOTE_WEB/"

echo '[deploy-web] Building on server (Linux supports symlinks)...'
ssh "$SERVER" "cd /var/www/codeclinic && NODE_OPTIONS='--max-old-space-size=1200' pnpm --filter web build"

echo '[deploy-web] Copying static assets into standalone (Next.js does not do this automatically)...'
ssh "$SERVER" "mkdir -p $REMOTE_STANDALONE/.next/static && cp -r $REMOTE_WEB/.next/static/. $REMOTE_STANDALONE/.next/static/"

echo '[deploy-web] Copying public folder into standalone (Next.js does not do this automatically)...'
ssh "$SERVER" "mkdir -p $REMOTE_STANDALONE/public && cp -r $REMOTE_WEB/public/. $REMOTE_STANDALONE/public/"

echo '[deploy-web] Restarting web on server...'
ssh "$SERVER" "pm2 restart codeclinic-web"

echo '[deploy-web] Verifying...'
sleep 5
ssh "$SERVER" "pm2 list | grep -E 'codeclinic-web' && curl -sI http://localhost:3000/icons/whatsapp.png | head -1"

echo '[deploy-web] Done.'
