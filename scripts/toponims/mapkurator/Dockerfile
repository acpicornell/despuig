# mapKurator spotter-v2 environment for GPU inference (Ada / RTX 4060, sm_89).
#
# This image contains ONLY the environment (CUDA devel + PyTorch + detectron2 +
# deps). The spotter repo itself is MOUNTED at runtime and its custom CUDA op
# (`adet._C`, the deformable-attention kernel) is compiled inside a container with
# `build-op.sh`, so source patches don't require an image rebuild. The compiled
# .so persists in the mounted repo.
#
# Why these versions: the RTX 4060 is Ada Lovelace (compute capability 8.9), which
# needs CUDA >= 11.8. The newest detectron2 prebuilt wheels + a torch that supports
# sm_89 land us on torch 2.0.1 + cu118 + detectron2 0.6. nvcc (devel image) is
# required to compile the adet op against this torch.
FROM nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
# Build the CUDA op only for Ada (8.9) to keep compile fast; FORCE_CUDA so the op
# builds even though the build host has no visible GPU.
ENV TORCH_CUDA_ARCH_LIST="8.9"
ENV FORCE_CUDA=1
ENV PYTHONDONTWRITEBYTECODE=1

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

WORKDIR /workspace
CMD ["/bin/bash"]
