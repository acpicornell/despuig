#!/usr/bin/env bash
# Download the English text-spotting checkpoint (Google Drive) into the mounted
# weights dir. Run INSIDE the container (run.sh) — the image has gdown.
#
#   scripts/toponims/mapkurator/run.sh bash /workspace/mk/get-weights.sh
set -euo pipefail
DEST="/workspace/weights/model_v2_en.pth"
# English spotting weight, from mapkurator-spotter README (Google Drive file id).
FILE_ID="1agOzYbhZPDVR-nqRc31_S6xu8yR5G1KQ"
if [ -s "$DEST" ]; then
  echo ">> weight already present: $DEST"; exit 0
fi
echo ">> downloading English spotter weight to $DEST ..."
gdown "$FILE_ID" -O "$DEST"
ls -la "$DEST"
