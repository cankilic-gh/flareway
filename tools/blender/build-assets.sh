#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
if [[ ! -x "$BLENDER" ]]; then
  echo "Blender not found at $BLENDER" >&2
  exit 1
fi
exec "$BLENDER" --background --factory-startup --python "$ROOT/tools/blender/generate_flareway_assets.py" -- "$@"
