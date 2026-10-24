#!/usr/bin/env bash
# Drives the two-invocation Mesen power cycle save_sram.lua proves the save
# feature against, for all three battery-save fixtures: mmc1, mmc3 (both
# action projects) and rpg-mmc1 (an RPG on MMC1 -- see
# docs/design-rpg-save-fixture.md for what it proves that the first two
# cannot).
#
#   test/lua/run_sram_check.sh [mesen-path] [--break=<mode>]
#
# Builds the checked-in sample-mmc1/, sample-mmc3/ and sample-rpg-mmc1/
# fixtures and copies each ROM out under a board-specific basename
# (test/lua/build_sram_roms.mjs -- Mesen persists SRAM to a .sav named after
# the ROM's own basename, and all three fixtures build as "game.nes", which
# would otherwise share one save slot), clears any leftover .sav for exactly
# that name, then runs Mesen against it twice: once expecting EXIT_RUN1_OK (1,
# not a failure -- the first half of the power cycle), once expecting 0
# (Continue restored everything run 1 saved).
#
# --break=mmc3-a001 | mmc1-disable | mmc1-restore-disable | mmc3-no-write
# builds with the register sequence under test deliberately broken, for a
# negative-control run. Every board is still built and run, but only the
# board(s) the break actually targets are expected to fail -- mmc1-disable
# patches engine/banks.asm's shared switch_prg_bank unconditionally, so it
# makes BOTH MMC1 boards (mmc1 and rpg-mmc1) fail, not just one; RPG-only
# mmc1-restore-disable only takes WRAM away once the last call_battle entry
# point was BE_RESTORE, so it targets rpg-mmc1 alone (run2=13,
# EXIT_WRAM_LOST_AFTER_RESTORE) and leaves mmc1/mmc3 passing -- see
# test/lua/build_sram_roms.mjs's own header for the full mechanism. Either way
# a break run's own pass/fail line is read by eye rather than by exit code --
# the script prints what it saw and exits 0 either way in that mode.
#
# --break=equip-omit (the omitted-serialization control, review R5) is different: it is judged by exit code. The two equipment boards
# (rpg-mmc1-equip, rpg-mmc3-equip) are built with a save record that keeps its length, identity and a valid checksum but never
# serialized pc_equip, so Continue accepts it and restores. The judge names the wrong worn id twice, both by exact id: run 1 reads
# the record off the chip (run1=7, EXIT_STATE_WRONG_BEFORE_CYCLE, "pc_equip[0] on the chip is 0, expected 1") and run 2 -- which still
# runs, because the envelope and checksum are valid, and reaches restore -- reports run2=10 (EXIT_RESTORED_STATE_WRONG,
# "pc_equip[0] restored as 255, expected 1": the sanitizer emptied the zero ids) on exactly those two boards, and the other three boards must still pass. Exit 0 iff all of that holds.
#
# Exit code (no --break): 0 if every board's round trip passed, 1 otherwise.
# Prints a pass/fail line per board with the exit codes seen either way, and then one machine-readable line per board,
# "SIG <board> run1=<exit|-> run2=<exit|-> sav=<yes|no>": the exact run codes and whether Mesen persisted a .sav ("-" = that run
# did not happen). The break modes exit 0 whatever they print, so a driver (the farm's job.sh) judges them by comparing the whole set
# of SIG lines with the one signature the mode must produce -- every targeted board's exact codes AND every unaffected board's explicit
# (1,0) pass -- rather than by exit code or by which boards printed FAIL.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$ROOT/test/lua/mesen_lib.sh"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"
BREAK_ARG=""
for a in "$@"; do
  case "$a" in
    --break=*) BREAK_ARG="$a" ;;
  esac
done

SAVES_DIR="$HOME/.config/Mesen2/Saves"
OUT_DIR="/tmp/nesforge-sram-roms"

if [ ! -x "$MESEN" ]; then
  echo "[run_sram_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

echo "[run_sram_check] building fixtures${BREAK_ARG:+ ($BREAK_ARG)}..."
node "$ROOT/test/lua/build_sram_roms.mjs" "$OUT_DIR" $BREAK_ARG || exit 1

overall=0
sigs=""
for key in mmc1 mmc3 rpg-mmc1 rpg-mmc1-equip rpg-mmc3-equip; do
  rom="$OUT_DIR/sram_${key}.nes"
  sav="$SAVES_DIR/sram_${key}.sav"
  rm -f "$sav"

  mesen_run 60 "$MESEN" "$ROOT/test/lua/save_sram.lua" "$rom"
  run1=$?

  if [ ! -f "$sav" ]; then
    echo "$key: FAIL -- no .sav written after run 1 (exit $run1) -- battery bit or Mesen persistence problem"
    sigs="$sigs
SIG $key run1=$run1 run2=- sav=no"
    overall=1
    continue
  fi

  mesen_run 60 "$MESEN" "$ROOT/test/lua/save_sram.lua" "$rom"
  run2=$?
  sigs="$sigs
SIG $key run1=$run1 run2=$run2 sav=yes"

  if [ "$BREAK_ARG" = "--break=equip-omit" ] && [ "${key%-equip}" != "$key" ]; then
    if [ "$run1" = "7" ] && [ "$run2" = "10" ]; then
      echo "$key: PASS -- the omitted equipment payload was caught (run1=$run1 EXIT_STATE_WRONG_BEFORE_CYCLE, run2=$run2 EXIT_RESTORED_STATE_WRONG)"
    else
      echo "$key: FAIL -- expected run1=7 run2=10 under equip-omit, got run1=$run1 run2=$run2"
      overall=1
    fi
  elif [ "$run1" = "1" ] && [ "$run2" = "0" ]; then
    echo "$key: PASS (run1=$run1 run2=$run2)"
  else
    echo "$key: FAIL (run1=$run1 run2=$run2) -- see save_sram.lua's EXIT_* constants"
    overall=1
  fi
done

echo "${sigs#
}"

if [ "$BREAK_ARG" = "--break=equip-omit" ]; then
  exit $overall
fi

if [ -n "$BREAK_ARG" ]; then
  echo "[run_sram_check] negative control ($BREAK_ARG): a FAIL on the targeted board is the expected result"
  exit 0
fi

exit $overall
