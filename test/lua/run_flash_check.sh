#!/usr/bin/env bash
# Drives the two-invocation Mesen power cycle save_flash.lua proves UNROM
# 512's flash save against.
#
#   test/lua/run_flash_check.sh [mesen-path] [--break=<mode>]
#
# Builds the checked-in sample-u512/ fixture (test/lua/build_flash_roms.mjs)
# and copies its ROM out under a board-specific basename, clears any leftover
# .ips for exactly that name, then runs Mesen against it twice: once expecting
# EXIT_RUN1_OK (1, not a failure -- the first half of the power cycle), once
# expecting 0 (Continue restored everything run 1 saved).
#
# This depends on two settings in Mesen's own settings.json, confirmed on
# this machine during phase 2.5's step A and again from Mesen's own source
# during step B: Nes.DisableFlashSaves must be false (Mesen will not persist
# anything at all otherwise), and Preferences.OverwriteOriginalRom must be
# false -- BaseMapper::SaveRom only writes a `.ips` when that is false; set
# it true and Mesen rewrites the ROM file itself in place instead, which this
# script does not look for and would silently read as "no save was written."
# Both are the shipped defaults; this is stated here rather than checked,
# because there is no artifact-free way to check them from the outside that
# would not also be racing the same settings.json Mesen itself might still be
# writing.
#
# --break=<mode> builds one of the variants build_flash_roms.mjs knows about
# -- three real breaks and one positive control, "break" kept as the flag
# name because all four reuse the same build machinery (one engine-source
# patch table, one project-mutation switch):
#
#   u512-no-unlock       JEDEC unlock write dropped -- commit silently no-ops
#   u512-bad-cmd-addr    command byte misaddressed  -- same, no-op
#   u512-no-erase        sector erase removed -- corrupts on a *second* commit
#   u512-second-commit-ok  positive control: the saver's guard is stripped
#                           (so a second commit really happens) but the erase
#                           is left intact -- the counterpart no-erase needs to
#                           mean anything: without this, a wrong checksumOf()
#                           or bodyEqual() in save_flash.lua (off by one, wrong
#                           wrap, wrong offset) would make u512-no-erase report
#                           a mismatch and "pass" its control for a reason that
#                           has nothing to do with the missing erase. This is
#                           the case where the recomputed checksum is
#                           *required* to match, and save_flash.lua's own
#                           phase 4.4 is what actually takes that code path --
#                           nothing else does, on any build. Its signature
#                           (below) checks run 1 only, deliberately: a second
#                           real commit means two gems are actually given, and
#                           the page's guard is what normally stops Continue's
#                           own reload -- which lands the player mid-contact,
#                           see CLAUDE.md's note on spawn_entities re-arming
#                           the trigger during the load's own redraw -- from
#                           firing a third one. This build has no guard, so
#                           run 2 would trigger exactly that third commit and
#                           there is nothing wrong being demonstrated by it;
#                           it is just not this control's claim. What this
#                           control exists to prove is entirely a run-1
#                           question -- does phase 4.4 actually reach and
#                           pass its changed-and-matches branch -- so that is
#                           all it checks, and it checks it by requiring that
#                           branch's own exit code (EXIT_SECOND_COMMIT_OK,
#                           18), not EXIT_RUN1_OK (1). An earlier round of
#                           this file required only EXIT_RUN1_OK here, which
#                           the unchanged path *also* ends in -- so a retouch
#                           that silently stopped happening, or a guard
#                           relaxation that silently did not take, passed
#                           this control without the comparison it exists to
#                           prove ever running. Do not relax this back to 1.
#
# Each mode has an exact expected *signature*, asserted below rather than
# inferred from "the round trip failed somehow" -- the three real breaks
# expect a specific run-1 exit code and a specific .ips outcome, and the
# control expects its own specific run-1 exit code too, not merely "some
# passing-shaped result". This is deliberately stricter than "any nonzero
# exit is a pass for the control":
# phase 4.4 could stop running entirely -- a syntax error, a crash, a timeout
# -- and a merely-nonzero check would call that a successful negative control
# too. Asserting the *exact* code is what tells "the intended assertion
# fired" apart from "something else in the harness broke".
#
# Deliberately diverges from run_sram_check.sh's own --break mode, which
# prints its verdict and always exits 0: that script builds *two* boards
# while only one is broken, so a single mechanical exit code cannot say which
# board was supposed to fail without the script re-deriving the break-to-board
# mapping bash-side, and reading the per-board PASS/FAIL lines by eye is what
# it settled for instead. This script has no second board to be ambiguous
# about -- one board, every mode targets it, so the expected outcome is
# always exactly one signature. Do not "restore consistency" with
# run_sram_check.sh by reverting this to a printed line and an unconditional
# exit 0 -- that would silently accept a break that stopped being injected,
# one a future engine change made harmless, or the harness itself silently
# not asserting anything, as a passing run.
#
# Exit code: 0 if the observed result matches the expected signature for the
# given mode (no mode = a clean pass); 1 otherwise.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"
MODE=""
for a in "$@"; do
  case "$a" in
    --break=*) MODE="${a#--break=}" ;;
  esac
done

SAVES_DIR="$HOME/.config/Mesen2/Saves"
OUT_DIR="/tmp/nesforge-flash-roms"

if [ ! -x "$MESEN" ]; then
  echo "[run_flash_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

# The expected signature for each mode -- see the header comment for what
# each one means. EXPECT_KIND is one of:
#   pass          -- .ips present, run1 == 1 (EXIT_RUN1_OK), run2 == 0 (the
#                     ordinary round trip)
#   success-run1-only -- .ips present, run1 == EXPECT_RUN1 (run 2 is not run
#                     at all -- see u512-second-commit-ok's own header note
#                     on why). EXPECT_RUN1 here is EXIT_SECOND_COMMIT_OK (18),
#                     save_flash.lua's own phase 4.4 -- not EXIT_RUN1_OK (1):
#                     the unchanged path and the changed-and-matches path used
#                     to share EXIT_RUN1_OK, which let this control pass
#                     without its own comparison ever running (a retouch that
#                     silently stopped happening looks identical to one that
#                     ran and matched). Requiring the branch's own code is
#                     what closes that.
#   fail-no-ips   -- no .ips ever written, run1 == EXPECT_RUN1
#   fail-with-ips -- .ips present, run1 == EXPECT_RUN1 (run2 is not reached)
EXPECT_KIND="pass"
EXPECT_RUN1=""
case "$MODE" in
  "") ;;
  u512-second-commit-ok) EXPECT_KIND="success-run1-only"; EXPECT_RUN1=18 ;;
  u512-no-unlock|u512-bad-cmd-addr) EXPECT_KIND="fail-no-ips"; EXPECT_RUN1=5 ;;
  u512-no-erase) EXPECT_KIND="fail-with-ips"; EXPECT_RUN1=13 ;;
  *)
    echo "[run_flash_check] unknown --break mode: $MODE"
    exit 1
    ;;
esac

echo "[run_flash_check] building fixture${MODE:+ (--break=$MODE)}..."
node "$ROOT/test/lua/build_flash_roms.mjs" "$OUT_DIR" ${MODE:+--break=$MODE} || exit 1

rom="$OUT_DIR/flash_u512.nes"
ips="$SAVES_DIR/flash_u512.ips"
rm -f "$ips"

timeout 60 "$MESEN" --testRunner "$ROOT/test/lua/save_flash.lua" "$rom" >/dev/null 2>&1
run1=$?
ips_present="no"
[ -f "$ips" ] && ips_present="yes"

run2=""
if [ "$ips_present" = "yes" ] && [ "$EXPECT_KIND" != "success-run1-only" ]; then
  # Run 2 always matters for the pass case (it must also succeed) and costs
  # nothing to also run for a fail-with-ips mode whose run-1 code did not
  # come back as expected -- it fills in the printed signature below rather
  # than leaving "run2=n/a" on a result that already needs explaining.
  # success-run1-only is the one mode that must NOT run it -- see
  # u512-second-commit-ok's own header note for why a second invocation of
  # this particular build is not a thing this control claims to prove.
  timeout 60 "$MESEN" --testRunner "$ROOT/test/lua/save_flash.lua" "$rom" >/dev/null 2>&1
  run2=$?
fi

matched="no"
case "$EXPECT_KIND" in
  pass)
    [ "$ips_present" = "yes" ] && [ "$run1" = "1" ] && [ "$run2" = "0" ] && matched="yes"
    ;;
  success-run1-only)
    [ "$ips_present" = "yes" ] && [ "$run1" = "$EXPECT_RUN1" ] && matched="yes"
    ;;
  fail-no-ips)
    [ "$ips_present" = "no" ] && [ "$run1" = "$EXPECT_RUN1" ] && matched="yes"
    ;;
  fail-with-ips)
    [ "$ips_present" = "yes" ] && [ "$run1" = "$EXPECT_RUN1" ] && matched="yes"
    ;;
esac

label="${MODE:-<no mode>}"
if [ "$matched" = "yes" ]; then
  echo "u512 ($label): PASS -- matched expected signature $EXPECT_KIND (ips=$ips_present run1=$run1 run2=${run2:-n/a})"
  exit 0
fi
echo "u512 ($label): FAIL -- expected $EXPECT_KIND (run1=${EXPECT_RUN1:-n/a}), got ips=$ips_present run1=$run1 run2=${run2:-n/a} -- see save_flash.lua's EXIT_* constants"
exit 1
