#!/usr/bin/env python3
"""Render one engraving crop per toponym that still needs review (suggerit /
posicional / sense), plus a review-data.json the web review tool consumes.

    nix-shell scripts/toponims/mapkurator/shell.nix \
        --run "python3 scripts/toponims/mapkurator/render_review_crops.py"

Reads data/toponims/ngib/matches.json + data/toponims/b/recheck.json + the master
scan. Writes data/toponims/review-crops/<id>.jpg + data/toponims/review-data.json
(both gitignored, regenerable).
"""
import json, os
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CROPS = os.path.join(ROOT, "data/toponims/review-crops")
WANT = {"suggerit", "posicional", "sense"}
WW, WH, SCALE = 760, 320, 1.5

os.makedirs(CROPS, exist_ok=True)
matches = json.load(open(f"{ROOT}/data/toponims/ngib/matches.json"))
recheck = {r["id"]: r for r in json.load(open(f"{ROOT}/data/toponims/b/recheck.json"))}
master = Image.open(f"{ROOT}/data/jpg/despuig-1785-original.jpg").convert("RGB")

items = []
for m in matches:
    if m["decision"] not in WANT or m["id"] not in recheck:
        continue
    r = recheck[m["id"]]
    x, y = r["x"], r["y"]
    crop = master.crop((x - WW // 2, y - WH // 2, x + WW // 2, y + WH // 2)).copy()
    d = ImageDraw.Draw(crop)
    cx, cy = crop.width // 2, crop.height // 2
    d.line((cx - 16, cy, cx + 16, cy), fill=(220, 0, 0), width=2)
    d.line((cx, cy - 16, cx, cy + 16), fill=(220, 0, 0), width=2)
    crop = crop.resize((int(WW * SCALE), int(WH * SCALE)), Image.LANCZOS)
    crop.save(f"{CROPS}/{m['id']}.jpg", quality=82)
    items.append({
        "id": m["id"], "graf": m["graf"], "nom": m["nom"], "tipus": m["tipus"],
        "decision": m["decision"], "x": x, "y": y,
        "ngib": m.get("ngib"), "sim": m.get("sim"), "km": m.get("km"),
        "candidates": [{"grafia": c["grafia"], "municipi": c["municipi"],
                        "km": c["km"], "sim": c["sim"]} for c in r.get("candidates", [])[:6]],
    })

json.dump({"count": len(items), "items": items},
          open(f"{ROOT}/data/toponims/review-data.json", "w"), ensure_ascii=False)
from collections import Counter
print(f"review items: {len(items)}  {dict(Counter(i['decision'] for i in items))}")
print(f"✓ {CROPS}/<id>.jpg + data/toponims/review-data.json")
