#!/usr/bin/env python3
"""Strategy 4 — vision recheck. Render a context crop of the real engraving around
every uncertain toponym, grouped into numbered montages, alongside an index that
carries each crop's gazetteer candidates. A vision pass (Claude) then reads each
crop and picks the matching candidate (or says none / gives a corrected reading);
apply_recheck.py folds the picks back into matches.json.

    nix-shell scripts/toponims/mapkurator/shell.nix \
        --run "python3 scripts/toponims/mapkurator/build_recheck_montages.py [decision]"

Default target = 'suggerit'. Reads data/toponims/recheck.json (candidates) +
data/jpg/despuig-1785-original.jpg (clean master). Writes
data/toponims/mapkurator/recheck/r##.png + index.json (gitignored).
"""
import json
import os
import sys

from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "data/toponims/mapkurator/recheck")

TARGET = sys.argv[1] if len(sys.argv) > 1 else "suggerit"
WW, WH = 660, 250            # master crop window (px) around the toponym point
CELL_H = 180                 # montage cell height
COLS, ROWS = 4, 6            # 24 crops per page
PAD = 8


def main():
    os.makedirs(OUT, exist_ok=True)
    recheck = json.load(open(os.path.join(ROOT, "data/toponims/recheck.json")))
    items = [r for r in recheck if r.get("decision") == TARGET]
    master = Image.open(os.path.join(ROOT, "data/jpg/despuig-1785-original.jpg")).convert("RGB")
    print(f">> {len(items)} '{TARGET}' toponyms -> montages of {COLS*ROWS}")

    index = []
    per = COLS * ROWS
    for pg in range((len(items) + per - 1) // per):
        chunk = items[pg * per:(pg + 1) * per]
        cellw = int(WW * CELL_H / WH)
        sheet = Image.new("RGB", (COLS * (cellw + PAD) + PAD,
                                  ROWS * (CELL_H + PAD) + PAD), (255, 255, 255))
        dr = ImageDraw.Draw(sheet)
        page_items = []
        for k, r in enumerate(chunk):
            x, y = r["x"], r["y"]
            crop = master.crop((x - WW // 2, y - WH // 2, x + WW // 2, y + WH // 2)).copy()
            d = ImageDraw.Draw(crop)
            cx, cy = crop.width // 2, crop.height // 2
            d.line((cx - 13, cy, cx + 13, cy), fill=(220, 0, 0), width=2)
            d.line((cx, cy - 13, cx, cy + 13), fill=(220, 0, 0), width=2)
            crop = crop.resize((cellw, CELL_H), Image.LANCZOS)
            row, col = divmod(k, COLS)
            x0 = PAD + col * (cellw + PAD)
            y0 = PAD + row * (CELL_H + PAD)
            sheet.paste(crop, (x0, y0))
            dr.rectangle((x0, y0, x0 + cellw, y0 + CELL_H), outline=(150, 150, 150))
            dr.text((x0 + 3, y0 + 2), f"#{k + 1}", fill=(0, 0, 220))
            page_items.append({
                "n": k + 1, "id": r["id"], "graf": r.get("graf"), "nom": r["nom"],
                "tipus": r["tipus"],
                "candidates": [{"grafia": c["grafia"], "municipi": c["municipi"],
                                "km": c["km"], "sim": c["sim"]} for c in r["candidates"]],
            })
        fn = f"r{pg + 1:02d}.png"
        sheet.save(os.path.join(OUT, fn))
        index.append({"page": pg + 1, "file": fn, "items": page_items})
    json.dump({"target": TARGET, "pages": len(index), "index": index},
              open(os.path.join(OUT, "index.json"), "w"), ensure_ascii=False, indent=1)
    print(f"✓ {len(index)} pages -> {OUT}/r##.png + index.json")


if __name__ == "__main__":
    main()
