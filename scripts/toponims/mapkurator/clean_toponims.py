#!/usr/bin/env python3
"""Conservative cleanup of toponims-final.json: drop entries that are evidently
NOT toponyms. Nothing is deleted destructively — rejects go to a separate file
with the reason, so the pass is auditable and reversible.

Reject rules (only the clearly-wrong):
  number       text is just digits / sounding numbers ("16", "3 12", "4 14 4")
  single_char  a lone letter ("I", "S", "a", "ç")
  decorative   spaced single capitals = title/sea lettering ("C E R A", "W E O")
  connector    a lone article/prefix with no name ("La", "El", "Sô", "de", "Câ")
  marker       only symbols/punctuation (⊙, etc.)

    nix-shell scripts/toponims/mapkurator/shell.nix \
        --run "python3 scripts/toponims/mapkurator/clean_toponims.py"

Reads  data/toponims/mapkurator/toponims-final.json
Writes data/toponims/mapkurator/toponims-clean.json     (kept)
       data/toponims/mapkurator/toponims-rejected.json  (dropped, with reason)
"""
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASE = os.path.join(ROOT, "data/toponims/mapkurator")

CONNECTOR = {"so", "son", "ca", "can", "sa", "ses", "sas", "es", "el", "la",
             "lo", "los", "na", "de", "del", "des", "s", "n", "i", "a", "o",
             "se", "re", "mo", "lu", "lj", "ba", "te", "co", "ce", "d"}


def _norm(s):
    s = s.strip().lower().rstrip(".,;:·").lstrip("·")
    for a, b in (("ô", "o"), ("â", "a"), ("î", "i"), ("ê", "e"), ("û", "u"),
                 ("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"),
                 ("à", "a"), ("ñ", "n"), ("ç", "c")):
        s = s.replace(a, b)
    return s


def reason(text):
    t = text.strip()
    letters = [c for c in t if c.isalpha()]
    if re.fullmatch(r"[\d\s.,]+", t) and any(c.isdigit() for c in t):
        return "number"                               # sounding numbers
    if not letters:                                   # ⊙, punctuation, empty
        return "marker"
    toks = [w.strip(".,;:") for w in t.split() if w.strip(".,;:")]
    if len(t.replace(" ", "")) <= 1:
        return "single_char"
    if len(toks) >= 2 and all(len(w) == 1 for w in toks) and t.upper() == t:
        return "decorative"                           # "C E R A", "W E O"
    if len(toks) == 1 and _norm(toks[0]) in CONNECTOR:
        return "connector"                            # lone La / El / Sô / de
    return None                                       # keep


def main():
    data = json.load(open(os.path.join(BASE, "toponims-final.json")))
    kept, rejected = [], []
    counts = {}
    for t in data["toponims"]:
        r = reason(t["text"])
        if r is None:
            kept.append(t)
        else:
            t2 = dict(t); t2["reject_reason"] = r
            rejected.append(t2)
            counts[r] = counts.get(r, 0) + 1
    json.dump({"count": len(kept), "toponims": kept},
              open(os.path.join(BASE, "toponims-clean.json"), "w"), ensure_ascii=False)
    json.dump({"count": len(rejected), "rejected": rejected},
              open(os.path.join(BASE, "toponims-rejected.json"), "w"), ensure_ascii=False)
    print(f">> input:    {len(data['toponims'])}")
    print(f">> kept:     {len(kept)}")
    print(f">> rejected: {len(rejected)}  by reason: {dict(sorted(counts.items()))}")
    print()
    for r in sorted(counts):
        ex = [x["text"] for x in rejected if x["reject_reason"] == r][:12]
        print(f"  [{r}] e.g.: {ex}")
    print("✓ toponims-clean.json + toponims-rejected.json")


if __name__ == "__main__":
    main()
