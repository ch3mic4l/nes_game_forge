#!/usr/bin/env bash
# Prints the streamed-worlds ring gate's acceptance table (plan 2.5: rows 1-9 x six cells x game type x placement x emulator) from the evidence of a
# certificate run, and exits nonzero on any FAIL or UNMEASURED cell or any matrix job that did not meet its declaration. Nothing here is hard-coded to a
# checkout's scratch directories: every directory is an argument.
#
#   test/lua/run_sw_ring_gate.sh <provenance-dir> <matrix-log-dir> [<s1b-records-dir>] [--json=<out.json>] [--construct]
#
# By default the certificate is VERIFIED: <provenance-dir>/INDEX.json must exist and its recorded hashes must hold, so a missing or unreadable index FAILS. `--construct` is the explicit
# request to audit an UNFINALIZED certificate (hashes computed in memory); the output then says so and is not a verified certificate.
#
# <provenance-dir> and <matrix-log-dir> are the two directories `node test/lua/ring_gate/run_matrix.mjs <prov> <logs>` wrote. Rows 2, 4 and 7 (S1b) are
# RE-DERIVED from the S1b result records that matrix wrote into <matrix-log-dir> unless <s1b-records-dir> is given, in which case they are read from there
# (for example a judge-only successor evaluation of an earlier S1b certificate, whose s1b-<cell>-<gt>-<placement>.json records carry the same items). The first
# lines of the printed table say which. S1b's declared-uncertified items (option A) print as UNCERTIFIED, never PASS.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$#" -lt 2 ]; then
  echo "usage: $0 <provenance-dir> <matrix-log-dir> [<s1b-records-dir>] [--json=<out.json>] [--construct]" >&2
  exit 2
fi
prov="$1"; logs="$2"; shift 2
extra=()
for a in "$@"; do
  case "$a" in
    --json=*|--construct) extra+=("$a") ;;
    --*) echo "$0: unknown option $a" >&2; exit 2 ;;
    *) extra+=("--s1b=$a") ;;
  esac
done
exec node "$here/ring_gate/s1c_gate.mjs" "--prov=$prov" "--logs=$logs" "${extra[@]}"
