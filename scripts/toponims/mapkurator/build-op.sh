#!/usr/bin/env bash
# Compile the spotter's custom CUDA op (adet._C, deformable-attention) against the
# image's torch. Run this INSIDE the container (via run.sh) once; the .so persists
# in the mounted spotter repo, so it survives container exits.
#
#   scripts/toponims/mapkurator/run.sh bash /workspace/mk/build-op.sh
set -euo pipefail
cd /workspace/spotter
export FORCE_CUDA=1
export TORCH_CUDA_ARCH_LIST="8.9"
echo ">> building adet._C for sm_89 ..."
# --no-build-isolation so setup.py sees the image's torch (it imports torch to
# discover CUDA and configure the extension build).
# --no-deps so it doesn't drag in numpy>=2 / opencv-python (the image already has
# all runtime deps pinned, incl. numpy<2 and opencv-python-headless).
pip install -e . --no-build-isolation --no-deps 2>&1 | tail -40
# Belt-and-braces: torch 2.0.1 needs the numpy 1.x ABI.
pip install --no-cache-dir "numpy<2" 2>&1 | tail -3
echo ">> import check:"
python -c "import torch, adet, adet._C; print('torch', torch.__version__, 'cuda', torch.version.cuda, 'adet._C OK')"
