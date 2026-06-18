#!/usr/bin/env bash
# Production toponym pipeline (approach B): from the window-extraction workflow
# output to the matched, georeferenced table. Writes the production files
# (data/toponims/toponims.json + ngib/matches.json). See ../README.md for the
# full chain (detections -> b_windows -> extraction workflow -> here).
# Usage: b_run.sh <b-extract workflow output json>
set -euo pipefail
cd "$(dirname "$0")/../../.."          # repo root
WF="$1"

nix-shell scripts/toponims/shell.nix --run "
  python3 scripts/toponims/mapkurator/b_assemble.py '$WF' &&   # -> data/toponims/toponims.json
  python3 scripts/toponims/mapkurator/graf_diplomatic.py &&    # graf -> diplomatic (Sô/Câ); nom stays modern
  python3 scripts/toponims/mapkurator/georef.py &&             # adds lon/lat (exact-dot GCPs)
  python3 scripts/toponims/mapkurator/georef_bootstrap.py &&   # densifies the georeference
  python3 scripts/toponims/ngib_match.py                       # -> data/toponims/ngib/matches.json
"
echo '✓ pipeline complete -> data/toponims/ngib/matches.json'
