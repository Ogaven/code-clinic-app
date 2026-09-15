#!/bin/bash
# smoke-test-web.sh <port> <release_dir> — verifies a running Next.js web
# release is ACTUALLY serving its CSS/JS, not just returning HTTP 200 HTML.
#
# This is the check that would have caught the 2026-09-15 incident: HTML was
# 200 while every /_next/static/*.css and *.js chunk it referenced was 404.
#
# Exit 0 = healthy. Exit 1 = unhealthy (caller must not treat this port/release
# as servable — either don't cut over, or roll back).

set -u
PORT="$1"
RELEASE_DIR="$2"
BASE="http://localhost:$PORT"

fail() { echo "SMOKE-TEST FAIL: $*" >&2; exit 1; }

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1"; }

# 1. HTML itself
html_code=$(code "$BASE/login")
[ "$html_code" = "200" ] || fail "/login returned $html_code (expected 200)"

html=$(curl -s --max-time 10 "$BASE/login")
[ -n "$html" ] || fail "/login returned empty body"

# 2. Every referenced /_next/static/*.css and *.js chunk must resolve.
assets=$(echo "$html" | grep -oE '/_next/static/[^"'"'"']+\.(css|js)' | sort -u)
[ -n "$assets" ] || fail "no /_next/static/*.css|js assets referenced in /login HTML — page did not render its normal script/style tags"

asset_count=0
while IFS= read -r asset; do
  [ -z "$asset" ] && continue
  asset_count=$((asset_count + 1))
  c=$(code "$BASE$asset")
  [ "$c" = "200" ] || fail "referenced asset $asset returned $c (expected 200)"
done <<< "$assets"
[ "$asset_count" -ge 1 ] || fail "found zero static assets to verify"

# 3. Must have at least one stylesheet — this is specifically the raw-HTML failure mode.
css_count=$(echo "$assets" | grep -c '\.css$' || true)
[ "$css_count" -ge 1 ] || fail "zero CSS assets referenced — page would render unstyled"

# 4. manifest.json and service worker (PWA assets)
manifest_code=$(code "$BASE/manifest.json")
[ "$manifest_code" = "200" ] || fail "/manifest.json returned $manifest_code (expected 200)"

sw_code=$(code "$BASE/sw.js")
[ "$sw_code" = "200" ] || fail "/sw.js returned $sw_code (expected 200)"

# 5. BUILD_ID consistency: the server's own BUILD_ID must actually be servable
# from /_next/static/<BUILD_ID>/_buildManifest.js — proves server code and
# static assets came from the SAME build, not server=new/static=old or vice versa.
build_id_file="$RELEASE_DIR/apps/web/.next/BUILD_ID"
[ -f "$build_id_file" ] || fail "release has no .next/BUILD_ID at $build_id_file"
build_id=$(cat "$build_id_file")
[ -n "$build_id" ] || fail "BUILD_ID file is empty"
bm_code=$(code "$BASE/_next/static/$build_id/_buildManifest.js")
[ "$bm_code" = "200" ] || fail "BUILD_ID mismatch: /_next/static/$build_id/_buildManifest.js returned $bm_code — running server's static assets do not match its own BUILD_ID ($build_id)"

echo "SMOKE-TEST OK: html=200 css=$css_count assets_checked=$asset_count manifest=200 sw=200 build_id=$build_id"
exit 0
