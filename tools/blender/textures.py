# Renders the vegetation textures from modelled detail (run: blender -b -P tools/blender/textures.py -- <out dir>).
#   fir_spray / beech_spray / olive_spray: two branch sprays per texture (top and bottom half),
#     each a twig with its needles or leaves, seen from above: colour (with alpha) and normals
#   bark_fir / bark_beech / bark_olive: seamless bark, colour and normals
import bpy, math, os, random, sys
from mathutils import Vector
sys.path.append(os.path.dirname(__file__))
from common import (reset, srgb, mix, Mesh, albedo_material, normal_material, vertex_color, ortho_camera,
                    render, bleed, _nodes)

OUT = sys.argv[-1]
os.makedirs(OUT, exist_ok=True)


def rot(v, a):
    c, s = math.cos(a), math.sin(a)
    return Vector((v.x * c - v.y * s, v.x * s + v.y * c, v.z))


class Cell:
    """A spray's place in the texture: x 0…1, y between lo and hi."""
    def __init__(self, lo, hi): self.lo, self.hi = lo, hi
    def inside(self, p, margin=0.004): return margin < p.x < 1 - margin and self.lo + margin < p.y < self.hi - margin


def stem(m, start, ang, length, w0, w1, color, rng, bend=0.6, steps=None, z=0.0, cell=None):
    """A twig: a tapering strip along a gently curving line. Returns its points and directions."""
    steps = steps or max(4, int(length / 0.012))
    pts, dirs = [], []
    p, a = Vector(start), ang
    curve = (rng.random() - 0.5) * bend
    for i in range(steps + 1):
        pts.append(p.copy()); d = Vector((math.cos(a), math.sin(a), 0)); dirs.append(d)
        p = p + d * (length / steps); a += curve / steps
    for i in range(steps):
        if cell and not (cell.inside(pts[i]) and cell.inside(pts[i + 1])): break
        t0, t1 = i / steps, (i + 1) / steps
        wa, wb = w0 + (w1 - w0) * t0, w0 + (w1 - w0) * t1
        n0 = Vector((-dirs[i].y, dirs[i].x, 0)); n1 = Vector((-dirs[i + 1].y, dirs[i + 1].x, 0))
        zz = Vector((0, 0, z))
        m.poly([pts[i] - n0 * wa / 2 + zz, pts[i + 1] - n1 * wb / 2 + zz, pts[i + 1] + n1 * wb / 2 + zz, pts[i] + n0 * wa / 2 + zz], color)
    return pts, dirs


# ---- silver fir: flat sprays, needles combed out to both sides ----

def needle(m, p, d, length, width, color, z):
    n = Vector((-d.y, d.x, 0))
    tip = p + d * length
    m.poly([p - n * width / 2 + Vector((0, 0, z)), tip - n * width * 0.18 + Vector((0, 0, z + 0.001)),
            tip + n * width * 0.18 + Vector((0, 0, z + 0.001)), p + n * width / 2 + Vector((0, 0, z))], color)


def fir_shoot(m, cell, start, ang, length, rng, depth, w0):
    dark, mid, young, twig = srgb(0x22391d), srgb(0x34512a), srgb(0x6d8f3c), srgb(0x6a5236)
    pts, dirs = stem(m, start, ang, length, w0, w0 * 0.4, twig, rng, z=0.004, cell=cell)
    # Needles every ~2.6 mm on both sides, nearly at right angles, shorter toward the tip.
    n = len(pts)
    steps = int(length / 0.0026)
    for k in range(steps):
        t = k / steps
        i = min(n - 1, int(t * (n - 1)))
        p = pts[i] + (pts[min(n - 1, i + 1)] - pts[i]) * ((t * (n - 1)) % 1)
        d = dirs[i]
        tipness = max(0, (t - 0.82) / 0.18)
        for side in (-1, 1):
            a = side * math.radians(72 + rng.uniform(-14, 10))
            l = (0.03 - 0.009 * t) * rng.uniform(0.8, 1.15)
            c = mix(mix(dark, mid, rng.random()), young, tipness * rng.uniform(0.5, 1))
            q = p + rot(d, a) * l
            if not cell.inside(q): continue
            needle(m, p, rot(d, a), l, 0.0026, c, rng.uniform(0.0, 0.004))
        # A few needles lying over the top of the shoot.
        if rng.random() < 0.35:
            a = rng.uniform(-0.5, 0.5); l = 0.016
            q = p + rot(d, a) * l
            if cell.inside(q): needle(m, p, rot(d, a), l, 0.002, mix(dark, mid, rng.random()), 0.006)
    # Side shoots, alternating, angled forward, shorter toward the tip.
    if depth > 0:
        t, side = 0.1 + rng.random() * 0.05, 1
        while t < 0.88:
            i = int(t * (n - 1))
            sl = length * (0.4 if depth == 2 else 0.55) * (1 - t) ** 0.6 * rng.uniform(0.8, 1.1)
            if sl > 0.035:
                fir_shoot(m, cell, pts[i], math.atan2(dirs[i].y, dirs[i].x) + side * math.radians(rng.uniform(48, 62)), sl, rng, depth - 1, w0 * 0.55)
            side = -side
            t += rng.uniform(0.045, 0.065) if depth == 2 else rng.uniform(0.08, 0.12)


def fir_spray():
    m = Mesh()
    for k, (lo, hi) in enumerate(((0.0, 0.5), (0.5, 1.0))):
        rng = random.Random(11 + k)
        fir_shoot(m, Cell(lo, hi), (0.02, (lo + hi) / 2, 0), rng.uniform(-0.05, 0.05), 0.95, rng, 2, 0.006)
    return m


# ---- leaves (beech, olive) ----

def leaf(m, base, d, length, width, color, rng, fold=0.25, tilt=0.0, shape='ovate', steps=7, z=0.0):
    """A leaf: two halves folded a little along the midrib, each a fan of strips."""
    n = Vector((-d.y, d.x, 0))
    def outline(s):
        if shape == 'ovate': return math.sin(math.pi * min(1, s * 1.08)) ** 0.75 * (1 - 0.25 * s)
        return math.sin(math.pi * s) ** 1.2   # lanceolate
    rib = srgb(0x9aa860) if shape == 'ovate' else color
    for side in (-1, 1):
        lift = math.sin(fold) * width * 0.5
        for i in range(steps):
            s0, s1 = i / steps, (i + 1) / steps
            a0 = base + d * (length * s0); a1 = base + d * (length * s1)
            e0 = a0 + n * side * width * 0.5 * outline(s0); e1 = a1 + n * side * width * 0.5 * outline(s1)
            zt = lambda t: Vector((0, 0, z + side * tilt * width * 0.5 * t + lift * t))
            c = mix(color, [x * 0.82 for x in color], 0.5 + 0.5 * side * 0.3)
            m.poly([a0 + Vector((0, 0, z)), a1 + Vector((0, 0, z)), e1 + zt(outline(s1)), e0 + zt(outline(s0))], c)
        # The midrib, a hair above the blade.
    m.poly([base - n * 0.0012 + Vector((0, 0, z + 0.0015)), base + d * length * 0.92 - n * 0.0006 + Vector((0, 0, z + 0.0015)),
            base + d * length * 0.92 + n * 0.0006 + Vector((0, 0, z + 0.0015)), base + n * 0.0012 + Vector((0, 0, z + 0.0015))], rib)


def beech_twig(m, cell, start, ang, length, rng, depth):
    twig = srgb(0x5b4a3a)
    greens = [srgb(0x3d6626), srgb(0x4e7a2e), srgb(0x5f8a35), srgb(0x6f9a3c)]
    pts, dirs = stem(m, start, ang, length, 0.004 if depth else 0.0025, 0.0012, twig, rng, bend=0.5, z=0.0, cell=cell)
    n = len(pts)
    t, side = 0.08, 1
    while t < 0.98:
        i = int(t * (n - 1))
        p, d = pts[i], dirs[i]
        la = math.atan2(d.y, d.x) + side * math.radians(rng.uniform(35, 60))
        L = rng.uniform(0.055, 0.085) * (0.75 if t > 0.8 else 1)
        dd = Vector((math.cos(la), math.sin(la), 0))
        base = p + dd * 0.008
        if cell.inside(base + dd * L) and cell.inside(base + rot(dd, 1.2) * L * 0.4) and cell.inside(base + rot(dd, -1.2) * L * 0.4):
            c = rng.choice(greens)
            leaf(m, base, dd, L, L * 0.62, c, rng, fold=rng.uniform(0.15, 0.4), tilt=rng.uniform(-0.5, 0.5), z=rng.uniform(0.002, 0.012))
        if depth and rng.random() < 0.45 and t < 0.7:
            beech_twig(m, cell, p, math.atan2(d.y, d.x) + side * math.radians(rng.uniform(40, 55)), length * rng.uniform(0.3, 0.45) * (1 - t), rng, depth - 1)
        side = -side
        t += rng.uniform(0.045, 0.07)
    return pts


def beech_spray():
    m = Mesh()
    for k, (lo, hi) in enumerate(((0.0, 0.5), (0.5, 1.0))):
        rng = random.Random(21 + k)
        beech_twig(m, Cell(lo, hi), (0.02, (lo + hi) / 2, 0), rng.uniform(-0.06, 0.06), 0.95, rng, 2)
    return m


def olive_twig(m, cell, start, ang, length, rng, depth):
    twig = srgb(0x6b6150)
    top, under = [srgb(0x4b573a), srgb(0x56603f), srgb(0x5f6a46)], [srgb(0x9aa08a), srgb(0xaab09a)]
    fruit = [srgb(0x2e2230), srgb(0x3c2c3a), srgb(0x5d6a2c)]
    pts, dirs = stem(m, start, ang, length, 0.004 if depth else 0.0022, 0.001, twig, rng, bend=0.8, cell=cell)
    n = len(pts)
    t = 0.06
    while t < 0.97:
        i = int(t * (n - 1))
        p, d = pts[i], dirs[i]
        for side in (-1, 1):   # opposite pairs
            la = math.atan2(d.y, d.x) + side * math.radians(rng.uniform(25, 45))
            L = rng.uniform(0.05, 0.07)
            dd = Vector((math.cos(la), math.sin(la), 0))
            if cell.inside(p + dd * L):
                c = rng.choice(under) if rng.random() < 0.3 else rng.choice(top)
                leaf(m, p + dd * 0.003, dd, L, L * 0.2, c, rng, fold=0.2, tilt=rng.uniform(-0.6, 0.6), shape='lance', steps=6, z=rng.uniform(0.002, 0.01))
        if rng.random() < 0.06:   # an olive
            o = p + Vector((rng.uniform(-0.01, 0.01), rng.uniform(-0.01, 0.01), 0.014))
            c = rng.choice(fruit)
            ring = [o + Vector((math.cos(a) * 0.007, math.sin(a) * 0.0095, 0)) for a in [j / 10 * math.tau for j in range(10)]]
            if all(cell.inside(q) for q in ring): m.poly(ring, c)
        if depth and rng.random() < 0.35 and t < 0.75:
            olive_twig(m, cell, p, math.atan2(d.y, d.x) + rng.choice((-1, 1)) * math.radians(rng.uniform(30, 50)), length * rng.uniform(0.35, 0.5) * (1 - t), rng, depth - 1)
        t += rng.uniform(0.04, 0.06)


def olive_spray():
    m = Mesh()
    for k, (lo, hi) in enumerate(((0.0, 0.5), (0.5, 1.0))):
        rng = random.Random(31 + k)
        olive_twig(m, Cell(lo, hi), (0.02, (lo + hi) / 2, 0), rng.uniform(-0.06, 0.06), 0.95, rng, 2)
    return m


def render_spray(name, mesh):
    alb = albedo_material(name + '_alb', vertex_color, ao=0.55, ao_dist=0.02)
    nrm = normal_material(name + '_nrm')
    mesh.obj(name, alb)
    ortho_camera((0.5, 0.5, 0), 1.0, 'top', (1024, 1024))
    c = render(os.path.join(OUT, f'{name}.png'))
    nm = render(os.path.join(OUT, f'{name}_n.png'), override=nrm, raw=True)
    bleed(c); bleed(nm)


# ---- bark: seamless (periodic noise in both directions) ----

def periodic(nt, su, sv):
    """A 4D point that goes round once as u and v go 0→1: noise on it tiles both ways."""
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['UV'], sep.inputs[0])
    def trig(src, op, r):
        a = nt.nodes.new('ShaderNodeMath'); a.operation = 'MULTIPLY'; a.inputs[1].default_value = math.tau
        nt.links.new(src, a.inputs[0])
        b = nt.nodes.new('ShaderNodeMath'); b.operation = op; nt.links.new(a.outputs[0], b.inputs[0])
        c = nt.nodes.new('ShaderNodeMath'); c.operation = 'MULTIPLY'; c.inputs[1].default_value = r
        nt.links.new(b.outputs[0], c.inputs[0])
        return c.outputs[0]
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(trig(sep.outputs['X'], 'COSINE', su), comb.inputs['X'])
    nt.links.new(trig(sep.outputs['X'], 'SINE', su), comb.inputs['Y'])
    nt.links.new(trig(sep.outputs['Y'], 'COSINE', sv), comb.inputs['Z'])
    return comb.outputs[0], trig(sep.outputs['Y'], 'SINE', sv)


BARK = {
    # su (round the trunk), sv (up it): how much happens across each; plates/cracks and colours.
    'fir': dict(su=3.0, sv=0.5, cell=3.0, crack=0.05, noise=5, colors=(0x2e2b27, 0x4f4b45, 0x6a665e), depth=0.8, lichen=0x7c8466),
    'beech': dict(su=1.6, sv=0.4, cell=4.0, crack=0.006, noise=2.5, colors=(0x4f4e49, 0x75736c, 0x8e8b83), depth=0.2, lichen=0x7f8a6a),
    'olive': dict(su=4.5, sv=0.45, cell=2.2, crack=0.14, noise=4, colors=(0x2a2520, 0x5a5247, 0x8b8070), depth=1.4, lichen=0x9a9a80),
}


def bark_height(nt, spec):
    vec, w = periodic(nt, spec['su'], spec['sv'])
    # Warp the plates with low noise so they wander instead of tiling like paving.
    warp = nt.nodes.new('ShaderNodeTexNoise'); warp.noise_dimensions = '4D'; warp.inputs['Scale'].default_value = 1.5
    nt.links.new(vec, warp.inputs['Vector']); nt.links.new(w, warp.inputs['W'])
    wv = nt.nodes.new('ShaderNodeVectorMath'); wv.operation = 'MULTIPLY_ADD'; wv.inputs[1].default_value = (0.6, 0.6, 0.6)
    nt.links.new(warp.outputs['Color'], wv.inputs[0]); nt.links.new(vec, wv.inputs[2])
    vor = nt.nodes.new('ShaderNodeTexVoronoi'); vor.voronoi_dimensions = '4D'; vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = spec['cell']; vor.inputs['Randomness'].default_value = 1
    nt.links.new(wv.outputs[0], vor.inputs['Vector']); nt.links.new(w, vor.inputs['W'])
    noi = nt.nodes.new('ShaderNodeTexNoise'); noi.noise_dimensions = '4D'
    noi.inputs['Scale'].default_value = spec['noise']; noi.inputs['Detail'].default_value = 8
    nt.links.new(vec, noi.inputs['Vector']); nt.links.new(w, noi.inputs['W'])
    crack = nt.nodes.new('ShaderNodeMapRange'); crack.inputs['From Max'].default_value = spec['crack']
    nt.links.new(vor.outputs['Distance'], crack.inputs['Value'])
    h = nt.nodes.new('ShaderNodeMath'); h.operation = 'MULTIPLY_ADD'
    nt.links.new(noi.outputs['Fac'], h.inputs[0]); h.inputs[1].default_value = 0.6
    nt.links.new(crack.outputs['Result'], h.inputs[2])
    return h.outputs[0]


def render_bark(kind):
    spec = BARK[kind]
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0.5, 0.5, 0))
    plane = bpy.context.object

    def color(nt):
        h = bark_height(nt, spec)
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        lo, mid, hi = (srgb(c) for c in spec['colors'])
        ramp.color_ramp.elements[0].position = 0.25; ramp.color_ramp.elements[0].color = (*lo, 1)
        ramp.color_ramp.elements[1].position = 1.2; ramp.color_ramp.elements[1].color = (*hi, 1)
        e = ramp.color_ramp.elements.new(0.6); e.color = (*mid, 1)
        nt.links.new(h, ramp.inputs['Fac'])
        # Patches of lichen: pale, greyish green, in blotches.
        vec, w = periodic(nt, spec['su'] * 0.5, spec['sv'] * 0.8)
        lic = nt.nodes.new('ShaderNodeTexNoise'); lic.noise_dimensions = '4D'; lic.inputs['Scale'].default_value = 2.2; lic.inputs['Detail'].default_value = 6
        nt.links.new(vec, lic.inputs['Vector']); nt.links.new(w, lic.inputs['W'])
        k = nt.nodes.new('ShaderNodeMapRange'); k.inputs['From Min'].default_value = 0.58; k.inputs['From Max'].default_value = 0.68
        k.inputs['To Max'].default_value = 0.7
        nt.links.new(lic.outputs['Fac'], k.inputs['Value'])
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
        nt.links.new(k.outputs['Result'], mx.inputs['Factor']); nt.links.new(ramp.outputs['Color'], mx.inputs['A'])
        mx.inputs['B'].default_value = (*srgb(spec['lichen']), 1)
        return mx.outputs['Result']

    def normal(nt):
        h = bark_height(nt, spec)
        bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 1
        bump.inputs['Distance'].default_value = 0.004 * spec['depth']
        nt.links.new(h, bump.inputs['Height'])
        return bump.outputs['Normal']

    plane.data.materials.append(albedo_material('bark_' + kind, color, ao=0))
    ortho_camera((0.5, 0.5, 0), 1.0, 'top', (1024, 1024))
    render(os.path.join(OUT, f'bark_{kind}.png'))
    render(os.path.join(OUT, f'bark_{kind}_n.png'), override=normal_material('barkn_' + kind, normal), raw=True)


if __name__ == '__main__':
    only = os.environ.get('ONLY', '').split(',') if os.environ.get('ONLY') else None
    for name, fn in (('fir_spray', fir_spray), ('beech_spray', beech_spray), ('olive_spray', olive_spray)):
        if only and name not in only: continue
        reset(); render_spray(name, fn())
    for kind in BARK:
        if only and f'bark_{kind}' not in only: continue
        reset(); render_bark(kind)
    print('TEXTURES DONE')
