# One palette per region: the building skins (StableGen) and the walls' photographs (SDXL style
# sets, public/textures/styles/<region>/) of a region pulled toward the same colour, so a skinned
# landmark and the code-built houses beside it read as the same stone and plaster. Each source was
# made on its own: in Umbria the skins came out greyer than the walls, in Liguria the plaster2
# photo far yellower than the rest, Lombardy's brick far redder.
# How: per region, the average colour (CIE Lab: lightness, then green–red and blue–yellow) and
# lightness spread of each of its textures, measured only where the surface uses the texture (a
# skin's atlas is mostly black gutter: uv-mask.mjs gives the used texels); the region's target is
# the average of those. Then each texture moves part of the way to it (a colour transfer in Lab:
# the shift of its average, its spread scaled), keeping its own pattern and some of its own
# colour: a pink church stays pinker than its grey neighbour, just less far apart.
#   skins: 60% of the colour gap, 40% of the lightness gap, 30% of the spread;
#   wall photos: 35%, 25%, 20% (they're shared by every house: moved less).
#   ~/ComfyUI-Installs/ComfyUI/ComfyUI/.venv/bin/python3 tools/skins/region-palette.py [--report] [region ...]
# --report only measures. Files already matched are listed in region-palette.json (with the
# region's target) and skipped, so running it twice doesn't move them twice; to redo one, restore
# it from git and take it off the list.
import io, json, struct, subprocess, sys, hashlib, tempfile
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
DONE = HERE / 'region-palette.json'
NODE = '/Users/f.h.huisman/.nvm/versions/node/v22.19.0/bin/node'
# Which missions' skins belong to which region: each map's wallStyle (src/missions/*.js; radar is coast.js).
REGIONS = {'tuscany': ['vineyard'], 'umbria': ['town'], 'apennine': ['bridge', 'flak', 'forest'],
           'po': ['railway'], 'liguria': ['harbour', 'radar'], 'lombardy': ['airfield']}
K = {'skin': (0.4, 0.6, 0.3), 'wall': (0.25, 0.35, 0.2)}      # (lightness, colour, spread) shares of the gap
M = 512                                                      # measuring size

# sRGB <-> CIE Lab (D65), float32, on (..., 3) arrays.
XYZ = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], np.float32)
WHITE = np.array([0.9505, 1.0, 1.089], np.float32)
def to_lab(rgb8):
    a = rgb8.astype(np.float32) / 255
    a = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    xyz = a @ XYZ.T / WHITE
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)
def to_rgb8(lab):
    fy = (lab[..., 0] + 16) / 116
    f = np.stack([fy + lab[..., 1] / 500, fy, fy - lab[..., 2] / 200], -1)
    xyz = np.where(f > 0.2069, f ** 3, (f - 16 / 116) / 7.787) * WHITE
    a = np.clip(xyz @ np.linalg.inv(XYZ).T.astype(np.float32), 0, 1)
    a = np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)
    return (a * 255 + 0.5).clip(0, 255).astype(np.uint8)

def glb_image(path):
    d = path.read_bytes(); jl = struct.unpack('<I', d[12:16])[0]; js = json.loads(d[20:20 + jl])
    iv = js['bufferViews'][js['images'][0]['bufferView']]; off = 28 + jl + iv.get('byteOffset', 0)
    return Image.open(io.BytesIO(d[off:off + iv['byteLength']])).convert('RGB'), js['images'][0]['mimeType']

def used_mask(path):
    with tempfile.TemporaryDirectory() as t:
        out = Path(t) / 'm.pgm'
        subprocess.run([NODE, str(HERE / 'uv-mask.mjs'), str(path), str(out), str(M)], check=True, capture_output=True, cwd=ROOT)
        return np.asarray(Image.open(out)) > 0

def stats(im, mask):
    lab = to_lab(np.asarray(im.resize((M, M), Image.BILINEAR)))[mask]
    return {'L': float(lab[:, 0].mean()), 'a': float(lab[:, 1].mean()), 'b': float(lab[:, 2].mean()), 'sd': float(lab[:, 0].std())}

def transfer(im, s, t, kind):
    kL, kc, ks = K[kind]
    scale = 1 + ks * (t['sd'] / max(s['sd'], 1e-3) - 1)
    rgb = np.asarray(im)
    out = np.empty_like(rgb)
    for y in range(0, rgb.shape[0], 256):                    # (a 4096 skin in strips: memory)
        lab = to_lab(rgb[y:y + 256])
        lab[..., 0] = (lab[..., 0] - s['L']) * scale + s['L'] + kL * (t['L'] - s['L'])
        lab[..., 1] += kc * (t['a'] - s['a'])
        lab[..., 2] += kc * (t['b'] - s['b'])
        out[y:y + 256] = to_rgb8(lab)
    return Image.fromarray(out)

def main():
    report = '--report' in sys.argv
    pick = [a for a in sys.argv[1:] if not a.startswith('--')] or list(REGIONS)
    done = json.loads(DONE.read_text()) if DONE.exists() else {}
    for region in pick:
        items = []
        for p in sorted((ROOT / 'public/textures/styles' / region).glob('*.jpg')):
            im = Image.open(p).convert('RGB')
            items.append(('wall', p, im, 'image/jpeg', np.ones((M, M), bool)))
        for m in REGIONS[region]:
            for p in sorted((ROOT / 'public/models').glob(f'skin_{m}_*.glb')):
                im, mime = glb_image(p)
                items.append(('skin', p, im, mime, used_mask(p)))
        st = [stats(im, mask) for _, _, im, _, mask in items]
        t = {k: float(np.mean([s[k] for s in st])) for k in ('L', 'a', 'b', 'sd')}
        print(f'{region}: target L{t["L"]:.1f}±{t["sd"]:.1f} a{t["a"]:.1f} b{t["b"]:.1f}')
        for (kind, p, im, mime, mask), s in zip(items, st):
            rel = str(p.relative_to(ROOT))
            line = f'  {kind} {rel:52} L{s["L"]:5.1f}±{s["sd"]:4.1f} a{s["a"]:5.1f} b{s["b"]:5.1f}'
            if report or rel in done:
                print(line + ('  (matched before)' if rel in done else '')); continue
            out = transfer(im, s, t, kind)
            n = stats(out, mask)
            print(line + f'  →  L{n["L"]:5.1f}±{n["sd"]:4.1f} a{n["a"]:5.1f} b{n["b"]:5.1f}')
            if kind == 'wall':
                out.save(p, quality=85)                     # (about the size the photos were)
            else:
                with tempfile.TemporaryDirectory() as tdir:
                    tmp = Path(tdir) / ('new.jpg' if mime == 'image/jpeg' else 'new.webp')
                    out.save(tmp, 'JPEG' if mime == 'image/jpeg' else 'WEBP', quality=78, method=6)   # (about the size the skins were)
                    subprocess.run([sys.executable, str(HERE / 'replace-texture.py'), str(p), str(tmp)], check=True)
            done[rel] = {'region': region, 'target': {k: round(v, 2) for k, v in t.items()}, 'from': {k: round(v, 2) for k, v in s.items()}}
        if not report:
            DONE.write_text(json.dumps(done, indent=1) + '\n')

main()
