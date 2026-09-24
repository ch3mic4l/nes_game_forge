#!/usr/bin/env bash
# Drives the Mesen (cycle-accurate) streamed-world DRIVER TIMING check --
# design-streamed-worlds.md's obligation 1 ("Driver specification and
# timing... Discharged by: the production driver measured in the real
# engine on UNROM 512 and the frame bound recomputed from it. The 660-cycle
# / 2.39% margin is PROVISIONAL until then."), and fix round 2's own Finding
# D / ruling M, which found the obligation-1 discharge incomplete (see
# sw_driver_timing.lua.template's own header for the full story: the old
# fixture never reached the real 61-region-tall UNROM 512 packing ceiling,
# carried no real entity workload, never exercised the row axis or an axis
# handoff, and had no ownership/respawn evidence beyond sw_col changing).
#
#   test/lua/run_sw_driver_timing_check.sh [mesen-path]
#
# Builds and runs SEVEN Mesen ROMs against the SAME 3x61 grid, landing at
# screen(1,58) -- an interior column, two rows from the tall edge -- with 8
# real chaser actors on the Right-crossing target and 4 on the Down-crossing
# target (build_sw_driver_timing_roms.mjs's own RIGHT_TARGET_ACTORS/
# DOWN_TARGET_ACTORS):
#   1. unbroken, --report=expensive (default)  -- the driver-span headline:
#      busy-phase max cost of a real ownership-crossing OR fresh busy-arm
#      frame. What obligation 1's own frame-bound arithmetic is recomputed
#      from.
#   2. unbroken, --report=cheap                -- the driver-span floor: no
#      crossing, no fresh arm, pooled across both phases. The harness itself
#      asserts (before ever reaching this script) that this is strictly
#      cheaper than #1 -- EXIT_WORKLOAD_NOT_CHEAPER otherwise.
#   3. unbroken, --report=mainline              -- the NEW mainline-span
#      headline (fix round 2): main_loop_body_start -> main_loop_ready,
#      busy-phase max -- the real whole-frame game-logic cost, including the
#      8/4 real chasers' own update_entities AI cost, which the driver span
#      (anchored before update_entities even runs) cannot see. This is what
#      the frame inequality below is recomputed from.
#   4. unbroken, --report=mainline --no-actors  -- missing-workload negative
#      control for #3: the SAME grid/landing with 0 actors on every screen.
#      Its own mainline max must be markedly cheaper than #3's, proving the
#      reported mainline figure is sensitive to real actor AI cost, not a
#      phantom number.
#   5. unbroken, --idle-only                    -- extra-cost control
#      baseline: the SAME unbroken engine, but the idle-only harness shape
#      (no busy phase, input never held), reporting the AVERAGE per-frame
#      driver-span cost across the whole idle window (sumIdleCycles /
#      idleFrameCount), not the max. A per-frame uniform-overhead defect can
#      be CHEAPER, frame for frame, than a legitimate rare peak (a real
#      one-time post-landing convergence) -- found empirically comparing
#      build #5 against #6 by their own MAX: the mutated build's max was
#      LOWER even though it pays real extra cost on every idle frame the
#      unbroken build mostly does not. The average is what actually
#      discriminates; see the template's own comment by IDLE_AVG_SCALE.
#   6. --break=unconditional-arm, --idle-only (implied) -- the extra-cost
#      negative control itself: project.code.overrides carries a COPY of
#      engine/streamworld.asm (the real repo file is never touched) with
#      sw_win_arm's own comparison chain replaced by an unconditional `jmp
#      sw_win_arm_col_inc` -- every single frame pays the real column-arm
#      work regardless of st_active or any desired/current match. Reports
#      the same average-per-idle-frame metric as #5; this script asserts #6
#      exceeds #5 by at least EXTRA_COST_MIN_DELTA cycles.
#   7. --break=no-spawn                         -- the ownership/respawn
#      evidence negative control: project.code.overrides carries a COPY of
#      engine/streamworld.asm with the RIGHT-crossing handler's own `jsr
#      spawn_entities` replaced by three NOPs -- sw_col still changes, but
#      the new screen's entities never actually spawn. This script asserts
#      #7 exits with EXIT_NO_RESPAWN_EVIDENCE (7) exactly, not a PASS-range
#      code -- review-s4b-round2-no-spawn.mjs's own finding, now closed.
#
# A PASS (exit in [100,254]) reports the picked metric's own max/average
# cycles, decoded via the matching *_SCALE cycles/exit-code-step (see the
# template's own MARGIN_SCALE/MAINLINE_MARGIN_SCALE/IDLE_AVG_SCALE). Exit
# 255 is the template's own saturation code (math.min clamp) -- it means the
# real cost is AT LEAST the top of the encodable range, not that it fits
# inside it, so this script treats it as a FAIL rather than a PASS: a
# saturated measurement asserts nothing about the actual cost.
#
# Exit code: 0 if every check in scope passed; 1 otherwise.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"

if [ ! -x "$MESEN" ]; then
  echo "[run_sw_driver_timing_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

EXIT_PASS_BASE=100
EXIT_PASS_MAX=255
EXIT_NO_RESPAWN_EVIDENCE=7
# Must track sw_driver_timing.lua.template's own *_SCALE constants exactly --
# this script only decodes exit codes the template already encoded, it does
# not re-derive the scales. Fix round 2 (finding D/ruling M) re-measured
# everything against the real 3x61/row-58 grid with real actors (the old
# 12x2/row-0 fixture never reached the real UNROM 512 packing ceiling) using
# a corrected, calibrated emu.getState()["masterClock"] clock (the old PPU
# scanline/dot reconstruction silently discarded any span crossing a frame
# boundary -- see the template's own header) and grew MARGIN_SCALE from 50
# to 150 and added MAINLINE_MARGIN_SCALE=200 / IDLE_AVG_SCALE=100 to fit the
# real, now-honestly-measured worst cases.
MARGIN_SCALE=150
MAINLINE_MARGIN_SCALE=200
IDLE_AVG_SCALE=100
# The extra-cost control's own broken-vs-baseline average delta must clear
# this many cycles to count as "markedly larger" -- real measurement
# (2026-09-23, 3x61 grid, row-58 landing): unbroken idle-only average
# 6,100-6,200 cyc/frame, broken (--break=unconditional-arm) idle-only
# average 7,700-7,800 cyc/frame, a 1,500-1,700 cycle/frame gap depending on
# which end of each bucket is real. Set below the guaranteed-worst-case gap
# (1,500) so a genuine regression still trips it without chasing this exact
# fixture's own bucket noise.
EXTRA_COST_MIN_DELTA=800
# The --no-actors mainline missing-workload control's own delta must clear
# this many cycles -- real measurement: real-actor mainline max
# 21,200-21,400 cyc, no-actors mainline max 19,400-19,600 cyc, a guaranteed
# gap of at least 21,200-19,600=1,600 cyc (comparing the worst-case ends of
# each bucket). Set below that.
MAINLINE_MISSING_WORKLOAD_MIN_DELTA=600
# Frame inequality (mainline-busy ceiling + worst-NMI < NTSC frame budget).
# Worst-NMI figures are cited from design-streamed-worlds.md ~2414 (NOT
# re-derived by this script): UNROM 512 strip 1,543 cyc / mixed@35 1,324
# cyc -- the larger of the two is used. NTSC frame budget 29,780 cyc (the
# lower of the alternating 29,780/29,781 exact figure, for a conservative
# ceiling).
WORST_NMI_CYCLES=1543
NTSC_FRAME_BUDGET=29780

overall=0

run_one() {
  local label="$1"
  local out_dir="$2"
  shift 2
  echo "[run_sw_driver_timing_check] building $label ($*)..."
  if ! node "$ROOT/test/lua/build_sw_driver_timing_roms.mjs" "$out_dir" "$@" >"$out_dir.build.log" 2>&1; then
    echo "sw_driver_timing ($label): FAIL -- build_sw_driver_timing_roms.mjs did not succeed (see $out_dir.build.log)"
    overall=1
    return 1
  fi
  local rom="$out_dir/sw_driver_timing.nes"
  local lua="$out_dir/sw_driver_timing.lua"
  timeout 60 "$MESEN" --testRunner "$lua" "$rom" >/dev/null 2>&1
  return $?
}

# decode_pass SCALE RESULT -> prints "lo-hi" (or "lo+ (saturated)")
decode_pass() {
  local scale="$1"
  local result="$2"
  local steps=$((result - EXIT_PASS_BASE))
  local lo=$((steps * scale))
  if [ "$result" = "$EXIT_PASS_MAX" ]; then
    echo "${lo}+ (saturated -- raise the matching *_SCALE in sw_driver_timing.lua.template if this happens on a real run)"
  else
    local hi=$(((steps + 1) * scale))
    echo "${lo}-$((hi - 1))"
  fi
}

# decode_lo SCALE RESULT -> prints just the lower bound (0 if not in PASS range)
decode_lo() {
  local scale="$1"
  local result="$2"
  if [ "$result" -ge "$EXIT_PASS_BASE" ] && [ "$result" -le "$EXIT_PASS_MAX" ]; then
    echo $(( (result - EXIT_PASS_BASE) * scale ))
  else
    echo 0
  fi
}

is_pass() {
  local result="$1"
  [ "$result" -ge "$EXIT_PASS_BASE" ] && [ "$result" -lt "$EXIT_PASS_MAX" ]
}

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-sw-driver-timing.XXXXXX")"
trap "rm -rf '$WORKDIR'" EXIT

EXPENSIVE_DIR="$WORKDIR/expensive"
CHEAP_DIR="$WORKDIR/cheap"
MAINLINE_DIR="$WORKDIR/mainline"
NOACTORS_MAINLINE_DIR="$WORKDIR/noactors-mainline"
IDLE_DIR="$WORKDIR/idle"
BREAK_ARM_DIR="$WORKDIR/break-arm"
BREAK_NOSPAWN_DIR="$WORKDIR/break-nospawn"

run_one "unbroken, expensive-path" "$EXPENSIVE_DIR" --report=expensive
expensive_result=$?
if is_pass "$expensive_result"; then
  echo "sw_driver_timing (expensive-path): PASS -- exit $expensive_result, driver-span busy max ~$(decode_pass "$MARGIN_SCALE" "$expensive_result") cycles"
else
  echo "sw_driver_timing (expensive-path): FAIL -- exit $expensive_result (see sw_driver_timing.lua.template's own EXIT_* constants)"
  overall=1
fi

run_one "unbroken, cheap-path" "$CHEAP_DIR" --report=cheap
cheap_result=$?
if is_pass "$cheap_result"; then
  echo "sw_driver_timing (cheap-path): PASS -- exit $cheap_result, driver-span floor ~$(decode_pass "$MARGIN_SCALE" "$cheap_result") cycles"
else
  echo "sw_driver_timing (cheap-path): FAIL -- exit $cheap_result"
  overall=1
fi

run_one "unbroken, mainline-busy" "$MAINLINE_DIR" --report=mainline
mainline_result=$?
mainline_lo=$(decode_lo "$MAINLINE_MARGIN_SCALE" "$mainline_result")
if is_pass "$mainline_result"; then
  echo "sw_driver_timing (mainline-busy): PASS -- exit $mainline_result, mainline-span busy max ~$(decode_pass "$MAINLINE_MARGIN_SCALE" "$mainline_result") cycles"
else
  echo "sw_driver_timing (mainline-busy): FAIL -- exit $mainline_result"
  overall=1
fi

run_one "unbroken, mainline-busy, no actors (missing-workload control)" "$NOACTORS_MAINLINE_DIR" --report=mainline --no-actors
noactors_mainline_result=$?
noactors_mainline_lo=$(decode_lo "$MAINLINE_MARGIN_SCALE" "$noactors_mainline_result")
if is_pass "$noactors_mainline_result"; then
  echo "sw_driver_timing (mainline-busy, no actors): reports exit $noactors_mainline_result, mainline-span busy max ~$(decode_pass "$MAINLINE_MARGIN_SCALE" "$noactors_mainline_result") cycles"
  if is_pass "$mainline_result"; then
    mdelta=$((mainline_lo - noactors_mainline_lo))
    if [ "$mdelta" -ge "$MAINLINE_MISSING_WORKLOAD_MIN_DELTA" ]; then
      echo "sw_driver_timing (mainline missing-workload control): PASS -- real-actor floor $mainline_lo cyc exceeds no-actors floor $noactors_mainline_lo cyc by $mdelta (>= $MAINLINE_MISSING_WORKLOAD_MIN_DELTA)"
    else
      echo "sw_driver_timing (mainline missing-workload control): FAIL -- real-actor floor $mainline_lo cyc is not markedly larger than no-actors floor $noactors_mainline_lo cyc (delta $mdelta < $MAINLINE_MISSING_WORKLOAD_MIN_DELTA) -- the mainline metric would not catch a build silently carrying no entity workload"
      overall=1
    fi
  else
    echo "sw_driver_timing (mainline missing-workload control): FAIL -- the real-actor mainline build did not PASS, so no floor to compare against"
    overall=1
  fi
else
  echo "sw_driver_timing (mainline-busy, no actors): FAIL -- exit $noactors_mainline_result"
  overall=1
fi

run_one "unbroken, idle-only (extra-cost baseline)" "$IDLE_DIR" --idle-only
idle_result=$?
idle_lo=$(decode_lo "$IDLE_AVG_SCALE" "$idle_result")
if is_pass "$idle_result"; then
  echo "sw_driver_timing (idle-only baseline): reports exit $idle_result, idle-only average ~$(decode_pass "$IDLE_AVG_SCALE" "$idle_result") cycles/frame"
else
  echo "sw_driver_timing (idle-only baseline): FAIL -- exit $idle_result"
  overall=1
fi

run_one "broken(unconditional-arm), idle-only" "$BREAK_ARM_DIR" --break=unconditional-arm
broken_arm_result=$?
broken_arm_lo=$(decode_lo "$IDLE_AVG_SCALE" "$broken_arm_result")
if is_pass "$broken_arm_result"; then
  echo "sw_driver_timing (broken, idle-only): reports exit $broken_arm_result, idle-only average ~$(decode_pass "$IDLE_AVG_SCALE" "$broken_arm_result") cycles/frame"
  if is_pass "$idle_result"; then
    adelta=$((broken_arm_lo - idle_lo))
    if [ "$adelta" -ge "$EXTRA_COST_MIN_DELTA" ]; then
      echo "sw_driver_timing (extra-cost control): PASS -- broken idle-only average floor $broken_arm_lo cyc/frame exceeds unbroken idle-only average floor $idle_lo cyc/frame by $adelta (>= $EXTRA_COST_MIN_DELTA)"
    else
      echo "sw_driver_timing (extra-cost control): FAIL -- broken idle-only average floor $broken_arm_lo cyc/frame is not markedly larger than unbroken idle-only average floor $idle_lo cyc/frame (delta $adelta < $EXTRA_COST_MIN_DELTA) -- this harness would not catch an implementation paying the expensive arm path unconditionally"
      overall=1
    fi
  else
    echo "sw_driver_timing (extra-cost control): FAIL -- unbroken idle-only baseline did not PASS, so no baseline to compare against"
    overall=1
  fi
else
  echo "sw_driver_timing (broken, idle-only): FAIL -- exit $broken_arm_result (expected a PASS-range exit reporting a real, larger, forced-arm average cost)"
  overall=1
fi

run_one "broken(no-spawn)" "$BREAK_NOSPAWN_DIR" --break=no-spawn
nospawn_result=$?
if [ "$nospawn_result" = "$EXIT_NO_RESPAWN_EVIDENCE" ]; then
  echo "sw_driver_timing (respawn-evidence control): PASS -- broken(no-spawn) build correctly failed with EXIT_NO_RESPAWN_EVIDENCE ($EXIT_NO_RESPAWN_EVIDENCE): sw_col changed but ent_active never did"
else
  echo "sw_driver_timing (respawn-evidence control): FAIL -- broken(no-spawn) build exited $nospawn_result, expected exactly $EXIT_NO_RESPAWN_EVIDENCE -- this harness would not catch a crossing that moves sw_col but never spawns the new screen's entities"
  overall=1
fi

# Frame inequality: measured mainline-busy ceiling (this run's own upper
# bound, the pessimistic end of its bucket) + cited worst-NMI cycles against
# the NTSC frame budget. Independently bounded, not summed against a
# rollover-safe measurement of the same frame -- the mainline span and the
# NMI handler are measured by separate harnesses (this script and
# run_sw_nmi_check.sh) and never overlap in real execution (the NMI always
# runs after the mainline body hands off at main_loop_ready), so summing
# their independently-measured worst cases is the correct, conservative
# bound.
if is_pass "$mainline_result"; then
  mainline_hi=$(( (mainline_result - EXIT_PASS_BASE + 1) * MAINLINE_MARGIN_SCALE ))
  total=$((mainline_hi + WORST_NMI_CYCLES))
  margin=$((NTSC_FRAME_BUDGET - total))
  if [ "$margin" -ge 0 ]; then
    echo "sw_driver_timing (frame inequality): PASS -- mainline-busy ceiling $mainline_hi cyc + worst-NMI $WORST_NMI_CYCLES cyc = $total cyc <= $NTSC_FRAME_BUDGET cyc budget (margin $margin cyc)"
  else
    echo "sw_driver_timing (frame inequality): FAIL -- mainline-busy ceiling $mainline_hi cyc + worst-NMI $WORST_NMI_CYCLES cyc = $total cyc EXCEEDS the $NTSC_FRAME_BUDGET cyc NTSC frame budget by $((-margin)) cyc -- needs-ruling, not a ceiling this script may loosen"
    overall=1
  fi
else
  echo "sw_driver_timing (frame inequality): FAIL -- no PASS-range mainline-busy measurement to check the frame budget against"
  overall=1
fi

exit $overall
