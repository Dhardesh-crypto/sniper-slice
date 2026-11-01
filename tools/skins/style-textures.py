# The walls' photographs per region (public/textures/styles/<style>/<key>.jpg): plaster, plaster2,
# stone and concrete, made with SDXL (RealVisXL V5 + the 8-step Lightning LoRA, the same ComfyUI
# setup StableGen uses), tiling from the start: the UNet and the VAE pad round the edges while they
# work (custom_nodes/sniper_slice_circular.py in ComfyUI), so the right edge carries on into the left
# and the top into the bottom. A map names its style (map.wallStyle) and usePhotoTextures
# (world/textures.js) loads these over the shared photos.
#   ~/ComfyUI-Installs/ComfyUI/ComfyUI/.venv/bin/python3 tools/skins/style-textures.py [style ...]
# Needs a ComfyUI server on 127.0.0.1:8188. Existing files are kept; delete one to make it again.
import io, sys, time, uuid, random
from pathlib import Path
import requests
from PIL import Image

SERVER = 'http://127.0.0.1:8188'
OUT = Path(__file__).resolve().parents[2] / 'public' / 'textures' / 'styles'
CKPT, LORA = 'RealVisXL_V5.0_fp16.safetensors', 'sdxl_lightning_8step_lora.safetensors'
FLAT = ('seamless texture, flat straight-on photograph of a wall, filling the whole frame, evenly lit by overcast daylight, '
        'no perspective, uniform all over, sharp detail, ')
NEG = 'stripes, bands, rows, moss, perspective, corner, window, door, sky, ground, grass, plants, people, text, sign, frame, border, vignette, blurry, cartoon, painting'

# Each picture shows about as much wall as one repeat in the game: stone 2.5 m, plaster 3.5 m, concrete 3 m.
STYLES = {
    'tuscany': {   # Vineyard: Tuscan farmhouses
        'plaster':  'pale ochre lime plaster on an old Tuscan farmhouse, weathered, hairline cracks, patched and stained, 3 metres of wall',
        'plaster2': 'faded pale siena lime plaster, worn thin and blotchy, small chips and old repairs, 3 metres of wall',
        'stone':    'rough Tuscan rubble masonry, irregular honey-coloured sandstone and grey limestone blocks, thick pale grey lime mortar, old and weathered, 2 metres of wall',
    },
    'umbria': {    # Bell Tower: an Umbrian hill town
        'plaster':  'pale cream lime plaster on a medieval Umbrian town house, flaking, damp stains, 3 metres of wall',
        'plaster2': 'pale rose lime plaster, faded and patched, blotchy, fine cracks, 3 metres of wall',
        'stone':    'medieval wall of rough-hewn pale pink and grey limestone blocks of different sizes, Assisi, worn and uneven, dark weathering in the joints, 2 metres of wall',
    },
    'liguria': {   # Low Tide and Sea Wall: the Ligurian coast
        'plaster':  'salt-weathered pale pastel painted plaster on a Ligurian harbour house, peeling paint, damp and salt stains, 3 metres of wall',
        'plaster2': 'faded pale yellow painted plaster, Ligurian seaside town, peeling in patches, streaks of grime, 3 metres of wall',
        'stone':    'grey Ligurian rubble stone and slate wall, irregular stones, lime mortar, salt crust and lichen, 2 metres of wall',
        'concrete': 'weathered grey coastal bunker concrete, faint board marks, rust streaks and salt bloom, chipped, 3 metres of wall',
    },
    'apennine': {  # Black Pine, Flak Line, Broken Span: the mountains
        'plaster':  'colourless rough grey cement render, unpainted, uneven trowel marks, hairline cracks, dark damp stains, 3 metres of wall',
        'plaster2': 'old whitewashed render, dirty and worn, grey patches where the whitewash has gone, small chips, 3 metres of wall',
        'stone':    'dark grey rough Apennine mountain stone, irregular rubble masonry, deep mortar joints, moss and lichen, 2 metres of wall',
        'concrete': 'weathered grey military concrete, faint board marks, water stains, chipped, 3 metres of wall',
    },
    'po': {        # Iron Road: a Po valley railway depot
        'plaster':  'pale yellow lime plaster, slightly dirty, a few fine cracks, 3 metres of wall',
        'plaster2': 'faded pale red-ochre plaster on a railway building, grimy, patched, 3 metres of wall',
        'stone':    'sooty red brick wall of a railway depot, blackened by smoke, worn mortar, a few broken bricks, 2 metres of wall',
    },
    'lombardy': {  # Night Owl: an airfield in Lombardy
        'plaster':  'pale cream plaster on a military building, weathered, rain streaks, 3 metres of wall',
        'plaster2': 'faded grey-green painted plaster, old camouflage paint worn away in patches, 3 metres of wall',
        'stone':    'weathered red brick wall of a Lombard farm building, faded bricks, worn mortar, a few broken bricks, 2 metres of wall',
        'concrete': 'weathered grey concrete wall of an airfield building, faint board marks, rain streaks, chipped, 3 metres of wall',
    },
}

def node(cls, **inputs): return {'class_type': cls, 'inputs': inputs}

def run(graph, timeout=600):
    cid = str(uuid.uuid4())
    pid = requests.post(f'{SERVER}/prompt', json={'prompt': graph, 'client_id': cid}).json()['prompt_id']
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = requests.get(f'{SERVER}/history/{pid}').json()
        if pid in h:
            outs = h[pid]['outputs']
            img = next(i for o in outs.values() for i in o.get('images', []))
            r = requests.get(f'{SERVER}/view', params={'filename': img['filename'], 'subfolder': img['subfolder'], 'type': img['type']})
            return Image.open(io.BytesIO(r.content)).convert('RGB')
        time.sleep(2)
    raise TimeoutError(pid)

def graph(prompt, seed, on=True, size=1024, steps=8):
    # (on=False: the same model with its padding put back, for whatever runs on the server next)
    return {
        'ckpt': node('CheckpointLoaderSimple', ckpt_name=CKPT),
        'lora': node('LoraLoader', model=['ckpt', 0], clip=['ckpt', 1], lora_name=LORA, strength_model=1.0, strength_clip=1.0),
        'wrap': node('SniperSliceCircularModel', model=['lora', 0], on=on),
        'vae': node('SniperSliceCircularVAE', vae=['ckpt', 2], on=on),
        'pos': node('CLIPTextEncode', clip=['lora', 1], text=FLAT + prompt),
        'neg': node('CLIPTextEncode', clip=['lora', 1], text=NEG),
        'lat': node('EmptyLatentImage', width=size, height=size, batch_size=1),
        'ks': node('KSampler', model=['wrap', 0], positive=['pos', 0], negative=['neg', 0], latent_image=['lat', 0],
                   seed=seed, steps=steps, cfg=1.5, sampler_name='euler', scheduler='sgm_uniform', denoise=1.0),
        'dec': node('VAEDecode', samples=['ks', 0], vae=['vae', 0]),
        'save': node('SaveImage', images=['dec', 0], filename_prefix='style_tex'),
    }

if __name__ == '__main__':
    only = sys.argv[1:]
    for style, keys in STYLES.items():
        if only and style not in only: continue
        (OUT / style).mkdir(parents=True, exist_ok=True)
        for key, prompt in keys.items():
            path = OUT / style / f'{key}.jpg'
            if path.exists(): continue
            t0 = time.time()
            run(graph(prompt, random.Random(f'{style}/{key}/{prompt}').randrange(2**31))).save(path, 'JPEG', quality=86)
            print(f'{style}/{key}: {time.time() - t0:.0f} s', flush=True)
    run(graph('wall', 0, on=False, size=256, steps=1))   # (the padding back to normal)
