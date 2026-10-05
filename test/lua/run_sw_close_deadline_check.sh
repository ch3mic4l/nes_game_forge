#!/usr/bin/env bash
# Mesen (cycle-accurate) check that the worst text-box close frame -- a streamed split close row, the arrow hide, a Flip and a Flash
# edge, 88 bytes of vram_buf -- publishes completely and restores the scroll inside vblank, in both dialogue placements.
#
#   test/lua/run_sw_close_deadline_check.sh [mesen-path]
#
# --controls also runs the two negative controls (no-flash must exit 7, slow-drain must exit 5).
# Exit 0 = both placements passed (and, with --controls, both controls failed as expected). See sw_close_deadline.lua.template's header for the assertions and the labelled RAM poke.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN=/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen
CONTROLS=0
for a in "$@"; do case "$a" in --controls) CONTROLS=1 ;; *) MESEN="$a" ;; esac; done
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-sw-close-deadline.XXXXXX")"
trap 'rm -rf "$OUT_DIR"' EXIT
[ -x "$MESEN" ] || { echo "[run_sw_close_deadline_check] Mesen not found at $MESEN"; exit 1; }
status=0
for placement in resident banked; do
  dir="$OUT_DIR/$placement"
  node "$ROOT/test/lua/build_sw_close_deadline_roms.mjs" "$dir" --placement=$placement >/dev/null || { echo "FAIL build ($placement)"; status=1; continue; }
  timeout 60 "$MESEN" --testRunner "$dir/sw_close_deadline.lua" "$dir/sw_close_deadline.nes" >"$dir/log.txt" 2>&1
  result=$?
  if [ "$result" = "0" ]; then echo "PASS ($placement): the 88-byte close frame finished inside vblank"; else echo "FAIL ($placement, exit $result)"; tail -15 "$dir/log.txt"; status=1; fi
done
if [ "$CONTROLS" = 1 ]; then
  for pair in "no-flash 7" "slow-drain 5"; do
    set -- $pair
    for placement in resident banked; do
      dir="$OUT_DIR/$placement-$1"
      node "$ROOT/test/lua/build_sw_close_deadline_roms.mjs" "$dir" --placement=$placement --break=$1 >/dev/null || { echo "FAIL build ($placement $1)"; status=1; continue; }
      timeout 60 "$MESEN" --testRunner "$dir/sw_close_deadline.lua" "$dir/sw_close_deadline.nes" >/dev/null 2>&1
      result=$?
      if [ "$result" = "$2" ]; then echo "control ok ($placement, --break=$1): exit $result as required"; else echo "CONTROL FAILED ($placement, --break=$1): exit $result, wanted $2"; status=1; fi
    done
  done
fi
exit $status
