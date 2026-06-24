#!/usr/bin/env bash
# Run spotter inference on a directory of tiles. Run INSIDE the container (run.sh).
# Writes one JSON per tile (word polygons + recognized text + score) to OUT.
#
#   scripts/toponims/mapkurator/run.sh bash /workspace/mk/infer.sh
# Env overrides: MK_CONFIG, MK_IN, MK_OUT, MK_WEIGHTS.
set -euo pipefail
SPOTTER="${MK_SPOTTER:-/opt/spotter}"
cd "$SPOTTER"
# The spotter (incl. the compiled adet._C op) lives at /opt/spotter; the image already
# sets PYTHONPATH=/opt/spotter. Re-assert it so `import adet` + adet._C resolve.
export PYTHONPATH="$SPOTTER${PYTHONPATH:+:$PYTHONPATH}"
CONFIG="${MK_CONFIG:-configs/inference_en_test.yaml}"
IN="${MK_IN:-/workspace/in}"
OUT="${MK_OUT:-/workspace/out}"
WEIGHTS="${MK_WEIGHTS:-/workspace/weights/model_v2_en.pth}"

echo ">> config=$CONFIG  in=$IN  out=$OUT  weights=$WEIGHTS"
CUDA_VISIBLE_DEVICES=0 python tools/inference.py \
  --config-file "$CONFIG" --output_json \
  --input "$IN" --output "$OUT" \
  --opts MODEL.WEIGHTS "$WEIGHTS"
echo ">> done. JSON written to $OUT:"
ls -la "$OUT"
