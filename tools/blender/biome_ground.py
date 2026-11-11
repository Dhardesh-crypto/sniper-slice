# Ground plants for the biomes beyond forest and maquis: heath, marsh, dune, limestone, farmland.
#   blender -b -P tools/blender/biome_ground.py -- <texture dir> <out dir (public/models)>
# Renders one foliage atlas from modelled detail (biome_atlas.png and its normals, 1024 square):
#   top strip: a reed stem with its leaves and plume; middle row: a gorse spray, a hedge spray;
#   bottom row: a heather sprig, a juniper spray, a fan of marram blades
# then builds ground_biome.glb, one mesh per kind, each standing at the origin with its foot at z=0:
#   gorse, heather, reed, marram, juniper, hedge (a 4 m section along x), scree (plain grey stones).
# It needs nothing rendered beforehand and leaves ground_detail.glb alone (ground.py builds that).
#   PREVIEW=1 blender -b -P … : also renders <texture dir>/biome_preview.png, all seven lit in two rows.
# Units are the game's metres; z is up here (the export turns it to y).
import bpy, bmesh, math, os, random, sys
import numpy as np
from mathutils import Vector, Matrix
sys.path.append(os.path.dirname(__file__))
from common import reset, srgb, mix, Mesh, albedo_material, normal_material, vertex_color, ortho_camera, render, bleed, export_glb, _nodes
from textures import Cell, stem, leaf, needle, rot
from trees import materials, facing
from ground import AtlasCards

TEX, OUT = sys.argv[-2], sys.argv[-1]
os.makedirs(TEX, exist_ok=True)


# ---- the atlas: each plant's detail drawn flat, growing along +x from the left edge of its cell ----

class Rect(Cell):
    """A plant's rectangle in the atlas. `uv` is the same rectangle as AtlasCards takes it."""
    def __init__(self, x0, x1, y0, y1):
        super().__init__(y0, y1); self.x0, self.x1 = x0, x1
        self.uv = (x0, x1, y0, y1)
    def inside(self, p, margin=0.004): return self.x0 + margin < p.x < self.x1 - margin and self.lo + margin < p.y < self.hi - margin
    def root(self, dy=0.0): return Vector((self.x0 + 0.012, (self.lo + self.hi) / 2 + dy, 0))


CELLS = {
    'reed': Rect(0.0, 1.0, 0.78, 1.0),          # (a reed is five times as tall as it is wide: a strip)
    'gorse': Rect(0.0, 0.5, 0.39, 0.78),
    'hedge': Rect(0.5, 1.0, 0.39, 0.78),
    'heather': Rect(0.0, 0.33, 0.0, 0.39),
    'juniper': Rect(0.33, 0.67, 0.0, 0.39),
    'marram': Rect(0.67, 1.0, 0.0, 0.39),
}


def dot(m, cell, c, r, color, z, squash=1.0, n=7):
    """A small round thing seen from above (a flower, a berry)."""
    ring = [c + Vector((math.cos(j / n * math.tau) * r, math.sin(j / n * math.tau) * r * squash, z)) for j in range(n)]
    if all(cell.inside(q) for q in ring): m.poly(ring, color)


def spiny(m, cell, start, ang, length, rng, depth, P):
    """A shoot bristling with short stiff needles all round, forking into more of the same: gorse
    (every leaf a spine) and juniper (needles in threes) are both this, with different numbers.
    P — gap: how far apart the needles sit; round: how many at each place; spread: how far they
    stand off the shoot, degrees; len, wide: a needle; cols: dark, mid and tip colour; dots:
    (chance per place, colours, radius) of flowers or berries, more of them toward the tip."""
    pts, dirs = stem(m, start, ang, length, P['wood'] * (0.5 + 0.25 * depth), 0.0012, P['twig'], rng, bend=0.6, z=0.002, cell=cell)
    n = len(pts); k = max(2, int(length / P['gap']))
    for j in range(k):
        t = j / k; i = min(n - 1, int(t * (n - 1))); p, d = pts[i], dirs[i]
        for s in range(P['round']):
            dd = rot(d, rng.uniform(-1, 1) * math.radians(P['spread']))
            l = P['len'] * rng.uniform(0.6, 1.1)
            c = mix(mix(P['cols'][0], P['cols'][1], rng.random()), P['cols'][2], max(0, t - 0.6) * 2.5 * rng.random())
            if cell.inside(p + dd * l): needle(m, p, dd, l, P['wide'], c, rng.uniform(0.003, 0.008))
        chance, cols, r = P['dots']
        if rng.random() < chance * (0.3 + t):
            dot(m, cell, p + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * P['len'] * 0.6, r * rng.uniform(0.8, 1.2), rng.choice(cols), 0.012, squash=rng.uniform(0.7, 1.0))
    if depth > 0:
        t, side = 0.08 + rng.random() * 0.05, rng.choice((-1, 1))
        while t < 0.9:
            i = int(t * (n - 1))
            sl = length * 0.55 * (1 - t) ** 0.5 * rng.uniform(0.75, 1.1)
            if sl > 0.03: spiny(m, cell, pts[i], math.atan2(dirs[i].y, dirs[i].x) + side * math.radians(rng.uniform(30, 55)), sl, rng, depth - 1, P)
            side = -side
            t += rng.uniform(*P['fork']) * (1 if depth > 1 else 2.2)


# Gorse: dark green, every leaf a spine, and the yellow pea flowers it carries nearly all year.
GORSE = dict(gap=0.0055, round=3, spread=80, len=0.021, wide=0.003, wood=0.006, twig=srgb(0x4f5a30), fork=(0.07, 0.1),
             cols=(srgb(0x2a4220), srgb(0x45642a), srgb(0x70893a)), dots=(0.045, [srgb(0xe6bd16), srgb(0xf4d630), srgb(0xf0c820)], 0.0085))
# Juniper: finer needles, dark with the blue-grey bloom of their upper sides, and a few blue-black berries.
JUNIPER = dict(gap=0.0045, round=3, spread=68, len=0.015, wide=0.0026, wood=0.005, twig=srgb(0x5c4a3a), fork=(0.065, 0.09),
               cols=(srgb(0x22382c), srgb(0x34503f), srgb(0x5f7c6a)), dots=(0.025, [srgb(0x27304a), srgb(0x3a4460)], 0.006))


def spiny_spray(m, cell, rng, P):
    for a in (-0.5, 0.0, 0.5):   # three shoots fanning from the root: the cell is nearly square
        spiny(m, cell, cell.root(a * 0.06), a + rng.uniform(-0.08, 0.08), (cell.x1 - cell.x0) * (0.9 - 0.15 * abs(a)), rng, 2, P)


def heather_sprig(m, cell, rng):
    """Ling: a fan of thin wiry stems, scale-like dull green leaves pressed along them, and over
    the upper half of each the spike of tiny purple-pink bells that colours a whole moor."""
    greens = [srgb(0x44552f), srgb(0x56683a), srgb(0x66743f)]
    pinks = [srgb(0x9c4f8c), srgb(0xb866a6), srgb(0xcd8cc0), srgb(0xa85a7e)]
    for k in range(20):
        ang = rng.uniform(-0.8, 0.8)
        length = rng.uniform(0.2, 0.3) * (1 - 0.3 * abs(ang))
        pts, dirs = stem(m, cell.root(rng.uniform(-0.02, 0.02)), ang, length, 0.0028, 0.0012, srgb(0x5a4636), rng, bend=0.5, cell=cell)
        n = len(pts); steps = int(length / 0.005)
        for j in range(steps):
            t = j / steps; i = min(n - 1, int(t * (n - 1))); p, d = pts[i], dirs[i]
            for side in (-1, 1):
                dd = rot(d, side * math.radians(rng.uniform(28, 50)))
                if cell.inside(p + dd * 0.009): needle(m, p, dd, rng.uniform(0.006, 0.009), 0.0034, rng.choice(greens), rng.uniform(0.002, 0.006))
            if t > 0.58 and rng.random() < 0.8:      # the flower spike
                q = p + Vector((-d.y, d.x, 0)) * rng.uniform(-0.006, 0.006)
                dot(m, cell, q, rng.uniform(0.0036, 0.0052), rng.choice(pinks), 0.01, n=6)


def reed_stem(m, cell, rng):
    """Common reed: a straight cane, long flat leaves leaving it alternately at a narrow angle, and
    at the top the loose, feathery, purple-brown plume, nodding to one side."""
    cane, greens = srgb(0xa9a45e), [srgb(0x86964a), srgb(0x9aa556), srgb(0xb2ae6c), srgb(0xc2b678)]
    pts, dirs = stem(m, cell.root(), 0.0, 0.8, 0.0075, 0.0035, cane, rng, bend=0.12, z=0.006, cell=cell)
    n = len(pts); t, side = 0.1, 1
    while t < 0.84:
        i = int(t * (n - 1)); p, d = pts[i], dirs[i]
        dd = rot(d, side * math.radians(rng.uniform(13, 22)))
        L = rng.uniform(0.19, 0.25) * (1 - 0.3 * max(0, t - 0.6) / 0.24)
        if cell.inside(p + dd * L):
            leaf(m, p, dd, L, L * 0.1, rng.choice(greens), rng, fold=0.3, tilt=rng.uniform(-0.4, 0.4), shape='lance', steps=8, z=rng.uniform(0.0, 0.005))
        side = -side
        t += rng.uniform(0.055, 0.075)
    # The plume: fine branchlets sweeping forward off the last of the cane, longest low down.
    lo, hi = srgb(0x55392f), srgb(0xa08462)
    end, d = pts[-1], dirs[-1]
    stem(m, end, 0.06, 0.16, 0.0035, 0.001, srgb(0x7a6a4a), rng, bend=0.2, z=0.006, cell=cell)
    for j in range(190):
        t = rng.random() ** 0.8
        p = end + rot(d, 0.06) * (t * 0.16)
        a = rng.choice((-1, 1)) * math.radians(rng.uniform(8, 38)) * (1 - 0.5 * t) + 0.1
        l = 0.012 + 0.04 * (1 - t) * rng.uniform(0.5, 1.0)
        if cell.inside(p + rot(d, a) * l): needle(m, p, rot(d, a), l, 0.004, mix(lo, hi, rng.random()), rng.uniform(0.007, 0.012))


def marram_fan(m, cell, rng):
    """Marram: stiff, rolled, grey-green blades springing from one point and arching apart, some
    of last year's bleached to straw among them."""
    cols = [srgb(0x8f9c70), srgb(0xa3ae84), srgb(0x7f8e64), srgb(0xb4b88e), srgb(0xc8c090)]
    for k in range(30):
        ang = rng.uniform(-0.66, 0.66)
        length = rng.uniform(0.19, 0.31) * (1 - 0.25 * abs(ang))
        stem(m, cell.root(rng.uniform(-0.012, 0.012)), ang, length, 0.0062, 0.0009, rng.choice(cols), rng, bend=1.1, z=rng.uniform(0, 0.01), cell=cell)


def hedge_twig(m, cell, start, ang, length, rng, depth):
    """A field hedge is hawthorn, blackthorn, hazel and field maple cut together: small leaves in
    several greens on one tangle of twigs, close enough to hide what is behind."""
    greens = [srgb(0x35581f), srgb(0x44692a), srgb(0x567a30), srgb(0x6b8c38), srgb(0x7d963f), srgb(0x4f5f2a)]
    pts, dirs = stem(m, start, ang, length, 0.004 if depth == 2 else 0.0025, 0.001, srgb(0x4d3f33), rng, bend=0.7, cell=cell)
    n = len(pts); t, side = 0.04, 1
    while t < 0.99:
        i = int(t * (n - 1)); p, d = pts[i], dirs[i]
        a = math.atan2(d.y, d.x) + side * math.radians(rng.uniform(35, 72))
        dd = Vector((math.cos(a), math.sin(a), 0)); L = rng.uniform(0.032, 0.05)
        base = p + dd * 0.004
        if cell.inside(base + dd * L) and cell.inside(base + rot(dd, 1.2) * L * 0.45) and cell.inside(base + rot(dd, -1.2) * L * 0.45):
            leaf(m, base, dd, L, L * 0.7, rng.choice(greens), rng, fold=rng.uniform(0.15, 0.4), tilt=rng.uniform(-0.6, 0.6), steps=5, z=rng.uniform(0.002, 0.012))
        if depth and rng.random() < 0.42 and t < 0.82:
            hedge_twig(m, cell, p, math.atan2(d.y, d.x) + side * math.radians(rng.uniform(30, 55)), length * rng.uniform(0.35, 0.55) * (1 - t) ** 0.5, rng, depth - 1)
        side = -side
        t += rng.uniform(0.017, 0.027) / length


def biome_atlas():
    m = Mesh(); rng = random.Random(83)
    reed_stem(m, CELLS['reed'], rng)
    spiny_spray(m, CELLS['gorse'], rng, GORSE)
    spiny_spray(m, CELLS['juniper'], rng, JUNIPER)
    heather_sprig(m, CELLS['heather'], rng)
    marram_fan(m, CELLS['marram'], rng)
    for a in (-0.55, 0.0, 0.55):
        hedge_twig(m, CELLS['hedge'], CELLS['hedge'].root(a * 0.05), a + rng.uniform(-0.08, 0.08), 0.46 - 0.08 * abs(a), rng, 2)
    m.obj('atlas', albedo_material('biome_alb', vertex_color, ao=0.5, ao_dist=0.02))
    ortho_camera((0.5, 0.5, 0), 1.0, 'top', (1024, 1024))
    c = render(os.path.join(TEX, 'biome_atlas.png'))
    nm = render(os.path.join(TEX, 'biome_atlas_n.png'), override=normal_material('biome_nrm'), raw=True)
    bleed(c); bleed(nm)


# ---- the meshes ----

class Mass(AtlasCards):
    """Cards of one plant, shaded as one mass. Its normals bend out from a middle point, or, for
    a long thing like the hedge, from a middle line (`spine`: its half-length along x), so the
    hedge's sides face sideways along its whole length and only its ends turn to face along it."""
    def __init__(self, kind, center, spine=0.0):
        super().__init__(center, CELLS[kind].uv); self.spine = spine

    def put(self, mid, d, side, out, length, width, back=0.5, **kw):
        """A card whose middle (or the point `back` of the way along it) is at `mid`, front to `out`."""
        d = Vector(d).normalized()
        self.card(Vector(mid) - d * (length * back), d, facing(d, side, out), length, width, **kw)

    def obj(self, name, mat, outward=0.7):
        for v in self.m.bm.verts: v.co.z = max(v.co.z, 0.0)       # (nothing under the ground: the foot is at z=0)
        ob = self.m.obj(name, mat)
        me = ob.data
        normals = []
        for poly in me.polygons:
            for li in poly.loop_indices:
                v = me.vertices[me.loops[li].vertex_index].co
                cx = self.center.x + max(-self.spine, min(self.spine, v.x - self.center.x))
                radial = Vector((v.x - cx, v.y - self.center.y, (v.z - self.center.z) * 0.6 + 0.4)).normalized()
                n = poly.normal if poly.normal.dot(radial) >= 0 else -poly.normal
                normals.append((n * (1 - outward) + radial * outward).normalized())
        me.normals_split_custom_set(normals)
        if 'Col' in me.color_attributes: me.color_attributes.remove(me.color_attributes['Col'])
        return ob


def on_dome(rng, lo=-0.15):
    """A random direction on the upper part of a sphere (down to `lo`), and a level tangent there."""
    u, v = rng.uniform(0, math.tau), math.acos(rng.uniform(lo, 1))
    n = Vector((math.cos(u) * math.sin(v), math.sin(u) * math.sin(v), math.cos(v)))
    tang = Vector((-n.y, n.x, 0)).normalized() if n.xy.length > 0.05 else Vector((1, 0, 0))
    return n, tang


def gorse(rng, mat):
    """A gorse bush: a dense rounded mound, but a bristly one: its shoots stand out of it, so the
    cards point outward more than they lie along the dome."""
    c = Mass('gorse', (0, 0, 0.45))
    for k in range(64):
        n, tang = on_dome(rng)
        f = rng.uniform(0.5, 1.0)
        q = Vector((n.x * 0.42 * f, n.y * 0.42 * f, 0.22 + n.z * 0.62 * f))
        d = tang * rng.choice((-1, 1)) * 0.7 + n + Vector((0, 0, 0.35))
        L = rng.uniform(0.55, 0.75)
        c.put(q, d, n.cross(d), n, L, L * 0.78, back=0.35, droop=0.05, segs=1, roll=rng.uniform(-0.7, 0.7))
    return c.obj('gorse', mat, outward=0.75)


def heather(rng, mat):
    """A heather cushion: sprigs standing up all over a low mound, leaning out at its edge, so
    the flower tips make its top."""
    c = Mass('heather', (0, 0, 0.05))
    for k in range(34):
        a, r = rng.uniform(0, math.tau), 0.3 * math.sqrt(rng.random())
        out = Vector((math.cos(a), math.sin(a), 0))
        d = Vector((0, 0, 1)) + out * (r / 0.3) * rng.uniform(0.5, 1.1)
        yaw = rng.uniform(0, math.tau)
        L = rng.uniform(0.4, 0.5) * (1 - 0.25 * r / 0.3)
        c.put(out * r, d, (math.cos(yaw), math.sin(yaw), 0), out + Vector((0, 0, 0.3)), L, L * 1.0, back=0.04, droop=0.1, segs=1)
    return c.obj('heather', mat, outward=0.7)


def reed(rng, mat):
    """A clump of reed: canes standing close, the outer ones leaning out a little, each card one
    cane turned its own way."""
    c = Mass('reed', (0, 0, 1.0))
    for k in range(16):
        a, r = rng.uniform(0, math.tau), 0.2 * math.sqrt(rng.random())
        out = Vector((math.cos(a), math.sin(a), 0))
        d = Vector((0, 0, 1)) + out * rng.uniform(0.02, 0.11) + Vector((rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), 0))
        yaw = rng.uniform(0, math.tau)
        L = rng.uniform(1.7, 2.12)
        c.put(out * r, d, (math.cos(yaw), math.sin(yaw), 0), out, L, L * 0.22, back=0.0, droop=0.02, segs=2)
    return c.obj('reed', mat, outward=0.6)


def marram(rng, mat):
    """A marram tussock: fans of blades rising from one foot and arching over all round."""
    c = Mass('marram', (0, 0, 0.2))
    for k in range(18):
        a = k / 18 * math.tau + rng.uniform(-0.3, 0.3)
        out = Vector((math.cos(a), math.sin(a), 0))
        d = Vector((0, 0, 1)) + out * rng.uniform(0.1, 0.45)
        yaw = a + math.pi / 2 + rng.uniform(-0.6, 0.6)
        L = rng.uniform(0.85, 1.05)
        c.put(out * rng.uniform(0, 0.07), d, (math.cos(yaw), math.sin(yaw), 0), out, L, L * 0.7, back=0.03, droop=0.22, segs=3)
    return c.obj('marram', mat, outward=0.6)


def juniper(rng, mat):
    """Common juniper on limestone: no one shape, but several upright spires of different heights
    grown together, their sprays standing up and out like a cypress's."""
    c = Mass('juniper', (0, 0, 0.7))
    # (x, y, height, radius, cards) of each spire
    for x, y, h, r, n in ((0.0, 0.02, 1.68, 0.25, 26), (0.2, 0.08, 1.15, 0.2, 15), (-0.17, 0.13, 1.35, 0.18, 15), (-0.05, -0.2, 0.9, 0.2, 13)):
        for k in range(n):
            t = rng.random() ** 0.85
            a = rng.uniform(0, math.tau)
            out = Vector((math.cos(a), math.sin(a), 0)); tang = Vector((-out.y, out.x, 0))
            rq = r * math.sin(math.pi * min(1, t * 0.9 + 0.12)) ** 0.7 * rng.uniform(0.6, 1.0)   # (widest low down, pointed)
            q = Vector((x, y, 0.1 + t * (h - 0.35))) + out * rq
            d = Vector((0, 0, 1)) * rng.uniform(0.7, 1.0) + out * rng.uniform(0.1, 0.45) + tang * rng.uniform(-0.3, 0.3)
            L = rng.uniform(0.4, 0.55)
            c.put(q, d, tang, out, L, L * 0.95, back=0.4, droop=0.04, segs=1, roll=rng.uniform(-0.4, 0.4))
    return c.obj('juniper', mat, outward=0.75)


def hedge(rng, mat):
    """One 4 m section of a field hedge along x: leafy cards all over the skin of a rounded bank
    (sides, top and both ends), and some inside so no daylight shows through it. Cards near an end
    reach a little past it: sections set end to end knit into one hedge."""
    hx, hy, hz = 2.0, 0.37, 1.45
    c = Mass('hedge', (0, 0, 0.75), spine=hx - 0.6)
    def skin(th, f=1.0):
        # The hedge's cross-section: a squared-off arch from the foot of one side over to the other.
        y, z = math.cos(th), math.sin(th)
        return Vector((0, hy * f * math.copysign(abs(y) ** 0.5, y), hz * f * abs(z) ** 0.55)), Vector((0, y, z * 0.9 + 0.1)).normalized()
    def spray(q, n, L):
        ax = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
        t1 = n.cross(ax).normalized(); t2 = n.cross(t1)
        a = rng.uniform(0, math.tau)
        d = t1 * math.cos(a) + t2 * math.sin(a) + n * 0.3 + Vector((0, 0, 0.15))     # (leaning out and up: a hedge's shoots)
        c.put(q, d, n.cross(d), n, L, L * 0.78, back=0.5, droop=0.06, segs=1, roll=rng.uniform(-0.5, 0.5))
    for k in range(150):                          # the long skin, on a shaken grid (15 along, 10 over) so no hole is left
        u = (k % 10 + rng.random()) / 10 * 2 - 1
        th = math.pi / 2 * (1 - math.copysign(abs(u) ** 0.6, u))                 # (more of them down the sides than over the top)
        p, n = skin(min(math.pi - 0.02, max(0.02, th)))
        spray(p + Vector((((k // 10 + rng.random()) / 15 * 2 - 1) * (hx - 0.3), 0, 0)), n, rng.uniform(0.65, 0.85))
    for sx in (-1, 1):                            # the ends
        for k in range(12):
            p, n = skin(rng.uniform(0.05, math.pi - 0.05), rng.uniform(0.25, 0.9))
            spray(p + Vector((sx * (hx - 0.3), 0, 0)), (n * 0.5 + Vector((sx, 0, 0))).normalized(), rng.uniform(0.6, 0.75))
    for k in range(26):                           # the inside
        p, n = skin(rng.uniform(0.3, math.pi - 0.3), rng.uniform(0.2, 0.6))
        spray(p + Vector((rng.uniform(-1, 1) * (hx - 0.4), 0, 0)), n, rng.uniform(0.75, 0.9))
    return c.obj('hedge', mat, outward=0.8)


def scree(rng, mat):
    """A patch of scree: angular stones, the big ones toward the middle, each sunk a little into
    the ground and cut off flat there. Plain faces, no texture: the game gives rock its own shader."""
    bm = bmesh.new()
    placed = []
    for k in range(15):
        s = rng.uniform(0.1, 0.4) if k > 2 else rng.uniform(0.3, 0.4)            # (its longest side)
        for attempt in range(30):
            a, r = rng.uniform(0, math.tau), (1.0 - s * 0.5) * rng.random() ** 0.6 * (1.25 - s * 1.2)
            pos = Vector((math.cos(a) * r, math.sin(a) * r, 0))
            if all((pos - q).length > (s + t) * 0.45 for q, t in placed): break
        placed.append((pos, s))
        verts = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)['verts']
        # Angular: every corner pushed in or out on its own, then the lump squashed to a slab or a block.
        size = Vector((s / 2, s / 2 * rng.uniform(0.55, 0.9), s / 2 * rng.uniform(0.4, 0.75)))
        turn = Matrix.Rotation(rng.uniform(0, math.tau), 3, 'Z') @ Matrix.Rotation(rng.uniform(-0.35, 0.35), 3, 'X')
        for v in verts:
            p = v.co * rng.uniform(0.72, 1.12)
            v.co = turn @ Vector((p.x * size.x, p.y * size.y, p.z * size.z))
        low = min(v.co.z for v in verts); high = max(v.co.z for v in verts)
        for v in verts:
            v.co.z = max(0.0, v.co.z - low - (high - low) * 0.22)
            v.co += pos
    me = bpy.data.meshes.new('scree'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('scree', me); bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def rock_material():
    mat = bpy.data.materials.new('rock')
    nt = _nodes(mat)
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (*srgb(0x8a8882), 1); bsdf.inputs['Roughness'].default_value = 0.95
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat


KINDS = (gorse, heather, reed, marram, juniper, hedge)


def build():
    reset()
    biome_atlas()
    reset()
    fol = materials('biome', os.path.join(TEX, 'biome_atlas.png'), os.path.join(TEX, 'biome_atlas_n.png'), cutout=True, roughness=0.9)['game']
    objs = [fn(random.Random(17 + i), fol) for i, fn in enumerate(KINDS)]
    objs.append(scree(random.Random(29), rock_material()))
    for o in objs:
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        lo = [min(v.co[i] for v in o.data.vertices) for i in range(3)]; hi = [max(v.co[i] for v in o.data.vertices) for i in range(3)]
        print(f'BIOME {o.name}: {tris} triangles, {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} m across, {hi[2]:.2f} m high (foot at {lo[2]:.2f})')
    export_glb(os.path.join(OUT, 'ground_biome.glb'), objs)
    if os.environ.get('PREVIEW'): preview({o.name: o for o in objs})


def preview(objs):
    """A lit look at all seven on a neutral ground, for checking by eye: the tall kinds in one
    picture, the low ones closer up in a second, stacked into biome_preview.png."""
    sc = bpy.context.scene
    sc.cycles.samples = 48
    sc.cycles.transparent_max_bounces = 64                 # (many cut-out cards stand behind one another)
    sc.render.film_transparent = False
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.55, 0.65, 0.8, 1); bg.inputs['Strength'].default_value = 0.8
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(35)); sc.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=80)
    gm = bpy.data.materials.new('ground'); nt = _nodes(gm)
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (*srgb(0x77705f), 1); bsdf.inputs['Roughness'].default_value = 1
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    bpy.context.object.data.materials.append(gm)
    cam = bpy.data.objects.new('pcam', bpy.data.cameras.new('pcam')); sc.collection.objects.link(cam)
    cam.data.lens = 50; sc.camera = cam
    sc.view_settings.view_transform = 'AgX'
    sc.render.resolution_x, sc.render.resolution_y = 1800, 620
    paths = []
    for i, (row, gap, height) in enumerate(((('hedge', 'gorse', 'juniper', 'reed'), 0.7, 2.2), (('marram', 'heather', 'scree'), 0.5, 1.0))):
        for o in objs.values(): o.hide_render = o.name not in row
        x = 0.0
        for name in row:                                   # side by side along x, a gap between
            o = objs[name]
            w = max(v.co.x for v in o.data.vertices) - min(v.co.x for v in o.data.vertices)
            o.location.x = x + w / 2; x += w + gap
        x -= gap
        dist = x * 1.42                                    # (a 50 mm lens sees 0.72 of its distance across)
        eye = Vector((x / 2, -dist, height * 0.5 + dist * 0.16)); aim = Vector((x / 2, 0, height * 0.42))
        cam.location = eye; cam.rotation_euler = (aim - eye).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(TEX, f'biome_preview_{i}.png')
        bpy.ops.render.render(write_still=True); paths.append(sc.render.filepath)
    for o in objs.values(): o.location.x = 0; o.hide_render = False
    rows = []
    for p in paths:
        im = bpy.data.images.load(p, check_existing=False); w, h = im.size
        a = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(a); rows.append(a.reshape(h, w, 4)); bpy.data.images.remove(im)
    sheet = np.concatenate(rows[::-1], axis=0)             # (pixel rows run bottom-up: the first picture on top)
    img = bpy.data.images.new('biome_preview', sheet.shape[1], sheet.shape[0], alpha=True)
    img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = os.path.join(TEX, 'biome_preview.png'); img.file_format = 'PNG'; img.save()


if __name__ == '__main__':
    build()
    print('BIOME DONE')
