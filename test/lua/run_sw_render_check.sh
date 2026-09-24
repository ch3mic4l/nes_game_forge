#!/usr/bin/env bash
# Runs sw_render_check.lua.template (phase 2 slice 2b, Part I: real window-render parity) --
# instantiated by test/lua/build_sw_render_roms.mjs against ONE streamed ROM, built through the
# real public path, that boots straight onto a non-trivial-parity streamed landing.
#
#   test/lua/run_sw_render_check.sh [mesen-path] [--break=blank-landing-tile|old-top-left-landing]
#
# Exit code: 0 if the render-parity check passed, the check's own EXIT_* code otherwise (2 =
# no boot, 3 = bad game_state, 4 = wrong map_is_streamed/cam_nt/cam_x_lo/cam_y_lo, 5 = wrong
# rendered tiles/palette, 6 = rendering never enabled while streamed within the frame budget --
# see sw_render_check.lua.template).
#
# --break=blank-landing-tile (fix round 1, F10): a reproducible, project-level negative control --
# build_sw_render_roms.mjs builds the SAME check ROM but never authors the per-screen metatiles,
# while the lua's own oracle keeps expecting their real values, so this run must exit 5
# (EXIT_WRONG_RENDER), not 0.
#
# --break=old-top-left-landing (phase 2 slice "landing"; fix round 1, finding 2: reworked to
# revert the engine, not the oracle): the ROM is built through project.code.overrides restoring
# the exact PRE-"landing"-slice sw_resolve_divdone tail (window pinned to the entered screen's own
# top-left corner, local always 0,0), while the lua's own oracle keeps expecting the real, current,
# correct player-centred window -- see build_sw_render_roms.mjs's own header. Must fail (real run:
# exit 4 -- the reverted engine's own wrong cam_x_lo/cam_y_lo/cam_nt is caught before the check
# ever reaches nametable content).

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"
BREAK_ARG=""
for a in "$@"; do
  case "$a" in
    --break=*) BREAK_ARG="$a" ;;
  esac
done

OUT_DIR="/tmp/nesforge-sw-render"

if [ ! -x "$MESEN" ]; then
  echo "[run_sw_render_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

echo "[run_sw_render_check] building ROM..."
node "$ROOT/test/lua/build_sw_render_roms.mjs" "$OUT_DIR" $BREAK_ARG || exit 1

rom="$OUT_DIR/sw_render.nes"
lua="$OUT_DIR/sw_render_check.lua"
timeout 30 "$MESEN" --testRunner "$lua" "$rom" >/dev/null 2>&1
code=$?

if [ "$code" = "0" ]; then
  echo "render: PASS (exit 0)"
else
  echo "render: FAIL (exit $code) -- see sw_render_check.lua.template's EXIT_* constants"
fi

exit $code
