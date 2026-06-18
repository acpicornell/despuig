#!/usr/bin/env python3
"""Compare approach B (pilotB workflow output) against approach A (current.json) on
the pilot area. Reads only; writes nothing. Pass the workflow output JSON path.

    nix-shell scripts/toponims/shell.nix \
        --run "python3 scripts/toponims/mapkurator/compare_pilotB.py <wf_output.json>"
"""
import json, math, re, sys
from unidecode import unidecode

ROOT = __import__("os").path.abspath(__import__("os").path.join(
    __import__("os").path.dirname(__file__), "..", "..", ".."))
BASE = f"{ROOT}/data/toponims/mapkurator/pilotB"

out = json.load(open(sys.argv[1]))
B = out["result"]["windows"] if "result" in out else out["windows"]
A = json.load(open(f"{BASE}/current.json"))["current"]

# resolve each B toponym to a position via its window's box list
def core(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", unidecode((s or "").lower()))).strip()

bt = []
for win in B:
    boxes = {b["n"]: b for b in json.load(open(f"{BASE}/w{win['w']:02d}.json"))["words"]}
    for t in win["toponims"]:
        pts = [boxes[n] for n in t["boxes"] if n in boxes]
        if not pts:
            continue
        bt.append({"reading": t["reading"], "nb": len(t["boxes"]),
                   "x": sum(p["cx"] for p in pts) / len(pts),
                   "y": sum(p["cy"] for p in pts) / len(pts)})

def near(x, y, pool, k):
    best, bd = None, 1e9
    for p in pool:
        d = math.hypot(p[k[0]] - x, p[k[1]] - y)
        if d < bd:
            bd, best = d, p
    return best, bd

print(f"A (current MST+split): {len(A)} toponyms")
print(f"B (Claude group+read): {len(bt)} toponyms")
print(f"B multi-box groupings (>=2 boxes): {sum(1 for t in bt if t['nb'] >= 2)}")
print()

matched = same = diff = 0
diffs, miss_a, only_b = [], [], []
usedB = set()
for a in A:
    b, d = near(a["x"], a["y"], bt, ("x", "y"))
    if b and d < 300:
        matched += 1; usedB.add(id(b))
        if core(a["graf"]) == core(b["reading"]):
            same += 1
        else:
            diff += 1; diffs.append((a["graf"], b["reading"], round(d)))
    else:
        miss_a.append(a["graf"])
for b in bt:
    a, d = near(b["x"], b["y"], A, ("x", "y"))
    if not (a and d < 300):
        only_b.append(b["reading"])

print(f"A↔B aligned by position (<300px): {matched}  | identical reading: {same}  differ: {diff}")
print(f"in A but NOT found by B (B recall gaps): {len(miss_a)}")
print(f"in B but NOT in A (B found extra / over-split): {len(only_b)}")
print()
print("--- reading/grouping DIFFERENCES (A graf -> B reading) ---")
for ag, br, d in sorted(diffs, key=lambda z: z[0].lower())[:60]:
    print(f"  {ag!r:30s} -> {br!r}")
print()
print("--- in A, missed by B ---")
print(" ", ", ".join(repr(x) for x in miss_a[:40]))
print()
print("--- in B, not aligned to any A (new / regroup) ---")
print(" ", ", ".join(repr(x) for x in only_b[:40]))
