# Per-sheet (page-by-page) extraction & georeference

The Despuig 1785 map is printed on **4 sheets** with a central horizontal + vertical
gutter (empty cross-band) that distorts a single whole-map georeference. Working
**quadrant by quadrant** lets us anchor each sheet on its own dense set of
hand-marked, immutable control points and georeference it in that crop's own pixel
space — far tighter than the global fit.

This doc is the reproducible recipe. The first sheet done this way is **NW**;
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

`<Q>` ∈ {NW, NE, SE, SW}. Coastal dots may be marked *in the sea* (their real
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
{ "sheet":"NW", "crop":"...-NW-canvas.jpg", "crop_dims":[9560,7299],
  "interior":[{"x":..,"y":..,"town":"..","lng":..,"lat":..,"src":"ngib"}, ...],
  "coast":[{"x":..,"y":..,"town":"Port de ..","lng":..,"lat":..,"src":"ngib"}, ...] }
```
GCPs must be 100 % correct. Sanity-check with an in-sample polynomial fit: residuals
should fall on a smooth gradient (no single dot an outlier) — a mislabeled dot shows
as a lone large residual.

## Step 1 — spotter on the clean canvas

```bash
# tile (real crop dims, FULL region; reads sharp().metadata, not frame.mjs)
MK_MASTER=data/jpg/NW/despuig-1785-original-NW-canvas.jpg MK_INDIR=nw/in \
  MK_PATCHES=nw/patches.json MK_REGION=FULL \
  nix-shell -p nodejs --run 'node scripts/toponims/mapkurator/pretile.mjs'

# GPU inference inside the container ($DATA is mounted at /workspace/data)
mkdir -p data/toponims/mapkurator/nw/out
scripts/toponims/mapkurator/run.sh bash -c \
  'MK_IN=/workspace/data/nw/in MK_OUT=/workspace/data/nw/out bash /workspace/mk/infer.sh'

# merge tile polygons → crop-space word polygons
MK_PATCHES=nw/patches.json MK_OUTDIR=nw/out MK_DETECTIONS=nw/detections.json \
  nix-shell scripts/toponims/mapkurator/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/merge_detections.py'
# → data/toponims/mapkurator/nw/detections.json  (coords already in crop pixel space)
```

## Step 2 — Approach B: window → vision read → assemble

Coastal names are engraved **at an angle** (they follow the coastline). Axis-aligned
windowing reads only each word's bounding box, so it mutilates diagonal coast names at
window cuts and merges close neighbours — we lose almost all of them. So the sheet is
windowed in **two tracks**: flat (interior) boxes the normal way, and tilted (coastal)
boxes through an **oriented-ribbon + deskew** path. The spotter `poly` gives the
writing direction (top-edge chord); a box is "tilted" if that exceeds `B_MAX_TILT`°.

```bash
# 2a. INTERIOR — flat boxes only (B_MAX_TILT drops tilted ones to the coast track)
B_DET=data/toponims/mapkurator/nw/detections.json \
B_MASTER=data/jpg/NW/despuig-1785-original-NW-canvas.jpg \
B_OUTDIR=data/toponims/mapkurator/nw/b  B_MAX_TILT=20 \
  nix-shell scripts/toponims/mapkurator/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/b_windows.py 0 0 9560 7299'
nix-shell scripts/toponims/mapkurator/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/split_windows.py data/toponims/mapkurator/nw/b'

# 2b. COAST — tilted boxes: cluster into oriented ribbons, deskew each to horizontal,
#     stack into montage windows (same w##.png/windows.json schema; writes coast-boxes.json)
B_DET=data/toponims/mapkurator/nw/detections.json \
B_MASTER=data/jpg/NW/despuig-1785-original-NW-canvas.jpg \
B_OUTDIR=data/toponims/mapkurator/nw/b-coast  B_MIN_TILT=20 \
  nix-shell scripts/toponims/mapkurator/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/b_coast_windows.py'

# 2c. EXTRACTION (vision): one agent per window groups boxes → toponyms + reads them
#     DIPLOMATICALLY (Sô/Câ kept). Run the `b-extract-sheet` Workflow ONCE PER TRACK:
#     EDIT its BASE/N constants (the `args` global does NOT propagate via scriptPath):
#       interior: BASE=…/nw/b       N = #interior windows
#       coast:    BASE=…/nw/b-coast N = #coast windows
#     Save each result's {windows:[...]} → <BASE>/extract.json.

# 2d. ASSEMBLE both tracks → unified sheet table (interior ids B##_#, coast ids C##_#;
#     coast supersedes any tilted box that leaked into an interior window)
B_WINDIR=data/toponims/mapkurator/nw/b \
TOPONIMS_JSON=data/toponims/nw/toponims.json \
B_COAST_WINDIR=data/toponims/mapkurator/nw/b-coast \
B_COAST_EXTRACT=data/toponims/mapkurator/nw/b-coast/extract.json \
  nix-shell scripts/toponims/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/b_assemble.py data/toponims/mapkurator/nw/b/extract.json'
```

### Re-running an already-curated sheet (preserve hand-curation)

A rebuild re-cuts windows, so toponym **ids change** and any existing
`recheck-picks.json` / `graf-fixes.json` / `review-reviewed.json` (keyed by old ids)
would be orphaned. Back up the pre-rebuild `<q>/` JSONs, rebuild (steps 1–2d), then
remap the curation onto the new ids by grafia + position:
```bash
OLD=data/toponims/mapkurator/nw/prebuild-backup NEW=data/toponims/nw \
  nix-shell scripts/toponims/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/remap_curation.py'          # dry-run report
# inspect fuzzy/unmapped, then re-run with --apply (keeps .bak of each rewritten file)
```
It key-matches the human-corrected reading across the whole table first (so coast
items the deskew regrouped+moved still re-attach), falls back to tight nearest, and
drops collisions/absent names rather than mis-attaching them.

## Step 3 — per-sheet georeference (crop space)

```bash
GCPS_NW=data/toponims/mapkurator/nw/gcps-nw.json \
TOPONIMS_JSON=data/toponims/nw/toponims.json \
  nix-shell scripts/toponims/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/georef_sheet.py --with-coast'
```
`georef_sheet.py` fits the mapKurator family (affine -order1 / poly2 -order2 / tps)
and picks by leave-one-out on the control points. `--with-coast` adds the 3 stable
port points → extends the GCP hull north, lowering the max error. poly2 is the safe
default (smooth past the hull; no coastal TPS rings).

## Step 3b — dense refinement from confirmed matches (run AFTER a first match)

The ~15 hand dots are a sparse, hull-limited fit (NW 838 m, but SE 1227 m / SW 1140 m
LOO). Once Step 4 has run once, every **`confirmat`** toponym is itself a control
point: its engraving pixel `(x,y)` ↔ the true NGIB coord of the place it matched.
There are hundreds, densely spread → a far better fit, especially away from the dots.

```bash
# report-only: validates by predicting the hand dots (held OUT of the fit)
Q=se ORDER=3 nix-shell scripts/toponims/mapkurator/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/georef_refine.py'
# apply: re-projects lon/lat of EVERY toponym with the dense model
Q=se ORDER=3 APPLY=1 nix-shell scripts/toponims/mapkurator/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/georef_refine.py'
```
Guards against circularity/noise: uses only **unique-name** confirmats (homonym picks
depend on the prior transform — excluded), **never `curat`** (hand picks may be wrong),
iterative **robust outlier rejection** (drops bad matches / large label offsets), and
the hand dots are added back as precise anchors but **never dropped**. Validation =
predicting the held-out hand dots: SE 1227→~700 m, SW 1140→~650 m, NE 1036→~714 m.

Then **re-match** (Step 4) so positions and homonym picks settle on the new transform —
EXCEPT on an already-curated sheet: there, run `APPLY=1` to re-project lon/lat only and
**do NOT re-match**, so the hand curation (decisions/picks/discards) stays intact. (NE
was refined this way; SE/SW got the full refine+re-match as they were uncurated.)

## Step 4 — NGIB matching (homonym-aware)

If the review tool has produced reading corrections, apply them to the table FIRST
(updates `graf`/`nom`/`tipus`; position unchanged, so no re-georef needed):
```bash
TOPONIMS_JSON=data/toponims/nw/toponims.json \
GRAF_JSON=data/toponims/nw/graf-fixes.json \
  nix-shell scripts/toponims/shell.nix \
  --run 'python3 scripts/toponims/mapkurator/apply_graf_fixes.py'
```
Then match:
```bash
TOPONIMS_JSON=data/toponims/nw/toponims.json \
MATCHES_JSON=data/toponims/nw/matches.json \
RECHECK_JSON=data/toponims/nw/recheck.json \
PICKS_JSON=data/toponims/nw/recheck-picks.json \
REVIEWED_JSON=data/toponims/nw/review-reviewed.json \
DISCARDS_JSON=data/toponims/nw/discards.json \
  nix-shell scripts/toponims/shell.nix \
  --run 'python3 scripts/toponims/ngib_match.py'
```
Distance only disambiguates homonyms, never discards a unique name.

**TWO ORTHOGONAL AXES** (TEI `@cert`/`@resp` model — don't conflate "how sure" with
"who says so"):
- `decision` = **confidence** (algorithmic, ALWAYS recomputed): `confirmat` / `probable`
  / `suggerit` / `posicional` / `sense`. Re-running the match never destroys it.
- `review` = **human validation** (persistent, orthogonal): `revisat` (a human confirmed
  the match, or confirmed there is no match), `corregit` (a human changed the match),
  `descartat` (brossa, dropped), or `null` (unreviewed).
The review tool's verdicts (`recheck-picks.json` + `review-reviewed.json` 'pick'/'ok'/
'none', `discards.json`) feed the `review` axis; a pick also re-sets the match and its
recomputed `decision`. There is **no `curat` tier** any more — "human-verified" is the
`review` flag, shown on top of whatever confidence the item has. So an already-curated
sheet can be safely re-matched: the confidence refreshes and the human layer rides along
(NW's old all-`curat` artefact came from the previous single-ladder model).

**Keep the per-sheet and whole-island databases separate.** The pipeline scripts
default every path to the global (whole-island) files; a per-sheet run MUST pass the
full set of `*_JSON` env vars above so it only ever reads/writes `data/toponims/nw/`.
`REVIEWED_JSON` decides which hand picks become `probable` (vs `confirmat`);
`DISCARDS_JSON` lists toponyms hand-marked as garbage (🗑 Brossa in the review tool),
which are dropped from `matches.json` and the recheck queue.

The web curation tool is **quadrant-aware** — no env vars; pick the sheet (NW/NE/SE/SW)
in the header and it reads/writes `data/toponims/<q>/{recheck-picks,review-reviewed,
graf-fixes,discards}.json`:
```bash
nix-shell -p nodejs --run 'node scripts/toponims/review-server.mjs'   # → :4400
```
Two views: **Taula** (an editable copy of the public toponyms table — fast inline edits
of reading/NGIB match, ✓ correcte, 🗑 brossa, candidate chips; works for any quadrant
straight from `matches.json` + `recheck.json`, no crops needed) and **Fitxes** (one item
at a time with the engraving crop + candidates + map — needs `render_review_crops.py` run
for that sheet first; degrades to a notice if absent). After editing, re-bake the sheet:
`apply_graf_fixes.py` (if readings changed) then `ngib_match.py` with the per-sheet env.

## NW results — clean deskew rebuild, 2026-06-19

- Crop `despuig-1785-original-NW-canvas.jpg` 9560×7299; sea masked, dots removed.
- Spotter: 108 tiles → **979** word polygons (754 flat + 225 tilted >20°).
- GCPs: **15 interior towns**, all NGIB. (Excluded the SW-peninsula dot by Dragonera.)
- Windows: interior **15** (`…/nw/b/`) + coast **4** deskewed montages (`…/nw/b-coast/`).
- Extraction (2 `b-extract-sheet` Workflow runs): interior **480** + coast **109** =
  **589 toponyms** (diplomatic grafia).
- Georef: **poly2**, control-point LOO median **838 m**.
- NGIB match: confirmat **299**, probable **97**, suggerit **132**, posicional **12**,
  sense **49**. Coast track alone: 28 conf / 12 prob / 45 sugg / 6 pos / 18 sense — a
  real coastal collection (the old axis-aligned run had lost nearly all of these).
- Hand-curation remapped old→new ids: **83/86** preserved (3 legit drops).

> Pre-rebuild run (2026-06-18, superseded): 599 toponyms, 314/33/167/13/72. Fewer
> confirmat now (299) but the coast is real instead of mangled junk.

## Sheet outputs

Per sheet, under `data/toponims/<q>/`: `toponims.json` (table + georef + lon/lat),
`matches.json`, `recheck.json`, `gcps-used.json`. The detection intermediates live
under `data/toponims/mapkurator/<q>/` (gitignored, regenerable). Assembling the 4
sheets into the production table is a later step.
