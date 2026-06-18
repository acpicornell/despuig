# Per-sheet (page-by-page) extraction & georeference

The Despuig 1785 map is printed on **4 sheets** with a central horizontal + vertical
gutter (empty cross-band) that distorts a single whole-map georeference. Working
**quadrant by quadrant** lets us anchor each sheet on its own dense set of
hand-marked, immutable control points and georeference it in that crop's own pixel
space — far tighter than the global fit.

This doc is the reproducible recipe. The first sheet done this way is **NW (NO)**;
its numbers are at the bottom.

## Inputs the user prepares (in GIMP, as layers)

For each quadrant crop, two exports at the **same canvas size** (so pixel coords
are shared):

1. `data/jpg/despuig-1785-original-<Q>.jpg` — engraving **+ red sea/decoration mask
   + blue town dots**. The blue dots mark every identifiable interior town; the
   name is engraved legibly beside each. (Used to extract GCP pixels.)
2. `data/jpg/despuig-1785-original-<Q>-canvas.jpg` — same canvas, **blue dots layer
   hidden** (engraving + red mask only). (Used by the spotter — dots would corrupt
   adjacent text.)

`<Q>` ∈ {NO, NE, SE, SO}. Coastal dots may be marked *in the sea* (their real
positions shifted historically → lower trust); interior towns are immutable.

## Step 0 — extract & vet the GCPs (from the dotted export)

Detect blue-dot centroids (uniform ~3400 px blobs), read the town beside each, and
resolve modern coordinates **from NGIB** (`data/toponims/ngib/llocs.json`, tipus
917/3010 = municipi seat/nucli). **Do NOT use `src/data/pobles.json`** — its town
coordinates are off by up to ~1.8 km vs NGIB (Puigpunyent 1757 m, Sencelles/Marratxí
~1.9 km, Binissalem 821 m…); that error propagates straight into the transform.

Write `data/toponims/<q>/gcps-<q>.json` (tracked — this is the authoritative record
of the hand-marked control-point work, like the anchor tables in `georef.py`):
```json
{ "sheet":"NO", "crop":"...-NO-canvas.jpg", "crop_dims":[9560,7299],
  "interior":[{"x":..,"y":..,"town":"..","lng":..,"lat":..,"src":"ngib"}, ...],
  "coast":[{"x":..,"y":..,"town":"Port de ..","lng":..,"lat":..,"src":"ngib"}, ...] }
```
GCPs must be 100 % correct. Sanity-check with an in-sample polynomial fit: residuals
should fall on a smooth gradient (no single dot an outlier) — a mislabeled dot shows
as a lone large residual.

## Step 1 — spotter on the clean canvas

```bash
# tile (real crop dims, FULL region; reads sharp().metadata, not frame.mjs)
MK_MASTER=data/jpg/despuig-1785-original-NO-canvas.jpg MK_INDIR=no/in \
  MK_PATCHES=no/patches.json MK_REGION=FULL \
  nix-shell -p nodejs --run 'node scripts/toponims/mapkurator/pretile.mjs'

# GPU inference inside the container ($DATA is mounted at /workspace/data)
mkdir -p data/toponims/mapkurator/no/out
scripts/toponims/mapkurator/run.sh bash -c \
  'MK_IN=/workspace/data/no/in MK_OUT=/workspace/data/no/out bash /workspace/mk/infer.sh'

# merge tile polygons → crop-space word polygons
MK_PATCHES=no/patches.json MK_OUTDIR=no/out MK_DETECTIONS=no/detections.json \
  nix-shell scripts/toponims/mapkurator/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/merge_detections.py'
# → data/toponims/mapkurator/no/detections.json  (coords already in crop pixel space)
```

## Step 2 — Approach B: window → vision read → assemble

```bash
# window the sheet (cuts only in whitespace; atomic clusters never split)
B_DET=data/toponims/mapkurator/no/detections.json \
B_MASTER=data/jpg/despuig-1785-original-NO-canvas.jpg \
B_OUTDIR=data/toponims/mapkurator/no/b \
  nix-shell scripts/toponims/mapkurator/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/b_windows.py 0 0 9560 7299'

# split windows.json → per-window w##.json (the box files each agent reads)
nix-shell scripts/toponims/mapkurator/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/split_windows.py data/toponims/mapkurator/no/b'

# vision extraction: one agent per window groups boxes into toponyms + reads them
# DIPLOMATICALLY (Sô/Câ kept). Run the `b-extract-no` workflow (N = #windows).
# Save its result → data/toponims/mapkurator/no/b/extract.json  ({windows:[...]}).

# assemble → sheet table (positions = box centroids, crop pixel space)
B_WINDIR=data/toponims/mapkurator/no/b \
TOPONIMS_JSON=data/toponims/no/toponims.json \
  nix-shell scripts/toponims/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/b_assemble.py data/toponims/mapkurator/no/b/extract.json'
```

## Step 3 — per-sheet georeference (crop space)

```bash
GCPS_NO=data/toponims/mapkurator/no/gcps-no.json \
TOPONIMS_JSON=data/toponims/no/toponims.json \
  nix-shell scripts/toponims/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/georef_sheet.py --with-coast'
```
`georef_sheet.py` fits the mapKurator family (affine -order1 / poly2 -order2 / tps)
and picks by leave-one-out on the control points. `--with-coast` adds the 3 stable
port points → extends the GCP hull north, lowering the max error. poly2 is the safe
default (smooth past the hull; no coastal TPS rings).

## Step 4 — NGIB matching (homonym-aware)

```bash
TOPONIMS_JSON=data/toponims/no/toponims.json \
MATCHES_JSON=data/toponims/no/matches.json \
RECHECK_JSON=data/toponims/no/recheck.json \
PICKS_JSON=data/toponims/no/recheck-picks.json \
  nix-shell scripts/toponims/shell.nix \
  --run 'python3 scripts/toponims/ngib_match.py'
```
Distance only disambiguates homonyms, never discards a unique name. Decision ladder:
confirmat / probable / suggerit / posicional / sense.

## NW (NO) results — 2026-06-18

- Crop `despuig-1785-original-NO-canvas.jpg` 9560×7299; sea masked, dots removed.
- Spotter: 108 tiles → **979** word polygons.
- GCPs: **15 interior towns + 3 coastal ports**, all NGIB. (Excluded the SW-peninsula
  dot by Dragonera — no clear town label.)
- Georef: **poly2 + coast**, control-point LOO median **843 m**; over all 599
  toponyms the **median nearest-NGIB-feature distance is 174 m** (p90 1.3 km), 0 in
  the sea.
- Extraction: **599 toponyms** (diplomatic grafia).
- NGIB match: confirmat **314**, probable **33**, suggerit **167**, posicional **13**,
  sense **72**.

## Sheet outputs

Per sheet, under `data/toponims/<q>/`: `toponims.json` (table + georef + lon/lat),
`matches.json`, `recheck.json`, `gcps-used.json`. The detection intermediates live
under `data/toponims/mapkurator/<q>/` (gitignored, regenerable). Assembling the 4
sheets into the production table is a later step.
