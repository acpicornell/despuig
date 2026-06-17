#!/usr/bin/env bash
# Run a command inside the mapKurator spotter GPU container, with the spotter repo,
# weights, input tiles and output dir all mounted. No args → interactive shell.
#
#   scripts/toponims/mapkurator/run.sh                 # shell inside the container
#   scripts/toponims/mapkurator/run.sh nvidia-smi -L   # check the GPU is visible
#   scripts/toponims/mapkurator/run.sh bash scripts/toponims/mapkurator/build-op.sh
#
# Requires: the image built (build-image.sh) and GPU-in-container working
# (hardware.nvidia-container-toolkit on NixOS → CDI device nvidia.com/gpu=all).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MK="$REPO/scripts/toponims/mapkurator"
VENDOR="$MK/vendor/mapkurator-spotter"
SPOTTER="$VENDOR/spotter-v2"
DATA="$REPO/data/toponims/mapkurator"
IMAGE="${MK_IMAGE:-localhost/despuig-mapkurator:latest}"
RUNTIME="${MK_RUNTIME:-podman}"

# Vendor the spotter repo (third-party, gitignored) on first run.
if [ ! -d "$SPOTTER" ]; then
  echo ">> cloning mapkurator-spotter into vendor/ ..."
  mkdir -p "$MK/vendor"
  git clone --depth 1 https://github.com/knowledge-computing/mapkurator-spotter.git "$VENDOR"
fi

mkdir -p "$DATA/weights" "$DATA/in" "$DATA/out"

# GPU device flag: skip it if MK_NO_GPU=1 (e.g. to compile the op with FORCE_CUDA
# on a host where CDI isn't ready yet — compilation needs nvcc, not a live GPU).
GPU=(--device nvidia.com/gpu=all)
[ "${MK_NO_GPU:-0}" = "1" ] && GPU=()

# Allocate a TTY only when stdout is one (so non-interactive `run.sh cmd ...` works).
TTY=(-i)
[ -t 1 ] && TTY=(-it)

exec "$RUNTIME" run --rm "${TTY[@]}" "${GPU[@]}" \
  -v "$MK":/workspace/mk:ro \
  -v "$SPOTTER":/workspace/spotter:rw \
  -v "$DATA/weights":/workspace/weights:rw \
  -v "$DATA/in":/workspace/in:rw \
  -v "$DATA/out":/workspace/out:rw \
  -w /workspace/spotter \
  "$IMAGE" "${@:-bash}"
