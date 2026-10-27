#!/bin/sh
# Render every mission's far-country panorama in Blender and write it as webp for the game:
#   sh tools/horizons.sh [mission …]   (default: all that have a horizon; the forest's mist hides it)
# Needs Blender (BLENDER=… to point at it) and the project's node modules (sharp).
set -e
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
TMP=$(mktemp -d)
for m in ${@:-vineyard town harbour railway bridge airfield radar}; do
  HORIZON_JSON=public/textures/horizons.json "$BLENDER" -b -P tools/blender/horizon.py -- "$m" "$TMP" | grep -E 'rendered|Error' || true
  node -e "require('sharp')('$TMP/horizon_$m.png').webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile('public/textures/horizon_$m.webp').then(i => console.log('$m', i.size, 'bytes'))"
done
rm -rf "$TMP"
