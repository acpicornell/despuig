#!/usr/bin/env python3
"""Multiword string construction — mapKurator's method.

Links single-word detections into multiword toponyms using the edge-cost +
spanning approach from Olson, Kim & Chiang, "Automatic Search of Multiword Place
Names on Historical Maps" (ACM SIGSPATIAL 2024, arXiv:2410.15586):

    cost(i,j) = d(i,j) · (1 + h(i,j)) · (1 + a(i,j)) · (1 + c(i,j))

  d  spatial distance between the boxes (here normalized by mean text height so
     the cut threshold is scale-free)
  h  taller/shorter height ratio − 1            (0 … ∞)
  a  |sin(Δangle)| between the text axes          (0 … 1)
  c  capitalization mismatch: 0 if both ALLCAPS or both not, else 1

Height and angle come from each polygon's minimum-area rectangle. The paper
builds one MST over all labels and traverses it to answer a query; we need
discrete labels instead, so we grow groups greedily in ascending cost up to a cut
threshold (TAU) — the height/angle/caps multipliers make a label bind only to a
same-shape, same-angle, same-case neighbour. On top of the geometric cost we keep
one domain cut: never bind across a HEAD word (Son/Can/Cala/…) unless a MID
connector (de/del) precedes it — geometry alone can't tell two adjacent same-style
Son-farms apart, and this is a partitioning task, not the paper's search task.

    nix-shell scripts/toponims/mapkurator/shell.nix \
        --run "python3 scripts/toponims/mapkurator/link_labels.py"

Reads  data/toponims/mapkurator/detections.json
Writes data/toponims/mapkurator/labels.json
"""
import json
import math
import os

import numpy as np
from scipy.spatial import cKDTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASE = os.path.join(ROOT, "data/toponims/mapkurator")

TAU = 1.30   # cut: drop edges whose (height-normalized) cost exceeds this
CAP = 6      # max words per label (safety against runaway chains)

HEAD = {"so", "son", "co", "ca", "can", "casa", "cas", "cal", "sa", "ses", "sas",
        "es", "el", "la", "lo", "los", "na", "den", "s", "sant", "santa", "san",
        "n", "hort", "mort", "puig", "coll", "pou", "cala", "calo", "punta", "pta",
        "torre", "torra", "torr", "mola", "moli", "molino", "refal", "refalet",
        "camp", "pla", "illot", "illa", "cabo", "cap", "playa", "coma", "serra",
        "font", "bassa", "morro", "cova", "roca", "vall", "alga", "alqueria"}
MID = {"de", "del", "dels", "d", "dela", "des"}


def _norm(s):
    s = s.strip().lower().rstrip(".,;:·").lstrip("·")
    if s.endswith("'"):
        s = s[:-1]
    for a, b in (("ô", "o"), ("â", "a"), ("î", "i"), ("ê", "e"), ("û", "u"),
                 ("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"),
                 ("à", "a"), ("ñ", "n"), ("ç", "c")):
        s = s.replace(a, b)
    return s


def _geom(poly):
    """height, reading angle, axis-aligned bbox — from the ordered polygon."""
    p = np.array(poly, dtype=float)
    m = len(p) // 2
    top, bot = p[:m], p[m:][::-1]           # bottom reversed → aligned with top
    h = (np.linalg.norm(top[0] - bot[0]) + np.linalg.norm(top[-1] - bot[-1])) / 2
    v = top[-1] - top[0]
    ang = math.atan2(v[1], v[0])
    return h, ang, (p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max())


def _box_dist(a, b):
    dx = max(0.0, a[0] - b[2], b[0] - a[2])
    dy = max(0.0, a[1] - b[3], b[1] - a[3])
    return math.hypot(dx, dy)


def _is_caps(t):
    letters = [ch for ch in t if ch.isalpha()]
    return len(letters) >= 2 and all(ch.isupper() for ch in letters)


def main():
    det = json.load(open(os.path.join(BASE, "detections.json")))["detections"]
    n = len(det)
    H = np.zeros(n); ANG = np.zeros(n); BOX = [None] * n
    for i, d in enumerate(det):
        H[i], ANG[i], BOX[i] = _geom(d["poly"])
    caps = [_is_caps(det[i]["text"]) for i in range(n)]
    norm = [_norm(det[i]["text"]) for i in range(n)]
    cx = np.array([(BOX[i][0] + BOX[i][2]) / 2 for i in range(n)])
    cy = np.array([(BOX[i][1] + BOX[i][3]) / 2 for i in range(n)])

    parent = list(range(n)); size = [1] * n
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a

    tree = cKDTree(np.c_[cx, cy])
    rad = float(np.median(H) * 6 + np.median([BOX[i][2] - BOX[i][0] for i in range(n)]) * 2)
    edges = []
    for i, j in tree.query_pairs(rad):
        hh = (H[i] + H[j]) / 2
        if hh < 1e-6:
            continue
        # same text line only: a multiword name runs along one baseline, so the
        # offset perpendicular to the reading direction must be small. Without
        # this, the cost binds vertically-stacked distinct labels in dense areas.
        amean = (ANG[i] + ANG[j]) / 2
        dvx, dvy = cx[j] - cx[i], cy[j] - cy[i]
        perp = abs(-math.sin(amean) * dvx + math.cos(amean) * dvy)
        if perp > 0.7 * hh:
            continue
        # mapKurator edge cost (distance normalized by mean height)
        d = _box_dist(BOX[i], BOX[j]) / hh
        h = max(H[i], H[j]) / max(1e-6, min(H[i], H[j])) - 1.0
        a = abs(math.sin(ANG[i] - ANG[j]))
        c = 0.0 if caps[i] == caps[j] else 1.0
        cost = d * (1 + h) * (1 + a) * (1 + c)
        if cost > TAU:
            continue
        # domain cut: never bind across a HEAD word unless preceded by a MID
        li, ri = (i, j) if BOX[i][0] <= BOX[j][0] else (j, i)
        if norm[ri] in HEAD and norm[li] not in MID:
            continue
        edges.append((cost, i, j))

    # grow groups greedily, lowest cost first (MST-like), capped
    edges.sort(key=lambda e: e[0])
    for cost, i, j in edges:
        ra, rb = find(i), find(j)
        if ra != rb and size[ra] + size[rb] <= CAP:
            parent[ra] = rb; size[rb] += size[ra]

    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    labels = []
    for k, members in enumerate(groups.values()):
        # order words along the group's mean reading direction, then x
        amean = np.mean([ANG[m] for m in members])
        ux, uy = math.cos(amean), math.sin(amean)
        members.sort(key=lambda m: cx[m] * ux + cy[m] * uy)
        xs0 = [BOX[m][0] for m in members]; ys0 = [BOX[m][1] for m in members]
        xs1 = [BOX[m][2] for m in members]; ys1 = [BOX[m][3] for m in members]
        lx0, ly0, lx1, ly1 = min(xs0), min(ys0), max(xs1), max(ys1)
        labels.append({
            "id": f"L{k:04d}",
            "bbox": [int(lx0), int(ly0), int(lx1 - lx0), int(ly1 - ly0)],
            "cx": int((lx0 + lx1) / 2), "cy": int((ly0 + ly1) / 2),
            "n_words": len(members),
            "hint": " ".join(det[m]["text"] for m in members),
            "members": [det[m]["id"] for m in members],
        })
    labels.sort(key=lambda L: (round(L["cy"] / 150), L["cx"]))

    json.dump({"source": "detections.json", "method": "mapkurator-mst-cost",
               "count": len(labels), "labels": labels},
              open(os.path.join(BASE, "labels.json"), "w"), ensure_ascii=False)
    merged = sum(1 for L in labels if L["n_words"] > 1)
    sizes = {}
    for L in labels:
        sizes[L["n_words"]] = sizes.get(L["n_words"], 0) + 1
    print(f">> detections: {n}")
    print(f">> labels:     {len(labels)}  ({n - len(labels)} fewer)")
    print(f">> multi-word: {merged}  | sizes {dict(sorted(sizes.items()))}")
    print(f"✓ {os.path.join(BASE, 'labels.json')}")


if __name__ == "__main__":
    main()
