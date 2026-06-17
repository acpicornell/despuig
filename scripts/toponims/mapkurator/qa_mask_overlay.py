#!/usr/bin/env python3
"""QA for the masked-image detection run.

The mask painted over the cartouches/vignettes is PAPER-COLOURED (not red), so it
can't be found by colour. Instead we derive the masked regions by diffing marked2
against the original: large solid blocks that changed = the painted-out areas.
Then we report how many detections leaked into them (should be ~0) and draw an
overlay on a downscaled copy of marked2 for visual review.

    nix-shell scripts/toponims/mapkurator/shell.nix \
        --run "python3 scripts/toponims/mapkurator/qa_mask_overlay.py"

Reads  data/jpg/despuig-1785-original{,-marked2}.jpg, data/toponims/mapkurator/detections.json
Writes data/toponims/mapkurator/qa/overlay-marked.png
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASE = os.path.join(ROOT, "data/toponims/mapkurator")
ORIG = os.path.join(ROOT, "data/jpg/despuig-1785-original.jpg")
MASKED = os.path.join(ROOT, os.environ.get("MK_MASTER", "data/jpg/despuig-1785-original-marked1.jpg"))
OUTW = 3200            # output width (downscaled for review)
DIFF_T = 200           # per-pixel sum-of-abs change to count as "repainted"
MIN_MASK_AREA = 15000  # keep only large painted blocks (drop jpeg-noise specks)

o = np.asarray(Image.open(ORIG).convert("RGB")).astype(np.int16)
mimg = Image.open(MASKED).convert("RGB")
m = np.asarray(mimg).astype(np.int16)
H, W = m.shape[:2]

# --- mask = large solid regions that changed vs the original ---
changed = np.abs(o - m).sum(2) > DIFF_T
changed = ndimage.binary_opening(changed, iterations=1)  # drop 1px noise
lbl, n = ndimage.label(changed)
sizes = np.bincount(lbl.ravel())
keep = sizes >= MIN_MASK_AREA
keep[0] = False                      # label 0 = background
mask = keep[lbl]                     # bool HxW of the real painted regions
print(f">> painted mask blocks (>= {MIN_MASK_AREA}px): {int(keep.sum())}")
print(f">> masked area: {mask.sum()/mask.size*100:.2f}% of the image")

# --- detections whose centre lands inside a painted region (= leaked) ---
det = json.load(open(os.path.join(BASE, "detections.json")))["detections"]
def in_mask(cx, cy):
    return bool(mask[cy, cx]) if (0 <= cy < H and 0 <= cx < W) else False
leaked = [t for t in det if in_mask(int(t["cx"]), int(t["cy"]))]
print(f">> detections total: {len(det)}")
print(f">> detections inside a painted (masked) region: {len(leaked)}")
for t in leaked[:25]:
    print(f"   LEAK id={t['id']} text={t['text']!r} score={t['score']:.2f} @({t['cx']},{t['cy']})")

# --- overlay on the downscaled masked master ---
s = OUTW / W
prev = mimg.resize((OUTW, round(H * s)))
d = ImageDraw.Draw(prev, "RGBA")
# outline the masked regions (blue) so the reviewer sees what was painted out
small_mask = np.asarray(Image.fromarray(mask).resize((OUTW, round(H * s))))
edge = small_mask ^ ndimage.binary_erosion(small_mask)
ey, ex = np.where(edge)
for x, y in zip(ex, ey):
    prev.putpixel((int(x), int(y)), (0, 120, 255))
for t in det:
    pts = [(x * s, y * s) for x, y in t["poly"]]
    leak = in_mask(int(t["cx"]), int(t["cy"]))
    d.line(pts + [pts[0]], fill=(255, 0, 0, 255) if leak else (0, 200, 0, 200), width=1)
out = os.path.join(BASE, "qa", "overlay-marked.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
prev.save(out)
print(f"✓ {out}  ({prev.size[0]}x{prev.size[1]}, {len(det)} polygons; "
      f"green=ok, red=leaked, blue outline=masked region)")
