#!/usr/bin/env python3
"""Assemble the approach-B extraction (window workflow output) into the web/table
schema, in PARALLEL to the production list (writes to data/toponims/b/toponims.json,
never touches data/toponims/toponims.json). Reuses to_table's normalisation.

Each B toponym carries its box numbers -> position = centroid of those boxes
(from the per-window box files). Box ownership is unique per window, so dedup is a
light safety net (same key + same ~cell).

    nix-shell scripts/toponims/shell.nix \
        --run "python3 scripts/toponims/mapkurator/b_assemble.py <wf_output.json>"
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import to_table as tt

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
WIN = os.path.join(ROOT, "data/toponims/mapkurator/b")
OUT = os.path.join(ROOT, "data/toponims/b/toponims.json")


def main():
    wf = json.load(open(sys.argv[1]))
    W = wf["result"]["windows"] if "result" in wf else wf["windows"]
    out, seen = [], set()
    for win in W:
        boxes = {b["n"]: b for b in json.load(open(f"{WIN}/w{win['w']:02d}.json"))["words"]}
        for i, t in enumerate(win["toponims"]):
            pts = [boxes[n] for n in t["boxes"] if n in boxes]
            graf = (t["reading"] or "").strip()
            if not pts or not graf:
                continue
            x = round(sum(p["cx"] for p in pts) / len(pts))
            y = round(sum(p["cy"] for p in pts) / len(pts))
            k = tt.key(graf)
            key2 = (k, x // 40, y // 40)
            if not k or key2 in seen:
                continue
            seen.add(key2)
            out.append({"id": f"B{win['w']:02d}_{i + 1}", "graf": graf,
                        "nom": tt.TOWNS.get(k) or tt.normalize_nom(graf),
                        "tipus": tt.tipus_of(graf, k), "subtile": "",
                        "x": x, "y": y, "dubte": False})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"font": "Topònims del mapa de Despuig — extracció 'approach B' (spotter "
                       "detecta les caixes; Claude vision agrupa i llegeix per finestra). "
                       "Pista paral·lela, no toca la llista de producció.",
               "comptador": {"toponims": len(out)}, "toponims": out},
              open(OUT, "w"), ensure_ascii=False, indent=1)
    from collections import Counter
    print(f"B toponyms: {len(out)}  tipus: {dict(Counter(r['tipus'] for r in out))}")
    print(f"✓ {OUT}")


if __name__ == "__main__":
    main()
