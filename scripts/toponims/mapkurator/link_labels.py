#!/usr/bin/env python3
"""Link word detections into multi-word LABELS before recognition.

The spotter detects whole words, so a two-word toponym ("Son Berenguer",
"Can Horrach") often arrives as two separate detections — and the very common
Mallorcan prefixes Sô (=Son) and Câ (=Can) show up as useless lone tokens. This
groups detections that sit on the same text line with a small horizontal gap into
one label, so the recognition pass reads "Sô Berenguer" as a unit instead of two
crops.

    nix-shell scripts/toponims/mapkurator/shell.nix \
        --run "python3 scripts/toponims/mapkurator/link_labels.py"

Reads  data/toponims/mapkurator/detections.json
Writes data/toponims/mapkurator/labels.json  (one entry per linked label)
"""
import json
import os

import numpy as np
from scipy.spatial import cKDTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASE = os.path.join(ROOT, "data/toponims/mapkurator")

# Merge tuning (in units of the local word height).
VOVERLAP = 0.40    # min vertical overlap fraction to count as the same line
GAP_MAX = 0.80     # max gap when a HEAD/MID binds the pair (Son X, X de Y)
GAP_TIGHT = 0.30   # max gap to merge two ORDINARY words (tight kerning = one name)
GAP_MIN = -0.40    # allow slight horizontal overlap
CAP = 5            # max words per label — blocks runaway chains across dense rows

# HEAD words START a toponym ("Son X", "Can Y", "Cala Z", "Hort de W"). They bind
# to the word on their RIGHT only — so we always CUT before a HEAD word, which is
# what stops consecutive Son/Can farms from chaining into one giant label.
HEAD = {"so", "son", "co", "ca", "can", "casa", "cas", "cal", "sa", "ses", "sas",
        "es", "el", "la", "lo", "los", "na", "den", "s", "sant", "santa", "san",
        "n", "hort", "mort", "puig", "coll", "pou", "cala", "calo", "punta", "pta",
        "torre", "torra", "torr", "mola", "moli", "molino", "refal", "refalet",
        "camp", "pla", "illot", "illa", "cabo", "cap", "playa", "coma", "serra",
        "font", "bassa", "morro", "cova", "roca", "vall", "alga", "alqueria"}
# MID connectors bind BOTH sides ("X de Y", "de la Z").
MID = {"de", "del", "dels", "d", "dela", "des"}


def _norm(s):
    s = s.strip().lower().rstrip(".,;:·").lstrip("·")
    if s.endswith("'"):                      # d' / s' / l'
        s = s[:-1]
    for a, b in (("ô", "o"), ("â", "a"), ("î", "i"), ("ê", "e"), ("û", "u"),
                 ("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"),
                 ("à", "a"), ("ñ", "n"), ("ç", "c")):
        s = s.replace(a, b)
    return s


def main():
    det = json.load(open(os.path.join(BASE, "detections.json")))["detections"]
    n = len(det)
    bb = np.array([t["bbox"] for t in det], dtype=float)  # x,y,w,h
    x0, y0 = bb[:, 0], bb[:, 1]
    x1, y1 = x0 + bb[:, 2], y0 + bb[:, 3]
    h = bb[:, 3]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    norm = [_norm(det[i]["text"]) for i in range(n)]

    # union-find with size tracking (for the per-label cap)
    parent = list(range(n))
    size = [1] * n
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    # collect candidate links, then union TIGHTEST-GAP FIRST so the best merges
    # win before the size cap blocks the rest — prevents dense rows from chaining.
    tree = cKDTree(np.c_[cx, cy])
    rad = float(np.median(bb[:, 2]) * 3 + np.median(h) * 2)
    cand = []
    for i, j in tree.query_pairs(rad):
        ov = min(y1[i], y1[j]) - max(y0[i], y0[j])
        if ov < VOVERLAP * min(h[i], h[j]):     # not the same text line
            continue
        hh = (h[i] + h[j]) / 2
        gap = (x0[j] - x1[i]) if x0[i] <= x0[j] else (x0[i] - x1[j])
        if not (GAP_MIN * hh <= gap <= GAP_MAX * hh):
            continue
        # directional rule: order by x, then CUT before a HEAD word unless the
        # left word is a MID connector ("…de la Cova" stays joined).
        li, ri = (i, j) if x0[i] <= x0[j] else (j, i)
        if norm[ri] in HEAD and norm[li] not in MID:
            continue
        cand.append((gap, i, j))
    cand.sort(key=lambda c: c[0])
    for gap, i, j in cand:
        ra, rb = find(i), find(j)
        if ra != rb and size[ra] + size[rb] <= CAP:
            parent[ra] = rb
            size[rb] += size[ra]

    # gather clusters
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    labels = []
    for k, members in enumerate(groups.values()):
        members.sort(key=lambda m: x0[m])  # reading order, left→right
        lx0 = float(min(x0[m] for m in members))
        ly0 = float(min(y0[m] for m in members))
        lx1 = float(max(x1[m] for m in members))
        ly1 = float(max(y1[m] for m in members))
        labels.append({
            "id": f"L{k:04d}",
            "bbox": [int(lx0), int(ly0), int(lx1 - lx0), int(ly1 - ly0)],
            "cx": int((lx0 + lx1) / 2),
            "cy": int((ly0 + ly1) / 2),
            "n_words": len(members),
            "hint": " ".join(det[m]["text"] for m in members),
            "members": [det[m]["id"] for m in members],
        })
    labels.sort(key=lambda L: (round(L["cy"] / 150), L["cx"]))

    out = os.path.join(BASE, "labels.json")
    json.dump({"source": "detections.json", "count": len(labels), "labels": labels},
              open(out, "w"), ensure_ascii=False)
    merged = sum(1 for L in labels if L["n_words"] > 1)
    PREFIX = {"Sô", "Câ", "Sa", "Sâ", "Son", "Can"}
    lone_prefix = sum(1 for L in labels if L["n_words"] == 1 and L["hint"].strip() in PREFIX)
    print(f">> detections: {n}")
    print(f">> labels:     {len(labels)}  ({n - len(labels)} fewer)")
    print(f">> multi-word labels: {merged}")
    print(f">> lone prefix tokens remaining (Sô/Câ/…): {lone_prefix}")
    sizes = {}
    for L in labels:
        sizes[L["n_words"]] = sizes.get(L["n_words"], 0) + 1
    print(f">> label sizes (words→count): {dict(sorted(sizes.items()))}")
    print(f"✓ {out}")


if __name__ == "__main__":
    main()
