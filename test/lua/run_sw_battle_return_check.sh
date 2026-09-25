#!/usr/bin/env bash
# Drives the Mesen (real, independent core) battle-return/position-jump-guard lifecycle check --
# fix round 2 (review round 3 of 3, finding A6/C1)'s own required "Mesen battle-return/guard check
# and failing negative control", brief-streamed-worlds-phase2-s6-fix2.md.
#
#   test/lua/run_sw_battle_return_check.sh [mesen-path]
#
# Builds two fixtures fresh (test/lua/build_sw_battle_return_roms.mjs -- a mkdtemp streamed RPG
# project, never touching the checked-in tree): the real engine (must PASS, exit 0) and the
# wrong-restore-slot negative control (project.code.overrides carries a patched COPY of
# engine/rpg.asm, the real file is never touched -- must FAIL, exit 11/EXIT_RESTORATION_IDENTITY).
#
# See sw_battle_return_check.lua.template's own EXIT_* constants for what any other code means.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN="${1:-/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen}"
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nesforge-sw-battle-return.XXXXXX")"
trap 'rm -rf "$OUT_DIR"' EXIT

if [ ! -x "$MESEN" ]; then
  echo "[run_sw_battle_return_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

overall=0

echo "[run_sw_battle_return_check] building the real (unbroken) fixture..."
node "$ROOT/test/lua/build_sw_battle_return_roms.mjs" "$OUT_DIR/ok" || exit 1
timeout 60 "$MESEN" --testRunner "$OUT_DIR/ok/sw_battle_return_check.lua" "$OUT_DIR/ok/battle_return.nes" >"$OUT_DIR/ok/out.log" 2>&1
okResult=$?
cat "$OUT_DIR/ok/out.log"
if [ "$okResult" = "0" ]; then
  echo "PASS (real engine): the battle-return lifecycle checked out and the guard stayed silent"
else
  echo "FAIL (real engine, exit $okResult) -- this must be 0; see sw_battle_return_check.lua.template's own EXIT_* constants"
  overall=1
fi

echo "[run_sw_battle_return_check] building the wrong-restore-slot negative control..."
node "$ROOT/test/lua/build_sw_battle_return_roms.mjs" "$OUT_DIR/break" --break=wrong-restore-slot || exit 1
timeout 60 "$MESEN" --testRunner "$OUT_DIR/break/sw_battle_return_check.lua" "$OUT_DIR/break/battle_return.nes" >"$OUT_DIR/break/out.log" 2>&1
breakResult=$?
cat "$OUT_DIR/break/out.log"
EXIT_RESTORATION_IDENTITY=11
if [ "$breakResult" = "$EXIT_RESTORATION_IDENTITY" ]; then
  echo "PASS (negative control, exit $breakResult): the wrong-restore-slot mutation was correctly caught with EXIT_RESTORATION_IDENTITY"
else
  echo "FAIL (negative control): expected exactly exit $EXIT_RESTORATION_IDENTITY (EXIT_RESTORATION_IDENTITY), got exit $breakResult -- a timeout (124), crash (255) or any other status must not be accepted as the restoration mutation being caught"
  overall=1
fi

exit $overall
