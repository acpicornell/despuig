#!/usr/bin/env python3
"""Read-only quality audit of the per-sheet toponym notations.

Surfaces likely problems WITHOUT modifying anything:
  - truncation / fragment suspects (very short, lowercase, dangling tokens,
    a name that is a prefix of a near neighbour)
  - duplicates (same reading repeated; same NGIB reused; near-identical
    coordinates with similar names = probable double-detection)
  - junk (digits / odd characters / empty)
  - spatial outliers (georef position outside the Mallorca bbox)

Homonyms are real (two Bini, Son Sureda Vell/Nou…), so duplicates are only
REPORTED, never acted on. Writes a JSON report for later triage.
"""
import json, os, re, sys, unicodedata
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
QS = ["nw", "ne", "se", "sw"]
BBOX = (2.30, 3.55, 39.20, 40.10)  # lon_min, lon_max, lat_min, lat_max (Mallorca)

try:
    from rapidfuzz.distance import Levenshtein
    def ratio(a, b):
        return Levenshtein.normalized_similarity(a, b)
except Exception:
    import difflib
    def ratio(a, b):
        return difflib.SequenceMatcher(None, a, b).ratio()


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def load():
    rows = []
    for q in QS:
        base = f"{ROOT}/data/toponims/{q}"
        topo = {t["id"]: t for t in json.load(open(f"{base}/toponims.json"))["toponims"]}
        try:
            cur = json.load(open(f"{base}/curation.json"))
        except FileNotFoundError:
            cur = {}
        try:
            matches = {m["id"]: m for m in json.load(open(f"{base}/matches.json"))}
        except FileNotFoundError:
            matches = {}
        for tid, t in topo.items():
            c = cur.get(tid, {})
            if c.get("verdict") == "trash":
                continue  # already discarded by hand
            m = matches.get(tid, {})
            rows.append({
                "uid": f"{q}:{tid}", "q": q, "id": tid,
                "graf": t.get("graf", ""), "nom": t.get("nom", ""),
                "tipus": t.get("tipus", ""), "dubte": t.get("dubte", False),
                "x": t.get("x"), "y": t.get("y"), "subtile": t.get("subtile", ""),
                "lon": t.get("lon"), "lat": t.get("lat"),
                "decision": m.get("decision"), "ngib": m.get("ngib"),
                "municipi": m.get("municipi"), "km": m.get("km"),
                "review": m.get("review"),
            })
    return rows


def audit(rows):
    rep = defaultdict(list)

    # ---- junk / truncation per-row ----
    STOP = {"de", "den", "des", "del", "la", "el", "es", "sa", "so", "son", "can",
            "ca", "na", "ses", "els", "les", "puig", "coll", "cap", "pou", "font"}
    for r in rows:
        nom = (r["nom"] or "").strip()
        n = norm(nom)
        if not n:
            rep["empty"].append(r); continue
        if re.search(r"\d", nom):
            rep["has_digit"].append(r)
        if re.search(r"[^A-Za-zÀ-ÿ0-9 '·\-\.]", nom):
            rep["odd_char"].append(r)
        # truncation suspects: very short single token, or lowercase start, or dangling
        toks = n.split()
        if len(n) <= 3 and n not in STOP:
            rep["very_short"].append(r)
        if nom[:1].islower():
            rep["lower_start"].append(r)
        if re.search(r"[\-']$", nom) or re.search(r"^[\-']", nom):
            rep["dangling_edge"].append(r)
        if len(toks) == 1 and len(n) <= 4 and n not in STOP:
            rep["short_single"].append(r)

    # ---- exact duplicate readings (same normalized nom) ----
    bynom = defaultdict(list)
    for r in rows:
        n = norm(r["nom"])
        if n:
            bynom[n].append(r)
    for n, group in bynom.items():
        if len(group) > 1:
            rep["dup_nom"].append({"nom": n, "count": len(group),
                                   "items": [g["uid"] for g in group]})

    # ---- same NGIB reused across toponyms ----
    byngib = defaultdict(list)
    for r in rows:
        if r["ngib"]:
            byngib[norm(r["ngib"])].append(r)
    for g, group in byngib.items():
        if len(group) > 1:
            rep["dup_ngib"].append({"ngib": group[0]["ngib"], "count": len(group),
                                    "items": [{"uid": x["uid"], "nom": x["nom"],
                                               "km": x["km"], "municipi": x["municipi"]}
                                              for x in group]})

    # ---- near-identical coordinates with similar names (double-detection) ----
    # group by quadrant+subtile, compare pixel distance
    bytile = defaultdict(list)
    for r in rows:
        if r["x"] is not None:
            bytile[(r["q"], r["subtile"])].append(r)
    seen = set()
    for key, group in bytile.items():
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                d = ((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2) ** 0.5
                if d <= 40:
                    sim = ratio(norm(a["nom"]), norm(b["nom"]))
                    if sim >= 0.6:
                        pair = tuple(sorted((a["uid"], b["uid"])))
                        if pair in seen:
                            continue
                        seen.add(pair)
                        rep["near_dup"].append({"a": a["uid"], "anom": a["nom"],
                                                "b": b["uid"], "bnom": b["nom"],
                                                "px": round(d, 1), "sim": round(sim, 2)})

    # ---- spatial outliers ----
    for r in rows:
        if r["lon"] is None or r["lat"] is None:
            continue
        if not (BBOX[0] <= r["lon"] <= BBOX[1] and BBOX[2] <= r["lat"] <= BBOX[3]):
            rep["geo_outlier"].append(r)

    return rep


def main():
    rows = load()
    rep = audit(rows)
    slim = {"total": len(rows)}
    print(f"\n=== QUALITY AUDIT — {len(rows)} toponyms (trashed excluded) ===\n")
    order = ["empty", "very_short", "short_single", "lower_start", "dangling_edge",
             "has_digit", "odd_char", "dup_nom", "dup_ngib", "near_dup", "geo_outlier"]
    DESC = {
        "empty": "buit (sense lectura)",
        "very_short": "molt curt (≤3) — possible truncat",
        "short_single": "token únic curt (≤4) — possible truncat",
        "lower_start": "comença en minúscula — possible fragment",
        "dangling_edge": "comença/acaba en - o '",
        "has_digit": "conté dígits",
        "odd_char": "caràcters estranys",
        "dup_nom": "lectures idèntiques repetides (pot ser homònim!)",
        "dup_ngib": "mateix NGIB reusat en ≥2 topònims",
        "near_dup": "coords quasi idèntiques + nom semblant (doble detecció)",
        "geo_outlier": "posició fora de Mallorca",
    }
    for k in order:
        v = rep.get(k, [])
        print(f"{len(v):>5}  {k:<14} {DESC[k]}")
        slim[k] = v
    # a few concrete examples for the eye
    def ex(k, n, fmt):
        v = rep.get(k, [])
        if not v:
            return
        print(f"\n  · {k} (mostra {min(n, len(v))}/{len(v)}):")
        for it in v[:n]:
            print("     " + fmt(it))
    ex("very_short", 12, lambda r: f'{r["uid"]:<10} "{r["nom"]}"  [{r["decision"]}] {r["municipi"] or ""}')
    ex("short_single", 12, lambda r: f'{r["uid"]:<10} "{r["nom"]}"  [{r["decision"]}]')
    ex("lower_start", 12, lambda r: f'{r["uid"]:<10} "{r["nom"]}"')
    ex("near_dup", 15, lambda p: f'{p["a"]} "{p["anom"]}"  ≈  {p["b"]} "{p["bnom"]}"  ({p["px"]}px, sim {p["sim"]})')
    ex("dup_ngib", 12, lambda d: f'{d["ngib"]:<22} ×{d["count"]}  ' + " · ".join(f'{i["uid"]}({i["nom"]})' for i in d["items"][:4]))
    ex("geo_outlier", 10, lambda r: f'{r["uid"]:<10} "{r["nom"]}" lon={r["lon"]} lat={r["lat"]}')

    out = f"{ROOT}/data/toponims/mapkurator/quality_report.json"
    json.dump(slim, open(out, "w"), ensure_ascii=False, indent=1, default=str)

    # Flags per-entry for the curation tool — NOTATION problems only.
    # Name/NGIB duplicates are NOT flagged: Mallorcan homonyms are legitimate.
    PROB = ["empty", "very_short", "short_single", "lower_start",
            "dangling_edge", "has_digit", "odd_char"]
    flags = defaultdict(list)
    for k in PROB:
        for r in rep.get(k, []):
            flags[r["uid"]].append(k)
    fp = f"{ROOT}/data/toponims/mapkurator/quality_flags.json"
    json.dump(flags, open(fp, "w"), ensure_ascii=False, indent=1)
    print(f"\n✓ informe complet → {out}")
    print(f"✓ flags ({len(flags)} entrades) → {fp}\n")


if __name__ == "__main__":
    main()
