# Toponym pipeline

Extracts the place names engraved on the Despuig map, georeferences them, and
matches them against the **NGIB** gazetteer to feed the web table (`/toponims`,
which imports `data/toponims/ngib/matches.json`).

> **Detection by the mapKurator spotter (GPU); reading+grouping by Claude vision.**
> The spotter is excellent at *finding* every word box but weak at *recognition*
> and at *grouping* words into names. So we keep only its word boxes and let Claude
> vision read the engraving AND group the boxes into toponyms, window by window.
> This "approach B" replaced an earlier mapKurator-style MST linker + per-label OCR
> (which over-/under-merged names); that path is removed but in git history. The
> detection half lives in [`mapkurator/`](mapkurator/README.md).

## Pipeline (in order)

Stages run in a Nix shell (no global pip): `mapkurator/shell.nix` has Pillow,
`shell.nix` has scipy/rapidfuzz/jellyfish. The vision steps are Claude **workflows**
(launched via the agent, not the CLI) — their scripts are in
[`mapkurator/workflows/`](mapkurator/workflows/).

| # | step | Script | In → Out |
|---|------|--------|----------|
| 1 | *(see [`mapkurator/`](mapkurator/README.md))* | spotter container | scan → `mapkurator/detections.json` (word boxes + a rough English OCR hint) |
| 2 | `npm run toponims:windows` | `mapkurator/b_windows.py` | detections → `mapkurator/b/w##.png` + per-window box lists. Windows the map by **recursive median split cutting only in whitespace** (clusters stay atomic, gutters are natural cuts) so no name is ever truncated; each box belongs to one window |
| 3 | *vision extraction* | `mapkurator/workflows/b-extract.js` | one agent per window reads the engraving + **groups the boxes** into toponyms (`{boxes:[n…], reading}`) — the step that fixes mis-grouping; position comes back from the boxes |
| 4 | `npm run toponims:assemble -- <wf.json>` | `mapkurator/b_assemble.py` | workflow output → `data/toponims/toponims.json` (table schema: `graf`,`nom`,`tipus`,`x`,`y`) |
| 5 | `npm run toponims:georef` | `mapkurator/georef.py` | adds `lon`/`lat` (see **Georeference**) |
| 6 | `npm run toponims:georef-bootstrap` | `mapkurator/georef_bootstrap.py` | densifies the georeference |
| 7 | `npm run toponims:ngib-fetch` | `ngib-fetch.mjs` | downloads the Mallorca NGIB subset → `ngib/llocs.json` (once; regenerable) |
| 8 | `npm run toponims:ngib-match` | `ngib_match.py` | → `ngib/matches.json` (+ `recheck.json`) — the file the web reads |
| 9 | *vision recheck (optional)* | `build_recheck_montages.py` + `workflows/b-recheck.js` | confirms `suggerit` matches from the engraving → `recheck-picks.json`, applied by `ngib_match.py` (durable override) |

`b_run.sh <wf.json>` chains steps 4–8. `toponims:vinetes` is unrelated — the
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

## Vision recheck (optional — strategy 4)

For toponyms the gazetteer match left uncertain (`suggerit`/`posicional`/`sense`), a
vision pass reads the actual engraving and picks the right candidate:

1. `build_recheck_montages.py [decision]` (default `suggerit`) — crops the real map
   around each target into numbered montages (`mapkurator/recheck/r##.png`) plus an
   `index.json` carrying each crop's NGIB candidates.
2. A reader (Claude vision) reads each page + its candidates and records the confirmed
   name per crop into `data/toponims/recheck-picks.json` — `{toponym id: NGIB grafia}`
   (omit a crop = leave it as is).
3. `ngib_match.py` applies that file as a **durable override** at the end of the run:
   each pick → `confirmat` against the nearest NGIB entry of that name, tagged
   `rev: "vision"`. Re-running the whole pipeline never loses a vision decision.

## Environment (Nix)

```sh
npm run toponims:georef          # = nix-shell scripts/toponims/shell.nix --run python3 …
npm run toponims:ngib-match
```

No Homebrew, no global pip — deps are declared in the two `shell.nix` files.
