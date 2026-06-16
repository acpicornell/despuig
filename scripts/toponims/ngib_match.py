#!/usr/bin/env python3
"""Match the AI-read Despuig toponyms against the NGIB gazetteer.

Validates readings, normalises spellings (UIB grafia) and clears "dubte" flags.

Pipeline:
  1. Georeference: build a pixel -> lon/lat transform from the well-identified
     nuclis (matched to the curated towns in src/data/pobles.json). We compare a
     robust 2nd-order polynomial against a smoothing thin-plate spline and keep
     whichever has the lower leave-one-out error.
  2. Project every toponym to approximate modern coordinates.
  3. For each toponym, search NGIB neighbours with a cKDTree and score candidates
     with rapidfuzz (token_set_ratio / WRatio) plus a phonetic (metaphone) bonus,
     gated by distance. Classify into confirmat / suggerit / posicional / sense.

Run inside the Nix env:
  nix-shell scripts/toponims/shell.nix --run "python3 scripts/toponims/ngib_match.py"

Writes data/toponims/ngib/matches.json (no mutation of the source cells).
"""
import json
import math
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
from rapidfuzz import fuzz, process
from scipy.interpolate import RBFInterpolator
from scipy.spatial import cKDTree
import jellyfish
from unidecode import unidecode

ROOT = Path(__file__).resolve().parents[2]
load = lambda p: json.loads((ROOT / p).read_text())

toponims = load("data/toponims/toponims.json")["toponims"]
pobles = load("src/data/pobles.json")["pobles"]
ngib = load("data/toponims/ngib/llocs.json")

# ---------- text normalisation ----------
ARTICLES = {"de", "del", "dels", "des", "la", "el", "els", "les", "es", "sa", "ses",
            "sos", "s", "d", "l", "na", "en", "lo", "y", "i",
            "los", "las"}  # incl. the "des" (de+es) contraction and Spanish articles


def norm(s: str) -> str:
    s = unidecode(s or "").lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def core(s: str) -> str:
    """Normalised string with articles dropped (keeps son/can/cas/sant)."""
    return " ".join(t for t in norm(s).split() if t not in ARTICLES)


def metaphone_key(s: str) -> str:
    return " ".join(jellyfish.metaphone(t) for t in core(s).split() if len(t) > 2)


def similarity(read: str, grafia: str) -> float:
    """0..1 fuzzy similarity.

    token_sort_ratio (not token_set_ratio): it handles word reordering but still
    PENALISES extra/missing tokens, so a name is not a perfect match to a longer
    NGIB entry that merely contains it ("Camí de X", "Racó de X", "Avenc de X").
    A phonetic (metaphone) pass catches historic spelling variants.
    """
    a, b = core(read), core(grafia)
    if not a or not b:
        return 0.0
    base = fuzz.token_sort_ratio(a, b) / 100.0
    # Distinctive single-token containment: a short map label (e.g. "Santueri") for a
    # place the gazetteer only lists in full ("Castell de Santueri"). Restricted to a
    # long, specific token so generic words inside longer names are not matched.
    if len(a) >= 6 and " " not in a and a in b.split():
        base = max(base, 0.86)
    # Phonetics only REFINE an already-plausible literal match; they must not
    # rescue distant strings (e.g. Gomà/Coma share metaphone KM but differ).
    if base >= 0.70:
        ma, mb = metaphone_key(read), metaphone_key(grafia)
        if ma and mb:
            phon = fuzz.token_sort_ratio(ma, mb) / 100.0
            base = max(base, 0.5 * base + 0.5 * phon)
    return base


# ---------- local planar projection (metres) ----------
LAT0 = float(np.mean([p["coords"]["lat"] for p in pobles]))
LON0 = float(np.mean([p["coords"]["lng"] for p in pobles]))
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110540.0


def to_m(lng, lat):
    return np.array([(np.asarray(lng) - LON0) * KX, (np.asarray(lat) - LAT0) * KY]).T


def to_lonlat(mx, my):
    return mx / KX + LON0, my / KY + LAT0


# ---------- control points (nuclis <-> curated towns) ----------
pob_keys = [(core(p["nom"]), p["coords"]) for p in pobles]


def control_points():
    cps = []
    for t in toponims:
        if t["tipus"] != "nucli" or t.get("dubte"):
            continue
        k = core(t["nom"])
        best, bc = 0, None
        for pk, coords in pob_keys:
            r = fuzz.ratio(k, pk)
            if r > best:
                best, bc = r, coords
        if best >= 90:
            cps.append((t["x"], t["y"], bc["lng"], bc["lat"]))
    return np.array([[c[0], c[1]] for c in cps], float), np.array([[c[2], c[3]] for c in cps], float)


px, ll = control_points()
tgt = to_m(ll[:, 0], ll[:, 1])  # control targets in metres


def poly2_design(p):
    x, y = p[:, 0], p[:, 1]
    return np.column_stack([np.ones_like(x), x, y, x * x, x * y, y * y])


def fit_poly2(P, T):
    A = poly2_design(P)
    coef, *_ = np.linalg.lstsq(A, T, rcond=None)
    return lambda Q: poly2_design(Q) @ coef


def loo_error(kind, P, T):
    """Leave-one-out median error (metres)."""
    errs = []
    idx = np.arange(len(P))
    for i in idx:
        m = idx != i
        if kind == "poly2":
            f = fit_poly2(P[m], T[m])
            pred = f(P[i:i + 1])[0]
        else:
            f = RBFInterpolator(P[m], T[m], kernel="thin_plate_spline", smoothing=kind)
            pred = f(P[i:i + 1])[0]
        errs.append(math.hypot(*(pred - T[i])))
    return float(np.median(errs)), errs


# robust outlier removal on poly2 residuals, then choose model by LOO
keep = np.ones(len(px), bool)
for _ in range(3):
    f = fit_poly2(px[keep], tgt[keep])
    res = np.hypot(*(f(px) - tgt).T)
    thr = max(2.5 * np.median(res[keep]), 1500.0)
    new = res <= thr
    if new.sum() == keep.sum() or new.sum() < 12:
        keep = new
        break
    keep = new
P, T = px[keep], tgt[keep]

candidates = {"poly2": loo_error("poly2", P, T)}
for sm in (1e7, 1e8, 5e8):
    candidates[sm] = loo_error(sm, P, T)
best_kind = min(candidates, key=lambda k: candidates[k][0])
best_med = candidates[best_kind][0]

if best_kind == "poly2":
    project_m = fit_poly2(P, T)
else:
    rbf = RBFInterpolator(P, T, kernel="thin_plate_spline", smoothing=best_kind)
    project_m = lambda Q: rbf(Q)

# ---------- NGIB spatial index ----------
ngib_m = to_m([g["lng"] for g in ngib], [g["lat"] for g in ngib])
tree = cKDTree(ngib_m)

# ---------- match ----------
# The georeference is imperfect near the map frame and the 4-sheet gutter, so a
# purely distance-gated match drops obvious names (e.g. SINEU, POLLENSA) whose
# projection lands far from the real place. We widen the search radius and add a
# "name-first" rule: a near-exact name match is trusted even when the distance is
# loose, plus a whole-corpus fallback when the projection finds nothing nearby.
RADIUS_M = 12000.0
matches, counts = [], {"confirmat": 0, "suggerit": 0, "posicional": 0, "sense": 0}

ngib_core = [core(g["grafia"]) for g in ngib]  # precomputed keys for the global fallback
# Distinct municipalities per name: a name in ONE municipi is a single place (safe to
# trust by name alone); the same name across SEVERAL is a homonym (needs position).
ngib_municipis = defaultdict(set)
for _g in ngib:
    ngib_municipis[core(_g["grafia"])].add(_g.get("municipi"))


def n_municipis(grafia):
    return len(ngib_municipis.get(core(grafia), ()))

allpx = np.array([[t["x"], t["y"]] for t in toponims], float)
proj = project_m(allpx)

for t, pm in zip(toponims, proj):
    near = tree.query_ball_point(pm, RADIUS_M)
    best = None       # best by combined score (similarity minus distance penalty)
    best_name = None  # best by name similarity alone: (g, s, d)
    for j in near:
        g = ngib[j]
        d = math.hypot(*(ngib_m[j] - pm))
        s = max(similarity(t["nom"], g["grafia"]), similarity(t.get("graf", ""), g["grafia"]))
        score = s - d / 60000.0
        if best is None or score > best[0]:
            best = (score, s, d, g)
        if best_name is None or s > best_name[1]:
            best_name = (g, s, d)

    # Primary decision uses the position-balanced candidate, so confirmat always has
    # the position corroborating the name (homonym-safe by construction).
    decision, chosen = "sense", None  # chosen = (g, sim, dist_or_None)
    if best:
        _, s, d, g = best
        if s >= 0.90 and d <= 5000:
            decision, chosen = "confirmat", (g, s, d)
        elif s >= 0.70 and d <= 8000:
            decision, chosen = "suggerit", (g, s, d)
        elif d <= 1500 and s >= 0.45:
            decision, chosen = "posicional", (g, s, d)
    # Safety net for obvious names the georef shifted out of position: a near-exact
    # name in a SINGLE municipi has no homonym to confuse it with, so trust it.
    if decision != "confirmat" and best_name and best_name[1] >= 0.95 \
            and best_name[2] <= 12000 and n_municipis(best_name[0]["grafia"]) <= 1:
        decision, chosen = "confirmat", best_name
    if decision == "sense":
        # Whole-corpus fallback for names the georef threw out of range entirely.
        # No position to disambiguate -> only a near-exact, single-municipi name is
        # trusted (Sineu, Pollença); anything ambiguous stays a suggestion.
        key = core(t["nom"])
        hit = process.extractOne(key, ngib_core, scorer=fuzz.token_sort_ratio) if key else None
        if hit and hit[1] / 100.0 >= 0.95 and len(key) >= 5:
            g = ngib[hit[2]]
            unique = n_municipis(g["grafia"]) <= 1
            decision, chosen = ("confirmat" if unique else "suggerit"), (g, hit[1] / 100.0, None)

    counts[decision] += 1
    g = chosen[0] if chosen else None
    matches.append({
        "id": t["id"], "nom": t["nom"], "graf": t.get("graf"), "tipus": t["tipus"],
        "dubte": bool(t.get("dubte")), "decision": decision,
        "ngib": g["grafia"] if g else None,
        "municipi": g["municipi"] if g else None,
        "sim": round(chosen[1], 2) if chosen else 0.0,
        "km": (round(chosen[2] / 1000, 2) if chosen and chosen[2] is not None else None),
    })

(ROOT / "data/toponims/ngib/matches.json").write_text(json.dumps(matches, ensure_ascii=False, indent=1))

# ---------- report ----------
dub = [t for t in toponims if t.get("dubte")]
resolved = [m for m in matches if m["dubte"] and m["decision"] == "confirmat"]
print(f"\nGeoreference: {len(P)} control points, model={best_kind}, "
      f"median error (LOO) {best_med:.0f} m")
print(f"  (alternatives: " + ", ".join(f"{k}={v[0]:.0f}m" for k, v in candidates.items()) + ")\n")
print(f"Toponyms: {len(toponims)}  |  current doubts: {len(dub)}")
print("NGIB classification:")
for k in ("confirmat", "suggerit", "posicional", "sense"):
    print(f"  {k:<11} {counts[k]}")
print(f"\nDoubts a 'confirmat' match would resolve: {len(resolved)}")
print("\nSample confirmed corrections (AI reading -> NGIB):")
shown = 0
for m in matches:
    if m["decision"] == "confirmat" and core(m["nom"]) != core(m["ngib"]):
        print(f"  [{m['tipus'][:4]}] \"{m['nom']}\"  ->  \"{m['ngib']}\"  "
              f"(sim {m['sim']}, {m['km']} km, {m['municipi'] or '?'})")
        shown += 1
        if shown >= 25:
            break
print("\n✓ data/toponims/ngib/matches.json")
