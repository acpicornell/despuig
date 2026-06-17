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


def rectify_member(im, poly, out_h, vpad=0.18):
    """Rectify ONE word to a horizontal strip using ALL the spotter's polygon
    points. The 16-point polygon follows the text contour: pts[0..7] = top edge
    left→right, pts[8..15] = bottom edge right→left. We pair them into 7 column
    quads (top[i],bot[i],bot[i+1],top[i+1]) and PIL-MESH-warp each onto its own
    output column — a piecewise unwarp along the curve, the same idea the model's
    BezierAlign uses. Handles rotated AND curved text exactly; no angle guessing."""
    p = np.array(poly, dtype=float)
    if len(p) < 16:
        return None
    top = p[0:8]
    bot = p[8:16][::-1]                    # reverse → left→right, aligned with top
    # pad outward along the vertical edge so ascenders/descenders survive
    d = top - bot
    top = top + d * vpad
    bot = bot - d * vpad
    seg = [(_dist(top[i], top[i + 1]) + _dist(bot[i], bot[i + 1])) / 2 for i in range(7)]
    hs = [(_dist(top[i], bot[i]) + _dist(top[i + 1], bot[i + 1])) / 2 for i in range(7)]
    W = sum(seg); H = float(np.mean(hs))
    if W < 4 or H < 4:
        return None
    out_w = max(6, int(out_h * W / H))
    xs, acc = [0.0], 0.0
    for s in seg:
        acc += s; xs.append(out_w * acc / W)
    mesh = []
    for i in range(7):
        box = (int(round(xs[i])), 0, int(round(xs[i + 1])), out_h)
        if box[2] <= box[0]:
            continue
        quad = (top[i][0], top[i][1], bot[i][0], bot[i][1],
                bot[i + 1][0], bot[i + 1][1], top[i + 1][0], top[i + 1][1])
        mesh.append((box, quad))
    if not mesh:
        return None
    return im.transform((out_w, out_h), Image.MESH, mesh,
                        resample=Image.BICUBIC, fillcolor=(255, 255, 255))


def rectify_label(im, polys, out_h=70, gap=6):
    """Rectify every word of a label and concatenate them left→right (members
    arrive sorted by link_labels). Uses the full spotter geometry per word."""
    strips = [s for s in (rectify_member(im, p, out_h) for p in polys) if s is not None]
    if not strips:
        return None
    W = sum(s.width for s in strips) + gap * (len(strips) - 1)
    out = Image.new("RGB", (W, out_h), (255, 255, 255))
    x = 0
    for s in strips:
        out.paste(s, (x, 0)); x += s.width + gap
    return out

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
