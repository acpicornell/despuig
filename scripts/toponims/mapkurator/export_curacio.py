#!/usr/bin/env python3
"""Export a manual-curation CSV: every toponym that still needs a human eye
(suggerit / posicional / sense), each row with its top NGIB candidates and empty
columns to fill in. Round-trips back via apply_curacio.py.

    nix-shell scripts/toponims/shell.nix \
        --run "python3 scripts/toponims/mapkurator/export_curacio.py"

Reads data/toponims/ngib/matches.json + data/toponims/b/recheck.json.
Writes data/toponims/curacio.csv
"""
import csv, json, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
WANT = {"suggerit", "posicional", "sense"}
ORDER = {"suggerit": 0, "posicional": 1, "sense": 2}

matches = {m["id"]: m for m in json.load(open(f"{ROOT}/data/toponims/ngib/matches.json"))}
recheck = {r["id"]: r for r in json.load(open(f"{ROOT}/data/toponims/b/recheck.json"))}

rows = [m for m in matches.values() if m["decision"] in WANT]
# suggerit first (most rescuable), best candidate first within each tier
rows.sort(key=lambda m: (ORDER[m["decision"]], -(m.get("sim") or 0)))


def cand_str(c):
    return f"{c['grafia']} ({c['municipi'] or '?'} · {c['km']}km · {c['sim']})"


out = f"{ROOT}/data/toponims/curacio.csv"
with open(out, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["id", "decision", "tipus", "graf", "nom", "x", "y",
                "ngib_actual", "sim", "km",
                "cand_1", "cand_2", "cand_3", "cand_4",
                "NGIB_correcte", "nota"])
    for m in rows:
        r = recheck.get(m["id"], {})
        cands = r.get("candidates", [])
        cs = [cand_str(c) for c in cands[:4]] + [""] * 4
        w.writerow([m["id"], m["decision"], m["tipus"], m["graf"], m["nom"],
                    r.get("x", ""), r.get("y", ""),
                    m.get("ngib") or "", m.get("sim") or "", m.get("km") if m.get("km") is not None else "",
                    cs[0], cs[1], cs[2], cs[3], "", ""])

from collections import Counter
print(f"rows: {len(rows)}  {dict(Counter(m['decision'] for m in rows))}")
print(f"✓ {out}")
