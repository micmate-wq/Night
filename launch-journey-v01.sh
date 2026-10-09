#!/bin/bash
# launch-journey-v01.sh — launch "Aether Journey v1.3 Lab" from THIS checkout only.
#
# Usage, in Terminal:   bash <this folder>/launch-journey-v01.sh          (dev window, live code)
#                       bash <this folder>/launch-journey-v01.sh build    (debug .app from the
#                         production copy step; stays in desktop/src-tauri/target, not installed)
#
# - Serves this checkout (no absolute paths) on port 3472, app id com.aether.desktop.journey-v1-3.
# - Never applies patches, commits, resets, deletes or kills anything.
# - Stops if the branch, config or port is not what it expects, or if the argument is not dev/build.
# - Exits non-zero if the Tauri build/dev command fails; a failed build never opens any .app.
# - Writes a log to desktop/src-tauri/target/journey-v01-launch.log (git-ignored).
# Quit with Ctrl+C here, or close the app window.
set -u
case "$#:${1-}" in
  0:|1:dev|1:build) MODE="${1:-dev}" ;;
  *) echo "Usage: bash launch-journey-v01.sh [dev|build]" >&2; echo "!! Unknown argument(s): $*. Nothing was launched." >&2; exit 2 ;;
esac
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT=3472
CONF="$ROOT/desktop/src-tauri/tauri.conf.json"
stop() { echo; echo "!! $1"; echo "!! Nothing was launched."; exit 1; }

cd "$ROOT" || stop "Cannot enter $ROOT"
BR="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || stop "Not a git checkout: $ROOT"
grep -qE '"identifier": "com.aether.desktop.journey-(v01|v1-2|v1-3)"' "$CONF" || stop "tauri.conf.json does not have the journey app id."
grep -q "localhost:$PORT/" "$CONF" || stop "tauri.conf.json devUrl is not on port $PORT."
if [ "$MODE" = "dev" ] && lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  lsof -nP -iTCP:$PORT -sTCP:LISTEN
  stop "Port $PORT is already in use (shown above). Not touching it."
fi
[ -f "$ROOT/desktop/dsp-wasm/pkg/dsp_wasm_bg.wasm" ] || stop "Built DSP missing: desktop/dsp-wasm/pkg."

if [ -x "$ROOT/node_modules/.bin/tauri" ]; then TAURI=("$ROOT/node_modules/.bin/tauri")
elif [ -x "$HOME/.gemini/antigravity/scratch/aether/node_modules/.bin/tauri" ]; then TAURI=("$HOME/.gemini/antigravity/scratch/aether/node_modules/.bin/tauri")
else TAURI=(npx --yes @tauri-apps/cli@2); fi

mkdir -p "$ROOT/desktop/src-tauri/target"
LOG="$ROOT/desktop/src-tauri/target/journey-v01-launch$([ "$MODE" = build ] && echo -build).log"
APP="$ROOT/desktop/src-tauri/target/debug/bundle/macos/Aether Journey v1.3 Lab.app"
{
  echo "== Aether Journey v1.3 Lab — $(date '+%Y-%m-%d %H:%M:%S')"
  echo "   checkout: $ROOT"
  echo "   branch:   $BR @ $(git rev-parse HEAD)"
  echo "   changes:  $(git status --porcelain | wc -l | tr -d ' ') uncommitted path(s)"
  git status --porcelain
  echo "   app id:   com.aether.desktop.journey-v1-3   port: $PORT"
  echo "   tauri:    ${TAURI[*]}"
} | tee "$LOG"
if [ "$MODE" = "build" ]; then
  "${TAURI[@]}" build --debug --bundles app 2>&1 | tee -a "$LOG"
  RC=${PIPESTATUS[0]}
  if [ "$RC" -ne 0 ]; then
    echo "!! Tauri build failed (exit $RC). Not opening any app. See $LOG" | tee -a "$LOG"
    exit "$RC"
  fi
  [ -d "$APP" ] || stop "Build reported success but $APP is missing (see $LOG)."
  echo "   Built: $APP" | tee -a "$LOG"
  open "$APP"
  exit $?
else
  "${TAURI[@]}" dev 2>&1 | tee -a "$LOG"
  RC=${PIPESTATUS[0]}
  [ "$RC" -eq 0 ] || echo "!! Tauri dev exited with $RC. See $LOG" | tee -a "$LOG"
  exit "$RC"
fi
