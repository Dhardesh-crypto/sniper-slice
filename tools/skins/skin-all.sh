#!/bin/sh
# Every exported building in <workdir> (<mission>_<x>_<z>.obj, from export-walls.js) through
# stablegen-texture.py, one after another, into public/models/skin_<mission>_<x>_<z>.glb (compressed).
# Buildings that already have their skin are skipped, so it can be stopped and started again.
# Needs a ComfyUI server on 127.0.0.1:8188 (see stablegen-texture.py).
#   sh tools/skins/skin-all.sh <workdir>
set -u
WORK=$1
HERE=$(cd "$(dirname "$0")/../.." && pwd)
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
style() {   # the map's wallStyle (missions/*.js)
  case $1 in
    vineyard) echo tuscany ;; town) echo umbria ;; harbour|radar) echo liguria ;;
    forest|flak|bridge) echo apennine ;; railway) echo po ;; airfield) echo lombardy ;;
  esac
}
for obj in "$WORK"/*.obj; do
  name=$(basename "$obj" .obj)
  out="$HERE/public/models/skin_$name.glb"
  [ -f "$out" ] && continue
  st=$(style "${name%%_*}")
  echo "$(date +%H:%M) $name ($st)"
  rm -f "$WORK/$name.status"
  "$BLENDER" --online-mode --python "$HERE/tools/skins/stablegen-texture.py" -- "$WORK" "$name" "$st" > "$WORK/$name.blender.txt" 2>&1
  if grep -q '"ok": true' "$WORK/$name.status" 2>/dev/null; then
    cp "$WORK/$name.glb" "$out" && (cd "$HERE" && node tools/compress-models.mjs "skin_$name.glb" | tail -1)
  else
    echo "  failed: $(tail -3 "$WORK/$name.log" 2>/dev/null | tr '\n' ' ')"
  fi
done
echo "$(date +%H:%M) done"
