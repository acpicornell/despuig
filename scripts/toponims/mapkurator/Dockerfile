# mapKurator spotter-v2 image for GPU inference (Ada / RTX 4060, sm_89). ~5.8 GB.
#
# Multi-stage build. The fat CUDA *devel* toolkit (nvcc, ~9.75 GB) is only needed
# to COMPILE detectron2 + the spotter's custom CUDA op (`adet._C`). At inference
# time torch's cu118 wheel carries its own bundled CUDA libs, so the system devel
# toolkit is dead weight. We therefore:
#   1. builder stage (devel): install torch/detectron2 + COMPILE adet._C, baking
#      the spotter repo into /opt/spotter (the .so lands next to its sources).
#   2. runtime stage (thin CUDA *base*, no nvcc): copy only the installed Python
#      packages + the compiled spotter.
#
# The op is baked in, not compiled at runtime, so the spotter repo is NOT mounted.
# To patch the spotter source, edit vendor/mapkurator-spotter/spotter-v2 and rebuild
# (build-image.sh) — the builder stage recompiles adet._C from it.
#
# Why these versions: the RTX 4060 is Ada Lovelace (compute capability 8.9), which
# needs CUDA >= 11.8. The newest detectron2 from source + a torch that supports
# sm_89 land us on torch 2.0.1 + cu118 + detectron2 main.

# Runtime base for stage 2 (global ARG so it's usable in that FROM). Defaults to the
# thin CUDA *base* image because torch's cu118 wheel bundles its own CUDA libs
# (verified: identical inference output to cudnn8-runtime). If you ever hit a missing
# system CUDA/cudnn lib, fall back with:
#   --build-arg RUNTIME_BASE=nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04
ARG RUNTIME_BASE=nvidia/cuda:11.8.0-base-ubuntu22.04

# ───────────────────────── Stage 1: builder (has nvcc) ─────────────────────────
FROM nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive
# Build the CUDA op only for Ada (8.9) to keep compile fast; FORCE_CUDA so the op
# builds even though the build host has no visible GPU.
ENV TORCH_CUDA_ARCH_LIST="8.9"
ENV FORCE_CUDA=1
ENV PYTHONDONTWRITEBYTECODE=1

# NOTE: keep these first RUN layers stable so the slow torch/detectron2 layers are
# reused from the build cache instead of re-downloaded on every rebuild.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 python3-pip python3.10-dev \
        git ninja-build build-essential \
        libgl1 libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python

RUN python -m pip install --no-cache-dir --upgrade pip setuptools wheel

# PyTorch 2.0.1 built for CUDA 11.8 (supports Ada sm_89).
RUN pip install --no-cache-dir \
        torch==2.0.1+cu118 torchvision==0.15.2+cu118 \
        --index-url https://download.pytorch.org/whl/cu118

# Pin numpy<2 BEFORE anything else pulls numpy 2.x: torch 2.0.1 is compiled against
# the numpy 1.x ABI and crashes at runtime under numpy 2.
RUN pip install --no-cache-dir "numpy<2"

# No prebuilt detectron2 wheels exist for torch2.0/cu118 → build from source.
# --no-build-isolation so the build sees the torch installed above (its setup.py
# imports torch). FORCE_CUDA + TORCH_CUDA_ARCH_LIST (set in ENV) compile the CUDA
# ops for Ada. detectron2 has no torch-2.x release tag; main is torch-2.x-compatible
# (v0.6 imports the removed torch._six and would crash).
RUN pip install --no-cache-dir --no-build-isolation \
        'git+https://github.com/facebookresearch/detectron2.git'

# Runtime deps for the spotter (from spotter-v2/setup.py install_requires) + gdown
# for fetching weights. Reassert numpy<2 in case a dep tried to bump it.
RUN pip install --no-cache-dir \
        "numpy<2" "Pillow>=9" opencv-python-headless \
        termcolor yacs tabulate cloudpickle matplotlib "tqdm>4.29.0" \
        tensorboard rapidfuzz Polygon3 shapely scikit-image editdistance numba \
        pandas gdown

# Bake + compile the spotter's adet._C op so the runtime stage needs no nvcc.
# --no-deps: the deps above already cover it (and avoid pulling numpy>=2 /
# opencv-python). The editable build places the compiled .so in /opt/spotter/adet/.
COPY vendor/mapkurator-spotter/spotter-v2 /opt/spotter
RUN cd /opt/spotter && pip install -e . --no-build-isolation --no-deps \
    && python -c "import torch, adet, adet._C; print('built adet._C for', torch.version.cuda)"

# ──────────────────────── Stage 2: runtime (no nvcc) ───────────────────────────
# Thin CUDA base (see RUNTIME_BASE ARG at top): torch carries its own CUDA libs, so
# the system CUDA runtime/cudnn are redundant.
FROM ${RUNTIME_BASE} AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
# The spotter is run from its repo (tools/inference.py + configs/), import via path.
ENV PYTHONPATH=/opt/spotter

# Just the Python interpreter + the few shared libs OpenCV/skimage need at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.10 libgl1 libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python

# Bring the compiled Python environment + the baked spotter from the builder.
# pip (apt's, upgraded) installs into /usr/local on Ubuntu; console scripts (gdown)
# land in /usr/local/bin. Ubuntu's python3.10 already has dist-packages on sys.path.
COPY --from=builder /usr/local/lib/python3.10/dist-packages /usr/local/lib/python3.10/dist-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /opt/spotter /opt/spotter

WORKDIR /workspace
CMD ["/bin/bash"]
