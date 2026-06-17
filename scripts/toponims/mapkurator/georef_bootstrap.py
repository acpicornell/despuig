#!/usr/bin/env python3
"""Densify the georeference by bootstrapping from high-confidence NGIB matches.

The 48 hand-marked control points (towns + coast + villages) pin the global trend,
but a 2nd-order polynomial only has 6 DOF, so it can't capture the engraving's
LOCAL distortion. A thin-plate spline (mapKurator's `-tps` option) can — but needs
points everywhere, not just at the 48 anchors. So we iterate:

  fit -> project every toponym -> the ones that match NGIB *unambiguously*
  (sim>=0.95, name in a single municipi, already within 2.5 km of the projection)
  become NEW control points (their map pixel <-> the NGIB coordinate) -> refit.

Guards against feedback drift:
  * only near-exact, single-municipi names (no homonym to latch onto wrongly);
  * only matches already close to the current projection (trustworthy, not a wild
    textual coincidence);
  * one control point per NGIB entry; none within 250 px of an existing one;
  * the 48 hand-marked anchors are NEVER removed and always trusted.

Validation is on the 48 hand-marked anchors ONLY (leave-one-anchor-out, predicted
from the other anchors + all bootstrapped points). If that error drops, the
densification genuinely helps; if it rises, the bootstrap is adding noise.

    nix-shell scripts/toponims/shell.nix \
        --run "python3 scripts/toponims/mapkurator/georef_bootstrap.py"

Overwrites lon/lat in data/toponims/toponims.json and writes gcps-bootstrap.json.
"""
import json
import math
import os
import re
from collections import defaultdict

import numpy as np
from rapidfuzz import fuzz
from scipy.interpolate import RBFInterpolator
from scipy.spatial import cKDTree
import jellyfish
from unidecode import unidecode

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASE = os.path.join(ROOT, "data/toponims/mapkurator")

SIM_MIN = 0.95          # near-exact name only
DIST_MAX = 2500.0       # m: match must already sit close to the projection
MIN_SPACING = 250.0     # px: don't pile bootstrapped points on top of each other
RADIUS_M = 8000.0

ARTICLES = {"de", "del", "dels", "des", "la", "el", "els", "les", "es", "sa", "ses",
            "sos", "s", "d", "l", "na", "en", "lo", "y", "i", "los", "las"}


def norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", unidecode(s or "").lower())).strip()


def core(s):
    return " ".join(t for t in norm(s).split() if t not in ARTICLES)


def metaphone_key(s):
    return " ".join(jellyfish.metaphone(t) for t in core(s).split() if len(t) > 2)


def similarity(read, grafia):
    a, b = core(read), core(grafia)
    if not a or not b:
        return 0.0
    base = fuzz.token_sort_ratio(a, b) / 100.0
    if len(a) >= 6 and " " not in a and a in b.split():
        base = max(base, 0.86)
    if base >= 0.70:
        ma, mb = metaphone_key(read), metaphone_key(grafia)
        if ma and mb:
            base = max(base, 0.5 * base + 0.5 * fuzz.token_sort_ratio(ma, mb) / 100.0)
    return base


def main():
    gcps = json.load(open(os.path.join(BASE, "gcps.json")))["gcps"]
    top = json.load(open(os.path.join(ROOT, "data/toponims/toponims.json")))
    toponims = top["toponims"]
    pobles = json.load(open(os.path.join(ROOT, "src/data/pobles.json")))["pobles"]
    ngib = json.load(open(os.path.join(ROOT, "data/toponims/ngib/llocs.json")))

    LAT0 = float(np.mean([p["coords"]["lat"] for p in pobles]))
    LON0 = float(np.mean([p["coords"]["lng"] for p in pobles]))
    KX = 111320.0 * math.cos(math.radians(LAT0))
    KY = 110540.0
    to_m = lambda lon, lat: np.array([(np.asarray(lon) - LON0) * KX,
                                      (np.asarray(lat) - LAT0) * KY]).T

    ngib_m = to_m([g["lng"] for g in ngib], [g["lat"] for g in ngib])
    tree = cKDTree(ngib_m)
    municipis = defaultdict(set)
    for g in ngib:
        municipis[core(g["grafia"])].add(g.get("municipi"))

    # trusted anchors (never dropped); their leave-one-out error is the yardstick
    TP = np.array([[g["x"], g["y"]] for g in gcps], float)
    TLL = np.array([[g["lng"], g["lat"]] for g in gcps], float)
    allpx = np.array([[t["x"], t["y"]] for t in toponims], float)

    def make(kind, P, LL):
        if kind == "tps":
            r = RBFInterpolator(P, LL, kernel="thin_plate_spline")
            return lambda Q: r(Q)
        x, y = P[:, 0] / 1e4, P[:, 1] / 1e4
        A = np.column_stack([np.ones_like(x), x, y, x * x, x * y, y * y])
        c, *_ = np.linalg.lstsq(A, LL, rcond=None)
        return lambda Q: np.column_stack([np.ones(len(Q)), Q[:, 0] / 1e4, Q[:, 1] / 1e4,
                                          (Q[:, 0] / 1e4) ** 2, (Q[:, 0] / 1e4) * (Q[:, 1] / 1e4),
                                          (Q[:, 1] / 1e4) ** 2]) @ c

    def err_m(pr, lo, la):
        return math.hypot((pr[0] - lo) * KX, (pr[1] - la) * KY)

    def anchor_loo(kind, BP, BLL):
        errs = []
        for i in range(len(TP)):
            keep = [j for j in range(len(TP)) if j != i]
            P = np.vstack([TP[keep], BP]) if len(BP) else TP[keep]
            LL = np.vstack([TLL[keep], BLL]) if len(BP) else TLL[keep]
            pr = make(kind, P, LL)(TP[i:i + 1])[0]
            errs.append(err_m(pr, TLL[i, 0], TLL[i, 1]))
        return float(np.median(errs))

    base = anchor_loo("poly2", np.empty((0, 2)), np.empty((0, 2)))
    base_tps = anchor_loo("tps", np.empty((0, 2)), np.empty((0, 2)))
    print(f"anchor LOO (48 only): poly2 {base:.0f} m   tps {base_tps:.0f} m")

    boot = []          # dicts: x,y,lng,lat,ngib,sim
    used_ngib = set()
    for it in range(1, 9):
        BP = np.array([[b["x"], b["y"]] for b in boot], float) if boot else np.empty((0, 2))
        BLL = np.array([[b["lng"], b["lat"]] for b in boot], float) if boot else np.empty((0, 2))
        P = np.vstack([TP, BP]) if len(BP) else TP
        LL = np.vstack([TLL, BLL]) if len(BP) else TLL
        proj = make("tps", P, LL)(allpx)
        projm = to_m(proj[:, 0], proj[:, 1])

        ctrl_px = np.vstack([P, [[b["x"], b["y"]] for b in boot]]) if False else P
        ctrl_tree = cKDTree(ctrl_px)
        added = 0
        for t, pm in zip(toponims, projm):
            near = tree.query_ball_point(pm, RADIUS_M)
            best = None
            for j in near:
                g = ngib[j]
                s = max(similarity(t["nom"], g["grafia"]), similarity(t.get("graf", ""), g["grafia"]))
                if best is None or s > best[0]:
                    best = (s, j, g)
            if not best or best[0] < SIM_MIN:
                continue
            s, j, g = best
            if len(municipis.get(core(g["grafia"]), ())) > 1:     # homonym -> unsafe
                continue
            d = math.hypot(*(ngib_m[j] - pm))
            if d > DIST_MAX or j in used_ngib:
                continue
            if ctrl_tree.query([t["x"], t["y"]])[0] < MIN_SPACING:  # too close to a control pt
                continue
            boot.append({"x": t["x"], "y": t["y"], "lng": g["lng"], "lat": g["lat"],
                         "ngib": g["grafia"], "sim": round(s, 2)})
            used_ngib.add(j)
            ctrl_tree = cKDTree(np.vstack([ctrl_px, [[t["x"], t["y"]]]]))
            ctrl_px = np.vstack([ctrl_px, [[t["x"], t["y"]]]])
            added += 1
        BP = np.array([[b["x"], b["y"]] for b in boot], float)
        BLL = np.array([[b["lng"], b["lat"]] for b in boot], float)
        loo = anchor_loo("tps", BP, BLL)
        print(f"iter {it}: +{added} new ({len(boot)} bootstrapped)  anchor-LOO(tps) {loo:.0f} m")
        if added == 0:
            break

    # final model: pick mapKurator transform (poly2 / tps) by anchor LOO on trusted+boot
    BP = np.array([[b["x"], b["y"]] for b in boot], float)
    BLL = np.array([[b["lng"], b["lat"]] for b in boot], float)
    cand = {k: anchor_loo(k, BP, BLL) for k in ("poly2", "tps")}
    best = min(cand, key=cand.get)
    print(f"final anchor-LOO: " + ", ".join(f"{k} {v:.0f}m" for k, v in cand.items())
          + f"  -> {best}")
    if cand[best] >= base:
        print("!! bootstrap did NOT beat the 48-anchor poly2 baseline — keeping baseline, no write")
        return

    P = np.vstack([TP, BP]); LL = np.vstack([TLL, BLL])
    proj = make(best, P, LL)(allpx)
    oob = 0
    for t, (lon, lat) in zip(toponims, proj):
        if not (2.2 <= lon <= 3.6 and 39.2 <= lat <= 40.0):
            oob += 1
        t["lon"], t["lat"] = round(float(lon), 6), round(float(lat), 6)
    top["georef"] = {"model": f"{best}+bootstrap", "control_points": len(P),
                     "anchors": len(TP), "bootstrapped": len(boot),
                     "loo_median_m": round(cand[best])}
    json.dump(top, open(os.path.join(ROOT, "data/toponims/toponims.json"), "w"),
              ensure_ascii=False, indent=1)
    json.dump({"anchors": len(TP), "bootstrapped": len(boot), "points": boot},
              open(os.path.join(BASE, "gcps-bootstrap.json"), "w"), ensure_ascii=False, indent=1)
    print(f"✓ {len(P)} control points ({len(TP)} anchors + {len(boot)} bootstrapped), "
          f"model {best}, anchor-LOO {cand[best]:.0f} m (was {base:.0f}); {oob} OOB; lon/lat written")


if __name__ == "__main__":
    main()
