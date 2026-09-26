#!/usr/bin/env bash
# Drives the Mesen (cycle-accurate) streamed-dialogue drain timing check -- ROADMAP item 15 phase
# 2 slice 7b, plan test 9: does the dialogue overlay's own worst single-transaction vram_buf
# queue (a 32-tile row split at an X seam, two headers + 32 payload = 38 bytes) finish inside
# vblank on real hardware timing while the real streamed dialogue lifecycle is genuinely DRAINING
# -- not merely produce eventually-correct pixels the way jsnes (with no hard vblank deadline)
# would regardless of how slow the drain actually is.
#
#   test/lua/run_sw_dlg_drain_check.sh [mesen-path]
#
# Builds and runs the real 38-byte shape, expecting a PASS exit code in [100,255]
# (sw_dlg_drain_timing.lua.template's own EXIT_PASS_BASE=100, MARGIN_SCALE=20 cycles/step -- see
# that file's own header for why the exit code is the only channel headless --testRunner mode can
# recover a measured figure through). Then builds and runs the --break=oversize negative control
# (a 245-byte transaction no real dialogue close ever produces), expecting EXIT_DEADLINE_MISS (5)
# -- proving the deadline check itself can fail, not merely pass vacuously. Exit code: 0 iff both
# match their expected signature; 1 otherwise.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"

if [ ! -x "$MESEN" ]; then
  echo "[run_sw_dlg_drain_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

EXIT_PASS_BASE=100
EXIT_PASS_MAX=255
MARGIN_SCALE=20
EXIT_DEADLINE_MISS=5

overall=0

run_case() {
  local label="$1"
  shift
  local out_dir
  out_dir="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-sw-dlg-drain-roms.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '$out_dir'" EXIT

  echo "[run_sw_dlg_drain_check] building $label..."
  if ! node "$ROOT/test/lua/build_sw_dlg_drain_roms.mjs" "$out_dir" "$@"; then
    echo "sw_dlg_drain ($label): FAIL -- build_sw_dlg_drain_roms.mjs did not succeed"
    overall=1
    rm -rf "$out_dir"
    trap - EXIT
    return
  fi

  local rom="$out_dir/sw_dlg_drain_timing.nes"
  local lua="$out_dir/sw_dlg_drain_timing.lua"
  timeout 30 "$MESEN" --testRunner "$lua" "$rom" >/dev/null 2>&1
  local result=$?

  if [ "$label" = "real" ]; then
    # Fix round 1 (A6): Mesen's own generic external-failure exit code is 255 too, indistinguishable
    # from this wrapper's outside view of the lua template's own math.min(EXIT_PASS_MAX, ...) clamp
    # -- so 255 is never accepted as a measurement here, even though the template's own scheme can
    # legitimately emit it for a real margin >= (255-100)*20 = 3100 cycles. A real run this far under
    # the deadline should lower MARGIN_SCALE rather than rely on a code this wrapper cannot trust.
    if [ "$result" = "$EXIT_PASS_MAX" ]; then
      echo "sw_dlg_drain ($label): FAIL -- exit $result is Mesen's own generic failure signal as well as this template's own clamp value; never accepted as a pass"
      overall=1
    elif [ "$result" -ge "$EXIT_PASS_BASE" ] && [ "$result" -lt "$EXIT_PASS_MAX" ]; then
      local steps=$((result - EXIT_PASS_BASE))
      local lo=$((steps * MARGIN_SCALE))
      local hi=$(((steps + 1) * MARGIN_SCALE))
      echo "sw_dlg_drain ($label): PASS -- exit $result, margin in [${lo}, ${hi}) cycles"
    else
      echo "sw_dlg_drain ($label): FAIL -- exit $result, expected a pass code in [$EXIT_PASS_BASE, $EXIT_PASS_MAX)"
      overall=1
    fi
  else
    if [ "$result" = "$EXIT_DEADLINE_MISS" ]; then
      echo "sw_dlg_drain ($label): PASS -- exit $EXIT_DEADLINE_MISS (EXIT_DEADLINE_MISS), the oversized transaction missed its vblank deadline as expected"
    else
      echo "sw_dlg_drain ($label): FAIL -- exit $result, expected $EXIT_DEADLINE_MISS (EXIT_DEADLINE_MISS)"
      overall=1
    fi
  fi

  rm -rf "$out_dir"
  trap - EXIT
}

run_case "real"
run_case "oversize" --break=oversize

exit $overall
