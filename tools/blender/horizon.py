# The far landscape around a mission, rendered as a panorama strip
# (run: blender -b -P tools/blender/horizon.py -- <mission> <out dir (public/textures)>).
# A real landscape is built from the map's edge out to 20 km (hills, fields, woods, cypress lines,
# poplar rows, hill villages, the sea, the Alps under snow, by region), lit by the mission's own
# sun and washed into its haze with distance, and rendered from the map's centre with a 360°
# equirectangular camera over a band of latitudes; the sky is left transparent so the game's own
# sky shows above it. src/world/horizon.js wraps it round a cylinder that follows the camera.
# Writes horizon_<mission>.png (straight alpha; tools/horizons.sh makes the webp) and the mission's
# brightness scale into horizons.json (or $HORIZON_JSON).
import bpy, bmesh, math, os, random, sys
import numpy as np
from mathutils import Vector, noise

MISSION, OUT = sys.argv[-2], sys.argv[-1]
os.makedirs(OUT, exist_ok=True)
LAT_MIN, LAT_MAX = -3.0, 16.0          # degrees: the band the game shows (see horizon.js)
WIDTH = 8192
R0, R1 = 1100.0, 22000.0               # the landscape starts beyond the map and its rim


def hexc(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return np.array([x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c])


def sst(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---- regions ----
# The mission's sun (zenith angle and compass bearing, as in its module) and colour; lift: how much
# the region's hills are raised to clear the map's rim; fade: how far (m) the haze takes to close in;
# sea: the bearings (degrees clockwise from north) of open sea, or None. Its sky, fog and ground
# brightness come from skies.json (sampled from the game by tools/sky-strip.js).
M = {
    'vineyard': dict(region='tuscany', zenith=50, azimuth=200, sun=0xffe4b8, lift=2.3, fade=4500, sea=None, seed=1),
    'town': dict(region='umbria', zenith=70, azimuth=250, sun=0xffc488, lift=1.9, fade=4200, sea=None, seed=2),
    'harbour': dict(region='liguria', zenith=76, azimuth=285, sun=0xffa868, lift=1.5, fade=4500, sea=(-80, 80), seed=3),
    'railway': dict(region='po', zenith=42, azimuth=200, sun=0xfff0e0, lift=1.0, fade=3800, sea=None, seed=4),
    'bridge': dict(region='serchio', zenith=40, azimuth=170, sun=0xfff0d8, lift=1.2, fade=5000, sea=None, seed=5),
    'airfield': dict(region='lombardy', zenith=80, azimuth=95, sun=0xff9c5c, lift=1.3, fade=4200, sea=None, seed=6),
    'radar': dict(region='coast', zenith=79, azimuth=290, sun=0xff9868, lift=1.7, fade=3600, sea=(-85, 85), seed=7),
}[MISSION]
rng = random.Random(M['seed'])
SKY = __import__('json').load(open(os.path.join(os.path.dirname(__file__), 'skies.json')))[MISSION]
# The game draws the panorama untextured-lit and tone-maps it with everything else, so the strip holds
# radiance (as the game's renderer has it before tone mapping) divided by K, and the game multiplies
# by K again. Brighter than K just clips: after tone mapping that's as white as the sky anyway.
K = float(min(4.0, max(1.0, max(max(c) for c in SKY['colours']))))
FOG = np.array(SKY['fog'] or [0.485, 0.565, 0.604]) / K
lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
# The sun's strength, so a field (albedo ~0.3) under it and the ambient comes out as bright as the
# game's own ground round the start.
AMBIENT = 0.3
SUN_E = max(0.6, (math.pi * lum(SKY['ground']) / 0.3 - math.pi * AMBIENT * 0.3 / 0.3) / max(0.2, math.cos(math.radians(M['zenith']))))
S = M['seed'] * 17.3


def fr(x, y, scale, octaves=5, z=0.0):
    return noise.fractal(Vector((x / scale + S, y / scale - S, z)), 0.9, 2.0, octaves)


def ridged(x, y, scale, octaves=6, z=0.0):
    return noise.ridged_multi_fractal(Vector((x / scale - S, y / scale + S, z + 3)), 0.9, 2.1, octaves, 1.0, 2.0)


def bearing(x, y):
    return math.degrees(math.atan2(x, y)) % 360


def shore(x, y, r):
    """How far out to sea (degrees of bearing past the shoreline: negative inland), with headlands
    and bays along the shore."""
    a0, a1 = M['sea']
    b = (bearing(x, y) + 180) % 360 - 180
    wob = 18 * fr(x, y, 2500, 3) + 8 * fr(x, y, 600, 2)
    return min(b - a0, a1 - b) + wob


def sea_mask(x, y, r):
    """1 out at sea, 0 on land."""
    if not M['sea']: return 0.0
    return float(np.clip((shore(x, y, r) + 4) / 10, 0, 1))


def coastal(x, y, r):
    """0 at the water's edge rising to 1 some 2.5 km inland, so the hills climb from the shore."""
    if not M['sea']: return 1.0
    inland = max(0.0, -(shore(x, y, r) + 4)) * math.pi / 180 * r      # metres back from the shoreline
    return 0.08 + 0.92 * float(sst(0, 2500, inland))


def alps(x, y, r, b_lo, b_hi, height=3000):
    """A distant range under snow, between two bearings, 13–21 km out."""
    b = (bearing(x, y) + 180) % 360 - 180
    k = sst(b_lo - 25, b_lo, b) * (1 - sst(b_hi, b_hi + 25, b)) * sst(12500, 15500, r) * (1 - sst(19500, 21500, r))
    return k * height * (0.35 + 0.45 * ridged(x, y, 4500) + 0.2 * fr(x, y, 1500, 3))


def height(x, y):
    r = math.hypot(x, y)
    rise = sst(R0, R0 + 1800, r)
    reg = M['region']
    if reg == 'tuscany':
        h = rise * (110 + 190 * (fr(x, y, 2600) + 0.5) + 45 * fr(x, y, 650, 3))
        h += sst(8000, 15000, r) * 550 * (0.6 + 0.6 * fr(x, y, 4000, 4))
    elif reg == 'umbria':
        h = rise * (200 + 330 * (fr(x, y, 1900) + 0.5) + 90 * ridged(x, y, 1400, 4))
        h += sst(7000, 14000, r) * 800 * (0.5 + 0.6 * ridged(x, y, 3500))
    elif reg == 'liguria':
        h = rise * (260 + 520 * ridged(x, y, 1700) + 160 * fr(x, y, 600, 3))
        h += sst(4000, 9000, r) * 700 * ridged(x, y, 3000)
    elif reg == 'coast':
        h = rise * (90 + 220 * (fr(x, y, 2000) + 0.5) + 70 * ridged(x, y, 900, 4))
        h += sst(6000, 12000, r) * 600 * ridged(x, y, 3200)
    elif reg == 'po':
        h = rise * (6 + 6 * fr(x, y, 900, 3))
        h += alps(x, y, r, -70, 75, 3200)
        b = (bearing(x, y) + 180) % 360
        h += sst(110, 140, b) * (1 - sst(220, 250, b)) * sst(9000, 13000, r) * 700 * (0.4 + 0.5 * ridged(x, y, 3000))
    elif reg == 'serchio':
        h = rise * (450 + 700 * ridged(x, y, 2100) + 200 * fr(x, y, 700, 3))
        h += sst(6000, 11000, r) * 900 * ridged(x, y, 3400)
    elif reg == 'lombardy':
        h = rise * (8 + 8 * fr(x, y, 900, 3))
        b = (bearing(x, y) + 180) % 360 - 180
        foot = sst(-110, -70, b) * (1 - sst(70, 110, b)) * sst(3500, 6500, r)
        h += foot * (260 + 500 * ridged(x, y, 1900))
        h += alps(x, y, r, -60, 60, 3300)
    h *= M['lift'] * coastal(x, y, r)  # (the far country has to clear the map's own rim)
    s = sea_mask(x, y, r)
    if s > 0:
        cliff = 60 if reg == 'coast' else 20
        h = h * (1 - s) + (-40) * s + (cliff * (1 - s) if 0 < s < 1 else 0)
    # Keep every peak inside the strip's band: heights over 13° up are eased down (tanh), not cut.
    if h > 0:
        cap = r * math.tan(math.radians(13)) + 25
        h = cap * math.tanh(h / cap)
    return h - 25.0


# ---- the ground: a polar grid, dense near, sparse far ----
NA, NR = 2880, 240
angles = np.linspace(0, 2 * math.pi, NA, endpoint=False)
radii = R0 * (R1 / R0) ** (np.arange(NR) / (NR - 1))
X = np.outer(radii, np.sin(angles))          # Blender: +y is north (the game's −z), +x east
Y = np.outer(radii, np.cos(angles))
H = np.zeros_like(X)
for i in range(NR):
    for j in range(NA):
        H[i, j] = height(X[i, j], Y[i, j])
print('heights done', flush=True)

# Slope (for woods and rock), from the neighbours.
dr = np.gradient(H, axis=0) / np.gradient(radii)[:, None]
da = np.gradient(H, axis=1) / (radii[:, None] * (2 * math.pi / NA))
slope = np.hypot(dr, da)

PAL = {k: hexc(v) for k, v in dict(
    gold=0xc0a35f, stubble=0xb59c6a, green=0x6f7d43, dark=0x56643a, plough=0x7f634a, olive=0x80866a,
    wood=0x3b4729, chestnut=0x40492b, scrub=0x6e6f4c, rock=0x8e877a, marble=0xd9d6cf, snow=0xeef1f3,
    sand=0xc9b994, poplar=0x6b7a44, terrace=0x7a805f).items()}
reg = M['region']
fields = {'tuscany': ['gold', 'stubble', 'green', 'plough', 'olive', 'gold'],
          'umbria': ['green', 'gold', 'plough', 'olive', 'dark'],
          'liguria': ['terrace', 'olive', 'scrub', 'terrace'],
          'coast': ['scrub', 'olive', 'gold', 'scrub'],
          'po': ['green', 'gold', 'dark', 'plough', 'green', 'stubble'],
          'serchio': ['chestnut', 'dark', 'scrub'],
          'lombardy': ['green', 'dark', 'gold', 'plough', 'green']}[reg]
wood_level = {'tuscany': 0.62, 'umbria': 0.5, 'liguria': 0.55, 'coast': 0.6, 'po': 0.8, 'serchio': 0.15, 'lombardy': 0.7}[reg]
# Woods (where the wood measure is high: noise plus slope) as a smooth field for the shader, and
# the same mask on the grid for where the crowns go.
WM = np.zeros(H.shape)
for i in range(NR):
    for j in range(NA):
        WM[i, j] = fr(X[i, j], Y[i, j], 900, 3) * 0.5 + 0.5 + slope[i, j] * 0.9
WM = np.where(H < 1400, WM, 0)
woods = WM > wood_level + 0.35
print('colours done', flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def make_mesh(name, verts, faces, colors, mat, floats={}):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist() if isinstance(verts, np.ndarray) else verts, [], faces.tolist() if isinstance(faces, np.ndarray) else faces)
    if colors is not None:
        a = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        rgba = np.concatenate([np.asarray(colors, dtype=np.float32).reshape(-1, 3), np.ones((len(me.vertices), 1), np.float32)], 1)
        a.data.foreach_set('color', rgba.ravel())
        me.color_attributes.active_color_name = 'Col'
    for k, v in floats.items():
        me.attributes.new(k, 'FLOAT', 'POINT').data.foreach_set('value', np.asarray(v, np.float32).ravel())
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    ob.data.materials.append(mat)
    for p in me.polygons: p.use_smooth = True
    return ob


def haze_colour(nt, ray_length):
    """What the distance fades into: the game's fog colour close to the map, its sky (as it is at
    that bearing, brighter toward the sun) far out."""
    N, L = nt.nodes, nt.links
    geo = N.new('ShaderNodeNewGeometry')
    sep = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Position'], sep.inputs[0])
    at = N.new('ShaderNodeMath'); at.operation = 'ARCTAN2'; L.new(sep.outputs['X'], at.inputs[0]); L.new(sep.outputs['Y'], at.inputs[1])
    u = N.new('ShaderNodeMath'); u.operation = 'MULTIPLY_ADD'; u.inputs[1].default_value = 1 / (2 * math.pi); u.inputs[2].default_value = 1.0
    L.new(at.outputs[0], u.inputs[0])
    uv = N.new('ShaderNodeCombineXYZ'); L.new(u.outputs[0], uv.inputs['X']); uv.inputs['Y'].default_value = 0.5
    tex = N.new('ShaderNodeTexImage'); tex.image = SKY_IMG; tex.extension = 'REPEAT'; tex.interpolation = 'Linear'
    L.new(uv.outputs[0], tex.inputs['Vector'])
    if ray_length is None: return tex.outputs['Color']           # (just the sky at this bearing)
    far = N.new('ShaderNodeMapRange'); far.interpolation_type = 'SMOOTHSTEP'; far.inputs[1].default_value = 1500; far.inputs[2].default_value = 15000
    L.new(ray_length, far.inputs[0])
    mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    L.new(far.outputs[0], mix.inputs[0]); mix.inputs[6].default_value = (*FOG, 1); L.new(tex.outputs['Color'], mix.inputs[7])
    return mix.outputs[2]


# The sky strip as an image (one pixel per 5° of bearing, from north clockwise), in radiance / K.
SKY_IMG = bpy.data.images.new('sky', len(SKY['colours']), 1, float_buffer=True)
SKY_IMG.colorspace_settings.name = 'Non-Color'
SKY_IMG.pixels.foreach_set(np.concatenate([np.minimum(np.array(SKY['colours']) / K, 1.0), np.ones((len(SKY['colours']), 1))], 1).astype(np.float32).ravel())


def land_material(name, water=False, ground=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = N['Principled BSDF']
    if water:
        # Far water mirrors the sky low over it: the strip's colour at that bearing, a little darker.
        bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
        bsdf.inputs['Roughness'].default_value = 0.2
        glow = N.new('ShaderNodeMix'); glow.data_type = 'RGBA'; glow.blend_type = 'MULTIPLY'; glow.inputs[0].default_value = 1
        L.new(haze_colour(nt, None), glow.inputs[6]); glow.inputs[7].default_value = (*hexc(0x8fa2ad), 1)
        L.new(glow.outputs[2], bsdf.inputs['Emission Color']); bsdf.inputs['Emission Strength'].default_value = 1.0
    elif ground:
        L.new(ground_colour(nt), bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.95
    else:
        att = N.new('ShaderNodeAttribute'); att.attribute_name = 'Col'
        L.new(att.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.95
    # Aerial perspective: the further the camera ray went, the more of the haze.
    lp = N.new('ShaderNodeLightPath')
    k = N.new('ShaderNodeMath'); k.operation = 'DIVIDE'; k.inputs[1].default_value = -M['fade']
    L.new(lp.outputs['Ray Length'], k.inputs[0])
    e = N.new('ShaderNodeMath'); e.operation = 'EXPONENT'; L.new(k.outputs[0], e.inputs[0])
    f = N.new('ShaderNodeMath'); f.operation = 'SUBTRACT'; f.inputs[0].default_value = 1.0; L.new(e.outputs[0], f.inputs[1])
    em = N.new('ShaderNodeEmission'); L.new(haze_colour(nt, lp.outputs['Ray Length']), em.inputs['Color']); em.inputs['Strength'].default_value = 1.0
    mix = N.new('ShaderNodeMixShader')
    L.new(f.outputs[0], mix.inputs['Fac']); L.new(bsdf.outputs[0], mix.inputs[1]); L.new(em.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], N['Material Output'].inputs['Surface'])
    return m


def ground_colour(nt):
    """The ground's colour, worked out per pixel: Voronoi fields in the region's palette, then woods,
    rock, snow, the Apuan marble and the beach over them by the smooth masks."""
    N, L = nt.nodes, nt.links
    def node(t, **kw):
        n = N.new(t)
        for k, v in kw.items(): setattr(n, k, v)
        return n
    def math_(op, a, b=None, clamp=False):
        n = node('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): n.inputs[i].default_value = v
            else: L.new(v, n.inputs[i])
        return n.outputs[0]
    def mixc(f, a, b):
        n = node('ShaderNodeMix', data_type='RGBA')
        for sock, v in ((0, f), (6, a), (7, b)):
            if isinstance(v, (int, float)): n.inputs[sock].default_value = v
            elif isinstance(v, tuple): n.inputs[sock].default_value = v
            else: L.new(v, n.inputs[sock])
        return n.outputs[2]
    def smooth(a, b, v):
        m = node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP'); m.inputs[1].default_value = a; m.inputs[2].default_value = b
        L.new(v, m.inputs[0]); return m.outputs[0]
    def attr(name):
        n = node('ShaderNodeAttribute', attribute_name=name); return n.outputs['Fac']
    geo = node('ShaderNodeNewGeometry')
    pos = geo.outputs['Position']
    sep = node('ShaderNodeSeparateXYZ'); L.new(pos, sep.inputs[0])
    z = sep.outputs['Z']
    # Fields: Voronoi cells on a warped, turned grid, coloured from the palette.
    warp = node('ShaderNodeTexNoise'); warp.inputs['Scale'].default_value = 0.0025; L.new(pos, warp.inputs['Vector'])
    wv = node('ShaderNodeVectorMath', operation='MULTIPLY_ADD'); wv.inputs[1].default_value = (90, 90, 0)
    L.new(warp.outputs['Color'], wv.inputs[0]); L.new(pos, wv.inputs[2])
    st = node('ShaderNodeMapping'); st.inputs['Rotation'].default_value = (0, 0, 0.6); st.inputs['Scale'].default_value = (1 / 230, 1 / 150, 1)
    L.new(wv.outputs[0], st.inputs['Vector'])
    vor = node('ShaderNodeTexVoronoi'); vor.inputs['Randomness'].default_value = 0.85; vor.inputs['Scale'].default_value = 1.0; vor.voronoi_dimensions = '2D'; L.new(st.outputs[0], vor.inputs['Vector'])
    ramp = node('ShaderNodeValToRGB'); ramp.color_ramp.interpolation = 'CONSTANT'
    cols = [PAL[k] for k in fields]
    els = ramp.color_ramp.elements
    while len(els) < len(cols): els.new(0)
    for i, c in enumerate(cols): els[i].position = i / len(cols); els[i].color = (*c, 1)
    sepc = node('ShaderNodeSeparateColor'); L.new(vor.outputs['Color'], sepc.inputs[0])
    L.new(sepc.outputs[0], ramp.inputs[0])
    fine = node('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = 0.02; fine.inputs['Detail'].default_value = 6; L.new(pos, fine.inputs['Vector'])
    vary = math_('MULTIPLY_ADD', fine.outputs['Fac'], 0.35); N[vary.node.name].inputs[2].default_value = 0.78
    c = node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); c.inputs[0].default_value = 1
    L.new(ramp.outputs['Color'], c.inputs[6]); L.new(vary, c.inputs[7]); col = c.outputs[2]
    # Woods.
    wood_c = PAL['chestnut' if reg == 'serchio' else 'wood']
    wn = node('ShaderNodeTexNoise'); wn.inputs['Scale'].default_value = 0.05; L.new(pos, wn.inputs['Vector'])
    wc = node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); wc.inputs[0].default_value = 1; wc.inputs[6].default_value = (*(wood_c * 1.35), 1)
    L.new(wn.outputs['Fac'], wc.inputs[7])
    col = mixc(smooth(wood_level + 0.3, wood_level + 0.4, attr('wood')), col, wc.outputs[2])
    # Rock on the steep heights, snow over the snow line, marble in the Apuan quarries, beach by the sea.
    slope_ = attr('slope')
    col = mixc(math_('MULTIPLY', smooth(0.7, 0.9, slope_), smooth(250, 400, z)), col, tuple([*(PAL['rock'] * 0.9), 1]))
    sn = node('ShaderNodeTexNoise'); sn.inputs['Scale'].default_value = 0.0015; L.new(pos, sn.inputs['Vector'])
    snowz = math_('MULTIPLY_ADD', sn.outputs['Fac'], 500); N[snowz.node.name].inputs[2].default_value = z_snow_offset
    col = mixc(smooth(-150, 50, math_('SUBTRACT', z, snowz)), col, tuple([*PAL['snow'], 1]))
    if reg == 'serchio':
        q = node('ShaderNodeTexNoise'); q.inputs['Scale'].default_value = 0.002; L.new(pos, q.inputs['Vector'])
        col = mixc(math_('MULTIPLY', math_('MULTIPLY', smooth(0.55, 0.7, slope_), smooth(650, 800, z)), smooth(0.55, 0.62, q.outputs['Fac'])), col, tuple([*PAL['marble'], 1]))
    if M['sea']:
        beach = math_('MULTIPLY', smooth(-31, -27, z), math_('SUBTRACT', 1.0, smooth(-22, -18, z)))
        col = mixc(beach, col, tuple([*PAL['sand'], 1]))
    return col


z_snow_offset = 1850.0
LAND = land_material('land', ground=True)
verts = np.stack([X, Y, H], -1).reshape(-1, 3)
idx = np.arange(NR * NA).reshape(NR, NA)
a, b = idx[:-1], np.roll(idx[:-1], -1, axis=1)
c, d = np.roll(idx[1:], -1, axis=1), idx[1:]
faces = np.stack([a, d, c, b], -1).reshape(-1, 4)
make_mesh('land', verts, faces, None, LAND, {'wood': WM, 'slope': slope})
if M['sea']:
    bpy.ops.mesh.primitive_circle_add(vertices=256, radius=R1 * 1.2, fill_type='NGON', location=(0, 0, -25.0))
    bpy.context.object.data.materials.append(land_material('sea', water=True))
print('ground built', flush=True)


# ---- what stands on it ----
class Batch:
    def __init__(self): self.v, self.f, self.c = [], [], []

    def add(self, vs, fs, color):
        n = len(self.v)
        self.v += vs
        self.f += [[n + i for i in f] for f in fs]
        self.c += [color] * len(vs)


def spindle(bt, x, y, z, h, r, color, sides=6):
    """A cypress or poplar: a pointed column."""
    ring = [(x + r * math.cos(2 * math.pi * k / sides), y + r * math.sin(2 * math.pi * k / sides), z + h * 0.28) for k in range(sides)]
    vs = [(x, y, z)] + ring + [(x, y, z + h)]
    fs = [[0, 1 + (k + 1) % sides, 1 + k] for k in range(sides)] + [[1 + k, 1 + (k + 1) % sides, sides + 1] for k in range(sides)]
    bt.add(vs, fs, color)


def blob(bt, x, y, z, r, color, flat=0.8):
    """A broadleaf crown (or an umbrella pine's): a squat octahedron with a girdle."""
    s = 6
    ring = [(x + r * math.cos(2 * math.pi * k / s), y + r * math.sin(2 * math.pi * k / s), z + r * flat) for k in range(s)]
    vs = [(x, y, z + 0.2 * r)] + ring + [(x, y, z + r * flat * 1.9)]
    fs = [[0, 1 + (k + 1) % s, 1 + k] for k in range(s)] + [[1 + k, 1 + (k + 1) % s, s + 1] for k in range(s)]
    bt.add(vs, fs, color)


def house(bt_wall, bt_roof, x, y, z, w, d, h, rot, wall):
    c, s = math.cos(rot), math.sin(rot)
    P = lambda u, v, zz: (x + u * c - v * s, y + u * s + v * c, zz)
    b = [P(-w / 2, -d / 2, z - 3), P(w / 2, -d / 2, z - 3), P(w / 2, d / 2, z - 3), P(-w / 2, d / 2, z - 3)]
    t = [(p[0], p[1], z + h) for p in b]
    bt_wall.add(b + t, [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], wall)
    ridge = [P(-w / 2 - 0.3, 0, z + h + d * 0.35), P(w / 2 + 0.3, 0, z + h + d * 0.35)]
    e = [P(-w / 2 - 0.3, -d / 2 - 0.4, z + h - 0.1), P(w / 2 + 0.3, -d / 2 - 0.4, z + h - 0.1), P(w / 2 + 0.3, d / 2 + 0.4, z + h - 0.1), P(-w / 2 - 0.3, d / 2 + 0.4, z + h - 0.1)]
    bt_roof.add(e + ridge, [[0, 1, 5, 4], [2, 3, 4, 5], [0, 4, 3], [1, 2, 5]], hexc(0xa4583a) * (0.85 + 0.3 * rng.random()))


trees, walls, roofs = Batch(), Batch(), Batch()
WALLS = [0xd8c7a3, 0xcdb48a, 0xe0d4bb, 0xc9a77a, 0xb9a58a]


def ground_at(x, y): return height(x, y)


def on_land(x, y): return sea_mask(x, y, math.hypot(x, y)) < 0.05


def scatter(n, rmin, rmax, accept, place):
    tries = 0
    while n > 0 and tries < n * 30:
        tries += 1
        r = math.sqrt(rng.uniform(rmin ** 2, rmax ** 2)) if rng.random() < 0.5 else rng.uniform(rmin, rmax)   # (more near)
        a = rng.uniform(0, 2 * math.pi)
        x, y = r * math.sin(a), r * math.cos(a)
        if not on_land(x, y) or not accept(x, y): continue
        place(x, y, ground_at(x, y))
        n -= 1


def wood_at(x, y):
    i = int(np.clip(np.searchsorted(radii, math.hypot(x, y)), 0, NR - 1))
    j = int(bearing(x, y) / 360 * NA) % NA
    return woods[i, j]


# Woods: crowns over the dark patches. Fields: cypress lines along the lanes, poplar rows, olives.
n_wood = {'serchio': 60000, 'umbria': 42000, 'tuscany': 30000, 'liguria': 30000, 'coast': 22000}.get(reg, 16000)
scatter(n_wood, R0, 7000, wood_at, lambda x, y, z: blob(trees, x, y, z, rng.uniform(4, 7), hexc(0x34402a if reg != 'serchio' else 0x3a4428) * rng.uniform(0.8, 1.2)))
if reg in ('tuscany', 'umbria', 'coast', 'liguria'):
    for _ in range({'tuscany': 900, 'umbria': 600}.get(reg, 300)):          # cypress avenues
        r, a = rng.uniform(R0 + 200, 6000), rng.uniform(0, 2 * math.pi)
        x, y = r * math.sin(a), r * math.cos(a)
        if not on_land(x, y) or wood_at(x, y): continue
        da = rng.uniform(0, 2 * math.pi)
        for k in range(rng.randint(4, 14)):
            px, py = x + math.cos(da) * k * 9, y + math.sin(da) * k * 9
            spindle(trees, px, py, ground_at(px, py), rng.uniform(13, 19), rng.uniform(1.3, 1.8), hexc(0x2f3c26) * rng.uniform(0.85, 1.1))
if reg in ('po', 'lombardy', 'railway'):
    for _ in range(1400):                                                    # poplar rows along the field edges
        r, a = rng.uniform(R0 + 100, 7000), rng.uniform(0, 2 * math.pi)
        x, y = r * math.sin(a), r * math.cos(a)
        if ground_at(x, y) > 40: continue
        da = rng.choice([0, math.pi / 2]) + rng.uniform(-0.2, 0.2)
        for k in range(rng.randint(6, 22)):
            px, py = x + math.cos(da) * k * 7, y + math.sin(da) * k * 7
            spindle(trees, px, py, ground_at(px, py), rng.uniform(18, 26), rng.uniform(1.8, 2.4), PAL['poplar'] * rng.uniform(0.8, 1.15))
if reg in ('tuscany', 'umbria', 'liguria', 'coast'):
    scatter(14000, R0, 5000, lambda x, y: not wood_at(x, y) and fr(x, y, 500, 2) > 0.15,     # olive groves
            lambda x, y, z: blob(trees, x, y, z, rng.uniform(2.2, 3.2), PAL['olive'] * rng.uniform(0.75, 1.0), flat=0.7))
if reg in ('coast', 'liguria'):
    scatter(2500, R0, 5000, lambda x, y: True, lambda x, y, z: blob(trees, x, y, z + 9, rng.uniform(5, 7), hexc(0x3c4a2c), flat=0.35))   # umbrella pines

# Villages on the hilltops (a church tower among them) and farmhouses in the fields.
peaks = []
for _ in range(4000):
    r, a = rng.uniform(R0 + 400, 8000), rng.uniform(0, 2 * math.pi)
    x, y = r * math.sin(a), r * math.cos(a)
    if not on_land(x, y): continue
    z = ground_at(x, y)
    if all(z >= ground_at(x + 120 * math.cos(t), y + 120 * math.sin(t)) for t in (0, 1.6, 3.1, 4.7)) and all(math.hypot(x - p[0], y - p[1]) > 1500 for p in peaks):
        peaks.append((x, y, z))
n_villages = {'po': 6, 'lombardy': 6, 'serchio': 7}.get(reg, 10)
for x, y, z in peaks[:n_villages]:
    rot = rng.uniform(0, math.pi)
    for k in range(rng.randint(18, 45)):
        px, py = x + rng.gauss(0, 55), y + rng.gauss(0, 55)
        house(walls, roofs, px, py, ground_at(px, py), rng.uniform(7, 13), rng.uniform(6, 9), rng.uniform(6, 11), rot + rng.choice([0, math.pi / 2]) + rng.uniform(-0.1, 0.1), hexc(rng.choice(WALLS)))
    house(walls, roofs, x, y, z, 4.5, 4.5, rng.uniform(22, 30), rot, hexc(0xc8b796))
scatter({'po': 220, 'lombardy': 200}.get(reg, 160), R0 + 100, 6500, lambda x, y: not wood_at(x, y),
        lambda x, y, z: (house(walls, roofs, x, y, z, rng.uniform(9, 16), rng.uniform(7, 10), rng.uniform(6, 9), rng.uniform(0, math.pi), hexc(rng.choice(WALLS))),
                         [spindle(trees, x + 12 + 6 * k, y + 8, z, 15, 1.5, hexc(0x2f3c26)) for k in range(rng.randint(0, 3)) if reg not in ('po', 'lombardy')]))

PLAIN = land_material('things')
for name, bt in (('trees', trees), ('walls', walls), ('roofs', roofs)):
    if bt.v: make_mesh(name, bt.v, bt.f, bt.c, PLAIN)
print('things placed', len(trees.v), len(walls.v), flush=True)

# ---- light, camera, render ----
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (*(FOG * K / max(lum(FOG * K), 1e-3) * AMBIENT / K), 1); bg.inputs['Strength'].default_value = 1.0
zen, az = math.radians(M['zenith']), math.radians(M['azimuth'])
g = Vector((math.sin(zen) * math.sin(az), math.cos(zen), math.sin(zen) * math.cos(az)))   # toward the sun, in the game's axes
d = Vector((g.x, -g.z, g.y))                                                                    # the same in Blender's
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = SUN_E / K; sun.data.color = hexc(M['sun']); sun.data.angle = math.radians(1.5)
sun.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
sc.collection.objects.link(sun)

cd = bpy.data.cameras.new('cam'); cd.type = 'PANO'; cd.panorama_type = 'EQUIRECTANGULAR'
cd.latitude_min, cd.latitude_max = math.radians(LAT_MIN), math.radians(LAT_MAX)
cd.clip_end = 60000
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (0, 0, 0); cam.rotation_euler = (math.radians(90), 0, 0)    # the strip's centre looks north

sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    sc.cycles.device = 'GPU'
except Exception as e: print('cpu render', e)
sc.cycles.samples = 48
sc.cycles.use_denoising = True
sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'
sc.render.resolution_x = WIDTH
sc.render.resolution_y = round(WIDTH * (LAT_MAX - LAT_MIN) / 360)
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
sc.render.filepath = os.path.join(OUT, f'horizon_{MISSION}.png')
bpy.ops.render.render(write_still=True)
print('rendered', sc.render.filepath, 'K', K, 'sun', round(SUN_E, 2), flush=True)
# The game needs K: horizon.js multiplies the strip by it (public/textures/horizons.json).
jp = os.environ.get('HORIZON_JSON') or os.path.join(OUT, 'horizons.json')
d = __import__('json').load(open(jp)) if os.path.exists(jp) else {}
d[MISSION] = round(K, 4)
open(jp, 'w').write(__import__('json').dumps(d, indent=1, sort_keys=True) + '\n')
