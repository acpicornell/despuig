# Toponym pipeline

Extracts the place names engraved on the Despuig map, georeferences them, and
matches them against the **NGIB** gazetteer to feed the web table (`/toponims`,
which imports `data/toponims/ngib/matches.json`).

> The current pipeline is built on **mapKurator** (GPU text-spotting). An earlier
> hand-sliced "subtile + vision-AI cell" approach was replaced by it and removed
> (recoverable in git history). The spotting/detection half lives in
> [`mapkurator/`](mapkurator/README.md); this README covers the whole chain.

## Pipeline (in order)

Everything from the detections onward is one `npm run` per stage. Stages run in a
Nix shell (no global pip): `mapkurator/shell.nix` has Pillow/shapely;
`shell.nix` has scipy/rapidfuzz/jellyfish. The `npm` scripts pick the right one.

| # | `npm run` | Script | In → Out |
|---|-----------|--------|----------|
| 1 | *(see [`mapkurator/`](mapkurator/README.md))* | spotter container | scan → `mapkurator/detections.json` (word-level boxes + English OCR) |
| 2 | `toponims:link` | `mapkurator/link_labels.py` | detections → `mapkurator/labels.json` — joins words into multi-word place names (mapKurator's *multiword string construction*: MST over a height/angle/caps cost, same-line gate) |
| 3 | `toponims:recog` | `mapkurator/build_recog_montages.py` | labels → `mapkurator/recog/m*.png` — MESH-rectifies each label upright (from its 16-pt polygon) into montages for reading |
| 4 | *(human/AI OCR)* | — | montages read into `mapkurator/read/m*.json` (Claude vision; the spotter's English OCR is only a low-confidence fallback) |
| 5 | `toponims:build` | `mapkurator/build_toponims.py` | labels + read → `mapkurator/toponims-final.json` |
| 6 | `toponims:clean` | `mapkurator/clean_toponims.py` | → `toponims-clean.json` (+ `toponims-rejected.json`) — drops non-toponyms (numbers, single chars, decorative lettering, lone articles) |
| 7 | `toponims:table` | `mapkurator/to_table.py` | → `data/toponims/toponims.json` — web/table schema (`graf`, `nom`, `tipus`, `x`, `y`, `dubte`); also **splits over-linked labels** the MST merged (`Sô Verdera Sô Fiol` → two entries, one per possessive head) |
| 8 | `toponims:georef` | `mapkurator/georef.py` | adds `lon`/`lat` per toponym (see **Georeference**) |
| 9 | `toponims:georef-bootstrap` | `mapkurator/georef_bootstrap.py` | densifies the georeference (see below) |
| 10 | `toponims:ngib-fetch` | `ngib-fetch.mjs` | downloads the Mallorca NGIB subset → `ngib/llocs.json` (run once; regenerable) |
| 11 | `toponims:ngib-match` | `ngib_match.py` | → `ngib/matches.json` (+ `recheck.json`) — the file the web reads |

`toponims:vinetes` (`vinetes-server.mjs`) is unrelated to this chain — it's the
deferred Phase-2 tool for the map's cartouche hotspots (`/mapa`).

## Georeference

The pixel→lon/lat transform is built from **exact control points the user marked
by hand** on the high-res scan (not from noisy OCR centroids), so every anchor is
correct by construction:

- **20 towns** (red dots) → coords from `src/data/pobles.json`.
- **13 coastal capes/islands** (blue dots) → NGIB by name+municipi (two absent
  capes use a published coordinate). These extend the fit to the coast and kill
  the convex-hull extrapolation that used to throw coastal names kilometres away.
- **15 villages** (yellow dots) → pobles.json / NGIB. Densify the interior.

Each marked dot was cross-checked against the nearest engraved label; the
identities and sources are the `ANCHORS` table in `georef.py`. The gutters between
the map's 4 sheets (green cross, x≈9687 / y≈7507) were tested as a per-sheet split
but rejected (too few points per sheet).

**Model = mapKurator's own** (its `m1_geotiff` warps with GDAL `gdal_translate
-gcp` + `gdalwarp`, offering affine `-order 1` / polynomial `-order 2` / `-tps`).
`georef.py` fits those three and picks by leave-one-out on the held-out towns →
**polynomial order 2** (≈1.1 km town LOO). The math is GDAL's, computed in numpy
(no GDAL dependency yet — could be wired for a QGIS GeoTIFF).

**Bootstrap densification** (`georef_bootstrap.py`): a global order-2 polynomial
has only 6 DOF, so it can't capture the engraving's *local* distortion. The
bootstrap iterates *fit → project → promote the unambiguous matches to control
points* (sim ≥ 0.95, name unique to one municipi, already < 2.5 km from its
projection, ≥ 250 px apart) and refits with a **thin-plate spline** (mapKurator's
`-tps`; density stops it ringing). It only keeps the result if it beats the
48-anchor baseline, **validated on the 48 hand-marked anchors** (leave-one-out:
~1435 m → ~1233 m). Converges at ~192 bootstrapped points (240 total) and roughly
**halves** the median confirmed-match distance.

## NGIB matching & classification (`ngib_match.py`)

Reads the precomputed `lon`/`lat`, searches NGIB neighbours (`cKDTree`), and scores
each candidate name (`similarity()`):

- base = rapidfuzz `token_sort_ratio` on the article-stripped cores (penalises
  extra/missing tokens, so a name isn't a false match to a longer entry that merely
  contains it);
- two refinements that only *raise* an already-plausible match (base ≥ 0.70),
  blended 50/50 so neither rescues a distant string: an **orthographic fold** that
  canonicalises 18th-c Mallorquí engraving spelling toward the modern grafia
  (`ll↔y`, `h`-drop, `v→b`, `ç/ss→s`, palatal `tx/ig/tj→x`, collapsed doubles —
  e.g. `Son Mayol`↔`Son Mallol`, `Buch`↔`Buc`), and a **metaphone** pass (jellyfish)
  for residual phonetic variants.

**Distance only disambiguates homonyms, it never discards a unique name.** The
score then feeds a confidence ladder:

- **`confirmat`** — the *name* is (near-)certain: a name unique to one municipi with
  sim ≥ 0.88 (≤ 6 km), or a homonym whose name **and** position are both strong
  (sim ≥ 0.90, ≤ 5 km).
- **`probable`** — the *position* is certain and the name is a looser variant
  (quasi-sure): a hit ≤ 1 km with sim ≥ 0.82, or ≤ 1.5 km with sim ≥ 0.85. The
  close position disambiguates the homonym; the spelling just differs from the
  gazetteer. Calibrated on the data (below ~0.82, real errors creep in).
- **`suggerit`** — plausible, needs a look (unique name sim ≥ 0.70 at any distance;
  or homonym sim ≥ 0.70 within 8 km).
- **`posicional`** — only a position (≤ 1.5 km), the reading is too weak to name.
- **`sense`** — no match.

## Environment (Nix)

```sh
npm run toponims:georef          # = nix-shell scripts/toponims/shell.nix --run python3 …
npm run toponims:ngib-match
```

No Homebrew, no global pip — deps are declared in the two `shell.nix` files.
