#!/usr/bin/env bash
# Run a command inside the mapKurator spotter GPU container, with weights, input
# tiles and output dir mounted. No args → interactive shell. The image bakes the
# spotter (and the compiled adet._C op) into /opt/spotter.
#
#   scripts/toponims/mapkurator/run.sh                 # shell inside the container
#   scripts/toponims/mapkurator/run.sh nvidia-smi -L   # check the GPU is visible
#   scripts/toponims/mapkurator/run.sh bash /workspace/mk/infer.sh
#
# To patch the spotter source: edit vendor/mapkurator-spotter/spotter-v2 and rebuild
# (build-image.sh) — the builder stage recompiles adet._C from it.
#
# Requires: the image built (build-image.sh) and GPU-in-container working
# (hardware.nvidia-container-toolkit on NixOS → CDI device nvidia.com/gpu=all).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MK="$REPO/scripts/toponims/mapkurator"
DATA="$REPO/data/toponims/mapkurator"
IMAGE="${MK_IMAGE:-localhost/despuig-mapkurator:latest}"
RUNTIME="${MK_RUNTIME:-podman}"

mkdir -p "$DATA/weights" "$DATA/in" "$DATA/out"

# GPU device flag: skip it if MK_NO_GPU=1 (e.g. on a host where CDI isn't ready yet).
GPU=(--device nvidia.com/gpu=all)
[ "${MK_NO_GPU:-0}" = "1" ] && GPU=()

# Allocate a TTY only when stdout is one (so non-interactive `run.sh cmd ...` works).
TTY=(-i)
[ -t 1 ] && TTY=(-it)

exec "$RUNTIME" run --rm "${TTY[@]}" "${GPU[@]}" \
  -v "$MK":/workspace/mk:ro \
  -v "$DATA/weights":/workspace/weights:rw \
  -v "$DATA/in":/workspace/in:rw \
  -v "$DATA/out":/workspace/out:rw \
  -v "$DATA":/workspace/data:rw \
  -w /opt/spotter \
  "$IMAGE" "${@:-bash}"
