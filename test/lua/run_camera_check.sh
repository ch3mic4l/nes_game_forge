#!/usr/bin/env bash
# Drives the Mesen (cycle-accurate) proof for the camera slide, candidate (b)
# -- docs/design-camera.md §7's Mesen row: does a real screen-edge crossing
# complete correctly under real hardware timing, on both a plain fixture and
# a worst-case heavy one (8 active switch-bound bindings on both screens, a
# real injected hold-terminal Flash), not merely produce eventually-correct
# pixels the way jsnes would regardless of how slow the drain actually is.
#
#   test/lua/run_camera_check.sh [mesen-path]
#
# Builds both fixtures fresh (test/lua/build_camera_roms.mjs -- a mkdtemp
# copy of sample/, never touching the checked-in tree), which also generates
# camera_check.lua from camera_check.lua.template with each exact build's own
# addresses and independent NT0/attribute reference baked in, and runs the
# generated script against each ROM once. Exit 0 on both = the slide
# genuinely completed and its content matches the independent reference; see
# camera_check.lua.template's own EXIT_* constants for any other code.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-camera-roms.XXXXXX")"
trap 'rm -rf "$OUT_DIR"' EXIT

if [ ! -x "$MESEN" ]; then
  echo "[run_camera_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

overall=0

for content in plain heavy; do
  dir="$OUT_DIR/$content"
  echo "[run_camera_check] building the $content fixture and generating the check..."
  node "$ROOT/test/lua/build_camera_roms.mjs" "$dir" "$content" || exit 1

  rom="$dir/camera.nes"
  lua="$dir/camera_check.lua"
  timeout 30 "$MESEN" --testRunner "$lua" "$rom" >"$dir/out.log" 2>&1
  result=$?
  cat "$dir/out.log"

  if [ "$result" = "0" ]; then
    echo "PASS ($content): the camera slide completed and matched the independent reference"
  else
    echo "FAIL ($content, exit $result) -- see camera_check.lua's own EXIT_* constants"
    overall=1
  fi
done

exit $overall
