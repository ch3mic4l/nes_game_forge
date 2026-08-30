#!/usr/bin/env bash
# Drives the Mesen (cycle-accurate) three-producer NMI timing check --
# design-tile.md §12 test 14: does the worst-case shared frame (flip_tick's
# own bound-tile packets, Flash's own on-edge, and the message box's own
# raise row all sharing one frame) still finish inside vblank on real
# hardware timing, not merely produce eventually-correct pixels the way
# jsnes would regardless of how slow the drain actually is.
#
#   test/lua/run_bound_tile_nmi_check.sh [mesen-path]
#
# Builds the fixture fresh (test/lua/build_bound_tile_nmi_roms.mjs -- a
# project built into a temp directory, never touching sample/ or
# sample-rpg/), which also generates bound_tile_nmi_timing.lua from
# bound_tile_nmi_timing.lua.template with this exact build's own
# nmi_rti/main_loop_ready/flash_tick/flip_tick/flash_left addresses baked
# in, and runs the generated script against the ROM once. Exit 0 = the NMI
# finished inside vblank; see bound_tile_nmi_timing.lua.template's own
# EXIT_* constants for any other code.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-bound-tile-nmi-roms.XXXXXX")"
trap 'rm -rf "$OUT_DIR"' EXIT

if [ ! -x "$MESEN" ]; then
  echo "[run_bound_tile_nmi_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

echo "[run_bound_tile_nmi_check] building the three-producer fixture and generating the timing check..."
node "$ROOT/test/lua/build_bound_tile_nmi_roms.mjs" "$OUT_DIR" || exit 1

rom="$OUT_DIR/bound_tile_nmi.nes"
lua="$OUT_DIR/bound_tile_nmi_timing.lua"
timeout 30 "$MESEN" --testRunner "$lua" "$rom" >/dev/null 2>&1
result=$?

if [ "$result" = "0" ]; then
  echo "PASS: the three-producer NMI finished inside vblank"
else
  echo "FAIL (exit $result) -- see bound_tile_nmi_timing.lua's own EXIT_* constants"
fi

exit $result
