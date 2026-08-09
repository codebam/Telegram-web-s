#!/usr/bin/env bash
#
# Launch the signed-in Web S test browser.
#
# A dedicated Chromium profile holding its own Telegram authorization, kept
# outside the repo at ~/Documents/webs-test-browser/profile (override with
# WEBS_TEST_PROFILE). It is a real authorization for a real account: anything
# driven here sends real messages, so keep test traffic in Saved Messages.
#
# Remote debugging is on, so an agent can attach with Playwright's
# chromium.connectOverCDP('http://localhost:9222') — see testBrowser.mjs next
# to this script. Headless by default so driving it never steals focus.
#
# Usage:
#   bash scripts/test-browser.sh                      # headless, localhost:8081
#   bash scripts/test-browser.sh --headed             # watch it
#   bash scripts/test-browser.sh https://telegram.codebam.ca
#
# The default URL is the `pnpm start:svelte` dev server.
set -euo pipefail

PROFILE="${WEBS_TEST_PROFILE:-$HOME/Documents/webs-test-browser/profile}"
PORT="${WEBS_TEST_CDP_PORT:-9222}"

HEADED=0
URL="http://localhost:8081/"
for arg in "$@"; do
  case "$arg" in
    --headed) HEADED=1 ;;
    *) URL="$arg" ;;
  esac
done

# A bare `[ ... ] && x=` would exit the script under `set -e` whenever the test
# is false, which is the common case.
HEADLESS_FLAG="--headless=new"
if [ "$HEADED" = 1 ]; then HEADLESS_FLAG=""; fi

if curl -sf "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
  echo "[test-browser] already running on :$PORT"
  exit 0
fi

mkdir -p "$(dirname "$PROFILE")"
echo "[test-browser] profile=$PROFILE  cdp=http://localhost:$PORT  url=$URL  headed=$HEADED"
exec chromium \
  ${HEADLESS_FLAG:+$HEADLESS_FLAG} \
  --window-size=1280,1000 \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$PORT" \
  --remote-allow-origins='*' \
  --no-first-run \
  --no-default-browser-check \
  --new-window "$URL"
