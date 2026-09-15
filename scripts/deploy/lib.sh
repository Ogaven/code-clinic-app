#!/bin/bash
# lib.sh — shared helpers for the remote release scripts. Sourced, not run.
# Lives in the repo at scripts/deploy/lib.sh and runs ON THE SERVER inside
# /var/www/codeclinic (the git checkout), so `git pull` alone keeps it current.

REPO=/var/www/codeclinic
LOCK_DIR="$REPO/.deploy.lock"
STATE_FILE="$REPO/.deploy-state.json"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
die() { echo "[$(date -u +%H:%M:%S)] ERROR: $*" >&2; exit 1; }

# Atomic mkdir-based lock. Stale locks (holder PID no longer running) are
# reclaimed automatically; a live lock aborts the deploy rather than racing it.
acquire_lock() {
  local label="$1"
  local attempts=0
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if [ -f "$LOCK_DIR/pid" ]; then
      local holder_pid holder_info
      holder_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null)
      holder_info=$(cat "$LOCK_DIR/info" 2>/dev/null)
      if [ -n "$holder_pid" ] && ! kill -0 "$holder_pid" 2>/dev/null; then
        log "Reclaiming stale deploy lock (pid $holder_pid no longer running): $holder_info"
        rm -rf "$LOCK_DIR"
        continue
      fi
      die "Another deployment is in progress: $holder_info (pid $holder_pid). Aborting safely — do not force unless you have confirmed that deploy is dead."
    fi
    attempts=$((attempts + 1))
    [ "$attempts" -gt 5 ] && die "Could not acquire deploy lock (dir keeps appearing without a pid file). Aborting."
    sleep 1
  done
  echo $$ > "$LOCK_DIR/pid"
  echo "$label started $(date -u +%FT%TZ) by ${SUDO_USER:-${USER:-unknown}} (pid $$)" > "$LOCK_DIR/info"
  trap release_lock EXIT
}

release_lock() {
  rm -rf "$LOCK_DIR"
}

# --- deploy state (currently-active SHAs, for change classification) -------
read_state() {
  local key="$1"
  [ -f "$STATE_FILE" ] || { echo ""; return; }
  node -e "
    try {
      const s = require('$STATE_FILE');
      process.stdout.write(s['$key'] || '');
    } catch (e) { process.stdout.write(''); }
  "
}

write_state() {
  # write_state key1 value1 key2 value2 ...
  node -e "
    const fs = require('fs');
    const path = '$STATE_FILE';
    let state = {};
    try { state = JSON.parse(fs.readFileSync(path, 'utf8')); } catch (e) {}
    const args = process.argv.slice(1);
    for (let i = 0; i < args.length; i += 2) state[args[i]] = args[i + 1];
    state.updated_at = new Date().toISOString();
    fs.writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
  " "$@"
}

# Keep the newest N entries of releases_dir/*, always preserving whatever the
# given cutover/rollback symlinks point at regardless of age. Callers must
# pass the FULL path to every symlink that might reference a release dir
# (e.g. apps/web/current, apps/web/previous, apps/api/dist,
# apps/api/previous_dist) — those symlinks live as siblings of releases_dir,
# not inside it, and have different names per app, so they can't be derived
# from releases_dir alone. A protect path that's missing or not a symlink is
# silently skipped (nothing to protect).
prune_releases() {
  local releases_dir="$1"
  local keep_n="${2:-3}"
  shift 2
  local keep_paths=""
  for link in "$@"; do
    [ -L "$link" ] && keep_paths="$keep_paths $(readlink -f "$link")"
  done
  local candidates
  candidates=$(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d ! -name '.tmp-*' | sort -r)
  local i=0
  while IFS= read -r dir; do
    [ -z "$dir" ] && continue
    i=$((i + 1))
    local keep=0
    for kp in $keep_paths; do
      [ "$dir" = "$kp" ] && keep=1
    done
    if [ "$i" -gt "$keep_n" ] && [ "$keep" -eq 0 ]; then
      log "Pruning old release: $dir"
      rm -rf "$dir"
    fi
  done <<< "$candidates"
}
