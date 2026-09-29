#!/usr/bin/env bash
# Runs face_frame_check.lua.template (streamed worlds phase 3a, slice S0: move_face keeps the pose
# in range) on the four scenes test/lua/build_face_frame_roms.mjs builds -- D1 (Turn) and D2 (a Move
# blocked on its first tick), each ordinary and streamed -- in Mesen, the second core.
#
#   test/lua/run_face_frame_check.sh [mesen-path] [--break=shipped]
#
# Each scene is observed to the END of its Say (the lua presses A at the end-wait) and compares all 256
# shadow OAM bytes every frame.
#
# Exit code: 0 if every scene passed, else the first failing scene's EXIT_* code (2 = never reached
# gameplay, 3 = the event never opened the dialogue, 4 = the Say did not run to its end, 5 = wrong
# actor tile group, 6 = ent_frame/timer not 0, 7 = wrong player tile, 8 = a wrong byte elsewhere in
# the shadow, 9 = sprite RAM matches neither shadow -- see the template).
#
# --break=shipped: the negative control. Every scene is built on the 9f0136e move_face (a Code Forge
# override of entities.asm made from `git show`), while the lua still expects the clamped result, so
# a run must exit 5 for every scene, not 0.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MESEN=/home/chris/Downloads/Mesen2/bin/linux-x64/Release/Mesen
case "${1:-}" in ""|--*) ;; *) MESEN="$1" ;; esac
BREAK_ARG=""
for a in "$@"; do
  case "$a" in
    --break=*) BREAK_ARG="$a" ;;
  esac
done
OUT_DIR="/tmp/nesforge-face-frame"

if [ ! -x "$MESEN" ]; then
  echo "[run_face_frame_check] Mesen not found at $MESEN -- pass its path as the first argument"
  exit 1
fi

rm -rf "$OUT_DIR"
node "$ROOT/test/lua/build_face_frame_roms.mjs" "$OUT_DIR" $BREAK_ARG || exit 1

status=0
for scene in d1_ordinary d1_streamed d2_ordinary d2_streamed; do
  out=$(timeout 60 "$MESEN" --testRunner "$OUT_DIR/$scene.lua" "$OUT_DIR/$scene.nes" 2>&1)
  code=$?
  if [ "$code" = "0" ]; then
    echo "$scene: PASS (exit 0)"
  else
    echo "$scene: FAIL (exit $code)"
    [ "$status" = "0" ] && status=$code
  fi
done
exit $status
