# mapKurator spotter — GPU text detection setup

Detect-then-read text spotting for the toponym pipeline (see
[`docs/mapkurator-text-spotting.md`](../../../docs/mapkurator-text-spotting.md) for
the *why*). This folder is the **detection** side: run the mapKurator spotter-v2 on
the GPU to get whole-word polygons over the map. Recognition (Claude) comes after.

There is **no official mapKurator Docker image** — the spotter is AdelaiDet
(Detectron2) with a custom CUDA op (`adet._C`, deformable-attention) that must be
**compiled** against the installed PyTorch. So we build our own image. The
`Dockerfile` is multi-stage: a CUDA *devel* builder compiles detectron2 + `adet._C`,
then a thin CUDA *base* runtime stage keeps only the installed Python packages (the
op is **baked in**; no nvcc, ~5.8 GB). To patch the spotter source, edit
`vendor/mapkurator-spotter/spotter-v2` and rebuild — the builder recompiles `adet._C`.

## One-time host setup (NixOS)

The RTX 4060 is only visible inside containers if the nvidia-container-toolkit is
enabled (it generates the CDI spec `nvidia.com/gpu=all`). Add to your NixOS config:

```nix
# configuration.nix
hardware.graphics.enable = true;                 # (hardware.opengl on <24.11)
hardware.nvidia-container-toolkit.enable = true; # generates the CDI spec
virtualisation.containers.enable = true;
virtualisation.podman.enable = true;
```

Then `sudo nixos-rebuild switch` and verify. On NixOS the toolkit writes the CDI
spec to **`/run/cdi/nvidia-container-toolkit.json`** (a systemd RuntimeDirectory),
*not* `/etc/cdi/nvidia.yaml` — podman scans `/run/cdi` too, so `nvidia.com/gpu=all`
resolves anyway:

```bash
ls /run/cdi/nvidia-container-toolkit.json          # should exist
scripts/toponims/mapkurator/run.sh nvidia-smi -L   # GPU listed inside the container
```

## Build & run

```bash
# 1. build the image (slow first time; no GPU needed). Clones the spotter into
#    vendor/ and compiles adet._C inside the build — no separate compile step.
scripts/toponims/mapkurator/build-image.sh

# 2. download the English spotting weight (Google Drive, via gdown)
scripts/toponims/mapkurator/run.sh bash /workspace/mk/get-weights.sh

# 3. tile the master scan into overlapping input tiles
node scripts/toponims/mapkurator/pretile.mjs        # → data/toponims/mapkurator/in/

# 4. detect on the tiles
scripts/toponims/mapkurator/run.sh bash /workspace/mk/infer.sh
#    → per-tile JSON in data/toponims/mapkurator/out/

# 5. stitch tile detections back to master-image coordinates, de-overlap
nix-shell scripts/toponims/mapkurator/shell.nix \
  --run "python3 scripts/toponims/mapkurator/merge_detections.py"   # → detections.json
```

To patch the spotter source: edit `vendor/mapkurator-spotter/spotter-v2` and rerun
`build-image.sh` — the builder stage recompiles `adet._C` from the patched sources.

`detections.json` is the handoff to the rest of the chain — see the
[parent README](../README.md) (b_windows → vision extraction → assemble → georef →
ngib-match).

**Judge Phase 0:** does it draw boxes around whole words on this 1785 engraving
(not the possession-marker circles, not noise)? If yes, the transfer bet holds →
proceed to Phase 1 (tile the whole master, merge polygons). If not, fall back to
"Claude-as-spotter" (see the plan doc).

## Files

- `Dockerfile` — multi-stage: CUDA 11.8 devel builder (torch 2.0.1+cu118 +
  detectron2 + compiled `adet._C`) → CUDA 11.8 *base* runtime (op baked in, ~5.8 GB).
  `--build-arg RUNTIME_BASE=…cudnn8-runtime…` to fall back to the bigger base.
- `build-image.sh` — build the image (`localhost/despuig-mapkurator:latest`). Clones
  the spotter into `vendor/` for the build.
- `run.sh` — run a command in the container with GPU + mounts. `MK_NO_GPU=1` drops
  the GPU device. Mounts this dir → `/workspace/mk` and
  `data/toponims/mapkurator/{weights,in,out}`.
- `get-weights.sh` — download the English checkpoint to the weights mount.
- `infer.sh` — run `tools/inference.py` over the input tiles → JSON polygons.
- `pretile.mjs` — slice the master scan into overlapping detection tiles (`in/`).
- `merge_detections.py` — map tile polygons back to master pixels, de-overlap →
  `detections.json` (the input to the downstream pipeline; see parent README).

## Paths (all under data/toponims/mapkurator/, gitignored)

- `weights/model_v2_en.pth` — English spotter checkpoint.
- `in/` — input tiles for detection.
- `out/` — per-tile JSON (`poly_text_score_dict_list`: polygon + text + score).
