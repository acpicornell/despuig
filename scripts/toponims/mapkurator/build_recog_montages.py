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
import os

from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASE = os.path.join(ROOT, "data/toponims/mapkurator")
MONT = os.path.join(BASE, "recog")
ORIG = os.path.join(ROOT, "data/jpg/despuig-1785-original.jpg")

PER = 80        # labels per montage
RH = 70         # normalized crop height
COLS = 3
CW = 560        # cell width
GUT = 44        # space for the index label
PAD = 12


def main():
    labels = json.load(open(os.path.join(BASE, "labels.json")))["labels"]
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
            x, y, w, h = L["bbox"]
            mx, my = 10, 7
            c = im.crop((max(0, x - mx), max(0, y - my), x + w + mx, y + h + my))
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
