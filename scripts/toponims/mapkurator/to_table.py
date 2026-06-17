#!/usr/bin/env python3
"""Convert the mapKurator toponym list (toponims-clean.json) into the web/table
schema that ngib_match.py + src/pages/toponims.astro expect, replacing the legacy
data/toponims/toponims.json (kept in git history).

Schema per record: {id, graf, nom, tipus, x, y, dubte, subtile}
  graf   the engraving spelling, as read (mapKurator + Claude OCR)
  nom    modern-ish normalization (Sô->Son, Câ->Can, circumflexes dropped; towns
         mapped to their pobles.json form so the georeference anchors line up)
  tipus  possessió | nucli | costa | orònim | hidrònim | altre  (inferred)
  x, y   master-image pixels (from the label bbox centroid)
  dubte  true when the reading was low-confidence (spotter-hint fallback)

    nix-shell scripts/toponims/shell.nix \
        --run "python3 scripts/toponims/mapkurator/to_table.py"
"""
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASE = os.path.join(ROOT, "data/toponims/mapkurator")

# town reading -> pobles.json `nom` (georeference anchors must match exactly)
TOWNS = {
    "palma": "Palma", "capital": "Palma", "inca": "Inca", "calvia": "Calvià",
    "andraix": "Andratx", "soller": "Sóller", "pollensa": "Pollença",
    "alcudia": "Alcúdia", "muro": "Muro", "selva": "Selva",
    "banalbufar": "Banyalbufar", "buñola": "Bunyola", "binisalem": "Binissalem",
    "sansellas": "Sencelles", "alaro": "Alaró", "san juan": "Sant Joan",
    "montuiri": "Montuïri", "manacor": "Manacor", "felanitx": "Felanitx",
    "campos": "Campos", "lluchmajor": "Llucmajor", "porreras": "Porreres",
    "puebla": "La Puebla (sa Pobla)", "santagni": "Santanyí", "santagn": "Santanyí",
    "algaida": "Algaida", "petra": "Petra", "espor": "Esporles",
    "puigpuñent": "Puigpunyent", "puigpunyent": "Puigpunyent", "sineu": "Sineu",
    "valldemossa": "Valldemossa", "arta": "Artà", "campanet": "Campanet",
    "marratxi": "Marratxí", "sta maria": "Santa Maria del Camí",
    "sta margarita": "Santa Margalida",
}
# non-poble settlements (tagged nucli but not georef anchors)
NUCLI_EXTRA = {"la calobra", "colonia", "cabrera", "escorca", "caimari",
               "fornalutx", "biniaraix", "lluc alcari", "lluc", "de lluc",
               "orient", "biniamar", "llubi", "maria", "consell", "llorito",
               "deya", "deia", "mancor", "bujer", "vila", "alaro", "galilea",
               "establiments", "raxa", "vinromá", "buger"}

POSSES = ("son", "so", "can", "ca", "casa", "cas", "cal")
COSTA = ("cala", "calo", "cabo", "cap", "punta", "pta", "illot", "illa",
         "morro", "playa", "puerto", "port", "carregador", "ensenada", "freu",
         "escar", "caleta", "estaca", "moll", "muelle", "torre marina",
         "carrador", "barranc", "barrancar", "sal", "salinas", "estanq")
ORONIM = ("puig", "coll", "serra", "talaia", "talaya", "mola", "bec", "peñal",
          "penal", "penyal", "mirador", "atalaya", "atalayâ", "monte")
HIDRO = ("font", "fuente", "fuête", "pou", "estany", "sinia", "aljub", "neveras",
         "cova", "cueva")


def deacc(s):
    for a, b in (("ô", "o"), ("â", "a"), ("î", "i"), ("ê", "e"), ("û", "u")):
        s = s.replace(a, b)
    return s


def key(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ",
                  deacc((s or "").lower()))).strip()


def normalize_nom(text):
    """Modern-ish reading: expand Sô/Câ prefixes, drop circumflexes."""
    parts = text.split()
    out = []
    for i, w in enumerate(parts):
        wl = deacc(w.lower().strip(".,"))
        if i == 0 and wl in ("sô", "so", "sô."):
            out.append("Son"); continue
        if i == 0 and wl in ("câ", "ca", "câ."):
            out.append("Can"); continue
        out.append(deacc(w))
    return " ".join(out)


def tipus_of(text, k):
    toks = k.split()
    head = toks[0] if toks else ""
    if k in TOWNS or k in NUCLI_EXTRA:
        return "nucli"
    if head in POSSES:
        return "possessió"
    if head in COSTA or k.startswith("i ") or k.startswith("illot"):
        return "costa"
    if head in ORONIM:
        return "orònim"
    if head in HIDRO:
        return "hidrònim"
    return "altre"


SPLIT_HEADS = {"sô", "son", "câ", "can", "cas", "cal"}


def split_label(text):
    """Split an over-linked multi-possession label into its separate names — the
    linking (MST) sometimes merges adjacent possessions ('Sô Verdera Sô Fiol',
    'Sô Arnau Sô Berrina Sô Ramis'). Hard split on '/', then start a new name at
    each possessive head (Sô/Câ/Son/Can/Cas/Cal) once the running piece already
    carries a content word. A bare 'ca'/'so' WITHOUT the engraving circumflex is
    not a head, so legitimate single names ('Son Ca s'Hereu') are left intact.
    Returns [text] unchanged when there is nothing to split."""
    pieces = []
    for chunk in re.split(r"\s*/\s*", text):
        cur = []
        for w in chunk.split():
            has_content = any(c.lower().strip(".,") not in SPLIT_HEADS for c in cur)
            if w.lower().strip(".,") in SPLIT_HEADS and has_content:
                pieces.append(" ".join(cur)); cur = [w]
            else:
                cur.append(w)
        if cur:
            pieces.append(" ".join(cur))
    pieces = [p for p in pieces                       # drop a lone head / punctuation
              if any(c.lower().strip(".,") not in SPLIT_HEADS and len(c.strip(".,")) > 1
                     for c in p.split())]
    return pieces if len(pieces) > 1 else [text]


def clean_town_anchors():
    """Georeference control points must be 100% correct, so build them ONLY from
    the unique town names — never from ambiguous toponyms (homonyms would corrupt
    the fit). Pull each town's position from the WORD-LEVEL detection (not the
    linking-merged label), so a town swallowed into a multi-word label
    ('Sô Marron SINEU', 'MANACOR R Sô Mas') still gets its clean coordinate."""
    det = json.load(open(os.path.join(BASE, "detections.json")))["detections"]
    best = {}                                    # pobles nom -> (score, cx, cy)
    for d in det:
        town = TOWNS.get(key(d["text"]))
        if not town:
            continue
        sc = d.get("score", 0.0)
        if town not in best or sc > best[town][0]:
            best[town] = (sc, d["cx"], d["cy"])
    return {town: (v[1], v[2]) for town, v in best.items()}


def main():
    src = json.load(open(os.path.join(BASE, "toponims-clean.json")))["toponims"]
    anchors = clean_town_anchors()               # {pobles nom: (x, y)} from detections
    out = []
    seen_towns = set()
    n_split = 0
    for t in src:
        pieces = split_label(t["text"])
        if len(pieces) > 1:
            n_split += 1
        for idx, text in enumerate(pieces):
            k = key(text)
            tip = tipus_of(text, k)
            nom = TOWNS.get(k) or (normalize_nom(text))
            x, y = t["cx"], t["cy"]               # split pieces share the label position
            # a label that IS a town: tag nucli and snap to the clean word position
            if k in TOWNS and TOWNS[k] in anchors:
                tip = "nucli"; nom = TOWNS[k]; x, y = anchors[TOWNS[k]]
                seen_towns.add(TOWNS[k])
            out.append({
                "id": t["id"] if len(pieces) == 1 else f"{t['id']}_{idx + 1}",
                "graf": text,
                "nom": nom,
                "tipus": tip,
                "subtile": "",                   # mapKurator has no subtile grid
                "x": x, "y": y,
                "dubte": t["confidence"] == "low",
            })
    # towns the linking swallowed into a multi-word label never appear as a clean
    # nucli above — add a dedicated anchor entry from the detection position.
    for town, (x, y) in anchors.items():
        if town not in seen_towns:
            out.append({"id": f"T_{key(town).replace(' ', '_')}", "graf": town,
                        "nom": town, "tipus": "nucli", "subtile": "",
                        "x": x, "y": y, "dubte": False})
    doc = {
        "font": "Topònims del Mapa de la Isla de Mallorca del Cardenal Despuig "
                "(reedició reduïda), detectats amb mapKurator (spotter GPU) sobre "
                "l'escaneig d'alta resolució, enllaçats en cadenes multi-paraula "
                "(mètode mapKurator) i llegits per IA de visió (Claude). Pendents "
                "de revisió manual.",
        "esquema": {"graf": "grafia gravada (lectura IA)", "nom": "normalització",
                    "tipus": "possessió | nucli | costa | orònim | hidrònim | altre",
                    "x": "px x master", "y": "px y master", "dubte": "lectura incerta"},
        "comptador": {"toponims": len(out),
                      "dubtes": sum(1 for r in out if r["dubte"])},
        "toponims": out,
    }
    json.dump(doc, open(os.path.join(ROOT, "data/toponims/toponims.json"), "w"),
              ensure_ascii=False, indent=1)
    from collections import Counter
    print(f">> toponims: {len(out)}  dubtes: {doc['comptador']['dubtes']}  "
          f"(labels split into pieces: {n_split})")
    print(f">> tipus: {dict(Counter(r['tipus'] for r in out))}")
    print(f">> nuclis (georef anchors found): "
          f"{sorted(set(r['nom'] for r in out if r['tipus']=='nucli' and key(r['graf']) in TOWNS))}")
    print("✓ data/toponims/toponims.json (legacy overwritten; in git history)")


if __name__ == "__main__":
    main()
