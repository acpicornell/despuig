#!/usr/bin/env python3
"""Apply the review tool's hand corrections onto the production toponym list:
  - graf-fixes.json  -> update graf, re-derive nom + tipus
  - tipus-fixes.json -> override tipus by hand (wins over the derived value)
Position is unchanged, so only ngib_match needs re-running afterwards (not georef).

    nix-shell scripts/toponims/shell.nix \
        --run "python3 scripts/toponims/mapkurator/apply_graf_fixes.py"
    npm run toponims:ngib-match      # re-match with the corrected readings
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import b_assemble as ba

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
# per-sheet support: default to the global table/fixes; a quadrant run passes
# TOPONIMS_JSON + GRAF_JSON (+ TIPUS_JSON) so it only ever touches data/toponims/<q>/.
TOP = os.environ.get("TOPONIMS_JSON") or f"{ROOT}/data/toponims/toponims.json"
if not os.path.isabs(TOP):
    TOP = f"{ROOT}/{TOP}"
FIXES = os.environ.get("GRAF_JSON") or f"{ROOT}/data/toponims/graf-fixes.json"
if not os.path.isabs(FIXES):
    FIXES = f"{ROOT}/{FIXES}"
TIPUSF = os.environ.get("TIPUS_JSON") or os.path.join(os.path.dirname(FIXES), "tipus-fixes.json")
if not os.path.isabs(TIPUSF):
    TIPUSF = f"{ROOT}/{TIPUSF}"

VALID_TIPUS = {"possessió", "nucli", "hidrònim", "orònim", "costa", "altre"}


def main():
    fixes = json.load(open(FIXES)) if os.path.exists(FIXES) else {}
    tfix = json.load(open(TIPUSF)) if os.path.exists(TIPUSF) else {}
    if not fixes and not tfix:
        print("no graf-fixes.json / tipus-fixes.json — nothing to apply"); return
    top = json.load(open(TOP))
    n = 0
    for t in top["toponims"]:
        g = (fixes.get(t["id"]) or "").strip()
        if g and g != t["graf"]:
            k = ba.key(g)
            t["graf"] = g
            t["nom"] = ba.TOWNS.get(k) or ba.normalize_nom(g)
            t["tipus"] = ba.tipus_for(g, k)
            n += 1
    # tipus overrides apply LAST so a hand-set type wins over the derived one
    nt = 0
    for t in top["toponims"]:
        v = tfix.get(t["id"])
        if v in VALID_TIPUS and v != t["tipus"]:
            t["tipus"] = v
            nt += 1
    json.dump(top, open(TOP, "w"), ensure_ascii=False, indent=1)
    print(f"applied {n} reading corrections + {nt} tipus overrides -> toponims.json")


if __name__ == "__main__":
    main()
