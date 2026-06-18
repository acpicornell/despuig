#!/usr/bin/env python3
"""Restore the diplomatic (engraved) form of the possessive prefixes in `graf`.

The B-extract prompt expanded the abbreviations the map uses (Sô = Son, Câ = Can),
so `graf` ended up modern instead of diplomatic. This map abbreviates those two
prefixes systematically, so a leading `Son`/`Can` maps back unambiguously. `nom`
keeps the modern form, giving a clean split: graf = engraved, nom = modern.
Idempotent (a leading `Sô`/`Câ` — including hand-curated readings — is left alone).

    nix-shell scripts/toponims/shell.nix \
        --run "python3 scripts/toponims/mapkurator/graf_diplomatic.py"
"""
import json, os
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TOP = os.environ.get("TOPONIMS_JSON") or os.path.join(ROOT, "data/toponims/toponims.json")
PREFIX = {"Son": "Sô", "Can": "Câ"}


def main():
    top = json.load(open(TOP))
    n = Counter()
    for t in top["toponims"]:
        toks = t["graf"].split()
        if toks and toks[0] in PREFIX:
            n[toks[0]] += 1
            toks[0] = PREFIX[toks[0]]
            t["graf"] = " ".join(toks)            # nom stays modern (Son/Can)
    json.dump(top, open(TOP, "w"), ensure_ascii=False, indent=1)
    print(f"diplomatic graf restored: {dict(n)}  (total {sum(n.values())})")


if __name__ == "__main__":
    main()
