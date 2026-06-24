#!/usr/bin/env bash
# Build the slim mapKurator spotter image (multi-stage; adet._C compiled in the
# builder stage and baked into a thin CUDA-base runtime, ~5.8 GB).
#
# Slow first time (~several GB of base layers + torch). No GPU needed to build
# (FORCE_CUDA compiles the CUDA op without a visible device). To patch the spotter,
# edit vendor/mapkurator-spotter/spotter-v2 and rebuild — the builder recompiles it.
set -euo pipefail
MK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="${MK_RUNTIME:-podman}"
VENDOR="$MK/vendor/mapkurator-spotter"
SPOTTER="$VENDOR/spotter-v2"

# The Dockerfile COPYs the spotter sources into the image, so the vendored repo
# (third-party, gitignored) must be present in the build context first.
if [ ! -d "$SPOTTER" ]; then
  echo ">> cloning mapkurator-spotter into vendor/ ..."
  mkdir -p "$MK/vendor"
  git clone --depth 1 https://github.com/knowledge-computing/mapkurator-spotter.git "$VENDOR"
fi

exec "$RUNTIME" build -t "${MK_IMAGE:-localhost/despuig-mapkurator:latest}" \
  -f "$MK/Dockerfile" "$MK"
