#!/usr/bin/env python3
"""Downscaled master with a labelled master-pixel grid + detection dots, so the
cartouche/legend/title/inset regions can be read off in master coordinates.

    nix-shell scripts/toponims/mapkurator/shell.nix \
        --run "python3 scripts/toponims/mapkurator/grid_preview.py"

Writes data/toponims/mapkurator/qa/grid.png
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASE = os.path.join(ROOT, "data/toponims/mapkurator")
MASTER = os.path.join(ROOT, "data/jpg/despuig-1785-original.jpg")
OUTW = 2600
STEP = 1000  # grid every 1000 master px

im = Image.open(MASTER).convert("RGB")
W, H = im.size
s = OUTW / W
prev = im.resize((OUTW, round(H * s)))
d = ImageDraw.Draw(prev)

det = json.load(open(os.path.join(BASE, "detections.json")))["detections"]
for t in det:
    x, y = t["cx"] * s, t["cy"] * s
    d.ellipse([x - 1.5, y - 1.5, x + 1.5, y + 1.5], fill=(255, 23, 68))

try:
    font = ImageFont.truetype("DejaVuSans.ttf", 16)
except Exception:
    font = ImageFont.load_default()

for gx in range(0, W + 1, STEP):
    px = gx * s
    d.line([(px, 0), (px, prev.size[1])], fill=(0, 120, 255), width=1)
    d.text((px + 2, 2), str(gx), fill=(0, 80, 200), font=font)
for gy in range(0, H + 1, STEP):
    py = gy * s
    d.line([(0, py), (prev.size[0], py)], fill=(0, 120, 255), width=1)
    d.text((2, py + 2), str(gy), fill=(0, 80, 200), font=font)

os.makedirs(os.path.join(BASE, "qa"), exist_ok=True)
out = os.path.join(BASE, "qa", "grid.png")
prev.save(out)
print(f"✓ {out}  ({prev.size[0]}x{prev.size[1]}, grid every {STEP}px, {len(det)} dots)")
