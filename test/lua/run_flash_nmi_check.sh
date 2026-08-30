#!/usr/bin/env bash
# Drives the Mesen (cycle-accurate) two-producer NMI timing check --
# design-flash.md §9 test 8: does the worst-case shared frame (a Say's own
# text_tick row plus Flash's own on-edge) still finish inside vblank on real
# hardware timing, not merely produce eventually-correct pixels the way
# jsnes would regardless of how slow the drain actually is.
#
#   test/lua/run_flash_nmi_check.sh [mesen-path]
#
# Builds the fixture fresh (test/lua/build_flash_nmi_roms.mjs -- a project
# built into a temp directory, never touching sample/ or sample-rpg/), which
# also generates flash_nmi_timing.lua from flash_nmi_timing.lua.template
# with this exact build's own nmi_rti/main_loop_ready/flash_tick/flash_left
# addresses baked in, and runs the generated script against the ROM once.
# Exit 0 = the NMI finished inside vblank; see flash_nmi_timing.lua.template's
# own EXIT_* constants for any other code.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"
# Finding 4: a fixed shared directory let two concurrent runs (different
# worktrees, or a stray leftover from a killed run) overwrite each other's
# ROM/generated-script pair between build and Mesen launch -- a race that
# produces a mismatched ROM/script pair or a spurious stale-anchor failure,
# not a real result. Each invocation now gets its own mktemp -d, removed on
# exit however the script leaves (success, failure, or a signal).
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-flash-nmi-roms.XXXXXX")"
trap 'rm -rf "$OUT_DIR"' EXIT

if [ ! -x "$MESEN" ]; then
  echo "[run_flash_nmi_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

echo "[run_flash_nmi_check] building the two-producer fixture and generating the timing check..."
node "$ROOT/test/lua/build_flash_nmi_roms.mjs" "$OUT_DIR" || exit 1

rom="$OUT_DIR/flash_nmi.nes"
lua="$OUT_DIR/flash_nmi_timing.lua"
timeout 30 "$MESEN" --testRunner "$lua" "$rom" >/dev/null 2>&1
result=$?

if [ "$result" = "0" ]; then
  echo "PASS: the two-producer NMI finished inside vblank"
else
  echo "FAIL (exit $result) -- see flash_nmi_timing.lua's own EXIT_* constants"
fi

exit $result
