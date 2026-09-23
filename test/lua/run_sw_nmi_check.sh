#!/usr/bin/env bash
# Drives the Mesen (cycle-accurate) streamed-world NMI deadline check --
# phase 2 slice 4a's own "measured deadline" half of plan test 5: does
# sw_nmi_stream's own strip-only chunk (SW_STREAM_CHUNK) and
# sw_nmi_stream_reduced's own mixed chunk (SW_STREAM_MIXED_CHUNK, alongside a
# real 35-byte vram_buf drain) both finish inside vblank on real hardware
# timing, not merely produce eventually-correct pixels the way jsnes would
# regardless of how slow the drain actually is.
#
#   test/lua/run_sw_nmi_check.sh [mesen-path] [--break=chunk4|mixed3]
#
# No --break: builds and runs BOTH parities (--parity=even lands on screen
# (0,0), --parity=odd lands on (1,1) of the streamed map's 3x2 grid -- see
# build_sw_nmi_roms.mjs's own header for why a cycle-accurate core can care
# about which physical nametable a block's own torus position resolves to)
# expecting a PASS exit code in [100,255] from sw_nmi_deadline.lua.template's
# own margin-encoding scheme (EXIT_PASS_BASE=100, MARGIN_SCALE=20 cycles/step
# -- see that file's own header comment for the full reasoning, including why
# the exit code is the only channel this build of Mesen's headless
# --testRunner mode can actually recover a measured figure through: emu.log()
# only feeds a GUI-only buffer, --enableStdout forwards an unrelated stream,
# and emu.displayMessage() is an OSD toast, none of them visible headless).
# Both parities' decoded margins are printed. Exit 0 iff both pass.
#
# --break=chunk4 patches the BUILT ROM's own `lda #SW_STREAM_CHUNK` operand
# (sw_nmi_stream's own chunk size), 3 -> 4, a real negative control against
# the exact byte the fixed kernel bank ships; expects EXIT_DEADLINE_MISS_A
# (5) from BOTH parities. --break=mixed3 patches `lda #SW_STREAM_MIXED_CHUNK`
# (sw_nmi_stream_reduced's own chunk size, alongside the queued 35-byte
# vram_buf packet), 2 -> 3; expects EXIT_DEADLINE_MISS_B (6) from BOTH
# parities. Each mode's expected code is asserted exactly, not merely
# "nonzero" -- see sw_nmi_deadline.lua.template's own EXIT_* constants; a
# wrong code (e.g. EXIT_STALE_ANCHOR or EXIT_TIMEOUT) means the harness broke
# before the deadline comparison ever ran, not that the comparison fired.
#
# Exit code: 0 if every parity in scope matched its expected signature; 1
# otherwise.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"
MODE=""
for a in "$@"; do
  case "$a" in
    --break=*) MODE="${a#--break=}" ;;
  esac
done

case "$MODE" in
  "" | chunk4 | mixed3) ;;
  *)
    echo "[run_sw_nmi_check] unknown --break mode: $MODE"
    exit 1
    ;;
esac

if [ ! -x "$MESEN" ]; then
  echo "[run_sw_nmi_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

EXIT_PASS_BASE=100
EXIT_PASS_MAX=255
MARGIN_SCALE=20

overall=0

for parity in even odd; do
  # Finding 4 (run_flash_nmi_check.sh): a fixed shared directory lets two
  # concurrent runs overwrite each other's ROM/generated-script pair. Each
  # parity gets its own mktemp -d, removed on exit however this loop
  # iteration leaves (success, failure, or a signal on the whole script).
  OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-sw-nmi-roms.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '$OUT_DIR'" EXIT

  echo "[run_sw_nmi_check] building parity=$parity${MODE:+ --break=$MODE}..."
  if ! node "$ROOT/test/lua/build_sw_nmi_roms.mjs" "$OUT_DIR" --parity="$parity" ${MODE:+--break=$MODE}; then
    echo "sw_nmi (parity=$parity${MODE:+ break=$MODE}): FAIL -- build_sw_nmi_roms.mjs did not succeed"
    overall=1
    rm -rf "$OUT_DIR"
    trap - EXIT
    continue
  fi

  rom="$OUT_DIR/sw_nmi.nes"
  lua="$OUT_DIR/sw_nmi_deadline.lua"
  timeout 30 "$MESEN" --testRunner "$lua" "$rom" >/dev/null 2>&1
  result=$?

  label="parity=$parity${MODE:+ break=$MODE}"
  case "$MODE" in
    "")
      if [ "$result" -ge "$EXIT_PASS_BASE" ] && [ "$result" -le "$EXIT_PASS_MAX" ]; then
        steps=$((result - EXIT_PASS_BASE))
        lo=$((steps * MARGIN_SCALE))
        if [ "$result" = "$EXIT_PASS_MAX" ]; then
          echo "sw_nmi ($label): PASS -- exit $result, min margin >= ${lo} cycles"
        else
          hi=$(((steps + 1) * MARGIN_SCALE))
          echo "sw_nmi ($label): PASS -- exit $result, min margin in [${lo}, ${hi}) cycles"
        fi
      else
        echo "sw_nmi ($label): FAIL -- exit $result, expected a pass code in [$EXIT_PASS_BASE, $EXIT_PASS_MAX] -- see sw_nmi_deadline.lua.template's own EXIT_* constants"
        overall=1
      fi
      ;;
    chunk4)
      if [ "$result" = "5" ]; then
        echo "sw_nmi ($label): PASS -- exit 5 (EXIT_DEADLINE_MISS_A), the broken strip chunk missed its vblank deadline as expected"
      else
        echo "sw_nmi ($label): FAIL -- exit $result, expected 5 (EXIT_DEADLINE_MISS_A)"
        overall=1
      fi
      ;;
    mixed3)
      if [ "$result" = "6" ]; then
        echo "sw_nmi ($label): PASS -- exit 6 (EXIT_DEADLINE_MISS_B), the broken mixed chunk missed its vblank deadline as expected"
      else
        echo "sw_nmi ($label): FAIL -- exit $result, expected 6 (EXIT_DEADLINE_MISS_B)"
        overall=1
      fi
      ;;
  esac

  rm -rf "$OUT_DIR"
  trap - EXIT
done

exit $overall
