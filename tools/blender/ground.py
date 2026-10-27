# Ground detail for every mission (run textures.py first, for the fir bark):
#   blender -b -P tools/blender/ground.py -- <texture dir> <out dir (public/models)>
# Renders a foliage atlas from modelled detail (top half: a fern frond; bottom left: a spray of
# lentisk, the Mediterranean scrub; bottom right: a patch of fallen needles, twigs and a cone) and
# uses a photo-scanned rock (Poly Haven), then builds ground_detail.glb, one mesh per kind:
#   fern, bush, litter (a flat patch), rock1–3, stump, branch.
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, noise
sys.path.append(os.path.dirname(__file__))
from common import reset, srgb, mix, Mesh, albedo_material, normal_material, vertex_color, ortho_camera, render, bleed, export_glb
import textures as T
from textures import Cell, stem, leaf, needle
from trees import materials, Wood, Cards, curve

TEX, OUT = sys.argv[-2], sys.argv[-1]
T.OUT = TEX
PH = os.environ.get('POLYHAVEN', os.path.join(TEX, '..', 'ph'))   # the Poly Haven downloads


# ---- the foliage atlas ----

def fern_frond(m, cell, rng):
    """A male-fern frond along x: pinnae out to both sides, longest a third of the way up,
    each with its own row of lobes."""
    greens = [srgb(0x3f6a26), srgb(0x4d7a2e), srgb(0x5c8a36)]
    cy = (cell.lo + cell.hi) / 2
    pts, dirs = stem(m, (0.03, cy, 0), rng.uniform(-0.04, 0.04), 0.92, 0.006, 0.0015, srgb(0x6b6a3a), rng, bend=0.25, cell=cell)
    n = len(pts)
    for k in range(34):
        t = 0.05 + k / 34 * 0.93
        i = int(t * (n - 1)); p, d = pts[i], dirs[i]
        L = 0.21 * math.sin(math.pi * min(1, (t + 0.08) / 1.0)) ** 0.8 * (1.15 - t * 0.6)
        for side in (-1, 1):
            a = math.atan2(d.y, d.x) + side * math.radians(rng.uniform(62, 75))
            dd = Vector((math.cos(a), math.sin(a), 0))
            c = rng.choice(greens)
            # The pinna's midrib and its lobes.
            steps = max(3, int(L / 0.012))
            for j in range(steps):
                s = j / steps
                q = p + dd * (L * s + 0.004)
                w = 0.013 * (1 - s * 0.7)
                for sd in (-1, 1):
                    la = a + sd * math.radians(70)
                    ld = Vector((math.cos(la), math.sin(la), 0))
                    tip = q + ld * w + dd * w * 0.6
                    if cell.inside(tip): m.poly([q, q + dd * (L / steps), tip], mix(c, srgb(0x2f5520), rng.random() * 0.3))
            if cell.inside(p + dd * L): m.poly([p - Vector((-dd.y, dd.x, 0)) * 0.001, p + dd * L, p + Vector((-dd.y, dd.x, 0)) * 0.001], srgb(0x8a9a4a))


def lentisk_spray(m, cell, rng):
    """Mastic scrub: a twig dense with small dark leathery leaves in pairs."""
    tops = [srgb(0x2f4a22), srgb(0x3a5a29), srgb(0x45632e)]
    def twig(start, ang, length, depth):
        pts, dirs = stem(m, start, ang, length, 0.003, 0.001, srgb(0x5a4a3a), rng, bend=0.7, cell=cell)
        n = len(pts); t = 0.05
        while t < 0.98:
            i = int(t * (n - 1)); p, d = pts[i], dirs[i]
            for side in (-1, 1):
                a = math.atan2(d.y, d.x) + side * math.radians(rng.uniform(40, 65))
                dd = Vector((math.cos(a), math.sin(a), 0)); L = rng.uniform(0.022, 0.032)
                if cell.inside(p + dd * L): leaf(m, p, dd, L, L * 0.5, rng.choice(tops), rng, fold=0.3, tilt=rng.uniform(-0.6, 0.6), steps=4, z=rng.uniform(0.002, 0.01))
            if depth and rng.random() < 0.3:
                twig(p, math.atan2(d.y, d.x) + rng.choice((-1, 1)) * math.radians(rng.uniform(30, 50)), length * rng.uniform(0.35, 0.5) * (1 - t), depth - 1)
            t += rng.uniform(0.025, 0.04)
    cx = 0.02
    for k in range(3):
        twig((cx, (cell.lo + cell.hi) / 2 + rng.uniform(-0.08, 0.08), 0), rng.uniform(-0.4, 0.4), 0.45, 2)


def litter_patch(m, cell, rng, x0, x1):
    """Fallen fir needles, bits of twig and a cone, brown and grey, thinning to the edges."""
    browns = [srgb(0x6a4a2a), srgb(0x7d5a34), srgb(0x5a4026), srgb(0x8a6a44), srgb(0x4a3a28)]
    cx, cy, r = (x0 + x1) / 2, (cell.lo + cell.hi) / 2, (x1 - x0) / 2 * 0.95
    for k in range(5200):
        a, d = rng.uniform(0, math.tau), r * math.sqrt(rng.random()) * (0.4 + 0.6 * rng.random())
        p = Vector((cx + math.cos(a) * d, cy + math.sin(a) * d, rng.uniform(0, 0.01)))
        b = rng.uniform(0, math.tau)
        if cell.inside(p + Vector((math.cos(b), math.sin(b), 0)) * 0.03): needle(m, p, Vector((math.cos(b), math.sin(b), 0)), rng.uniform(0.015, 0.028), 0.0024, rng.choice(browns), p.z)
    for k in range(9):
        a = rng.uniform(0, math.tau); p = Vector((cx + math.cos(a) * r * 0.5 * rng.random(), cy + math.sin(a) * r * 0.5 * rng.random(), 0.012))
        stem(m, p, rng.uniform(0, math.tau), rng.uniform(0.05, 0.14), 0.006, 0.003, srgb(0x5a4a3a), rng, bend=1.0, z=0.012, cell=cell)
    # A cone: overlapping scales in rings.
    c = Vector((cx + r * 0.3, cy - r * 0.2, 0.02)); ang = rng.uniform(0, math.tau); ax = Vector((math.cos(ang), math.sin(ang), 0)); side = Vector((-ax.y, ax.x, 0))
    for j in range(14):
        s = j / 14; w = 0.022 * math.sin(math.pi * (0.15 + 0.85 * s))
        for sd in (-1, 1):
            q = c + ax * (0.11 * s - 0.05)
            m.poly([q, q + ax * 0.012 + side * sd * w, q + ax * 0.02], mix(srgb(0x6a4628), srgb(0x8a5e34), rng.random()))


def foliage_atlas():
    m = Mesh(); rng = random.Random(41)
    fern_frond(m, Cell(0.5, 1.0), rng)
    # Bottom left: the lentisk (x 0–0.5); bottom right: the litter (x 0.5–1).
    class Half(Cell):
        def __init__(self, x0, x1): super().__init__(0.0, 0.5); self.x0, self.x1 = x0, x1
        def inside(self, p, margin=0.004): return self.x0 + margin < p.x < self.x1 - margin and margin < p.y < 0.5 - margin
    left, right = Half(0.0, 0.5), Half(0.5, 1.0)
    lentisk_spray(m, left, rng)
    litter_patch(m, right, rng, 0.5, 1.0)
    alb = albedo_material('fol_alb', vertex_color, ao=0.5, ao_dist=0.02)
    m.obj('atlas', alb)
    ortho_camera((0.5, 0.5, 0), 1.0, 'top', (1024, 1024))
    c = render(os.path.join(TEX, 'ground_atlas.png'))
    nm = render(os.path.join(TEX, 'ground_atlas_n.png'), override=normal_material('fol_nrm'), raw=True)
    bleed(c); bleed(nm)


# ---- the meshes ----

def rock_mesh(name, seed, size, mat):
    rng = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1)
    ob = bpy.context.object; ob.name = name
    off = Vector((rng.uniform(0, 50), rng.uniform(0, 50), rng.uniform(0, 50)))
    for v in ob.data.vertices:
        p = v.co
        k = 1 + 0.35 * noise.noise(p * 1.3 + off) + 0.12 * noise.noise(p * 3.1 + off)
        p *= k
        p.z = p.z * 0.6 if p.z > 0 else p.z * 0.25     # sits low, flattened underneath
        p.x *= size[0]; p.y *= size[1]; p.z *= size[2]
        p.z += size[2] * 0.15
    bpy.ops.object.shade_flat()
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=2.0); bpy.ops.object.mode_set(mode='OBJECT')
    ob.data.materials.append(mat)
    return ob


class AtlasCards(Cards):
    """Cards from one rectangle of the atlas (u0…u1 along, v0…v1 across)."""
    def __init__(self, center, rect):
        super().__init__(center); self.rect = rect
    def card(self, base, d, side, length, width, variant=0, droop=0.15, segs=2, roll=0.0):
        u0, u1, v0, v1 = self.rect
        d = Vector(d).normalized(); side = Vector(side).normalized()
        up = side.cross(d).normalized()
        if up.z < 0: up = -up
        side = (side * math.cos(roll) + up * math.sin(roll)).normalized()
        pts = [base + d * (length * t) - Vector((0, 0, droop * length * t * t)) for t in (i / segs for i in range(segs + 1))]
        for i in range(segs):
            t0, t1 = i / segs, (i + 1) / segs
            a, b = pts[i], pts[i + 1]
            uu = lambda t: u0 + (u1 - u0) * (0.02 + 0.98 * t)
            self.m.poly([a - side * width / 2, b - side * width / 2, b + side * width / 2, a + side * width / 2], (1, 1, 1),
                        [(uu(t0), v0), (uu(t1), v0), (uu(t1), v1), (uu(t0), v1)])


def build():
    reset()
    foliage_atlas()
    reset()
    fol = materials('foliage', os.path.join(TEX, 'ground_atlas.png'), os.path.join(TEX, 'ground_atlas_n.png'), cutout=True, roughness=0.9)['game']
    # The rock is a photo-scan: Poly Haven's Rock Boulder Dry (CC0), resized (public/textures/CREDITS.md).
    rock = materials('rock', os.path.join(PH, 'rock_boulder_dry_diff.jpg'), os.path.join(PH, 'rock_boulder_dry_nor_gl.jpg'), cutout=False)['game']
    bark = materials('bark', os.path.join(TEX, 'bark_fir.png'), os.path.join(TEX, 'bark_fir_n.png'), cutout=False)['game']
    rng = random.Random(3)
    objs = []
    # Fern: fronds from the top half.
    fern = AtlasCards((0, 0, 0.2), (0.0, 1.0, 0.5, 1.0))
    for k in range(9):
        a = k / 9 * math.tau + rng.uniform(-0.3, 0.3); L = rng.uniform(0.7, 1.0)
        fern.card(Vector((0, 0, 0.02)), (math.cos(a), math.sin(a), rng.uniform(0.8, 1.3)), (-math.sin(a), math.cos(a), 0), L, L * 0.5, droop=0.95, segs=3, roll=rng.uniform(-0.3, 0.3))
    objs.append(fern.obj('fern', fol, outward=0.5))
    # Bush: lentisk sprays over a low dome.
    bush = AtlasCards((0, 0, 0.5), (0.0, 0.5, 0.0, 0.5))
    for k in range(46):
        u, v = rng.uniform(0, math.tau), math.acos(rng.uniform(-0.15, 1))
        nrm = Vector((math.cos(u) * math.sin(v), math.sin(u) * math.sin(v), math.cos(v)))
        q = Vector((nrm.x * 0.72, nrm.y * 0.72, 0.18 + nrm.z * 0.62)) * rng.uniform(0.55, 1.0)
        tang = Vector((-nrm.y, nrm.x, 0)).normalized() if nrm.xy.length > 0.05 else Vector((1, 0, 0))
        d = (tang * rng.choice((-1, 1)) + nrm * 0.4).normalized(); L = rng.uniform(0.6, 0.9)
        bush.card(q - d * L * 0.5, d, nrm.cross(d).normalized(), L, L, droop=0.08, segs=1, roll=rng.uniform(-0.6, 0.6))
    objs.append(bush.obj('bush', fol, outward=0.75))
    # Litter: one flat patch (the game lays it on the slope).
    lit = AtlasCards((0, 0, -5), (0.5, 1.0, 0.0, 0.5))
    lit.card(Vector((-0.6, 0, 0.015)), (1, 0, 0), (0, 1, 0), 1.2, 1.2, droop=0, segs=1)
    objs.append(lit.obj('litter', fol, outward=0.0))
    for i, size in enumerate(((0.55, 0.42, 0.4), (0.35, 0.3, 0.32), (0.9, 0.6, 0.45))):
        objs.append(rock_mesh(f'rock{i + 1}', 10 + i, size, rock))
    # A fir stump, sawn: bark round the side, a pale cut on top.
    wood = Wood(1.3)
    wood.tube([Vector((0, 0, -0.1)), Vector((0, 0, 0.25)), Vector((0, 0, 0.5))], [0.42, 0.36, 0.33], sides=12)
    stump = wood.obj('stump', bark)
    objs.append(stump)
    # A fallen branch: crooked, with two side twigs.
    w2 = Wood(1.0)
    br = curve((-1.3, 0, 0.06), (1, 0.1, 0.02), 2.6, 5, rng, 0.12)
    w2.tube(br, [0.06, 0.055, 0.05, 0.04, 0.03, 0.015], sides=6)
    for j in (2, 3):
        tw = curve(br[j], (rng.uniform(-0.3, 0.3), rng.choice((-1, 1)), 0.1), 0.7, 2, rng, 0.2)
        w2.tube(tw, [0.02, 0.014, 0.006], sides=4)
    objs.append(w2.obj('branch', bark))
    for o in objs:
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        print(f'GROUND {o.name}: {tris} triangles')
    export_glb(os.path.join(OUT, 'ground_detail.glb'), objs)


if __name__ == '__main__':
    build()
    print('GROUND DONE')
