#!/usr/bin/env bash
# Approach-B pipeline driver — runs in PARALLEL to production (writes only under
# data/toponims/b/, never touches data/toponims/toponims.json or ngib/matches.json).
# Usage: b_run.sh <b-extract workflow output json>
set -euo pipefail
cd "$(dirname "$0")/../../.."          # repo root
WF="$1"
SH="scripts/toponims/shell.nix"

# B output paths (parallel track)
export TOPONIMS_JSON=data/toponims/b/toponims.json
export GCPS_JSON=data/toponims/b/gcps.json
export GCPS_BOOT_JSON=data/toponims/b/gcps-bootstrap.json
export MATCHES_JSON=data/toponims/b/matches.json
export RECHECK_JSON=data/toponims/b/recheck.json
export PICKS_JSON=data/toponims/b/recheck-picks.json   # absent -> no vision overrides

nix-shell "$SH" --run "
  python3 scripts/toponims/mapkurator/b_assemble.py '$WF' &&
  python3 scripts/toponims/mapkurator/georef.py &&
  python3 scripts/toponims/mapkurator/georef_bootstrap.py &&
  python3 scripts/toponims/ngib_match.py
"
echo '✓ approach-B pipeline complete -> data/toponims/b/matches.json'
