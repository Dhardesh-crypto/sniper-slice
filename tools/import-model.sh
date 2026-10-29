#!/bin/sh
# Bring a generated model into the game: download it, shrink its textures to JPEG
# (tools/shrink-glb.py), then weld and simplify it (meshoptimizer, error 0.005: the look stays,
# a third of the triangles or fewer). Usage: tools/import-model.sh <glb url> <name> [texture px=1024]
# Writes public/models/<name>.glb, meshopt-compressed (tools/compress-models.mjs).
set -e
url=$1; name=$2; px=${3:-1024}
tmp=$(mktemp -d)
curl -sL -o "$tmp/in.glb" "$url"
python3 tools/shrink-glb.py "$tmp/in.glb" "$tmp/small.glb" "$px"
npx gltf-transform weld "$tmp/small.glb" "$tmp/weld.glb" >/dev/null 2>&1
npx gltf-transform simplify "$tmp/weld.glb" "public/models/$name.glb" --ratio 0.25 --error 0.005 >/dev/null 2>&1
node tools/compress-models.mjs "$name.glb" >/dev/null
rm -rf "$tmp"
