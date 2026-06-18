#!/usr/bin/env python3
"""Georeference the toponyms from the EXACT points the user marked on the map.

Control points come in three layers, all placed by hand on the high-res scan and
TABULATED below so this script is self-contained (no dependency on the gitignored
dot/detection files):
  * RED dots  -> the 20 municipi positions (TOWN_ANCHORS; coords from pobles.json).
  * BLUE dots -> distinctive coastal capes/islands (extend the fit to the coast,
                 killing the convex-hull extrapolation that blew up coastal names).
  * YELLOW dots -> extra inland towns/villages (densify the interior).
The blue/yellow pixel centroids were detected in despuig-1785-original-marked3.jpg;
each is tied here to its modern feature (verified against the nearest engraved
label), and the real coordinate comes from pobles.json (municipis) or the NGIB
gazetteer (everything else; two capes absent from NGIB use a published coordinate).
The raw marked images / dot JSONs are kept locally only — these tables are the
authoritative copy of the hand-marked work.

Model: a single global thin-plate spline pixel->lon/lat over all exact points
(smoothing=0, every control point honoured exactly). A per-sheet split at the
central gutters was tried and rejected (too few points per sheet -> worse LOO).

    nix-shell scripts/toponims/shell.nix \
        --run "python3 scripts/toponims/mapkurator/georef.py"

Writes lon/lat into every entry of data/toponims/toponims.json and dumps the
control points to data/toponims/mapkurator/gcps.json for QA.
"""
import json
import math
import os
import re

import numpy as np
from scipy.interpolate import RBFInterpolator

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASE = os.path.join(ROOT, "data/toponims/mapkurator")
# parallel B-track support: override the toponym/gcps paths via env (defaults = A)
TOP_PATH = os.environ.get("TOPONIMS_JSON") or os.path.join(ROOT, "data/toponims/toponims.json")
GCPS_PATH = os.environ.get("GCPS_JSON") or os.path.join(BASE, "gcps.json")

# red dots: exact municipi pixel positions (marked by hand), name = pobles.json `nom`
TOWN_ANCHORS = [
    ( 7946,  5886, "Alaró"),               (13085,  3067, "Alcúdia"),
    ( 9207,  8902, "Algaida"),             ( 2321,  7650, "Andratx"),
    ( 8857,  6157, "Binissalem"),          ( 3791,  8129, "Calvià"),
    (10775, 11363, "Campos"),              ( 4780,  6384, "Esporles"),
    ( 9858,  5494, "Inca"),                (11626,  4395, "La Puebla (sa Pobla)"),
    ( 9069, 10141, "Llucmajor"),           (13932,  8751, "Manacor"),
    (12066,  5165, "Muro"),                ( 5809,  8415, "Palma"),
    (11418,  2574, "Pollença"),            (11288, 10024, "Porreres"),
    (12073, 12805, "Santanyí"),            ( 9905,  6826, "Sencelles"),
    (11289,  7203, "Sineu"),               ( 7021,  4502, "Sóller"),
]

# blue (coast) + yellow (village) dots -> modern feature, verified vs nearby label.
# src: pobles | ngib | fixed(lng,lat).  muni narrows generic NGIB names to one place.
ANCHORS = [
    # --- coast (blue) ---
    (14471,   966, "Cap de Formentor",  "ngib",  "Pollença"),
    (13996,  2383, "Cap des Pinar",     "ngib",  "Alcúdia"),
    ( 8448,  3053, "Cala Tuent",        "ngib",  "Escorca"),
    ( 6569,  3799, "Cap Gros",          "ngib",  "Sóller"),
    (15793,  4233, "Cap de Ferrutx",    "ngib",  "Artà"),
    (18192,  5570, "Cap de Pera",       "fixed", (3.4783, 39.7128)),
    (  620,  7378, "Illa Dragonera",    "fixed", (2.3267, 39.5840)),
    (15596,  9571, "Cala Petita",       "ngib",  "Manacor"),
    ( 3187, 10157, "Illa del Toro",     "ngib",  "Calvià"),
    ( 6805, 10216, "Cap Enderrocat",    "ngib",  "Llucmajor"),
    ( 7464, 12170, "Cap Blanc",         "ngib",  "Llucmajor"),
    (12751, 12983, "Caló des Moro",     "ngib",  "Santanyí"),
    (11395, 14069, "Cap de ses Salines","ngib",  "Santanyí"),
    # --- villages / extra towns (yellow) ---
    (10798,  4210, "Búger",             "ngib",  "Búger"),
    ( 9606,  4860, "Selva",             "pobles", None),
    ( 5349,  5895, "Valldemossa",       "pobles", None),
    ( 3864,  5923, "Banyalbufar",       "ngib",  "Banyalbufar"),
    ( 6757,  5967, "Bunyola",           "pobles", None),
    (12595,  6129, "Santa Margalida",   "pobles", None),
    (17464,  6143, "Capdepera",         "ngib",  "Capdepera"),
    (16298,  6451, "Artà",              "pobles", None),
    (12226,  6733, "Maria de la Salut", "ngib",  "Maria de la Salut"),
    ( 4100,  7327, "Puigpunyent",       "pobles", None),
    ( 7540,  7381, "Santa Maria del Camí", "pobles", None),
    (12496,  8069, "Petra",             "pobles", None),
    (11319,  8246, "Sant Joan",         "pobles", None),
    (10551,  8914, "Montuïri",          "pobles", None),
    (12774, 10742, "Felanitx",          "pobles", None),
]


def key(s):
    s = s.lower()
    for a, b in (("ô", "o"), ("â", "a"), ("ê", "e"), ("î", "i"), ("û", "u"),
                 ("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"),
                 ("ñ", "n"), ("ç", "c"), ("à", "a")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9 ]", " ", s).strip()


def m_err(lo, la, tlo, tla):
    return math.hypot((lo - tlo) * 111320 * math.cos(math.radians(la)),
                      (la - tla) * 110540)


def main():
    pobles = json.load(open(os.path.join(ROOT, "src/data/pobles.json")))["pobles"]
    coords = {p["nom"]: p["coords"] for p in pobles}
    ngib = json.load(open(os.path.join(ROOT, "data/toponims/ngib/llocs.json")))

    gcps = [{"layer": "town", "town": t, "x": x, "y": y,
             "lng": coords[t]["lng"], "lat": coords[t]["lat"]} for x, y, t in TOWN_ANCHORS]

    # rough town-only TPS, to disambiguate multi-hit NGIB names by position
    Pt = np.array([[g["x"], g["y"]] for g in gcps], float)
    LLt = np.array([[g["lng"], g["lat"]] for g in gcps], float)
    rough = RBFInterpolator(Pt, LLt, kernel="thin_plate_spline")

    def ngib_coord(name, muni, x, y):
        nk = key(name)
        hits = [g for g in ngib if key(g["grafia"]) == nk]
        if muni:
            mh = [g for g in hits if key(g.get("municipi", "")) == key(muni)]
            hits = mh or hits
        if not hits:
            return None
        plo, pla = rough([[x, y]])[0]
        g = min(hits, key=lambda g: m_err(g["lng"], g["lat"], plo, pla))
        return g["lng"], g["lat"]

    for idx, (x, y, name, src, arg) in enumerate(ANCHORS):
        if src == "pobles":
            c = coords.get(name)
            ll = (c["lng"], c["lat"]) if c else None
        elif src == "fixed":
            ll = arg
        else:
            ll = ngib_coord(name, arg, x, y)
        if ll is None:
            print(f"   !! no coord for {name} ({src}) — dropped")
            continue
        gcps.append({"layer": "coast" if idx < 13 else "village",
                     "town": name, "x": x, "y": y, "lng": round(ll[0], 6), "lat": round(ll[1], 6)})

    P = np.array([[g["x"], g["y"]] for g in gcps], float)
    LL = np.array([[g["lng"], g["lat"]] for g in gcps], float)
    layers = [g["layer"] for g in gcps]
    print(f">> {len(gcps)} control points "
          f"(towns {layers.count('town')}, coast {layers.count('coast')}, "
          f"village {layers.count('village')})")

    # Same transform family mapKurator uses: its m1_geotiff step warps with GDAL
    # gdal_translate -gcp + gdalwarp, exposing exactly affine (-order 1),
    # polynomial (-order 2) and thin-plate spline (-tps). We pick among those THREE
    # by leave-one-out on the held-out TOWNS (the ground-truth interior) — i.e. we
    # choose mapKurator's transform_method principledly rather than guessing it.
    # (An exact TPS rings between the dense coastal points, so -order 2 usually wins.)
    def design(p, deg):
        x, y = p[:, 0] / 1e4, p[:, 1] / 1e4
        cols = [np.ones_like(x)]
        for d in range(1, deg + 1):
            cols += [(x ** (d - i)) * (y ** i) for i in range(d + 1)]
        return np.column_stack(cols)

    def make(kind):
        if kind == "tps":
            r = RBFInterpolator(P, LL, kernel="thin_plate_spline")
            return lambda Q: r(Q)
        deg = int(kind[-1])
        c, *_ = np.linalg.lstsq(design(P, deg), LL, rcond=None)
        return lambda Q: design(Q, deg) @ c

    def loo(kind):
        town_e, all_e = [], []
        for i in range(len(gcps)):
            m = [j for j in range(len(gcps)) if j != i]
            if kind == "tps":
                pr = RBFInterpolator(P[m], LL[m], kernel="thin_plate_spline")([P[i]])[0]
            else:
                deg = int(kind[-1])
                c, *_ = np.linalg.lstsq(design(P[m], deg), LL[m], rcond=None)
                pr = (design(P[i:i + 1], deg) @ c)[0]
            e = m_err(pr[0], pr[1], LL[i, 0], LL[i, 1])
            all_e.append(e)
            if layers[i] == "town":
                town_e.append(e)
        return float(np.median(town_e)), float(np.median(all_e))

    scores = {k: loo(k) for k in ("poly1", "poly2", "tps")}   # mapKurator's affine/polynomial/tps
    best = min(scores, key=lambda k: scores[k][0])      # lowest held-out TOWN error
    label = {"poly1": "affine(-order1)", "poly2": "polynomial(-order2)", "tps": "tps"}
    for k, (te, ae) in scores.items():
        print(f"   {label[k]:18s} town-LOO {te:5.0f} m   all-LOO {ae:5.0f} m"
              + ("   <-- chosen" if k == best else ""))
    project = make(best)

    top = json.load(open(TOP_PATH))
    Q = np.array([[t["x"], t["y"]] for t in top["toponims"]], float)
    proj = project(Q)
    oob = 0
    for t, (lon, lat) in zip(top["toponims"], proj):
        if not (2.2 <= lon <= 3.6 and 39.2 <= lat <= 40.0):
            oob += 1
        t["lon"], t["lat"] = round(float(lon), 6), round(float(lat), 6)
    if oob:
        print(f"   note: {oob} toponyms project outside Mallorca's bbox (extreme extrapolation)")
    top["georef"] = {"model": best, "control_points": len(gcps),
                     "loo_median_m": round(scores[best][0])}
    json.dump(top, open(TOP_PATH, "w"),
              ensure_ascii=False, indent=1)
    json.dump({"count": len(gcps), "gcps": gcps},
              open(GCPS_PATH, "w"), ensure_ascii=False, indent=1)
    print(f"✓ lon/lat written for {len(top['toponims'])} toponyms; gcps.json saved")


if __name__ == "__main__":
    main()
