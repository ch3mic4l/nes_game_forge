#!/usr/bin/env bash
# Drives the Mesen (cycle-accurate) Equip-screen timing and register checks -- docs/design-equipment.md section 10, obligation F8 (b) and (c):
# does the frame that publishes an Equip row, alone and sharing a frame with Flash, with a live bound-tile flip, and with a flip plus Flash
# (where the row waits a frame), still finish its NMI's rti before scanline 257 (E12, Chris's ruling on review Q1 of C4: NOT the 260 the
# sibling checks judge), and (MMC3) does the register file stay what the design pins while Equip is open and after it closes -- including
# the font page and the battle art R1 really maps (review R2 of C4).
#
#   test/lua/run_equip_nmi_check.sh [mesen-path]
#
# Every variant is built fresh by test/lua/build_equip_nmi_roms.mjs (a project in a temp directory, never touching a checked-in fixture), which
# also generates equip_nmi_timing.lua from equip_nmi_timing.lua.template with that build's own addresses. A variant passes on exit 0 and the
# NEGATIVE CONTROLS must each fail with their named code, so a judge that has stopped judging fails the script:
#   rows       -- the Equip tick publishes every dirty row in one frame (an unbounded multi-row publish): exit 5, the NMI overruns vblank
#   nodefer    -- the C4 code before E12: the row joins the flip + Flash frame, whose NMI settles on scanline 257 on MMC3: exit 5
#   wrongfont  -- the split handler selects page 0 instead of the font page, everything else intact: exit 40 (the font-page verdict)
#   norestore  -- battle_end no longer redraws the field (a lost MMC3 restore at exit): exit 33, the tileset registers did not come back
# Exit 0 = every variant passed and every control flipped.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-equip-nmi-roms.XXXXXX")"
trap 'rm -rf "$OUT_DIR"' EXIT

if [ ! -x "$MESEN" ]; then
  echo "[run_equip_nmi_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

failures=0
# $1 = expected exit code, the rest = build_equip_nmi_roms.mjs arguments
variant() {
  local want="$1"; shift
  node "$ROOT/test/lua/build_equip_nmi_roms.mjs" "$OUT_DIR" "$@" >/dev/null || { echo "BUILD FAIL: $*"; failures=$((failures + 1)); return; }
  timeout 60 "$MESEN" --testRunner "$OUT_DIR/equip_nmi_timing.lua" "$OUT_DIR/equip_nmi.nes" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then
    echo "ok   (exit $got) $*"
  else
    echo "FAIL (exit $got, wanted $want) $*"
    failures=$((failures + 1))
  fi
}

echo "[run_equip_nmi_check] the Equip frame alone, with Flash, with a bound-tile flip, and the flip + Flash frame the row waits out, on every board that can carry an RPG"
for board in 1 4 30; do
  for mode in equip flash flipeq flip; do variant 0 --mode=$mode --board=$board; done
done
echo "[run_equip_nmi_check] a streamed world (the screen's own bank differs from the battle bank)"
for board in 1 30; do
  for mode in equip flash; do variant 0 --mode=$mode --board=$board --streamed; done
done
echo "[run_equip_nmi_check] MMC3 register file while open and after leaving"
for mode in equip flash flipeq flip; do variant 0 --mode=$mode --board=4 --regcheck; done
echo "[run_equip_nmi_check] negative controls: each must flip its judge"
for board in 1 4 30; do
  variant 5 --mode=equip --board=$board --control=rows
  variant 5 --mode=flip --board=$board --control=rows
done
variant 5 --mode=equip --board=30 --streamed --control=rows
variant 5 --mode=flip --board=4 --control=nodefer
variant 5 --mode=flip --board=4 --regcheck --control=nodefer
variant 33 --mode=equip --board=4 --regcheck --control=norestore
variant 40 --mode=equip --board=4 --regcheck --control=wrongfont
variant 40 --mode=flip --board=4 --regcheck --control=wrongfont

if [ "$failures" = "0" ]; then
  echo "PASS: every Equip frame's rti settled before scanline 257, the MMC3 register file held, and every control flipped"
  exit 0
fi
echo "FAIL: $failures variant(s) did not give the expected result"
exit 1
