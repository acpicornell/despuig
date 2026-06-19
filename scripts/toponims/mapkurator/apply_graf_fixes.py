#!/usr/bin/env python3
"""Apply hand-corrected readings (graf-fixes.json, written by the review tool) onto
the production toponym list: update graf, re-derive nom + tipus. Position is
unchanged, so only ngib_match needs re-running afterwards (not the georef).

    nix-shell scripts/toponims/shell.nix \
        --run "python3 scripts/toponims/mapkurator/apply_graf_fixes.py"
    npm run toponims:ngib-match      # re-match with the corrected readings
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import b_assemble as ba

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
# per-sheet support: default to the global table/fixes; a quadrant run passes
# TOPONIMS_JSON + GRAF_JSON so it only ever touches data/toponims/<q>/.
TOP = os.environ.get("TOPONIMS_JSON") or f"{ROOT}/data/toponims/toponims.json"
if not os.path.isabs(TOP):
    TOP = f"{ROOT}/{TOP}"
FIXES = os.environ.get("GRAF_JSON") or f"{ROOT}/data/toponims/graf-fixes.json"
if not os.path.isabs(FIXES):
    FIXES = f"{ROOT}/{FIXES}"


def main():
    if not os.path.exists(FIXES):
        print("no graf-fixes.json — nothing to apply"); return
    fixes = json.load(open(FIXES))
    top = json.load(open(TOP))
    n = 0
    for t in top["toponims"]:
        g = (fixes.get(t["id"]) or "").strip()
        if not g or g == t["graf"]:
            continue
        k = ba.key(g)
        t["graf"] = g
        t["nom"] = ba.TOWNS.get(k) or ba.normalize_nom(g)
        t["tipus"] = ba.tipus_of(k)
        n += 1
    json.dump(top, open(TOP, "w"), ensure_ascii=False, indent=1)
    print(f"applied {n} reading corrections of {len(fixes)} in graf-fixes.json -> toponims.json")


if __name__ == "__main__":
    main()
