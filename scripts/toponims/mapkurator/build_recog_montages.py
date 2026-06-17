#!/usr/bin/env python3
"""Build numbered montages of every linked label for the Claude recognition pass.

Crops each label from the CLEAN original, normalizes height, packs ~N per image
into numbered cells, and writes a sidecar index mapping (montage, local index) →
label id. The recognition step reads each montage and writes read/mNN.json with
{local_index: text}; build_toponims.py then joins those to label ids.

    nix-shell scripts/toponims/mapkurator/shell.nix \
        --run "python3 scripts/toponims/mapkurator/build_recog_montages.py"
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASE = os.path.join(ROOT, "data/toponims/mapkurator")
MONT = os.path.join(BASE, "recog")
ORIG = os.path.join(ROOT, "data/jpg/despuig-1785-original.jpg")


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def rectify_label(im, polys, out_h=70, pad=0.18):
    """Rectify a label to a horizontal strip via the spotter's ordered polygon.

    Each 16-point polygon follows the text: pts[0..7] = top edge left→right,
    pts[8..15] = bottom edge right→left. So the label's source quad is
    TL=first.member top-left, TR=last.member top-right, BR=last.member
    bottom-right, BL=first.member bottom-left. A PIL QUAD warp maps that quad onto
    a level rectangle — the same idea as the model's BezierAlign — so rotated or
    skewed coastal text comes out upright and readable, and horizontal interior
    text is unchanged. Members arrive sorted left→right (link_labels)."""
    ps = [np.array(p, dtype=float) for p in polys if len(p) >= 16]
    if not ps:
        return None
    first, last = ps[0], ps[-1]
    TL, BL = first[0], first[15]
    TR, BR = last[7], last[8]
    w = (_dist(TL, TR) + _dist(BL, BR)) / 2
    h = (_dist(TL, BL) + _dist(TR, BR)) / 2
    if w < 4 or h < 4:
        return None
    # widen the quad slightly so ascenders/edges aren't clipped
    px = (TR - TL); py = (BL - TL)
    nx = px / (np.linalg.norm(px) + 1e-6); ny = py / (np.linalg.norm(py) + 1e-6)
    ex, ey = nx * (w * pad), ny * (h * pad)
    TL2, TR2 = TL - ex - ey, TR + ex - ey
    BL2, BR2 = BL - ex + ey, BR + ex + ey
    out_w = max(8, int(out_h * (w / h)))
    # PIL QUAD data order: UL, LL, LR, UR of the SOURCE quad
    data = [TL2[0], TL2[1], BL2[0], BL2[1], BR2[0], BR2[1], TR2[0], TR2[1]]
    return im.transform((out_w, out_h), Image.QUAD, data,
                        resample=Image.BICUBIC, fillcolor=(255, 255, 255))

PER = 80        # labels per montage
RH = 70         # normalized crop height
COLS = 3
CW = 560        # cell width
GUT = 44        # space for the index label
PAD = 12


def main():
    labels = json.load(open(os.path.join(BASE, "labels.json")))["labels"]
    poly = {d["id"]: d["poly"] for d in
            json.load(open(os.path.join(BASE, "detections.json")))["detections"]}
    # already sorted in reading order by link_labels; keep it (spatially coherent)
    im = Image.open(ORIG).convert("RGB")
    os.makedirs(MONT, exist_ok=True)
    index = []
    nmont = (len(labels) + PER - 1) // PER
    for mi in range(nmont):
        chunk = labels[mi * PER:(mi + 1) * PER]
        cells = []
        entry = {"montage": mi + 1, "file": f"m{mi+1:02d}.png", "cells": []}
        for li, L in enumerate(chunk, 1):
            c = rectify_label(im, [poly[m] for m in L["members"] if m in poly])
            if c is None:                  # fallback: plain axis-aligned crop
                x, y, w, h = L["bbox"]
                c = im.crop((max(0, x - 10), max(0, y - 7), x + w + 10, y + h + 7))
            sc = RH / c.height
            cw = max(1, int(c.width * sc))
            c = c.resize((cw, RH), Image.LANCZOS)
            if c.width > CW - GUT:            # shrink over-long labels to fit
                c = c.resize((CW - GUT, RH), Image.LANCZOS)
            cells.append((li, L["n_words"], c))
            entry["cells"].append({"i": li, "id": L["id"], "hint": L["hint"]})
        rows = (len(cells) + COLS - 1) // COLS
        rowh = RH + PAD
        W, H = COLS * CW, rows * rowh + PAD
        mont = Image.new("RGB", (W, H), (255, 255, 255))
        d = ImageDraw.Draw(mont)
        for k, (li, nw, c) in enumerate(cells):
            r, cc = divmod(k, COLS)
            x0, y0 = cc * CW + 4, PAD + r * rowh
            col = (0, 120, 0) if nw > 1 else (190, 0, 0)
            d.text((x0, y0 + RH // 2 - 6), str(li), fill=col)
            mont.paste(c, (x0 + GUT, y0))
        mont.save(os.path.join(MONT, entry["file"]))
        index.append(entry)
    json.dump({"per": PER, "n_montages": nmont, "montages": index},
              open(os.path.join(MONT, "index.json"), "w"), ensure_ascii=False)
    print(f">> labels: {len(labels)}  montages: {nmont}  →  {MONT}/m01..m{nmont:02d}.png")


if __name__ == "__main__":
    main()
