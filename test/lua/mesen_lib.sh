# Sourced by the run_*_check.sh runners (never executed): one way to run a Mesen script and read how it ended.
#
#   mesen_run <timeout-seconds> <mesen> <script.lua> <rom> [logfile]
#
# Returns the status the Lua script passed to emu.stop(), 0-254, and nothing else. Anything that is not such a status -- the time limit
# expiring, a signal, Mesen failing to start, a missing or malformed result record, or the status 255 -- returns 255 and prints one
# "[mesen_run] ..." line saying which. 255 is Mesen's own generic failure code, so no script may use it to mean a result: the
# measurement templates clamp their pass encoding at 254, and every runner rejects 255 before decoding anything (a timeout is 124 and a
# signal 128+n, both of which ARE legitimate measurement buckets, so `timeout N mesen; result=$?` could never tell them apart).
# MESEN_KIND holds exit|timeout|signal|error|missing for a caller that wants to say more.
_MESEN_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mesen_run() {
  local rec
  rec="$(node "$_MESEN_LIB_DIR/mesen_run.mjs" "$@" 2>/dev/null </dev/null)"
  MESEN_KIND=missing
  if [[ "$rec" =~ ^MESEN_RESULT[[:space:]]kind=exit[[:space:]]code=([0-9]+)$ ]]; then
    MESEN_KIND=exit
    if [ "${BASH_REMATCH[1]}" -lt 255 ]; then
      return "${BASH_REMATCH[1]}"
    fi
    echo "[mesen_run] exit 255 is Mesen's own generic failure code, never a result"
    return 255
  elif [[ "$rec" =~ ^MESEN_RESULT[[:space:]]kind=(timeout|signal|error)([[:space:]]signal=[A-Z0-9]+)?$ ]]; then
    MESEN_KIND="${BASH_REMATCH[1]}"
    echo "[mesen_run] no result: Mesen ended as kind=$MESEN_KIND${BASH_REMATCH[2]} after at most $1 s"
  else
    echo "[mesen_run] no result: the supervisor printed no valid record (got: ${rec:-nothing})"
  fi
  return 255
}
