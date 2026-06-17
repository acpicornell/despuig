# Plan: clean toponym extraction via text spotting (mapKurator + Claude)

Status: **Phase 0 done — the bet holds.** The spotter is set up and running on the
GPU laptop (RTX 4060), and detection **transfers well** to the 1785 engraving:
whole-word polygons, possession-marker circles and tree glyphs correctly ignored,
the (English) recognizer even reads most names at ~0.98 score. Setup, scripts and
how-to are in [`scripts/toponims/mapkurator/`](../scripts/toponims/mapkurator/)
(`README.md`). **Next: Phase 1** (tile the whole master, run the spotter, merge
polygons to master coords). This document remains the *why*; the README is the *how*.

### What differed from the assumptions below (lessons from the setup)

- **No official mapKurator Docker image exists.** The spotter is AdelaiDet
  (Detectron2) with a custom CUDA op (`adet._C`); we build our own image and
  compile the op. See `scripts/toponims/mapkurator/Dockerfile`.
- **Versions (Ada / sm_89):** CUDA 11.8 devel + `torch 2.0.1+cu118` +
  `torchvision 0.15.2` + **detectron2 built from source** (no torch-2.0 wheels) +
  **`numpy<2`** (torch 2.0 ABI). Compile both detectron2 and the adet op with
  `--no-build-isolation` and `TORCH_CUDA_ARCH_LIST=8.9`, `FORCE_CUDA=1`.
- **GPU in Podman on NixOS:** `hardware.nvidia-container-toolkit.enable = true`
  writes the CDI spec to **`/run/cdi/nvidia-container-toolkit.json`** (not
  `/etc/cdi/nvidia.yaml`); the device is `--device nvidia.com/gpu=all`.
- **Inference config/weight actually used:** `configs/inference_en_test.yaml` with
  `MODEL.WEIGHTS` overridden to the English checkpoint (GDrive
  `1agOzYbhZPDVR-nqRc31_S6xu8yR5G1KQ` → `model_v2_en.pth`). The JSON output is
  column-oriented (`polygon_x`, `polygon_y`, `text`, `score`).

---

This document is self-contained so the work can be resumed right after `git clone`.

## Why this exists

The current toponym layer was produced by **blind grid tiling**: the map interior
is cut into fixed cells and a vision model reads each cell whole. This has a
structural flaw — names that fall on a cell boundary get **cut**, and each half is
recorded as a separate garbage entry. That, not the vision model, is the main
source of noise. (See `scripts/toponims/README.md` for the current pipeline.)

Historical-map OCR is a mature field with a better architecture. The reference
system is **mapKurator** (Univ. of Minnesota), run over 60k+ David Rumsey maps,
and there is an annual benchmark (**ICDAR MapText**). The key idea:

> **Separate detection from recognition; the unit is the WORD, not the cell.**
> A model detects a polygon around every word label (curved/rotated included),
> overlapping tiles are merged at the polygon level, so a word cut in one tile is
> whole in its neighbour. A fragment is never recorded as a final entry — by design.

Decisions already taken (do not relitigate):
- **Goal = a clean toponym list** (faithful transcription). Gazetteer (NGIB)
  matching is optional enrichment, NOT the quality bar; a 1785 map will never map
  cleanly onto a modern gazetteer (vanished/renamed places, real homonyms).
- **Retrieval-first (project NGIB places, verify) is rejected** for this goal: the
  NGIB differs too much from what the map actually shows.
- **Symbol detection (Hough circles on the possession markers) is rejected**: in
  dense areas it cannot separate rings from round letters (o, c, ô). A trained text
  detector handles dense text holistically; symbols do not.

## The hybrid we will build

1. **Detection (GPU, mapKurator spotter):** detect word polygons over the map.
   This is what we cannot do well ourselves and what fixes the mutilation.
2. **Recognition (Claude, local/Mac):** crop each detected polygon and read it.
   Claude reads this 1785 engraving better than the spotter's recognizer, which is
   trained on (mostly English) Rumsey maps — so we use the spotter's **detection**
   and **ignore its recognition text** (keep it only as a hint).
3. Output: a clean toponym list with precise polygons/positions. No fuzzy matching.

Division of labour: the GPU finds **where** each word is; Claude reads **what** it says.

## Hardware (this laptop) — sufficient

- **RTX 4060, 8 GB VRAM** — plenty for *inference* on ~1000 px tiles.
- **32 GB system RAM** — handles the 287 Mpx master without trouble.
- **NixOS** with working NVIDIA + container stack (already used for LLM work).
  On NixOS, run mapKurator via **Docker + `--gpus all`** (nvidia-container-toolkit).
  Do NOT try to build Detectron2 + the Deformable-Attention CUDA op natively under
  Nix purity — that path is pain. Docker sidesteps it.

## Prerequisite: get the master image (it is gitignored)

The high-resolution master is **not in git** (too large). After cloning, obtain it:

- Path expected by the scripts: `data/jpg/despuig-1785-original.jpg`
  (set in `src/lib/frame.mjs` as `MASTER_REL`).
- Dimensions: **19306 × 14902** (287 Mpx), ~60 MB.
- Source: Biblioteca Virtual de Defensa, the **original 1785** Despuig map,
  signature **Ar.G bis-T.3-C.1-023bis**, license **CC BY 4.0**.
  Record: https://bibliotecavirtual.defensa.gob.es/BVMDefensa/ (id 212247).
- Easiest: copy it from the Mac that has it (`data/jpg/despuig-1785-original.jpg`).

Sanity check after placing it:
```bash
node -e 'import("sharp").then(s=>s.default("data/jpg/despuig-1785-original.jpg").metadata().then(m=>console.log(m.width,m.height)))'
# expect: 19306 14902
```

## Phase 0 — de-risk (do this FIRST, ~1 hour)

The only real unknown is whether a detector trained on 19th-c. English Rumsey maps
**transfers** to this finer, denser 1785 Catalan engraving. Test before investing.

1. Get the spotter running in Docker:
   - Repo: https://github.com/knowledge-computing/mapkurator-spotter
     (full system, not needed: https://github.com/knowledge-computing/mapkurator-system)
   - Use its Docker image / Dockerfile; run with `--gpus all`.
   - Model weights (Google Drive, linked in the spotter README): use the
     **English text spotting** checkpoint and config
     (`spotter-v2`, config `.../PALEJUN/Finetune/Rumsey_Polygon_Finetune.yaml`).
2. Run detection on ONE dense test tile from our map (e.g. a crop of the southern
   interior). You can reuse an existing cell image: `data/toponims/sub/s12_c07.jpg`
   is a dense possession area — but that is gitignored too; regenerate any cell with
   `node scripts/toponims/subtiles.mjs --render s12_c07` after the master is in place.
3. Inference command shape (from the docs):
   ```bash
   python tools/inference.py \
     --spotter_config /path/PALEJUN/Finetune/Rumsey_Polygon_Finetune.yaml \
     --output_json --input ./test_tiles --output ./out
   ```
   Output is JSON with word polygons (16-point) + recognized text per tile.
4. **Judge:** does it draw boxes around whole words on OUR engraving (not symbols,
   not noise)? If yes → the bet is good, continue. If the detection is poor, stop
   and reconsider (the fallback is the in-house "Claude-as-spotter" idea below).

## Phase 1 — detect over the whole map

1. **Pre-tile the master into ~1024 px patches with ~25% overlap.** Overlap is what
   lets boundary words be whole in some tile. Reference for the cropping math:
   `scripts/toponims/subtiles.mjs` (currently 16×15 cells, overlap 180, for the
   vision pass — for the spotter use smaller ~1024 px patches; keep a manifest of
   each patch's `(x, y)` offset in master pixels). Tile the **MAP interior** region
   (`MAP` in `src/lib/frame.mjs`) if you only want interior toponyms, or the whole
   `IMG` if you also want the border.
2. Run the spotter on all patches (GPU). Keep per-patch JSON.
3. **Merge to map coordinates:** shift each polygon by its patch offset, then
   **deduplicate overlapping detections** (same word seen in two patches) by polygon
   IoU (e.g. drop a box if it overlaps another by > ~0.5; keep the more central /
   higher-score one). This is the step that removes mutilation duplicates cleanly,
   because the unit is a whole-word polygon, not a text string.
4. Result: one set of word polygons over the master, no fragments.

## Phase 2 — recognize with Claude (back on the Mac is fine)

1. For each merged polygon, crop a tight window (with a small margin) from the master.
   Reuse the rendering approach in `scripts/toponims/render-recheck.mjs`
   (crop-around-a-point with upscale + sharpen) — adapt it to crop-around-a-polygon.
2. Read each crop with Claude (batch several crops per agent to amortise overhead,
   as learned in the grid pass — ~14k tokens/agent if one-per-agent; batch ~8).
3. Optional: link adjacent word polygons into multi-word labels
   ("Sô" + "Ballester" → "Sô Ballester"); see the ICDAR MapText "linking" task and
   the LIGHT paper (https://arxiv.org/pdf/2506.22589).
4. Output: `data/toponims/toponims.json` (same shape as today: `nom`, `graf`,
   `tipus`, `x`, `y`, ...) so the existing `/toponims` table and merge tooling keep
   working. NGIB matching (`ngib_match.py`) stays available as optional enrichment.

## Fallback if mapKurator does not transfer (no GPU, no ML stack)

"Claude-as-spotter": tile with **large overlap**, ask Claude for a bounding box +
text per word, then **dedup by position + completeness** (when an edge fragment
overlaps a fuller reading from the neighbour tile, keep the fuller one and drop the
fragment). Also have Claude flag "cut at edge". This mimics the detect-then-merge
principle with our existing tools — worse than a trained detector, but it directly
kills the mutilation and needs no GPU.

## Pointers in this repo

- `src/lib/frame.mjs` — geometry: `MASTER_REL`, `IMG {19306×14902}`, `MAP` interior
  region, gutters between the 4 printed sheets.
- `scripts/toponims/subtiles.mjs` — current tiler (cropping math to reuse).
- `scripts/toponims/render-recheck.mjs` — crop-around-a-point renderer (adapt for
  polygons in Phase 2).
- `scripts/toponims/merge.mjs` / `ngib_match.py` — current merge + optional NGIB
  enrichment, kept for compatibility.
- Current data state: ~2,909 toponyms in `data/toponims/toponims.json` from the grid
  pass (after manual garbage triage); this plan aims to supersede it with a cleaner
  set. Do not delete the current data until the new pass is validated.

## References

- mapKurator system: https://arxiv.org/abs/2306.17059 ·
  https://github.com/knowledge-computing/mapkurator-system
- Spotter: https://github.com/knowledge-computing/mapkurator-spotter
- ICDAR 2024 MapText competition: https://rrc.cvc.uab.es/?ch=28&com=tasks
- LIGHT (multi-modal text linking): https://arxiv.org/pdf/2506.22589
