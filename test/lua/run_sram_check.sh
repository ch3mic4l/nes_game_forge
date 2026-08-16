#!/usr/bin/env bash
# Drives the two-invocation Mesen power cycle save_sram.lua proves the save
# feature against, for both battery-capable boards.
#
#   test/lua/run_sram_check.sh [mesen-path] [--break=<mode>]
#
# Builds the checked-in sample-mmc1/ and sample-mmc3/ fixtures and copies each
# ROM out under a board-specific basename (test/lua/build_sram_roms.mjs --
# Mesen persists SRAM to a .sav named after the ROM's own basename, and both
# fixtures build as "game.nes", which would otherwise share one save slot),
# clears any leftover .sav for exactly that name, then runs Mesen against it
# twice: once expecting EXIT_RUN1_OK (1, not a failure -- the first half of the
# power cycle), once expecting 0 (Continue restored everything run 1 saved).
#
# --break=mmc3-a001 | mmc1-disable | mmc3-no-write builds with the register
# sequence under test deliberately broken, for a negative-control run. Both
# boards are still built and run, but only the broken board is expected to
# fail, so a break run's own pass/fail line is read by eye rather than by exit
# code -- the script prints what it saw and exits 0 either way in that mode.
#
# Exit code (no --break): 0 if both boards' round trip passed, 1 otherwise.
# Prints a pass/fail line per board with the exit codes seen either way.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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
for key in mmc1 mmc3; do
  rom="$OUT_DIR/sram_${key}.nes"
  sav="$SAVES_DIR/sram_${key}.sav"
  rm -f "$sav"

  timeout 60 "$MESEN" --testRunner "$ROOT/test/lua/save_sram.lua" "$rom" >/dev/null 2>&1
  run1=$?

  if [ ! -f "$sav" ]; then
    echo "$key: FAIL -- no .sav written after run 1 (exit $run1) -- battery bit or Mesen persistence problem"
    overall=1
    continue
  fi

  timeout 60 "$MESEN" --testRunner "$ROOT/test/lua/save_sram.lua" "$rom" >/dev/null 2>&1
  run2=$?

  if [ "$run1" = "1" ] && [ "$run2" = "0" ]; then
    echo "$key: PASS (run1=$run1 run2=$run2)"
  else
    echo "$key: FAIL (run1=$run1 run2=$run2) -- see save_sram.lua's EXIT_* constants"
    overall=1
  fi
done

if [ -n "$BREAK_ARG" ]; then
  echo "[run_sram_check] negative control ($BREAK_ARG): a FAIL on the targeted board is the expected result"
  exit 0
fi

exit $overall
