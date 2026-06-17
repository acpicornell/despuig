#!/usr/bin/env python3
"""Assemble the final toponym list from linked labels + Claude readings.

Hybrid recognition: where a montage was hand-read (read/mNN.json), use Claude's
text (high confidence); for illegible cells ("?") or montages not hand-read, fall
back to the spotter's OCR hint (low confidence) so nothing is lost. Marker-only
cells ("⊙") and empties are dropped.

    nix-shell scripts/toponims/mapkurator/shell.nix \
        --run "python3 scripts/toponims/mapkurator/build_toponims.py"

Reads  data/toponims/mapkurator/{labels.json, recog/index.json, read/m*.json}
Writes data/toponims/mapkurator/toponims-final.json
"""
import glob
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASE = os.path.join(ROOT, "data/toponims/mapkurator")

DROP = {"⊙", "", "·", "-"}


def main():
    labels = {L["id"]: L for L in json.load(open(os.path.join(BASE, "labels.json")))["labels"]}
    idx = json.load(open(os.path.join(BASE, "recog/index.json")))["montages"]

    # label id -> (montage number, local index, hint)
    loc = {}
    for m in idx:
        for c in m["cells"]:
            loc[c["id"]] = (m["montage"], c["i"], c["hint"])

    # load all hand-read montages
    readings = {}  # montage number -> {local idx (int): text}
    for f in glob.glob(os.path.join(BASE, "read", "m*.json")):
        mnum = int(os.path.basename(f)[1:-5])
        readings[mnum] = {int(k): v for k, v in json.load(open(f)).items()}

    out = []
    stats = {"high": 0, "low_illegible": 0, "low_notread": 0, "dropped": 0}
    for lid, L in labels.items():
        mnum, li, hint = loc.get(lid, (None, None, L["hint"]))
        text, conf = None, None
        if mnum in readings:
            r = readings[mnum].get(li)
            if r is None:                       # cell beyond what was transcribed
                text, conf = hint, "low"; stats["low_notread"] += 1
            elif r.strip() in DROP:
                stats["dropped"] += 1; continue
            elif r.strip() == "?":
                text, conf = hint, "low"; stats["low_illegible"] += 1
            else:
                text, conf = r.strip(), "high"; stats["high"] += 1
        else:                                   # montage not hand-read yet
            text, conf = hint, "low"; stats["low_notread"] += 1
        if not text or text.strip() in DROP:
            stats["dropped"] += 1; continue
        out.append({
            "id": lid, "text": text, "confidence": conf,
            "bbox": L["bbox"], "cx": L["cx"], "cy": L["cy"],
            "n_words": L["n_words"], "members": L["members"], "spotter_hint": hint,
        })
    out.sort(key=lambda t: (round(t["cy"] / 150), t["cx"]))
    json.dump({"count": len(out), "stats": stats, "toponims": out},
              open(os.path.join(BASE, "toponims-final.json"), "w"), ensure_ascii=False)
    print(f">> labels: {len(labels)}  montages hand-read: {sorted(readings)}")
    print(f">> toponims: {len(out)}  | {stats}")
    print(f"✓ data/toponims/mapkurator/toponims-final.json")


if __name__ == "__main__":
    main()
