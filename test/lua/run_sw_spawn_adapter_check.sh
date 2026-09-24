#!/usr/bin/env bash
# Drives the Mesen (cycle-accurate) streamed-world SPAWN ADAPTER check --
# design-streamed-worlds.md's obligation 2 ("Spawn adapter bound... The
# 44-cycle charge covers one metadata byte, but the streamed metadata is 73
# bytes read by spawn_entities. Discharged by: bounding the complete
# adapter (pointer rebasing or actual accessor count, page crossings) and
# recomputing the crossing case.").
#
#   test/lua/run_sw_spawn_adapter_check.sh [mesen-path]
#
# Builds and runs TWO ROMs through sw_spawn_adapter.lua.template's own
# single-shot cold-boot measurement (spawn_entities entry to build_oam
# entry, the very next jsr on the real cold-boot streamed-landing path,
# engine/boot.asm:121-122):
#   --actors=8: the landing screen's full MAX_ENTITIES complement, one with
#     trigger=enter (arm_event included). The entity block (offsets 241-312,
#     shared/streamlayout.js) crosses the 8-bit Y register's own 256-byte
#     wrap partway through actor index 1 -- sw_adv_offset's page-crossing
#     carry branch is taken for real, without special engineering. The
#     worst real case (every slot filled), reported as the headline figure.
#   --actors=1: one actor, entity block stays under offset 256, the carry
#     branch never taken -- the missing-workload negative control (ruling
#     4): this must be markedly cheaper than the 8-actor measurement.
# Real measurement (2026-09-23, fix round 2/ruling M, re-confirmed under the
# corrected clock-based method): 8-actor 2,940-2,999 cyc, 1-actor 600-659
# cyc -- at least a ~2,280-cycle (~4.6x) gap.
#
# Fix round 2 (finding D/ruling M): each run's own PASS-range exit code
# ALREADY proves two evidence checks the template enforces before ever
# encoding the exit -- a non-PASS exit here means one of them failed, not
# merely "the cost changed":
#   * carry-branch EXECUTION evidence (EXIT_CARRY_MISMATCH=4) -- the new
#     sw_adv_offset_carry label (engine/streamworld.asm) fired for the
#     8-actor build and did NOT fire for the 1-actor build, proven by a
#     dedicated exec breakpoint on the branch's own target, not inferred
#     from the byte-count math alone.
#   * spawn-CONTENTS evidence (EXIT_NO_SPAWN_CONTENTS=5) -- ent_active's own
#     sum after the span landed at exactly the real actor count baked into
#     each build, not merely "changed" (the same gap
#     review-s4b-round2-no-spawn.mjs found in sw_driver_timing's own
#     pre-fix-round-2 shape).
#   * spawn-CONTENT evidence (EXIT_SPAWN_CONTENT_MISMATCH=6, round-3 gate
#     closure): every active slot's own actor id/x/y/trigger bipartite-
#     matches EXPECTED_ACTORS -- distinct ids/coordinates/event fields, not
#     only the slot count.
#
# Extra-cost control (gates round-1 finding 3/ruling R3): --break=extra-cost
# (build_sw_spawn_adapter_roms.mjs) inserts three balanced `inc <mtptr_hi` /
# `dec <mtptr_hi` pairs before the real `iny` in every sw_adv_offset call --
# semantics-preserving, but real extra cost on all 72 calls the 8-actor
# build makes. This script builds --actors=8 --break=extra-cost and asserts
# its measured cost exceeds the plain --actors=8 build's own cost by at
# least EXTRA_COST_MIN_DELTA cycles. sw_adv_offset's own page-crossing
# branch (`bne`, engine/streamworld.asm:196-198) is a real conditional
# branch, not unconditional -- see sw_spawn_adapter.lua.template's own
# header for the full reasoning.
#
# Exit code: 0 if both plain runs passed (carry-branch AND spawn-contents
# evidence both held), the 8-actor measurement was markedly larger than the
# 1-actor one, and the extra-cost control's own delta cleared its floor;
# 1 otherwise.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"

if [ ! -x "$MESEN" ]; then
  echo "[run_sw_spawn_adapter_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

EXIT_PASS_BASE=100
# Exit 255 is the template's own saturation code (math.min clamp,
# sw_spawn_adapter.lua.template) -- it means the real cost is AT LEAST the
# top of the encodable range, not that it fits inside it. Fix round 1
# (finding 5/ruling E) treats it as a FAIL, not a PASS, below: a saturated
# measurement asserts nothing about the actual cost.
EXIT_PASS_MAX=255
EXIT_CARRY_MISMATCH=4
EXIT_NO_SPAWN_CONTENTS=5
EXIT_SPAWN_CONTENT_MISMATCH=6
MARGIN_SCALE=60
# The 8-actor-vs-1-actor delta must clear this many cycles to count as "markedly larger" -- real
# measurement (2026-09-23): a 2,315-cycle (~4.6x) gap. Set well below that real gap so a genuine
# regression (not just this exact fixture's own numbers moving slightly) still trips it.
MIN_DELTA=1000
# The extra-cost control's own broken-vs-baseline delta must clear this many cycles. Real
# measurement (2026-09-23, this exact 3x2/screen(1,0) fixture): unbroken 8-actor floor 2,940 cyc,
# broken(extra-cost) floor 5,100 cyc -- a 2,160-cycle gap (three balanced inc/dec pairs x 72 real
# sw_adv_offset calls). Set well below that real gap so a genuine regression still trips it without
# chasing this exact fixture's own bucket noise.
EXTRA_COST_MIN_DELTA=1000

overall=0

run_one() {
  local label="$1"
  local out_dir="$2"
  shift 2
  echo "[run_sw_spawn_adapter_check] building $label ($*)..."
  if ! node "$ROOT/test/lua/build_sw_spawn_adapter_roms.mjs" "$out_dir" "$@"; then
    echo "sw_spawn_adapter ($label): FAIL -- build_sw_spawn_adapter_roms.mjs did not succeed"
    overall=1
    return 1
  fi
  local rom="$out_dir/sw_spawn_adapter.nes"
  local lua="$out_dir/sw_spawn_adapter.lua"
  timeout 30 "$MESEN" --testRunner "$lua" "$rom" >/dev/null 2>&1
  return $?
}

decode_fail() {
  local result="$1"
  case "$result" in
    "$EXIT_CARRY_MISMATCH") echo " -- EXIT_CARRY_MISMATCH: sw_adv_offset_carry's own firing did not match this build's real actor count" ;;
    "$EXIT_NO_SPAWN_CONTENTS") echo " -- EXIT_NO_SPAWN_CONTENTS: ent_active's own sum after the span did not equal this build's real actor count" ;;
    "$EXIT_SPAWN_CONTENT_MISMATCH") echo " -- EXIT_SPAWN_CONTENT_MISMATCH: an active slot's own actor id/x/y/trigger did not bipartite-match EXPECTED_ACTORS" ;;
    *) echo "" ;;
  esac
}

decode_pass() {
  local result="$1"
  local steps=$((result - EXIT_PASS_BASE))
  local lo=$((steps * MARGIN_SCALE))
  if [ "$result" = "$EXIT_PASS_MAX" ]; then
    echo "${lo}+ (saturated -- raise MARGIN_SCALE in sw_spawn_adapter.lua.template if this happens on a real run)"
  else
    local hi=$(((steps + 1) * MARGIN_SCALE))
    echo "${lo}-$((hi - 1))"
  fi
}

EIGHT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-sw-spawn-8.XXXXXX")"
ONE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-sw-spawn-1.XXXXXX")"
EXTRACOST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-sw-spawn-extracost.XXXXXX")"
trap "rm -rf '$EIGHT_DIR' '$ONE_DIR' '$EXTRACOST_DIR'" EXIT

run_one "8-actor (crossing)" "$EIGHT_DIR" --actors=8
eight_result=$?
run_one "1-actor (no crossing)" "$ONE_DIR" --actors=1
one_result=$?
run_one "8-actor, broken(extra-cost)" "$EXTRACOST_DIR" --actors=8 --break=extra-cost
extracost_result=$?

if [ "$eight_result" -ge "$EXIT_PASS_BASE" ] && [ "$eight_result" -lt "$EXIT_PASS_MAX" ]; then
  echo "sw_spawn_adapter (8-actor): PASS -- exit $eight_result, ~$(decode_pass "$eight_result") cycles (carry-branch + spawn-contents evidence both held)"
else
  echo "sw_spawn_adapter (8-actor): FAIL -- exit $eight_result$(decode_fail "$eight_result") (see sw_spawn_adapter.lua.template's own EXIT_* constants)"
  overall=1
fi

if [ "$one_result" -ge "$EXIT_PASS_BASE" ] && [ "$one_result" -lt "$EXIT_PASS_MAX" ]; then
  echo "sw_spawn_adapter (1-actor): PASS -- exit $one_result, ~$(decode_pass "$one_result") cycles (carry-branch + spawn-contents evidence both held)"
else
  echo "sw_spawn_adapter (1-actor): FAIL -- exit $one_result$(decode_fail "$one_result")"
  overall=1
fi

if [ "$eight_result" -ge "$EXIT_PASS_BASE" ] && [ "$eight_result" -lt "$EXIT_PASS_MAX" ] \
  && [ "$one_result" -ge "$EXIT_PASS_BASE" ] && [ "$one_result" -lt "$EXIT_PASS_MAX" ]; then
  eight_lo=$(( (eight_result - EXIT_PASS_BASE) * MARGIN_SCALE ))
  one_lo=$(( (one_result - EXIT_PASS_BASE) * MARGIN_SCALE ))
  delta=$((eight_lo - one_lo))
  if [ "$delta" -ge "$MIN_DELTA" ]; then
    echo "sw_spawn_adapter (missing-workload control): PASS -- 8-actor floor $eight_lo cyc exceeds 1-actor floor $one_lo cyc by $delta (>= $MIN_DELTA)"
  else
    echo "sw_spawn_adapter (missing-workload control): FAIL -- 8-actor floor $eight_lo cyc is not markedly larger than 1-actor floor $one_lo cyc (delta $delta < $MIN_DELTA)"
    overall=1
  fi
else
  echo "sw_spawn_adapter (missing-workload control): FAIL -- one or both runs did not PASS"
  overall=1
fi

# Extra-cost control (gates round-1 finding 3/ruling R3): the broken(extra-cost) build must still
# PASS every evidence check (carry-branch, spawn-contents, spawn-CONTENT) -- a PASS-range exit here
# already proves the mutation is semantics-preserving (see sw_spawn_adapter.lua.template's own
# header) -- and its own measured cost must exceed the plain 8-actor build's cost by a floor.
if [ "$extracost_result" -ge "$EXIT_PASS_BASE" ] && [ "$extracost_result" -lt "$EXIT_PASS_MAX" ]; then
  echo "sw_spawn_adapter (8-actor, broken(extra-cost)): reports exit $extracost_result, ~$(decode_pass "$extracost_result") cycles (carry-branch + spawn-contents + spawn-content evidence all held -- semantics preserved)"
  if [ "$eight_result" -ge "$EXIT_PASS_BASE" ] && [ "$eight_result" -lt "$EXIT_PASS_MAX" ]; then
    eight_lo=$(( (eight_result - EXIT_PASS_BASE) * MARGIN_SCALE ))
    extracost_lo=$(( (extracost_result - EXIT_PASS_BASE) * MARGIN_SCALE ))
    edelta=$((extracost_lo - eight_lo))
    if [ "$edelta" -ge "$EXTRA_COST_MIN_DELTA" ]; then
      echo "sw_spawn_adapter (extra-cost control): PASS -- broken(extra-cost) floor $extracost_lo cyc exceeds unbroken 8-actor floor $eight_lo cyc by $edelta (>= $EXTRA_COST_MIN_DELTA)"
    else
      echo "sw_spawn_adapter (extra-cost control): FAIL -- broken(extra-cost) floor $extracost_lo cyc is not markedly larger than unbroken 8-actor floor $eight_lo cyc (delta $edelta < $EXTRA_COST_MIN_DELTA) -- this harness would not catch an sw_adv_offset regression"
      overall=1
    fi
  else
    echo "sw_spawn_adapter (extra-cost control): FAIL -- the unbroken 8-actor build did not PASS, so no baseline to compare against"
    overall=1
  fi
else
  echo "sw_spawn_adapter (8-actor, broken(extra-cost)): FAIL -- exit $extracost_result$(decode_fail "$extracost_result") -- the mutation was expected to be semantics-preserving (same carry-branch/spawn-contents/spawn-content evidence as the unbroken 8-actor build), only more expensive"
  overall=1
fi

exit $overall
