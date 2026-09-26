#!/usr/bin/env bash
# Drives the Mesen (cycle-accurate) REAL-lifecycle streamed-dialogue check -- ROADMAP item 15 phase
# 2 slice 7b, fix round 1 finding A6's own remaining requirement: does the REAL production path (a
# real scripted walk, a real B-press interact, a real `flash`+`say "AB"` event, the real camera/OAM
# barrier, real vram_drain) finish every NMI's drain inside vblank at the real reachable worst case
# (73 payload bytes: Flash's own 35 sharing the interact frame with the dialogue box's own first
# 38-byte row/attribute draw)?
#
#   test/lua/run_sw_dlg_real_workload_check.sh [mesen-path]
#
# Runs the real, unbroken lifecycle first, expecting a PASS exit code in [100,254]
# (sw_dlg_real_workload_timing.lua.template's own EXIT_PASS_BASE=100, MARGIN_SCALE=20 cycles/step,
# capped at 254 -- that file's own header explains why 255 is never emitted at all here, learning
# fix round 1's own exit-255-ambiguity lesson proactively rather than special-casing it at this
# wrapper). Then runs the --break=inject-oversize negative control (the identical real walk/
# interact/event, plus one extra oversized fake packet appended onto the real queue's own tail at
# runtime), expecting EXIT_DEADLINE_MISS (5) -- proving the deadline check can genuinely fail.
# Exit code: 0 iff both match their expected signature; 1 otherwise.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"

if [ ! -x "$MESEN" ]; then
  echo "[run_sw_dlg_real_workload_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

EXIT_PASS_BASE=100
EXIT_PASS_CAP=254
MARGIN_SCALE=20
EXIT_DEADLINE_MISS=5

overall=0

run_case() {
  local label="$1"
  shift
  local out_dir
  out_dir="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-sw-dlg-real-workload-roms.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '$out_dir'" EXIT

  echo "[run_sw_dlg_real_workload_check] building $label..."
  if ! node "$ROOT/test/lua/build_sw_dlg_real_workload_roms.mjs" "$out_dir" "$@"; then
    echo "sw_dlg_real_workload ($label): FAIL -- build_sw_dlg_real_workload_roms.mjs did not succeed"
    overall=1
    rm -rf "$out_dir"
    trap - EXIT
    return
  fi

  local rom="$out_dir/sw_dlg_real_workload_timing.nes"
  local lua="$out_dir/sw_dlg_real_workload_timing.lua"
  timeout 60 "$MESEN" --testRunner "$lua" "$rom" >/dev/null 2>&1
  local result=$?

  if [ "$label" = "real" ]; then
    # Same rule run_sw_dlg_drain_check.sh's own fix established (A6): Mesen's own generic
    # external-failure exit code is 255 too, indistinguishable from a legitimate high-margin pass --
    # never accepted here, though this template also proactively caps its own encoding at 254 so it
    # should never legitimately emit 255 in the first place.
    if [ "$result" = "255" ]; then
      echo "sw_dlg_real_workload ($label): FAIL -- exit $result is Mesen's own generic failure signal; never accepted as a pass"
      overall=1
    elif [ "$result" -ge "$EXIT_PASS_BASE" ] && [ "$result" -le "$EXIT_PASS_CAP" ]; then
      local steps=$((result - EXIT_PASS_BASE))
      local lo=$((steps * MARGIN_SCALE))
      local hi=$(((steps + 1) * MARGIN_SCALE))
      echo "sw_dlg_real_workload ($label): PASS -- exit $result, worst margin in [${lo}, ${hi}) cycles"
    else
      echo "sw_dlg_real_workload ($label): FAIL -- exit $result, expected a pass code in [$EXIT_PASS_BASE, $EXIT_PASS_CAP]"
      overall=1
    fi
  else
    if [ "$result" = "$EXIT_DEADLINE_MISS" ]; then
      echo "sw_dlg_real_workload ($label): PASS -- exit $EXIT_DEADLINE_MISS (EXIT_DEADLINE_MISS), the injected-oversize transaction missed its vblank deadline as expected"
    else
      echo "sw_dlg_real_workload ($label): FAIL -- exit $result, expected $EXIT_DEADLINE_MISS (EXIT_DEADLINE_MISS)"
      overall=1
    fi
  fi

  rm -rf "$out_dir"
  trap - EXIT
}

run_case "real"
run_case "oversize" --break=inject-oversize

exit $overall
