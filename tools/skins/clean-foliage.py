# Clean the pale specks out of a Tripo tree's leaf texture (the umbrella pine's "pale squares").
# Tripo's crown is a few hundred big leaf triangles, so a speck of near-white in its 512 px texture
# (sky or glare the image model painted between the needles) lands on a whole triangle and shows as
# a pale square in the crown; the brightness fix the material step gives the dark trees
# (src/world/materials.json) made them stand out more. Each texel that is much lighter and greyer
# than the leaves (grey, and lighter than most of the texture or than its neighbours) takes the
# colour of the nearest leaf texel, with a little margin, so the pattern stays and only the specks go.
#   ~/ComfyUI-Installs/ComfyUI/ComfyUI/.venv/bin/python3 tools/skins/clean-foliage.py public/models/tree_pine.glb [more.glb]
# It writes the cleaned base colour back into the GLB (replace-texture.py: images[0], the base
# colour in Tripo's files) and saves the old one as <name>.before.jpg in the temp folder for checking.
import io, json, struct, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = Path(__file__).resolve().parent
TMP = Path(tempfile.gettempdir())

def base_colour(path):
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    js = json.loads(d[20:20 + jl])
    tex = js['textures'][js['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']]
    src = tex.get('source', tex.get('extensions', {}).get('EXT_texture_webp', {}).get('source'))
    assert src == 0, 'replace-texture.py writes images[0]: the base colour is elsewhere in this file'
    iv = js['bufferViews'][js['images'][0]['bufferView']]
    off = 28 + jl + iv.get('byteOffset', 0)
    return Image.open(io.BytesIO(d[off:off + iv['byteLength']])).convert('RGB'), js['images'][0]['mimeType']

def clean(im):
    a = np.asarray(im).astype(np.float32) / 255
    mx, mn = a.max(2), a.min(2)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    med = np.asarray(im.filter(ImageFilter.MedianFilter(9))).astype(np.float32) / 255
    # Pale: grey (hardly any colour: the leaves are green, the bark red-brown) and lighter than most
    # of the texture, or clearly lighter than the leaves just round it. Each pale texel takes the
    # colour of the nearest texel that isn't. (The pine's texture is dark: 98% of it under 0.36.)
    pale = (sat < 0.22) & ((mx > np.median(mx) * 1.3) | (mx > med.max(2) * 1.45 + 0.04))
    pale = ndimage.binary_dilation(pale, iterations=2)
    _, (iy, ix) = ndimage.distance_transform_edt(pale, return_indices=True)
    out = a[iy, ix]
    return Image.fromarray((out * 255 + 0.5).clip(0, 255).astype(np.uint8)), int(pale.sum())

for p in sys.argv[1:]:
    im, mime = base_colour(p)
    im.save(TMP / f'{Path(p).stem}.before.jpg', quality=95)
    out, n = clean(im)
    buf = io.BytesIO()
    out.save(buf, 'JPEG' if mime == 'image/jpeg' else 'WEBP', quality=92)
    tmp = TMP / (f'{Path(p).stem}.clean' + ('.jpg' if mime == 'image/jpeg' else '.webp'))
    tmp.write_bytes(buf.getvalue())
    subprocess.run([sys.executable, str(HERE / 'replace-texture.py'), p, str(tmp)], check=True)
    print(p, f'{n} texels replaced ({100 * n / (im.width * im.height):.2f}%)')
