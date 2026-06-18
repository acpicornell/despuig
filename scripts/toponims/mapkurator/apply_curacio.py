#!/usr/bin/env python3
"""Apply the hand-curated CSV back into the durable vision/curation picks, then the
next `ngib_match` promotes them. Round-trips export_curacio.py.

Fill the CSV's **NGIB_correcte** column per row:
  - the exact grafia of the right place (copy it from a cand_N cell, or type the
    correct NGIB name) -> that toponym becomes `confirmat` against it;
  - leave blank to skip (re-export keeps it for later);
  - "cap" / "-" / "x" -> you confirm there is NO gazetteer match (left as is).

    nix-shell scripts/toponims/shell.nix \
        --run "python3 scripts/toponims/mapkurator/apply_curacio.py"
    npm run toponims:ngib-match        # re-match to promote the curated picks
"""
import csv, json, os, re
from unidecode import unidecode

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PICKS = f"{ROOT}/data/toponims/recheck-picks.json"
CSV = f"{ROOT}/data/toponims/curacio.csv"
NOMATCH = {"", "-", "—", "cap", "none", "no", "x", "n/a"}


def core(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", unidecode((s or "").lower()))).strip()


def main():
    ngib_cores = {core(g["grafia"]) for g in json.load(open(f"{ROOT}/data/toponims/ngib/llocs.json"))}
    picks = json.load(open(PICKS)) if os.path.exists(PICKS) else {}
    added, nomatch, warn = 0, 0, []
    for r in csv.DictReader(open(CSV)):
        v = (r.get("NGIB_correcte") or "").strip()
        if not v:
            continue
        if v.lower() in NOMATCH:
            nomatch += 1
            continue
        picks[r["id"]] = v
        added += 1
        if core(v) not in ngib_cores:
            warn.append((r["id"], v))
    json.dump(picks, open(PICKS, "w"), ensure_ascii=False, indent=1)
    print(f"curated picks added/updated: {added}   marked no-match: {nomatch}   "
          f"total picks now: {len(picks)}")
    if warn:
        print(f"⚠ {len(warn)} picks whose name is NOT in NGIB (typo? will be skipped at match):")
        for i, v in warn[:20]:
            print(f"   {i}: {v!r}")
    print("→ now run:  npm run toponims:ngib-match")


if __name__ == "__main__":
    main()
