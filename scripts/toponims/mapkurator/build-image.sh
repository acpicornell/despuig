#!/usr/bin/env bash
# Build the mapKurator spotter environment image (CUDA devel + torch + detectron2).
# Slow first time (~several GB of base layers + torch). No GPU needed to build.
set -euo pipefail
MK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="${MK_RUNTIME:-podman}"
exec "$RUNTIME" build -t "${MK_IMAGE:-localhost/despuig-mapkurator:latest}" \
  -f "$MK/Dockerfile" "$MK"
