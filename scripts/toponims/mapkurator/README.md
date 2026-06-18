# mapKurator spotter — GPU text detection setup

Detect-then-read text spotting for the toponym pipeline (see
[`docs/mapkurator-text-spotting.md`](../../../docs/mapkurator-text-spotting.md) for
the *why*). This folder is the **detection** side: run the mapKurator spotter-v2 on
the GPU to get whole-word polygons over the map. Recognition (Claude) comes after.

There is **no official mapKurator Docker image** — the spotter is AdelaiDet
(Detectron2) with a custom CUDA op (`adet._C`, deformable-attention) that must be
**compiled** against the installed PyTorch. So we build our own environment image
and compile the op inside a container.

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
# 1. build the environment image (slow first time; no GPU needed)
scripts/toponims/mapkurator/build-image.sh

# 2. compile the custom CUDA op (clones the spotter into vendor/ on first run)
scripts/toponims/mapkurator/run.sh bash /workspace/mk/build-op.sh

# 3. download the English spotting weight (Google Drive, via gdown)
scripts/toponims/mapkurator/run.sh bash /workspace/mk/get-weights.sh

# 4. tile the master scan into overlapping input tiles
node scripts/toponims/mapkurator/pretile.mjs        # → data/toponims/mapkurator/in/

# 5. detect on the tiles
scripts/toponims/mapkurator/run.sh bash /workspace/mk/infer.sh
#    → per-tile JSON in data/toponims/mapkurator/out/

# 6. stitch tile detections back to master-image coordinates, de-overlap
nix-shell scripts/toponims/mapkurator/shell.nix \
  --run "python3 scripts/toponims/mapkurator/merge_detections.py"   # → detections.json
```

`detections.json` is the handoff to the rest of the chain — see the
[parent README](../README.md) (b_windows → vision extraction → assemble → georef →
ngib-match).

**Judge Phase 0:** does it draw boxes around whole words on this 1785 engraving
(not the possession-marker circles, not noise)? If yes, the transfer bet holds →
proceed to Phase 1 (tile the whole master, merge polygons). If not, fall back to
"Claude-as-spotter" (see the plan doc).

## Files

- `Dockerfile` — CUDA 11.8 devel + torch 2.0.1+cu118 + detectron2 0.6 + deps.
- `build-image.sh` — build the image (`localhost/despuig-mapkurator:latest`).
- `run.sh` — run a command in the container with GPU + all mounts. Clones the
  spotter into `vendor/` if missing. `MK_NO_GPU=1` drops the GPU device (for
  compiling the op before the host toolkit is ready). Mounts:
  `vendor/mapkurator-spotter/spotter-v2` → `/workspace/spotter`, this dir →
  `/workspace/mk`, and `data/toponims/mapkurator/{weights,in,out}`.
- `build-op.sh` — `pip install -e .` the spotter (compiles `adet._C` for sm_89).
- `get-weights.sh` — download the English checkpoint to the weights mount.
- `infer.sh` — run `tools/inference.py` over the input tiles → JSON polygons.
- `pretile.mjs` — slice the master scan into overlapping detection tiles (`in/`).
- `merge_detections.py` — map tile polygons back to master pixels, de-overlap →
  `detections.json` (the input to the downstream pipeline; see parent README).

## Paths (all under data/toponims/mapkurator/, gitignored)

- `weights/model_v2_en.pth` — English spotter checkpoint.
- `in/` — input tiles for detection.
- `out/` — per-tile JSON (`poly_text_score_dict_list`: polygon + text + score).
