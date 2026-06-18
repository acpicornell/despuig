#!/usr/bin/env python3
"""PILOT (architecture comparison): render a map region with the spotter's WORD
detections drawn as numbered boxes, so Claude can do the grouping+reading itself
(replacing the MST linker). Also dumps the word list and the CURRENT pipeline's
toponyms in the same region, to compare.

    nix-shell scripts/toponims/mapkurator/shell.nix \
        --run "python3 scripts/toponims/mapkurator/pilot_boxes.py"
"""
import json, os, re
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "data/toponims/mapkurator/pilot")
X0, Y0, W, H = 9000, 7800, 1500, 1100
SCALE = 1.7

os.makedirs(OUT, exist_ok=True)
det = json.load(open(os.path.join(ROOT, "data/toponims/mapkurator/detections.json")))["detections"]
top = json.load(open(os.path.join(ROOT, "data/toponims/toponims.json")))["toponims"]

inreg = [w for w in det if X0 <= w["cx"] < X0 + W and Y0 <= w["cy"] < Y0 + H]
inreg.sort(key=lambda w: (round((w["cy"] - Y0) / 110), w["cx"]))   # reading order

master = Image.open(os.path.join(ROOT, "data/jpg/despuig-1785-original.jpg")).convert("RGB")
crop = master.crop((X0, Y0, X0 + W, Y0 + H)).resize((int(W * SCALE), int(H * SCALE)), Image.LANCZOS)
dr = ImageDraw.Draw(crop)
words = []
for i, w in enumerate(inreg, 1):
    bx, by, bw, bh = w["bbox"]
    x0 = (bx - X0) * SCALE; y0 = (by - Y0) * SCALE
    dr.rectangle((x0, y0, x0 + bw * SCALE, y0 + bh * SCALE), outline=(200, 0, 0), width=2)
    dr.text((x0, y0 - 11), str(i), fill=(0, 0, 230))
    words.append({"n": i, "text": w["text"], "cx": w["cx"], "cy": w["cy"]})
crop.save(os.path.join(OUT, "region.png"))

# current pipeline toponyms in the same region (for the comparison)
cur = [{"id": t["id"], "graf": t["graf"], "nom": t["nom"], "x": t["x"], "y": t["y"]}
       for t in top if X0 <= t["x"] < X0 + W and Y0 <= t["y"] < Y0 + H]
json.dump({"region": [X0, Y0, W, H], "scale": SCALE, "words": words},
          open(os.path.join(OUT, "words.json"), "w"), ensure_ascii=False, indent=1)
json.dump({"current": cur}, open(os.path.join(OUT, "current.json"), "w"),
          ensure_ascii=False, indent=1)
print(f">> region {X0},{Y0} {W}x{H}: {len(words)} word boxes, {len(cur)} current toponyms")
print(f"✓ {OUT}/region.png + words.json + current.json")
