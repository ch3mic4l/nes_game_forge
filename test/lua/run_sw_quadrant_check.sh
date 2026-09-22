#!/usr/bin/env bash
# Runs sw_quadrant_check.lua.template -- instantiated once per shape by
# test/lua/build_sw_roms.mjs, with that build's own resolved
# frame_cnt/game_state/ST_GAMEPLAY addresses baked in (fix round 2, MINOR 3)
# -- against the three streamed-project ROMs the same script builds (action,
# rpg, action_mixed), following run_sram_check.sh's own shape: build first,
# then one Mesen invocation per ROM, exit 0 only if every ROM's boot-sanity
# check passed.
#
#   test/lua/run_sw_quadrant_check.sh [mesen-path]
#   test/lua/run_sw_quadrant_check.sh [mesen-path] --break=corrupt-reset-vector
#
# --break=corrupt-reset-vector is a generic negative control, not a
# streamworld.asm-specific one -- see sw_quadrant_check.lua's own header for
# why full render-parity (the prototype's own quadrant pixel/attribute
# comparison) needs a real call site this slice deliberately does not
# provide, and is deferred to whichever of slice 2b/4a wires one. Only the
# `action` ROM is built broken in this mode; `rpg`/`action_mixed` stay clean
# so a run can also confirm the break is scoped to the one ROM it patched.
#
# Exit code (no --break): 0 if every ROM's boot-sanity check passed, 1
# otherwise. In --break mode: 0 if `action` failed with SPECIFICALLY
# EXIT_NO_BOOT (2, sw_quadrant_check.lua) and the other two passed with 0 (the
# expected shape for this control -- any other exit code, including some
# OTHER nonzero code, is itself a failure of the control), 1 otherwise.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"
BREAK_ARG=""
for a in "$@"; do
  case "$a" in
    --break=*) BREAK_ARG="$a" ;;
  esac
done

OUT_DIR="/tmp/nesforge-sw-roms"

if [ ! -x "$MESEN" ]; then
  echo "[run_sw_quadrant_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

echo "[run_sw_quadrant_check] building ROMs${BREAK_ARG:+ ($BREAK_ARG)}..."
node "$ROOT/test/lua/build_sw_roms.mjs" "$OUT_DIR" $BREAK_ARG || exit 1

overall=0
for key in action rpg action_mixed; do
  rom="$OUT_DIR/sw_${key}.nes"
  lua="$OUT_DIR/sw_${key}_check.lua"
  timeout 30 "$MESEN" --testRunner "$lua" "$rom" >/dev/null 2>&1
  code=$?
  # EXIT_NO_BOOT, sw_quadrant_check.lua -- the specific code a corrupted reset vector must produce
  # (frame_cnt never advances because the CPU never reaches real code at all), not any nonzero exit.
  expected_code=0
  if [ -n "$BREAK_ARG" ] && [ "$key" = "action" ]; then
    expected_code=2
  fi

  if [ "$code" = "$expected_code" ]; then
    if [ "$expected_code" = "0" ]; then
      echo "$key: PASS (exit 0)"
    else
      echo "$key: FAIL as expected (exit $code) -- corrupt-reset-vector control caught it"
    fi
  else
    echo "$key: WRONG exit $code (expected $expected_code) -- see sw_quadrant_check.lua's EXIT_* constants"
    overall=1
  fi
done

exit $overall
