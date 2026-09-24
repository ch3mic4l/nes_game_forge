#!/usr/bin/env bash
# Drives the Mesen (cycle-accurate) streamed-world DRIVER TIMING check --
# design-streamed-worlds.md's obligation 1 ("Driver specification and
# timing... Discharged by: the production driver measured in the real
# engine on UNROM 512 and the frame bound recomputed from it. The 660-cycle
# / 2.39% margin is PROVISIONAL until then."), fix round 2's own Finding
# D / ruling M (see sw_driver_timing.lua.template's own header for that
# story), fix round 1 (gates round-1, Task 1), which added five real
# entity workloads (a)-(e) baked into the ordinary busy walk plus their own
# negative controls, folded the row-axis/8-actor build (workload b) in as
# its own dedicated run, added two absolute regression ceilings, and
# corrected the frame inequality's NMI term (R5 orchestrator rulings); and
# fix round 2 (gates round-2), which strengthened three of those checks
# (workload (b)'s own eight-actor evidence, workload (e)'s mixed-vblank
# precondition, workload (d)'s in-bounds geometry), ported the review's own
# slow-driver regression control in-tree, added a live NMI measurement (both
# ordinary and --row8) to the frame inequality and gave it its own ceiling,
# and recalibrated EXPENSIVE_CEILING_CYCLES/MAINLINE_CEILING_CYCLES per
# Chris's 2026-09-24 ruling (see sw_driver_timing.lua.template's own header
# for the exact rule and measured figures).
#
#   test/lua/run_sw_driver_timing_check.sh [mesen-path]
#
# Builds and runs SEVENTEEN Mesen ROMs against the SAME 3x61 grid, landing at
# screen(1,58) -- an interior column, two rows from the tall edge -- with 8
# real chaser actors on the Right-crossing target and 4 on the Down-crossing
# target (build_sw_driver_timing_roms.mjs's own RIGHT_TARGET_ACTORS/
# DOWN_TARGET_ACTORS), plus fix round 1's own contact-damage npc and
# Shake/Flash/Sfx npc on those same two screens:
#   1. unbroken, --report=expensive (default)  -- the driver-span headline:
#      busy-phase max cost of a real ownership-crossing OR fresh busy-arm
#      frame. What obligation 1's own frame-bound arithmetic is recomputed
#      from.
#   2. unbroken, --report=cheap                -- the driver-span floor: no
#      crossing, no fresh arm, pooled across both phases. The harness itself
#      asserts (before ever reaching this script) that this is strictly
#      cheaper than #1 -- EXIT_WORKLOAD_NOT_CHEAPER otherwise.
#   3. unbroken, --report=mainline              -- the mainline-span
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
#      code -- review-s4b-round2-no-spawn.mjs's own finding, closed.
#   8. --row8                                    -- workload (b): 8 real
#      chasers on the ROW-axis (Down-crossing) target instead of the usual
#      4, exercising the row arm under the same real-actor AI cost #3 does
#      for the column arm. Its own mainline-busy max is folded into the
#      frame inequality below by taking the LARGER of #3 and this build's
#      own figure. Fix round 2: this build must now also show a real fresh
#      ROW arm on the Down-target screen with all eight ent_active slots
#      occupied (EXIT_NO_ROW8_EIGHT_ACTORS=16 otherwise).
#   9. --skip-contact                            -- workload (a) negative
#      control: the DOWN_TARGET contact-damage npc becomes a non-touching
#      chaser. Asserts EXIT_NO_CONTACT_DAMAGE (12): a real hurt_player call
#      (player_iframes 0 -> IFRAME_TIME) never observed.
#   10. --skip-release-fallback                  -- workload (c) negative
#      control: leg 1 holds Right only (Down is never held alongside it), so
#      the leg1->leg2 handoff is a fresh press, not a release-fallback.
#      Asserts EXIT_NO_RELEASE_FALLBACK (13): sw_axis_pref never flipped via
#      the release-fallback branch (a 0->1 flip with no fresh pad_new press).
#   11. --align-landing-y                        -- workload (d) negative
#      control: lands directly on LANDING_ROW and skips the pre_down phase
#      entirely, so win_row_local stays 0 (its landing-reset value) through
#      the whole walk instead of genuinely crossing into a misaligned row.
#      Asserts EXIT_NO_UNALIGNED_3SCREEN (14): no column arm's own entering
#      edge ever spanned three distinct in-bounds screen-rows.
#   12. --skip-shake-flash                       -- workload (e) negative
#      control: the RIGHT_TARGET touch npc's Shake+Flash+Sfx event (and its
#      'touch' trigger) is removed, leaving a plain non-interactive chaser.
#      Asserts EXIT_NO_VRAM_STRIP_COOCCURRENCE (15): the strengthened mixed-
#      vblank precondition (vram_ready~=0, 0<vram_len<=MIXED_VBLANK_MAX_BYTES,
#      st_active~=0) was never observed at a real NMI entry.
#   13. --row8-drop                              -- workload (b) negative
#      control (fix round 2, gates round-2 finding 1): keeps --row8's other
#      substitutions but forces the Down-target back to 4 actors. Asserts
#      EXIT_NO_ROW8_EIGHT_ACTORS (16): no fresh ROW arm with all eight
#      ent_active slots occupied was ever observed.
#   14. --break=offmap-column                    -- workload (d)'s own
#      off-map negative control (round-3 gate closure Task 1, gates round-3
#      finding 1): project.code.overrides forces sw_stream_start_col's own
#      saved entering column (sw_ss_sc) to 255 -- off the real grid -- through
#      the real off-map fill path. Asserts EXIT_NO_UNALIGNED_3SCREEN (14):
#      the strengthened bounds check now reads the actual entering column
#      (sw_ss_sc), not the window's own near-edge win_col_screen, which stays
#      in-bounds even when the real entering column is off-map.
#   15. --break=slow-driver                      -- the absolute-regression-
#      ceiling negative control (fix round 2, gates round-2 finding 5,
#      ported in-tree from the reviewer's own reproducer): a real
#      ~1,276-cycle delay loop at every real sw_update_player entry. Asserts
#      EXIT_EXPENSIVE_REGRESSION (8): the expensive-path absolute ceiling is
#      checked before the mainline one in sw_driver_timing.lua.template's
#      own finish(), so this is the exit code a real uniform-per-frame
#      regression trips first.
#   16/17. unbroken, --report=nmi (ordinary and --row8)  -- fix round 2,
#      gates round-2 finding 4: a LIVE NMI-span maximum measurement (the
#      existing "nmi" report metric, already computed by every build, just
#      not previously surfaced by this script), folded into the frame
#      inequality below and given its own absolute regression ceiling. Round-3
#      gate closure Task 2 (gates round-3 finding 2): the frame inequality now
#      REQUIRES both of these (and both mainline builds, #3/#8) to be live,
#      non-saturated PASS-range results before it is computed at all.
#
# A PASS (exit in [100,254]) reports the picked metric's own max/average
# cycles, decoded via the matching *_SCALE cycles/exit-code-step (see the
# template's own MARGIN_SCALE/MAINLINE_MARGIN_SCALE/IDLE_AVG_SCALE/
# NMI_MARGIN_SCALE). Exit 255 is the template's own saturation code (math.min
# clamp) -- it means the real cost is AT LEAST the top of the encodable
# range, not that it fits inside it, so this script treats it as a FAIL
# rather than a PASS: a saturated measurement asserts nothing about the
# actual cost.
#
# Ceilings (Chris ruling, 2026-09-24): EXPENSIVE_CEILING_CYCLES=19,200 /
# MAINLINE_CEILING_CYCLES=24,200 (sw_driver_timing.lua.template) are now
# RULED, not a placeholder awaiting a decision -- see the template's own
# header for the exact recalibration rule and measured figures. Every clean
# build (#1/#3/#8) is expected to PASS under these ceilings; an overrun is
# now reported as a genuine FAIL (this script no longer prints a
# "NEEDS-RULING" line or falls back to a cited historical figure to paper
# over a live measurement that failed -- fix round 2, gates round-2 finding
# 3). Only the in-tree slow-driver control (#15) is expected to trip a
# ceiling.
#
# Fix round 2, gates round-2 finding 3: every comparison this script prints
# as PASS must use LIVE, current-run measurements decoded from this run's
# own exit codes. If a needed measurement is unavailable (its own build/run
# did not report a live decodable figure), this script prints
# UNAVAILABLE/FAIL for that comparison and sets the overall exit nonzero --
# it never substitutes a historical constant to keep printing a PASS.
#
# Round-3 gate closure Task 2 (gates round-3 finding 2): the frame inequality
# below is computed ONLY when all four of its live inputs -- the ordinary and
# --row8 mainline-busy runs (#3/#8) AND the ordinary and --row8 NMI runs
# (#16/#17) -- are current-run, non-saturated PASS-range results; a single
# surviving mainline run with the other three broken is no longer enough to
# print a frame-inequality PASS. The one historical figure that legitimately
# still appears (the NMI term's own conservative 2,167-cycle floor, folded in
# per Chris's own ruling in fix round 2 task 4) is used as a conservative
# floor only when it exceeds the live-measured NMI maximum -- and that
# substitution is reported on its own line starting INFORMATIONAL, never
# folded into the frame-inequality PASS line's own arithmetic text.
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
EXIT_EXPENSIVE_REGRESSION=8
EXIT_MAINLINE_REGRESSION=9
EXIT_NO_CONTACT_DAMAGE=12
EXIT_NO_RELEASE_FALLBACK=13
EXIT_NO_UNALIGNED_3SCREEN=14
EXIT_NO_VRAM_STRIP_COOCCURRENCE=15
EXIT_NO_ROW8_EIGHT_ACTORS=16
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
# Fix round 2 (gates round-2, finding 4): must track sw_driver_timing.lua.
# template's own NMI_MARGIN_SCALE exactly, the same convention as the other
# *_SCALE constants above.
NMI_MARGIN_SCALE=20
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
# each bucket). Set below that. (Fix round 1 grew the real-actor mainline
# max further -- see the ceiling recalibration citation in the template's
# own header -- so this delta is now comfortably conservative, not tight.)
MAINLINE_MISSING_WORKLOAD_MIN_DELTA=600
# Frame inequality (mainline-busy ceiling + worst-NMI < NTSC frame budget).
#
# Round-3 gate closure (Task 1): the OLD 1,543 here was design-streamed-worlds.md ~2414's own
# jsnes CROSS-CHECK figure (diag_f18_streamed_nmi.mjs), not its authoritative one -- that same
# document says so directly, in the paragraph the evidence-table row itself footnotes (~1423-1434):
# "UNROM 512's own Mesen re-timing gives the tightest real margin recorded anywhere in this
# document: the mixed-vblank-at-35-bytes/reduced-chunk-2 scenario, 105.7 cyc of margin against the
# full 20-scanline (2,273-cycle) vblank window -- a derived worst NMI cost of 2,273 - 105.7 ~ 2,167
# cycles. An independent jsnes cross-check ... measures a lower 1,324-1,856 cycles across both
# boards and scenarios -- a known-shaped discrepancy ... the real, full-system Mesen figure is what
# this document treats as authoritative elsewhere and is used here too, as the conservative
# (larger-subtraction) choice." The wrapper here was citing the LOWER, non-authoritative number.
#
# That 2,167-cycle figure was measured against proto-tools/build_f11_mixed_vblank_fixture.mjs (a
# scratch tool, restored from an archived backup for that measurement round, no longer present in
# this repo -- out of this slice's own scope to recreate) exercising the mixed-vblank branch
# (engine/boot.asm's nmi_vram_dispatch, MIXED_VBLANK_MAX_BYTES=35) with camera+Shake+split live --
# exactly the "authored Shake/Flash sharing a frame with the streaming strip" coincidence this
# obligation needs bounded. Re-verified this round that the governing mechanism is still the SAME
# shipped code the figure was measured against (engine/boot.asm's nmi_vram_dispatch/nmi_drain_big/
# nmi_no_drain three-way dispatch is unchanged in shape; engine/constants.asm's own
# MIXED_VBLANK_MAX_BYTES is still exactly 35) -- by design, ANY single authored-command packet
# (Shake/Flash/Sfx/Say, each one real packet, <= 35 bytes) sharing a frame with an active strip is
# forced through this exact mixed branch (a bigger queue instead takes nmi_drain_big, which the
# engine "only ever builds while the world is frozen" -- i.e. never concurrently streaming), so this
# figure remains the correct bound for that coincidence today, not merely a historical one.
#
# Fix round 2 (gates round-2, finding 4): this figure is now used as an INFORMATIONAL floor only --
# the frame inequality below takes the LARGER of this and the two LIVE nmi-report measurements
# (ordinary and --row8, both real, this exact walk's own worst mixed-queue NMI), never this figure
# alone when a live measurement is available and larger.
WORST_NMI_CYCLES=2167
# Fix round 1 (gates round-1, Task 1), review finding (a)2: the nmi/nmi_rti exec-callback span
# (sw_driver_timing.lua.template's own NMI/NMI_RTI anchors) brackets register save/restore, OAM
# DMA, sw_nmi_stream, vram_drain and frame_cnt/vblank bookkeeping, but the callback at `nmi` fires
# AFTER the CPU's own 7-cycle interrupt-entry sequence, and the callback at `nmi_rti` fires BEFORE
# RTI's own 6 cycles execute -- so the measured span excludes both ends' real CPU-occupancy time.
# Add 13 (7 + 6) to the measured NMI term wherever it is used to bound real frame-budget occupancy.
NMI_ANCHOR_CYCLES=13
NTSC_FRAME_BUDGET=29780
# Fix round 2 (gates round-2, finding 4): NMI_MARGIN_SCALE's own absolute regression ceiling --
# same rule as EXPENSIVE_CEILING_CYCLES/MAINLINE_CEILING_CYCLES (sw_driver_timing.lua.template,
# Chris ruling 2026-09-24): take the larger clean upper bucket endpoint across the ordinary and
# --row8 builds, add 600 cycles, round up to the next 100. Clean measurement (review round 2, this
# exact 3x61/row-58 fixture): nmi-busy max ordinary 2,100-2,119 cyc, --row8 2,100-2,119 cyc (same
# bucket). ceil100(2,119+600)=2,800.
NMI_CEILING_CYCLES=2800

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

# report_ceiling_gated LABEL RESULT SCALE -> a decodable PASS-range code (the absolute ceiling not
# exceeded -- reports the real live decoded range) or a FAIL: either the ceiling's own
# EXIT_EXPENSIVE_REGRESSION/EXIT_MAINLINE_REGRESSION code (a real regression per Chris's 2026-09-24
# ceiling ruling -- not a needs-ruling state any more, fix round 2 gates round-2 finding 3), or any
# other exit (a genuine harness FAIL). Sets overall=1 on anything but a clean PASS.
report_ceiling_gated() {
  local label="$1" result="$2" scale="$3"
  if is_pass "$result"; then
    echo "sw_driver_timing ($label): PASS -- exit $result, max ~$(decode_pass "$scale" "$result") cycles"
  elif [ "$result" = "$EXIT_EXPENSIVE_REGRESSION" ] || [ "$result" = "$EXIT_MAINLINE_REGRESSION" ]; then
    echo "sw_driver_timing ($label): FAIL -- exit $result, exceeds the absolute regression ceiling (EXPENSIVE_CEILING_CYCLES/MAINLINE_CEILING_CYCLES, sw_driver_timing.lua.template -- ruled 2026-09-24, not retuned by this script)"
    overall=1
  else
    echo "sw_driver_timing ($label): FAIL -- exit $result (see sw_driver_timing.lua.template's own EXIT_* constants)"
    overall=1
  fi
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
ROW8_DIR="$WORKDIR/row8"
SKIP_CONTACT_DIR="$WORKDIR/skip-contact"
SKIP_RELEASE_FALLBACK_DIR="$WORKDIR/skip-release-fallback"
ALIGN_LANDING_Y_DIR="$WORKDIR/align-landing-y"
SKIP_SHAKE_FLASH_DIR="$WORKDIR/skip-shake-flash"
ROW8_DROP_DIR="$WORKDIR/row8-drop"
OFFMAP_COLUMN_DIR="$WORKDIR/offmap-column"
SLOW_DRIVER_DIR="$WORKDIR/slow-driver"
NMI_DIR="$WORKDIR/nmi"
ROW8_NMI_DIR="$WORKDIR/row8-nmi"

run_one "unbroken, expensive-path" "$EXPENSIVE_DIR" --report=expensive
expensive_result=$?
report_ceiling_gated "expensive-path" "$expensive_result" "$MARGIN_SCALE"

run_one "unbroken, cheap-path" "$CHEAP_DIR" --report=cheap
cheap_result=$?
# The cheap-path build still computes the SAME maxExpensiveCycles the expensive-ceiling check
# gates on (only the FINAL reported metric differs by --report), so it can ALSO now report
# EXIT_EXPENSIVE_REGRESSION -- the same condition #1 already surfaces, not a distinct cheap-path
# defect.
report_ceiling_gated "cheap-path" "$cheap_result" "$MARGIN_SCALE"

run_one "unbroken, mainline-busy" "$MAINLINE_DIR" --report=mainline
mainline_result=$?
mainline_lo=$(decode_lo "$MAINLINE_MARGIN_SCALE" "$mainline_result")
report_ceiling_gated "mainline-busy" "$mainline_result" "$MAINLINE_MARGIN_SCALE"

run_one "unbroken, mainline-busy, no actors (missing-workload control)" "$NOACTORS_MAINLINE_DIR" --report=mainline --no-actors
noactors_mainline_result=$?
noactors_mainline_lo=$(decode_lo "$MAINLINE_MARGIN_SCALE" "$noactors_mainline_result")
if is_pass "$noactors_mainline_result"; then
  echo "sw_driver_timing (mainline-busy, no actors): reports exit $noactors_mainline_result, mainline-span busy max ~$(decode_pass "$MAINLINE_MARGIN_SCALE" "$noactors_mainline_result") cycles"
  if is_pass "$mainline_result"; then
    mdelta=$((mainline_lo - noactors_mainline_lo))
    if [ "$mdelta" -ge "$MAINLINE_MISSING_WORKLOAD_MIN_DELTA" ]; then
      echo "sw_driver_timing (mainline missing-workload control): PASS -- real-actor floor exceeds no-actors floor $noactors_mainline_lo cyc by $mdelta (>= $MAINLINE_MISSING_WORKLOAD_MIN_DELTA)"
    else
      echo "sw_driver_timing (mainline missing-workload control): FAIL -- real-actor floor is not markedly larger than no-actors floor $noactors_mainline_lo cyc (delta $mdelta < $MAINLINE_MISSING_WORKLOAD_MIN_DELTA) -- the mainline metric would not catch a build silently carrying no entity workload"
      overall=1
    fi
  else
    # Fix round 2 (gates round-2, finding 3): a failed/unavailable live measurement is reported as
    # such, never papered over with a historical constant to keep printing a PASS.
    echo "sw_driver_timing (mainline missing-workload control): UNAVAILABLE -- the real-actor mainline-busy run (exit $mainline_result) did not report a live decodable measurement, so there is no current real-actor floor to compare against"
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

run_one "unbroken, row8 (workload (b): 8 real actors on the row-axis target)" "$ROW8_DIR" --row8 --report=mainline
row8_result=$?
report_ceiling_gated "row8 mainline-busy" "$row8_result" "$MAINLINE_MARGIN_SCALE"

run_one "workload (a) negative control, skip-contact" "$SKIP_CONTACT_DIR" --skip-contact
skip_contact_result=$?
if [ "$skip_contact_result" = "$EXIT_NO_CONTACT_DAMAGE" ]; then
  echo "sw_driver_timing (workload (a) negative control): PASS -- --skip-contact correctly failed with EXIT_NO_CONTACT_DAMAGE ($EXIT_NO_CONTACT_DAMAGE): player_iframes never went 0 -> IFRAME_TIME"
else
  echo "sw_driver_timing (workload (a) negative control): FAIL -- --skip-contact exited $skip_contact_result, expected exactly $EXIT_NO_CONTACT_DAMAGE -- this harness would not catch a build that dropped the contact-damage workload"
  overall=1
fi

run_one "workload (c) negative control, skip-release-fallback" "$SKIP_RELEASE_FALLBACK_DIR" --skip-release-fallback
skip_release_fallback_result=$?
if [ "$skip_release_fallback_result" = "$EXIT_NO_RELEASE_FALLBACK" ]; then
  echo "sw_driver_timing (workload (c) negative control): PASS -- --skip-release-fallback correctly failed with EXIT_NO_RELEASE_FALLBACK ($EXIT_NO_RELEASE_FALLBACK): sw_axis_pref never flipped via the release-fallback branch"
else
  echo "sw_driver_timing (workload (c) negative control): FAIL -- --skip-release-fallback exited $skip_release_fallback_result, expected exactly $EXIT_NO_RELEASE_FALLBACK -- this harness would not catch a build that dropped the release-fallback workload"
  overall=1
fi

run_one "workload (d) negative control, align-landing-y" "$ALIGN_LANDING_Y_DIR" --align-landing-y
align_landing_y_result=$?
if [ "$align_landing_y_result" = "$EXIT_NO_UNALIGNED_3SCREEN" ]; then
  echo "sw_driver_timing (workload (d) negative control): PASS -- --align-landing-y correctly failed with EXIT_NO_UNALIGNED_3SCREEN ($EXIT_NO_UNALIGNED_3SCREEN): no column arm's own entering edge ever spanned three distinct in-bounds screen-rows"
else
  echo "sw_driver_timing (workload (d) negative control): FAIL -- --align-landing-y exited $align_landing_y_result, expected exactly $EXIT_NO_UNALIGNED_3SCREEN -- this harness would not catch a build that dropped the unaligned-3-screen workload"
  overall=1
fi

run_one "workload (e) negative control, skip-shake-flash" "$SKIP_SHAKE_FLASH_DIR" --skip-shake-flash
skip_shake_flash_result=$?
if [ "$skip_shake_flash_result" = "$EXIT_NO_VRAM_STRIP_COOCCURRENCE" ]; then
  echo "sw_driver_timing (workload (e) negative control): PASS -- --skip-shake-flash correctly failed with EXIT_NO_VRAM_STRIP_COOCCURRENCE ($EXIT_NO_VRAM_STRIP_COOCCURRENCE): the mixed-vblank precondition (vram_ready~=0, 0<vram_len<=MIXED_VBLANK_MAX_BYTES, st_active~=0) was never observed at a real NMI entry"
else
  echo "sw_driver_timing (workload (e) negative control): FAIL -- --skip-shake-flash exited $skip_shake_flash_result, expected exactly $EXIT_NO_VRAM_STRIP_COOCCURRENCE -- this harness would not catch a build that dropped the Shake/Flash/Sfx-vs-active-strip workload"
  overall=1
fi

run_one "workload (b) negative control, row8-drop" "$ROW8_DROP_DIR" --row8-drop
row8_drop_result=$?
if [ "$row8_drop_result" = "$EXIT_NO_ROW8_EIGHT_ACTORS" ]; then
  echo "sw_driver_timing (workload (b) negative control): PASS -- --row8-drop correctly failed with EXIT_NO_ROW8_EIGHT_ACTORS ($EXIT_NO_ROW8_EIGHT_ACTORS): no fresh ROW arm on the Down-target screen was ever observed with all eight ent_active slots occupied"
else
  echo "sw_driver_timing (workload (b) negative control): FAIL -- --row8-drop exited $row8_drop_result, expected exactly $EXIT_NO_ROW8_EIGHT_ACTORS -- this harness would not catch a build that dropped the eight-actor row-arm workload"
  overall=1
fi

run_one "workload (d) negative control, offmap-column" "$OFFMAP_COLUMN_DIR" --break=offmap-column
offmap_column_result=$?
if [ "$offmap_column_result" = "$EXIT_NO_UNALIGNED_3SCREEN" ]; then
  echo "sw_driver_timing (workload (d) off-map negative control): PASS -- --break=offmap-column correctly failed with EXIT_NO_UNALIGNED_3SCREEN ($EXIT_NO_UNALIGNED_3SCREEN): the real off-map entering column (sw_ss_sc forced to 255 through the real fill path) was correctly rejected"
else
  echo "sw_driver_timing (workload (d) off-map negative control): FAIL -- --break=offmap-column exited $offmap_column_result, expected exactly $EXIT_NO_UNALIGNED_3SCREEN -- this harness would not catch a build whose entering column genuinely walked off the grid"
  overall=1
fi

run_one "broken(slow-driver) regression control" "$SLOW_DRIVER_DIR" --break=slow-driver
slow_driver_result=$?
if [ "$slow_driver_result" = "$EXIT_EXPENSIVE_REGRESSION" ]; then
  echo "sw_driver_timing (slow-driver regression control): PASS -- --break=slow-driver correctly failed with EXIT_EXPENSIVE_REGRESSION ($EXIT_EXPENSIVE_REGRESSION): the ~1,276-cycle per-frame delay loop exceeded the expensive-path absolute ceiling (checked before the mainline one)"
else
  echo "sw_driver_timing (slow-driver regression control): FAIL -- --break=slow-driver exited $slow_driver_result, expected exactly $EXIT_EXPENSIVE_REGRESSION -- this harness's absolute regression ceilings would not catch a real uniform per-frame cost regression"
  overall=1
fi

run_one "unbroken, nmi" "$NMI_DIR" --report=nmi
nmi_result=$?
if is_pass "$nmi_result"; then
  nmi_hi=$(( (nmi_result - EXIT_PASS_BASE + 1) * NMI_MARGIN_SCALE ))
  echo "sw_driver_timing (nmi, ordinary): PASS -- exit $nmi_result, max ~$(decode_pass "$NMI_MARGIN_SCALE" "$nmi_result") cycles"
  if [ "$nmi_hi" -gt "$NMI_CEILING_CYCLES" ]; then
    echo "sw_driver_timing (nmi ceiling, ordinary): FAIL -- max upper bound $nmi_hi cyc exceeds the absolute regression ceiling $NMI_CEILING_CYCLES cyc"
    overall=1
  fi
else
  echo "sw_driver_timing (nmi, ordinary): FAIL -- exit $nmi_result"
  overall=1
fi

run_one "unbroken, row8, nmi" "$ROW8_NMI_DIR" --row8 --report=nmi
row8_nmi_result=$?
if is_pass "$row8_nmi_result"; then
  row8_nmi_hi=$(( (row8_nmi_result - EXIT_PASS_BASE + 1) * NMI_MARGIN_SCALE ))
  echo "sw_driver_timing (nmi, row8): PASS -- exit $row8_nmi_result, max ~$(decode_pass "$NMI_MARGIN_SCALE" "$row8_nmi_result") cycles"
  if [ "$row8_nmi_hi" -gt "$NMI_CEILING_CYCLES" ]; then
    echo "sw_driver_timing (nmi ceiling, row8): FAIL -- max upper bound $row8_nmi_hi cyc exceeds the absolute regression ceiling $NMI_CEILING_CYCLES cyc"
    overall=1
  fi
else
  echo "sw_driver_timing (nmi, row8): FAIL -- exit $row8_nmi_result"
  overall=1
fi

# Frame inequality: measured mainline-busy ceiling (the larger of the ordinary and --row8 builds'
# own LIVE upper bounds) + the NMI term (the larger of the two LIVE NMI upper bounds and the
# historical 2,167-cycle figure, informational only -- see WORST_NMI_CYCLES's own comment above) +
# the anchor-convention adjustment, against the NTSC frame budget. Independently bounded, not summed
# against a rollover-safe measurement of the same frame -- the mainline span and the NMI handler are
# measured by separate harnesses and never overlap in real execution (the NMI always runs after the
# mainline body hands off at main_loop_ready), so summing their independently-measured worst cases
# is the correct, conservative bound.
#
# Round-3 gate closure Task 2 (gates round-3 finding 2): ALL FOUR live inputs -- ordinary mainline,
# --row8 mainline, ordinary NMI, --row8 NMI -- must each be a current-run, non-saturated PASS-range
# result before this comparison is computed at all. A single surviving mainline run (with the other
# three broken) is not enough: it cannot by itself bound the OTHER mainline arm's own cost, nor
# either live NMI term, so it must not silently pass this comparison alone.
missing_frame_inputs=""
if ! is_pass "$mainline_result"; then missing_frame_inputs="$missing_frame_inputs ordinary-mainline(exit $mainline_result)"; fi
if ! is_pass "$row8_result"; then missing_frame_inputs="$missing_frame_inputs row8-mainline(exit $row8_result)"; fi
if ! is_pass "$nmi_result"; then missing_frame_inputs="$missing_frame_inputs ordinary-nmi(exit $nmi_result)"; fi
if ! is_pass "$row8_nmi_result"; then missing_frame_inputs="$missing_frame_inputs row8-nmi(exit $row8_nmi_result)"; fi

if [ -n "$missing_frame_inputs" ]; then
  echo "sw_driver_timing (frame inequality): UNAVAILABLE --$missing_frame_inputs did not produce a live, non-saturated, current-run PASS-range measurement, so the frame inequality cannot be computed from current data"
  overall=1
else
  mainline_ordinary_hi=$(( (mainline_result - EXIT_PASS_BASE + 1) * MAINLINE_MARGIN_SCALE ))
  mainline_row8_hi=$(( (row8_result - EXIT_PASS_BASE + 1) * MAINLINE_MARGIN_SCALE ))
  mainline_hi=$mainline_ordinary_hi
  if [ "$mainline_row8_hi" -gt "$mainline_hi" ]; then
    mainline_hi=$mainline_row8_hi
  fi

  nmi_live_ordinary_hi=$(( (nmi_result - EXIT_PASS_BASE + 1) * NMI_MARGIN_SCALE ))
  nmi_live_row8_hi=$(( (row8_nmi_result - EXIT_PASS_BASE + 1) * NMI_MARGIN_SCALE ))
  nmi_live_hi=$nmi_live_ordinary_hi
  if [ "$nmi_live_row8_hi" -gt "$nmi_live_hi" ]; then
    nmi_live_hi=$nmi_live_row8_hi
  fi

  nmi_term=$nmi_live_hi
  if [ "$WORST_NMI_CYCLES" -gt "$nmi_term" ]; then
    nmi_term=$WORST_NMI_CYCLES
    echo "sw_driver_timing (frame inequality, NMI term): INFORMATIONAL -- historical $WORST_NMI_CYCLES cyc (design-streamed-worlds.md's own cited UNROM 512 mixed-vblank figure) exceeds the live-measured max $nmi_live_hi cyc (ordinary $nmi_live_ordinary_hi, row8 $nmi_live_row8_hi), so the historical figure is used as the conservative NMI term below"
  fi

  total=$((mainline_hi + nmi_term + NMI_ANCHOR_CYCLES))
  margin=$((NTSC_FRAME_BUDGET - total))
  if [ "$margin" -ge 0 ]; then
    echo "sw_driver_timing (frame inequality): PASS -- mainline-busy ceiling $mainline_hi cyc (live, max of ordinary $mainline_ordinary_hi/row8 $mainline_row8_hi) + NMI term $nmi_term cyc + anchor-convention $NMI_ANCHOR_CYCLES cyc = $total cyc <= $NTSC_FRAME_BUDGET cyc budget (margin $margin cyc)"
  else
    echo "sw_driver_timing (frame inequality): FAIL -- mainline-busy ceiling $mainline_hi cyc (live, max of ordinary $mainline_ordinary_hi/row8 $mainline_row8_hi) + NMI term $nmi_term cyc + anchor-convention $NMI_ANCHOR_CYCLES cyc = $total cyc EXCEEDS the $NTSC_FRAME_BUDGET cyc NTSC frame budget by $((-margin)) cyc"
    overall=1
  fi
fi

exit $overall
