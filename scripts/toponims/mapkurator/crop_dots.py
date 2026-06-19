#!/usr/bin/env python3
"""Native-resolution crops around each detected GCP dot, to read the engraved
town name beside it (the Read tool downsamples big images; a small native crop
is legible).  Reads <q>/dots-detected.json, writes <q>/gcp-crops/dotNN.jpg.

  Q=se nix-shell scripts/toponims/mapkurator/shell.nix --run 'python3 scripts/toponims/mapkurator/crop_dots.py'
"""
import json
import os

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

Q = os.environ["Q"].lower()
QU = Q.upper()
CW = int(os.environ.get("CW", "900"))
CH = int(os.environ.get("CH", "620"))

det = json.load(open(f"data/toponims/{Q}/dots-detected.json"))
im = Image.open(f"data/jpg/{QU}/despuig-1785-original-{QU}-dots.jpg").convert("RGB")
W, H = im.size
outd = f"data/toponims/{Q}/gcp-crops"
os.makedirs(outd, exist_ok=True)
for d in det["dots"]:
    x, y = d["x"], d["y"]
    l = int(max(0, min(W - CW, x - CW / 2)))
    t = int(max(0, min(H - CH, y - CH / 2)))
    im.crop((l, t, l + CW, t + CH)).save(f'{outd}/dot{d["n"]:02d}.jpg', quality=88)
print(f'{Q} -> {len(det["dots"])} crops in {outd}')
