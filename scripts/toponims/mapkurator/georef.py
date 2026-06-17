#!/usr/bin/env python3
"""Georeference the toponyms from the EXACT points the user marked on the map.

Control points come in three layers, all placed by hand on the high-res scan:
  * RED dots  -> the 20 municipi labels (paired via the word-level OCR anchor).
  * BLUE dots -> distinctive coastal capes/islands (extend the fit to the coast,
                 killing the convex-hull extrapolation that blew up coastal names).
  * YELLOW dots -> extra inland towns/villages (densify the interior).
The blue/yellow centroids are detected in despuig-1785-original-marked3.jpg
(scripts produce data/toponims/mapkurator/qa/anchor-dots.json); each is tied here
to its modern feature (verified against the nearest engraved label), and the real
coordinate comes from pobles.json (municipis) or the NGIB gazetteer (everything
else; two capes absent from NGIB use their published coordinate).

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
PAIR_MAX = 1100.0                                  # px: max OCR-anchor->red-dot distance

# town reading-key -> pobles.json `nom` (red-dot layer)
TOWNS = {"palma": "Palma", "capital": "Palma", "inca": "Inca", "calvia": "Calvià",
    "andraix": "Andratx", "soller": "Sóller", "pollensa": "Pollença",
    "alcudia": "Alcúdia", "muro": "Muro", "selva": "Selva", "banalbufar": "Banyalbufar",
    "buñola": "Bunyola", "binisalem": "Binissalem", "sansellas": "Sencelles",
    "alaro": "Alaró", "san juan": "Sant Joan", "montuiri": "Montuïri",
    "manacor": "Manacor", "felanitx": "Felanitx", "campos": "Campos",
    "lluchmajor": "Llucmajor", "porreras": "Porreres", "puebla": "La Puebla (sa Pobla)",
    "santagni": "Santanyí", "santagn": "Santanyí", "algaida": "Algaida", "petra": "Petra",
    "espor": "Esporles", "puigpuñent": "Puigpunyent", "puigpunyent": "Puigpunyent",
    "sineu": "Sineu", "valldemossa": "Valldemossa", "campanet": "Campanet"}

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


def town_gcps(coords, dots, det):
    """Resolved red-dot<->town pairing: each dot belongs to its closest town only."""
    anch = {}
    for d in det:
        t = TOWNS.get(key(d["text"]))
        if t and (t not in anch or d.get("score", 0) > anch[t][0]):
            anch[t] = (d.get("score", 0), d["cx"], d["cy"])
    pair = {}
    for town, (_, ax, ay) in anch.items():
        if town not in coords:
            continue
        di, dist = min(((i, math.hypot(p["x"] - ax, p["y"] - ay)) for i, p in enumerate(dots)),
                       key=lambda z: z[1])
        pair[town] = (di, dist)
    bydot = {}
    for town, (di, dist) in pair.items():
        if di not in bydot or dist < bydot[di][1]:
            bydot[di] = (town, dist)
    out = []
    for di, (town, dist) in bydot.items():
        if dist < PAIR_MAX:
            out.append({"layer": "town", "town": town, "x": dots[di]["x"], "y": dots[di]["y"],
                        "lng": coords[town]["lng"], "lat": coords[town]["lat"]})
    return out


def main():
    pobles = json.load(open(os.path.join(ROOT, "src/data/pobles.json")))["pobles"]
    coords = {p["nom"]: p["coords"] for p in pobles}
    dots = json.load(open(os.path.join(BASE, "qa/town-dots.json")))
    det = json.load(open(os.path.join(BASE, "detections.json")))["detections"]
    ngib = json.load(open(os.path.join(ROOT, "data/toponims/ngib/llocs.json")))

    gcps = town_gcps(coords, dots, det)

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

    top = json.load(open(os.path.join(ROOT, "data/toponims/toponims.json")))
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
    json.dump(top, open(os.path.join(ROOT, "data/toponims/toponims.json"), "w"),
              ensure_ascii=False, indent=1)
    json.dump({"count": len(gcps), "gcps": gcps},
              open(os.path.join(BASE, "gcps.json"), "w"), ensure_ascii=False, indent=1)
    print(f"✓ lon/lat written for {len(top['toponims'])} toponyms; gcps.json saved")


if __name__ == "__main__":
    main()
