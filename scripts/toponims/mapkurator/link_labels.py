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
GAP_CONN = 0.95    # max gap when one side is a connector (Sô/Câ/de/…) — aggressive
GAP_WORD = 0.32    # max gap between two ordinary words — conservative (tight kerning only)
GAP_MIN = -0.40    # allow slight horizontal overlap
CAP = 5            # max words per label — blocks runaway chains across dense rows

# Words that are never a toponym on their own — always part of a larger name.
CONNECTORS = {"sô", "câ", "sa", "sâ", "son", "can", "de", "del", "d'", "sas",
              "ses", "es", "na", "den", "la", "lo", "los", "ca", "so"}


def main():
    det = json.load(open(os.path.join(BASE, "detections.json")))["detections"]
    n = len(det)
    bb = np.array([t["bbox"] for t in det], dtype=float)  # x,y,w,h
    x0, y0 = bb[:, 0], bb[:, 1]
    x1, y1 = x0 + bb[:, 2], y0 + bb[:, 3]
    h = bb[:, 3]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    is_conn = [det[i]["text"].strip().lower().rstrip(".") in CONNECTORS for i in range(n)]

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
        if ov < VOVERLAP * min(h[i], h[j]):
            continue
        hh = (h[i] + h[j]) / 2
        gap = (x0[j] - x1[i]) if x0[i] <= x0[j] else (x0[i] - x1[j])
        # connector on either side → allow the big gap; otherwise require tight kerning
        limit = GAP_CONN if (is_conn[i] or is_conn[j]) else GAP_WORD
        if GAP_MIN * hh <= gap <= limit * hh:
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
