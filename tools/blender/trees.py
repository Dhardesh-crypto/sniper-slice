# Builds the trees from the rendered textures (run textures.py first):
#   blender -b -P tools/blender/trees.py -- <texture dir> <out dir (public/models)>
# Each tree_<kind>.glb holds three meshes: `trunk` (bark), `crown` (branch cards cut from the
# spray textures, normals bent outward so the crown shades as a volume) and `far`: two crossed
# cards with the whole tree rendered on them, front and side, for the distance.
# The fir, beech, olive, larch and birch are shaped by hand below; the umbrella pine and the cypress are grown
# from a seed by one recursive brancher (grow(): depth, split angle, taper, leaf density), the way
# a procedural bonsai is: change the seed in TREES and you get another tree of the same kind.
#   ONLY=pine,cypress blender -b -P tools/blender/trees.py -- <texture dir> <out dir>
# Units are the game's metres; z is up here (the export turns it to y).
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix
sys.path.append(os.path.dirname(__file__))
from common import reset, srgb, Mesh, ortho_camera, render, bleed, combine, _nodes, export_glb

TEX, OUT = sys.argv[-2], sys.argv[-1]


# ---- materials: what the game gets, and the two used to render the far cards ----

def image(path, data=False):
    im = bpy.data.images.load(path, check_existing=True)
    if data: im.colorspace_settings.name = 'Non-Color'
    return im


def materials(name, color_png, normal_png, cutout, roughness=0.9, label=None):
    game = bpy.data.materials.new(label or name)   # (label: the game's name for it, e.g. pine_leaf)
    nt = _nodes(game)
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = roughness
    ct = nt.nodes.new('ShaderNodeTexImage'); ct.image = image(color_png)
    nt.links.new(ct.outputs['Color'], bsdf.inputs['Base Color'])
    if cutout: nt.links.new(ct.outputs['Alpha'], bsdf.inputs['Alpha'])
    ntx = nt.nodes.new('ShaderNodeTexImage'); ntx.image = image(normal_png, True)
    nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(ntx.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    game.use_backface_culling = not cutout

    def variant(kind):
        m = bpy.data.materials.new(f'{name}_{kind}')
        nt = _nodes(m)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        ct = nt.nodes.new('ShaderNodeTexImage'); ct.image = image(color_png)
        if kind == 'flat':
            occ = nt.nodes.new('ShaderNodeAmbientOcclusion'); occ.inputs['Distance'].default_value = 0.8
            k = nt.nodes.new('ShaderNodeMapRange'); k.inputs['To Min'].default_value = 0.45
            nt.links.new(occ.outputs['AO'], k.inputs['Value'])
            mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
            nt.links.new(ct.outputs['Color'], mul.inputs['A']); nt.links.new(k.outputs['Result'], mul.inputs['B'])
            em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(mul.outputs['Result'], em.inputs['Color'])
        else:
            ntx = nt.nodes.new('ShaderNodeTexImage'); ntx.image = image(normal_png, True)
            nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(ntx.outputs['Color'], nm.inputs['Color'])
            vt = nt.nodes.new('ShaderNodeVectorTransform'); vt.vector_type = 'NORMAL'; vt.convert_from = 'WORLD'; vt.convert_to = 'CAMERA'
            nt.links.new(nm.outputs['Normal'], vt.inputs[0])
            sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(vt.outputs[0], sep.inputs[0])
            neg = nt.nodes.new('ShaderNodeMath'); neg.operation = 'MULTIPLY'; neg.inputs[1].default_value = -1
            nt.links.new(sep.outputs['Z'], neg.inputs[0])
            comb = nt.nodes.new('ShaderNodeCombineXYZ')
            nt.links.new(sep.outputs['X'], comb.inputs['X']); nt.links.new(sep.outputs['Y'], comb.inputs['Y']); nt.links.new(neg.outputs[0], comb.inputs['Z'])
            enc = nt.nodes.new('ShaderNodeVectorMath'); enc.operation = 'MULTIPLY_ADD'
            enc.inputs[1].default_value = (0.5, 0.5, 0.5); enc.inputs[2].default_value = (0.5, 0.5, 0.5)
            nt.links.new(comb.outputs[0], enc.inputs[0])
            em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(enc.outputs[0], em.inputs['Color'])
        shader = em.outputs[0]
        if cutout:
            tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mx = nt.nodes.new('ShaderNodeMixShader')
            nt.links.new(ct.outputs['Alpha'], mx.inputs['Fac']); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(shader, mx.inputs[2])
            shader = mx.outputs[0]
        nt.links.new(shader, out.inputs['Surface'])
        return m
    return {'game': game, 'flat': variant('flat'), 'nrm': variant('nrm')}


# ---- wood: tapered tubes with bark UVs (shared vertices, smooth) ----

class Wood:
    def __init__(self, bark_tile=1.4):
        self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.new('UVMap'); self.tile = bark_tile

    def tube(self, path, radii, sides=8):
        """A tube along `path` (points), radius per point; bark wraps round 1–3 times."""
        rings, vs = [], 0.0
        around = max(1, round(2 * math.pi * radii[0] / self.tile * 1.6))
        for i, p in enumerate(path):
            d = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
            ref = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0))
            a = d.cross(ref).normalized(); b = d.cross(a)
            rings.append([self.bm.verts.new(p + (a * math.cos(k / sides * math.tau) + b * math.sin(k / sides * math.tau)) * radii[i]) for k in range(sides)])
        vcoord = [0.0]
        for i in range(1, len(path)): vcoord.append(vcoord[-1] + (path[i] - path[i - 1]).length / self.tile)
        for i in range(len(path) - 1):
            for k in range(sides):
                k2 = (k + 1) % sides
                f = self.bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
                f.smooth = True
                u0, u1 = k / sides * around, (k + 1) / sides * around
                for l, uv in zip(f.loops, ((u0, vcoord[i]), (u1, vcoord[i]), (u1, vcoord[i + 1]), (u0, vcoord[i + 1]))): l[self.uv].uv = uv
        # Cap the thin end so it doesn't show as a hole.
        top = rings[-1]
        if radii[-1] > 0.02:
            f = self.bm.faces.new(top); f.smooth = True
            for l in f.loops: l[self.uv].uv = (0.5, vcoord[-1])

    def obj(self, name, mat):
        me = bpy.data.meshes.new(name); self.bm.to_mesh(me); self.bm.free()
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.append(mat)
        return ob


def curve(start, direction, length, n, rng, wander=0.15, gravity=0.0):
    pts, p, d = [Vector(start)], Vector(start), Vector(direction).normalized()
    for i in range(n):
        d = (d + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.5, 0.5))) * wander + Vector((0, 0, -gravity))).normalized()
        p = p + d * (length / n); pts.append(p.copy())
    return pts


# ---- crowns: cards cut from the spray texture ----

class Cards:
    """Branch cards. A card runs from `base` along `d` for `length`, `width` across, drooping;
    its UVs take one of the two sprays in the texture (variant 0 or 1)."""
    def __init__(self, center):
        self.m = Mesh(); self.center = Vector(center); self.normals = []

    def card(self, base, d, side, length, width, variant, droop=0.15, segs=3, roll=0.0):
        d = Vector(d).normalized(); side = Vector(side).normalized()
        up = side.cross(d).normalized()
        if up.z < 0: up = -up
        side = (side * math.cos(roll) + up * math.sin(roll)).normalized()
        lo, hi = (0.0, 0.5) if variant == 0 else (0.5, 1.0)
        pts = [base + d * (length * t) - Vector((0, 0, droop * length * t * t)) for t in (i / segs for i in range(segs + 1))]
        for i in range(segs):
            t0, t1 = i / segs, (i + 1) / segs
            a, b = pts[i], pts[i + 1]
            quad = [a - side * width / 2, b - side * width / 2, b + side * width / 2, a + side * width / 2]
            self.m.poly(quad, (1, 1, 1), [(t0 * 0.98 + 0.02, lo), (t1 * 0.98 + 0.02, lo), (t1 * 0.98 + 0.02, hi), (t0 * 0.98 + 0.02, hi)])

    def obj(self, name, mat, outward=0.65, up=0.0, snow=None):
        """outward: how far the normals bend out from the crown's axis; up: then how far toward the
        sky. A flat crown seen from below (the umbrella pine against a bright sky) has its cards'
        undersides facing the ground: lit only by the dim ground bounce they go black, so their
        normals lean skyward and the sun and sky light them as they'd light the leaves' own
        translucent glow. snow(position, face normal) → 0…1: how much snow that point holds, kept
        as the `_snow` attribute (winter.js lays snow by it instead of by the normals, which no
        longer say which side is really on top)."""
        ob = self.m.obj(name, mat)
        me = ob.data
        normals = []
        for poly in me.polygons:
            for li in poly.loop_indices:
                v = me.vertices[me.loops[li].vertex_index].co
                radial = Vector((v.x - self.center.x, v.y - self.center.y, (v.z - self.center.z) * 0.6 + 0.4))
                n = poly.normal.copy()
                if n.z < 0: n = -n
                n = (n * (1 - outward) + radial.normalized() * outward).normalized()
                normals.append((n * (1 - up) + Vector((0, 0, 1)) * up).normalized())
        me.normals_split_custom_set(normals)
        if 'Col' in me.color_attributes: me.color_attributes.remove(me.color_attributes['Col'])
        if snow:
            at = me.attributes.new('_snow', 'FLOAT', 'POINT')
            vals = [0.0] * len(me.vertices)
            for poly in me.polygons:
                for vi in poly.vertices: vals[vi] = snow(me.vertices[vi].co, poly.normal)
            at.data.foreach_set('value', vals)
        return ob


def facing(d, side, out):
    """`side`, or its opposite: whichever makes a card running along `d` show its front to `out`.
    A card's front is d × side. For a hanging card that matters: the game (and Cycles) turn the
    normals round on a back face, so a curtain whose back faces out of the crown would have its
    outward-bent normals pointing back in, and go dark on the sunny side of the tree."""
    d, side = Vector(d), Vector(side)
    return side if d.cross(side).dot(out) >= 0 else -side


# ---- the hand-shaped trees ----

def fir(rng, M):
    H, base = 16.6, 5.2
    wood = Wood(1.3)
    wood.tube([Vector((0, 0, z)) for z in [-0.3, 0.5, 2, 4, 6, 8, 10, 12, 14, 15.5, H]],
              [0.36, 0.33, 0.31, 0.28, 0.25, 0.21, 0.17, 0.13, 0.09, 0.05, 0.015], sides=10)
    # A few dead twigs low on the trunk, below the live crown.
    for z in [2.6, 3.3, 3.9, 4.5]:
        for k in range(3):
            a = rng.uniform(0, math.tau)
            wood.tube(curve((math.cos(a) * 0.2, math.sin(a) * 0.2, z + rng.uniform(-0.2, 0.2)), (math.cos(a), math.sin(a), -0.2), rng.uniform(0.4, 0.9), 2, rng, 0.2), [0.025, 0.015, 0.006], sides=4)
    trunk = wood.obj('trunk', M['bark']['game'])
    cards = Cards((0, 0, 9.5))
    z = base
    while z < H - 0.6:
        rel = (z - base) / (H - base)
        L0 = 0.35 + 2.75 * (1 - rel) ** 1.05
        n = rng.choice((5, 5, 6))
        a0 = rng.uniform(0, math.tau)
        r = 0.33 - 0.31 * (z / H)
        for k in range(n):
            a = a0 + k / n * math.tau + rng.uniform(-0.25, 0.25)
            L = L0 * rng.uniform(0.85, 1.1)
            d = Vector((math.cos(a), math.sin(a), -rng.uniform(0.08, 0.3) * (1 - rel * 0.6)))
            side = Vector((-math.sin(a), math.cos(a), 0))
            b0 = Vector((math.cos(a) * r, math.sin(a) * r, z))
            segs = 3 if L > 0.9 else 2
            cards.card(b0, d, side, L, L * 0.68, rng.randrange(2), droop=0.12 + 0.12 * (1 - rel), roll=rng.uniform(-0.45, 0.45), segs=segs)
            if L > 0.8:   # an inner spray, rolled steeper, to fill the gap between two branches
                a2 = a + math.pi / n * rng.choice((-1, 1))
                d2 = Vector((math.cos(a2), math.sin(a2), d.z + 0.1))
                cards.card(b0 + Vector((0, 0, 0.12)), d2, Vector((-math.sin(a2), math.cos(a2), 0)), L * 0.62, L * 0.4, rng.randrange(2), droop=0.1, roll=rng.uniform(-0.9, 0.9), segs=2)
            if L > 1.5:   # hanging side shoots under the long branches: depth seen from the side
                cards.card(b0 + d * (L * 0.3), d + Vector((0, 0, -0.35)), side, L * 0.65, L * 0.45, rng.randrange(2), droop=0.25, roll=rng.choice((-1, 1)) * rng.uniform(0.6, 1.0), segs=2)
        z += rng.uniform(0.38, 0.5)
    # The leader: two upright sprays crossing at the top.
    for a in (0, math.pi / 2):
        cards.card(Vector((0, 0, H - 1.4)), (0, 0, 1), (math.cos(a), math.sin(a), 0), 1.6, 0.55, 0, droop=0)
    return trunk, cards.obj('crown', M['leaf']['game'], outward=0.6)


def beech(rng, M):
    wood = Wood(1.6)
    lean = Vector((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 1)).normalized()
    stem = [Vector((0, 0, -0.3)) + lean * (h) for h in (0, 1, 2.5, 4, 5.5, 6.6)]
    wood.tube(stem, [0.36, 0.31, 0.29, 0.27, 0.24, 0.2], sides=12)
    cards = Cards((0, 0, 8.8))
    tips = []
    a0 = rng.uniform(0, math.tau)
    for k in range(4):
        a = a0 + k / 4 * math.tau + rng.uniform(-0.3, 0.3)
        start = stem[-2] + (stem[-1] - stem[-2]) * rng.uniform(0.3, 1)
        out = rng.uniform(0.5, 0.85)
        limb = curve(start, (math.cos(a) * out, math.sin(a) * out, 1), rng.uniform(4.2, 5.2), 5, rng, 0.12)
        wood.tube(limb, [0.16, 0.13, 0.1, 0.08, 0.06, 0.035], sides=8)
        for j in range(4):
            p = limb[2 + j % 3]
            b = a + rng.uniform(-0.9, 0.9)
            br = curve(p, (math.cos(b), math.sin(b), rng.uniform(0.2, 0.7)), rng.uniform(1.4, 2.4), 3, rng, 0.2)
            wood.tube(br, [0.05, 0.035, 0.022, 0.01], sides=5)
            tips += br[1:]
        tips += limb[2:]
    trunk = wood.obj('trunk', M['bark']['game'])
    # Leafy sprays on the branches' outer parts, mostly lying flat, spread to an even crown…
    for p in tips:
        for k in range(4):
            q = p + Vector((rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), rng.uniform(-0.4, 0.5)))
            out = Vector((q.x, q.y, 0)).normalized() if q.xy.length > 0.1 else Vector((1, 0, 0))
            a = math.atan2(out.y, out.x) + rng.uniform(-0.9, 0.9)
            d = Vector((math.cos(a), math.sin(a), rng.uniform(-0.15, 0.35)))
            L = rng.uniform(1.1, 1.7)
            cards.card(q - d * L * 0.3, d, Vector((-math.sin(a), math.cos(a), 0)), L, L * 0.6, rng.randrange(2), droop=0.1, roll=rng.uniform(-0.8, 0.8), segs=2)
    # …and over the dome of the crown, so it reads as one rounded mass from every side.
    for k in range(110):
        u, v = rng.uniform(0, math.tau), math.acos(rng.uniform(-0.55, 1))
        n = Vector((math.cos(u) * math.sin(v), math.sin(u) * math.sin(v), math.cos(v)))
        q = Vector((0, 0, 8.5)) + Vector((n.x * 4.0, n.y * 4.0, n.z * 3.6)) * rng.uniform(0.8, 1.02)
        tang = Vector((-n.y, n.x, 0)).normalized() if n.xy.length > 0.05 else Vector((1, 0, 0))
        d = (tang * rng.choice((-1, 1)) + n * 0.4).normalized()
        L = rng.uniform(1.2, 1.8)
        cards.card(q - d * L * 0.5, d, n.cross(d).normalized(), L, L * 0.6, rng.randrange(2), droop=0.08, roll=rng.uniform(-0.4, 0.4), segs=2)
    return trunk, cards.obj('crown', M['leaf']['game'], outward=0.7)


def olive(rng, M):
    wood = Wood(0.9)
    cards = Cards((0, 0, 3.0))
    tips = []
    trunk_pts = curve((0, 0, -0.2), (0.1, 0.05, 1), 1.5, 4, rng, 0.25)
    wood.tube(trunk_pts, [0.3, 0.26, 0.24, 0.22, 0.2], sides=10)
    # A second stem twisting off low: olives grow from the stool in several trunks.
    s2 = curve(trunk_pts[1], (-0.6, rng.uniform(-0.4, 0.4), 1), 1.3, 3, rng, 0.25)
    wood.tube(s2, [0.15, 0.13, 0.11, 0.1], sides=8)
    for start in (trunk_pts[-1], s2[-1]):
        for k in range(3):
            a = rng.uniform(0, math.tau)
            br = curve(start, (math.cos(a), math.sin(a), rng.uniform(0.6, 1.2)), rng.uniform(1.6, 2.3), 4, rng, 0.3)
            wood.tube(br, [0.11, 0.08, 0.06, 0.04, 0.02], sides=6)
            tips += br[2:]
    trunk = wood.obj('trunk', M['bark']['game'])
    for p in tips:
        for k in range(4):
            q = p + Vector((rng.uniform(-0.7, 0.7), rng.uniform(-0.7, 0.7), rng.uniform(-0.3, 0.4)))
            a = rng.uniform(0, math.tau)
            d = Vector((math.cos(a), math.sin(a), rng.uniform(-0.4, 0.3)))
            L = rng.uniform(0.75, 1.05)
            cards.card(q - d * L * 0.35, d, Vector((-math.sin(a), math.cos(a), 0)), L, L * 0.6, rng.randrange(2), droop=0.18, roll=rng.uniform(-0.6, 0.6), segs=2)
    # The rounded, silvery mass of the crown, hanging a little at the edges.
    bb = [p for p in tips]
    cz = sum(p.z for p in bb) / len(bb)
    for k in range(95):
        u, v = rng.uniform(0, math.tau), math.acos(rng.uniform(-0.6, 1))
        n = Vector((math.cos(u) * math.sin(v), math.sin(u) * math.sin(v), math.cos(v)))
        q = Vector((0, 0, cz + 0.2)) + Vector((n.x * 2.3, n.y * 2.3, n.z * 1.5)) * rng.uniform(0.75, 1.02)
        tang = Vector((-n.y, n.x, 0)).normalized() if n.xy.length > 0.05 else Vector((1, 0, 0))
        d = (tang * rng.choice((-1, 1)) + n * 0.3 + Vector((0, 0, -0.25))).normalized()
        L = rng.uniform(0.8, 1.15)
        cards.card(q - d * L * 0.5, d, n.cross(d).normalized(), L, L * 0.6, rng.randrange(2), droop=0.15, roll=rng.uniform(-0.5, 0.5), segs=2)
    return trunk, cards.obj('crown', M['leaf']['game'], outward=0.7)


def larch(rng, M):
    """European larch (Larix decidua), the pale conifer of the high Alps: a dead-straight trunk and
    a narrow, open crown you can see the sky through. Thin limbs leave the trunk in loose whorls,
    sag, and turn up again at their tips; the needle-bearing twigs hang from them like curtains.
    So unlike the fir (closed tiers of flat dark combs) nearly every card here hangs, and the
    limbs themselves are drawn as wood because nothing hides them."""
    H, base = 15.2, 4.4
    zs = [-0.3, 0.5, 2, 4, 6, 8, 10, 12, 13.6, 14.6, H]
    rs = [0.31, 0.27, 0.25, 0.22, 0.19, 0.16, 0.13, 0.1, 0.065, 0.035, 0.012]
    wood = Wood(1.3)
    wood.tube([Vector((0, 0, z)) for z in zs], rs, sides=10)
    # Dead stubs below the live crown: a larch sheds its shaded lower limbs but keeps their stumps.
    for z in (2.4, 3.0, 3.5, 3.9):
        a = rng.uniform(0, math.tau)
        wood.tube(curve((math.cos(a) * 0.2, math.sin(a) * 0.2, z), (math.cos(a), math.sin(a), -0.1), rng.uniform(0.4, 0.8), 2, rng, 0.15), [0.025, 0.015, 0.006], sides=3)
    cards = Cards((0, 0, 9.5))
    z = base
    while z < H - 0.5:
        rel = (z - base) / (H - base)
        L0 = 0.5 + 3.0 * (1 - rel) ** 0.85
        n = rng.choice((3, 4, 4))
        a0 = rng.uniform(0, math.tau)
        r = 0.23 - 0.2 * rel
        for k in range(n):
            a = a0 + k / n * math.tau + rng.uniform(-0.35, 0.35)
            L = L0 * rng.uniform(0.7, 1.1)
            out = Vector((math.cos(a), math.sin(a), 0)); side = Vector((-math.sin(a), math.cos(a), 0))
            b0 = out * r + Vector((0, 0, z + rng.uniform(-0.15, 0.15)))
            sag = L * rng.uniform(0.16, 0.3) * (1 - rel * 0.8)            # (the top limbs are young and still point up)
            limb = [b0, b0 + out * (L * 0.55) - Vector((0, 0, sag)), b0 + out * L - Vector((0, 0, sag - L * 0.14))]
            if L > 0.8: wood.tube(limb, [0.016 + 0.01 * L, 0.01 + 0.004 * L, 0.005], sides=3)
            v = rng.randrange(2)
            # The limb's own end: one spray lying along its upturned tip.
            tip = (limb[2] - limb[1]).normalized()
            cards.card(limb[1] - tip * (L * 0.3), tip, facing(tip, side, (0, 0, 1)), L * 0.85, L * 0.55, v, droop=0.06, roll=rng.uniform(-0.5, 0.5), segs=1)
            # The curtains: sprays hanging straight down from points along the limb, each in a
            # plane near the limb's own but turned a little, so they show from every side.
            for j in range(2 if L < 1.0 else 4 if L < 2.2 else 5):
                t = rng.uniform(0.2, 1.0)
                p = limb[0] + (limb[1] - limb[0]) * (t / 0.55) if t < 0.55 else limb[1] + (limb[2] - limb[1]) * ((t - 0.55) / 0.45)
                yaw = a + rng.uniform(-0.7, 0.7)
                Lc = rng.uniform(1.0, 1.6) * (0.5 + 0.5 * (1 - rel))
                d = Vector((0, 0, -1)) + out * rng.uniform(0.0, 0.3)
                sd = Vector((math.cos(yaw), math.sin(yaw), 0))
                face = Vector((p.x, p.y, 0)) + Vector((-sd.y, sd.x, 0)) * rng.choice((-0.3, 0.3))   # (out of the crown; near the trunk, either way)
                cards.card(p + Vector((0, 0, 0.08)), d, facing(d, sd, face), Lc, Lc * 0.7, rng.randrange(2), droop=0, segs=1)
        z += rng.uniform(0.46, 0.64)
    # The leader: two upright sprays crossing at the top.
    for a in (0, math.pi / 2):
        cards.card(Vector((0, 0, H - 1.0)), (0, 0, 1), (math.cos(a), math.sin(a), 0), 1.2, 0.45, 0, droop=0, segs=1)
    return wood.obj('trunk', M['bark']['game']), cards.obj('crown', M['leaf']['game'], outward=0.6)


def birch(rng, M):
    """Silver birch (Betula pendula), the tree of heath and field edge: a slender white trunk that
    runs right up through the crown, limbs climbing steeply off it and arching over, and from
    their ends the long whip twigs that hang straight down. The crown is light: the trunk and
    limbs show through it, so they are all drawn."""
    wood = Wood(1.2)
    stem = curve((0, 0, -0.3), (rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), 1), 10.6, 10, rng, 0.03)
    rs = [0.19, 0.16, 0.145, 0.13, 0.115, 0.1, 0.085, 0.068, 0.05, 0.03, 0.012]
    wood.tube(stem, rs, sides=8)
    cards = Cards((0, 0, 7.0))
    hang = []                                               # where twigs hang from: (point, outward angle, how far up the crown)
    a = rng.uniform(0, math.tau)
    for i in range(3, 10):
        for k in range(3 if i < 8 else 2):
            a += 2.4 + rng.uniform(-0.5, 0.5)               # (the golden angle, roughly: limbs spread all round)
            p = stem[i] + (stem[i + 1] - stem[i]) * rng.random()
            rel = (p.z - 3.0) / 7.3
            L = (3.3 - 2.3 * rel) * rng.uniform(0.8, 1.1)
            el = math.radians(rng.uniform(26, 44))          # from upright: birch limbs climb
            limb = curve(p, (math.cos(a) * math.sin(el), math.sin(a) * math.sin(el), math.cos(el)), L, 3, rng, 0.1, gravity=0.1)
            r0 = rs[i] * 0.55
            wood.tube(limb, [r0, r0 * 0.65, r0 * 0.38, 0.006], sides=4)
            hang += [(limb[2], a, rel), (limb[3], a, rel)]
            if L > 2.0: hang.append(((limb[1] + limb[2]) / 2 + Vector((math.cos(a), math.sin(a), 0)) * 0.3, a, rel))
    hang.append((stem[-1], a, 1.0))
    trunk = wood.obj('trunk', M['bark']['game'])
    for p, a, rel in hang:
        out = Vector((math.cos(a), math.sin(a), 0)); side = Vector((-math.sin(a), math.cos(a), 0))
        # The limb's end arches out and over…
        d = out * rng.uniform(0.5, 1.0) + Vector((0, 0, rng.uniform(0.3, 0.8)))
        L = rng.uniform(1.2, 1.7)
        cards.card(p - d.normalized() * 0.25, d, facing(d, side, (0, 0, 1)), L, L * 0.6, rng.randrange(2), droop=0.55, roll=rng.uniform(-0.6, 0.6), segs=3)
        # …and the whips hang from it: curtains turned every way, longer low in the crown.
        for k in range(4):
            q = p + Vector((rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45), rng.uniform(-0.1, 0.35)))
            yaw = rng.uniform(0, math.pi)
            Lc = rng.uniform(1.1, 1.7) * (1.0 - 0.35 * rel)
            dd = Vector((0, 0, -1)) + out * rng.uniform(-0.05, 0.3)
            sd = Vector((math.cos(yaw), math.sin(yaw), 0))
            cards.card(q, dd, facing(dd, sd, Vector((q.x, q.y, 0)) + out * 0.2), Lc, Lc * 0.6, rng.randrange(2), droop=0, segs=1)
    return trunk, cards.obj('crown', M['leaf']['game'], outward=0.7)


# ---- grown trees: one recursive brancher, seeded (the umbrella pine and the cypress) ----

def grow(wood, start, d, length, radius, level, P, rng, ends):
    """One branch and, below `P['depth']`, its children. The branch wanders a little (wander) and
    bends toward the horizontal by `flat` per level (an umbrella pine's limbs level out into its
    flat roof); its radius narrows by `taper` along it. At its end it splits in two (sometimes
    three) at ±`split` degrees about a random axis, the children `ratio` as long. Wood is drawn
    with fewer sides the finer it gets; `ends` collects (point, direction, level) for the leaves:
    every branch end, the wood's last tips (level −1), and halfway points unless `mids` is off.
    `ceiling`, if given, is a height no wood grows above."""
    n = max(2, P.get('segs', 3) - level)
    flat = P['flat'] * (level + 1) / (P['depth'] + 1)
    pts = curve(start, d, length, n, rng, P['wander'], gravity=flat * 0.35)
    if 'ceiling' in P:                     # (no wood above the roof: a branch reaching it runs along under it)
        for q in pts: q.z = min(q.z, P['ceiling'] - 0.15 * rng.random())
    r1 = radius * (1 - P['taper'])
    radii = [radius + (r1 - radius) * i / n for i in range(n + 1)]
    if level < P['wood']:
        wood.tube(pts, radii, sides=max(3, P.get('sides', 6) - level))
        if level == P['wood'] - 1: ends.append((pts[-1], None, -1))   # (the wood's last tips: leaves hide them)
    end, dir_ = pts[-1], (pts[-1] - pts[-2]).normalized()
    if P.get('mids', True): ends.append((pts[n // 2 + 1] if n > 2 else end, dir_, level))   # (leaves part-way along too)
    if level >= P['depth']:
        ends.append((end, dir_, level)); return
    kids = 3 if (level == 0 and rng.random() < 0.35) else 2
    a0 = rng.uniform(0, math.tau)
    ref = Vector((1, 0, 0)) if abs(dir_.x) < 0.9 else Vector((0, 1, 0))
    ax1 = dir_.cross(ref).normalized(); ax2 = dir_.cross(ax1)
    for k in range(kids):
        a = a0 + k / kids * math.tau
        axis = (ax1 * math.cos(a) + ax2 * math.sin(a)).normalized()
        cd = Matrix.Rotation(math.radians(P['split'] * rng.uniform(0.8, 1.2)), 3, axis) @ dir_
        cd.z = min(cd.z, dir_.z + 0.05) * (1 - flat)                       # level out (never turning up past its parent)
        grow(wood, end, cd.normalized(), length * P['ratio'] * rng.uniform(0.85, 1.15), r1, level + 1, P, rng, ends)


def stone_pine(rng, M, P):
    """Italian stone pine (Pinus pinea): a tall bare trunk, often leaning, that forks high up into a
    few long limbs; they spread and level out into a broad flat roof of needle pads, open below
    so you see the limbs from underneath."""
    wood = Wood(1.3)
    lean = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)).normalized() * P['lean']
    bole = curve((0, 0, -0.3), Vector((0, 0, 1)) + lean, P['bole'] + 0.3, 6, rng, 0.04)
    R = P['radius']
    wood.tube(bole, [R * 1.35, R * 1.08, R, R * 0.94, R * 0.88, R * 0.82, R * 0.76], sides=10)   # (a flared foot)
    ends = []
    top = bole[-1]; up = (bole[-1] - bole[-2]).normalized()
    P = dict(P, ceiling=top.z + P['rise'])                                 # (the roof's underside: the limbs rise this far)
    limbs = P['limbs']
    a0 = rng.uniform(0, math.tau)
    for k in range(limbs):
        a = a0 + k / limbs * math.tau + rng.uniform(-0.35, 0.35)
        el = math.radians(P['split'] * rng.uniform(1.0, 1.35))             # from upright
        d = up * math.cos(el) + Vector((math.cos(a), math.sin(a), 0)) * math.sin(el)
        start = top - up * rng.uniform(0, 0.9)                             # (they fork a little apart)
        grow(wood, start, d, P['length'] * rng.uniform(0.85, 1.1), R * 0.62, 0, P, rng, ends)
    trunk = wood.obj('trunk', M['bark']['game'])
    # The roof: a clump of needle cards at every branch end, a flattened dome of cards each facing
    # out from the clump's middle (stone pines carry their needles in cloud-like pads). The clumps
    # are pulled toward one gently domed roof, so the crown's top is flat and its underside level.
    ends_xy = [(p, lv) for p, d, lv in ends if lv >= P['depth'] or lv < 0]
    reach = max(Vector((p.x, p.y)).length for p, _ in ends_xy)
    roof = P['ceiling'] + 0.3                                              # (just over the highest wood)
    cards = Cards((0, 0, roof - 1.0))
    for p, lv in ends_xy:
        r = Vector((p.x, p.y)).length / reach
        c = Vector((p.x, p.y, p.z * (1 - P['roof']) + (roof - 0.6 * r * r) * P['roof']))
        size = P['clump'] * (1.0 - 0.3 * r) * rng.uniform(0.85, 1.15)
        for k in range(P['density']):
            u = rng.uniform(0, math.tau); v = math.acos(rng.uniform(-0.25, 1))     # (mostly the upper side)
            n = Vector((math.cos(u) * math.sin(v), math.sin(u) * math.sin(v), math.cos(v)))
            q = c + Vector((n.x * size, n.y * size, n.z * size * P['squash']))
            tang = Vector((-n.y, n.x, 0)).normalized() if n.xy.length > 0.05 else Vector((1, 0, 0))
            cd = (tang * rng.choice((-1, 1)) + n * 0.35).normalized()
            L = rng.uniform(0.9, 1.15) * P['card'] * size / P['clump']
            # (rolled well off the dome's surface: a card lying flat vanishes edge-on from the side)
            cards.card(q - cd * L * 0.5, cd, n.cross(cd).normalized(), L, L * 0.66, rng.randrange(2),
                       droop=0.1, roll=rng.uniform(-P['roll'], P['roll']), segs=1)
    # The top of the roof at each place (a 0.6 m grid): snow lies on what nothing else covers.
    cell = lambda v: (round(v.x / 0.6), round(v.y / 0.6))
    tops = {}
    for v in cards.m.bm.verts: tops[cell(v.co)] = max(tops.get(cell(v.co), -1e9), v.co.z)
    def snow(v, n):
        return max(0.0, min(1.0, 1 - (tops.get(cell(v), v.z) - v.z) / 0.7)) * min(1.0, abs(n.z) * 1.4)
    crown = cards.obj('crown', M['leaf']['game'], outward=P['outward'], up=P['sky'], snow=snow)
    return trunk, crown


def cypress(rng, M, P):
    """Italian cypress (Cupressus sempervirens): a narrow flame-shaped column, its short branches
    sweeping steeply up the central leader and clothed all over in dense dark sprays."""
    H, R = P['height'], P['width'] / 2
    base = 1.0                                   # (the bare foot of the trunk below the crown)
    def env(z):                                  # the column's radius at height z: widest a third up, pointed
        t = max(0.0, min(1.0, (z - base) / (H - base)))
        return R * math.sin(math.pi * t ** 0.72) ** 0.75 * (1 - 0.15 * t) + 0.05
    wood = Wood(0.9)
    lead = curve((0, 0, -0.3), (rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02), 1), H - 0.2, 8, rng, 0.015)
    rr = P['radius']
    wood.tube(lead, [rr * (1 - P['taper'] * i / 8) for i in range(9)], sides=8)
    cards = Cards((0, 0, H * 0.45))
    ends = []
    # Branch whorls up the leader, steep (split from upright); only the lowest few get wood (the
    # rest are hidden in the column), every branch gets sprays along it.
    z = base
    while z < H - 0.8:
        a0 = rng.uniform(0, math.tau)
        for k in range(P['whorl']):
            a = a0 + k / P['whorl'] * math.tau + rng.uniform(-0.4, 0.4)
            el = math.radians(P['split'] * rng.uniform(0.8, 1.25))
            d = Vector((math.cos(a) * math.sin(el), math.sin(a) * math.sin(el), math.cos(el)))
            reach = env(z + 0.8) * 0.95 / max(0.2, math.sin(el))
            start = Vector((0, 0, z))
            if z < base + 1.6:
                grow(wood, start, d, min(reach, 2.2), rr * 0.3, P['depth'] - 1, P, rng, ends)
            else:
                pts = curve(start, d, min(reach, 2.2), 2, rng, 0.1)
                ends += [(pts[1], d, P['depth']), (pts[2], d, P['depth'])]
        z += rng.uniform(0.45, 0.6)
    trunk = wood.obj('trunk', M['bark']['game'])
    def spray(q, L):
        # A spray standing up and out from the axis, its face turned outward (it lies in the column's skin).
        out = Vector((q.x, q.y, 0)); out = out.normalized() if out.length > 0.05 else Vector((1, 0, 0))
        tang = Vector((-out.y, out.x, 0))
        cd = (Vector((0, 0, 1)) * rng.uniform(0.7, 1.0) + out * rng.uniform(0.15, 0.5) + tang * rng.uniform(-0.35, 0.35)).normalized()
        cards.card(q - cd * L * 0.45, cd, tang, L, L * 0.6, rng.randrange(2), droop=0.05, roll=rng.uniform(-0.35, 0.35), segs=1)
    for p, d, lv in ends:
        if Vector((p.x, p.y)).length > env(p.z) * 1.05: continue          # (no sprays sticking out of the column)
        for k in range(max(1, P['density'] // 3)):
            spray(p + Vector((rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), rng.uniform(-0.2, 0.2))), rng.uniform(0.8, 1.15))
    # …and the skin of the column, so it reads as one dense mass from every side.
    for k in range(P['density'] * 40):
        zq = base + (H - base) * rng.random() ** 0.9
        a = rng.uniform(0, math.tau)
        rq = env(zq) * rng.uniform(0.7, 1.0)
        spray(Vector((math.cos(a) * rq, math.sin(a) * rq, zq)), rng.uniform(0.75, 1.1) * (0.6 + 0.4 * min(1, env(zq) / R)))
    def snow(v, n):
        # On the outer skin, more where the sprays face up (they hold snow on their tops).
        e = env(v.z)
        out = max(0.0, min(1.0, (Vector((v.x, v.y)).length / e - 0.7) / 0.3))
        return out * (0.15 + 0.85 * abs(n.z)) * 0.8     # (dense sprays stand nearly upright: little lies on them)
    crown = cards.obj('crown', M['leaf']['game'], outward=P['outward'], up=P['sky'], snow=snow)
    return trunk, crown


TREES = {
    'fir': dict(build=fir, spray='fir_spray', bark='bark_fir', seed=5),
    'beech': dict(build=beech, spray='beech_spray', bark='bark_beech', seed=7),
    'olive': dict(build=olive, spray='olive_spray', bark='bark_olive', seed=9),
    'larch': dict(build=larch, spray='larch_spray', bark='bark_larch', seed=6, label='larch_'),
    'birch': dict(build=birch, spray='birch_spray', bark='bark_birch', seed=8, label='birch_'),
    # Grown ones (seed: change it for another tree of the kind). P are grow()'s parameters — depth:
    # levels of forking; split: their angle, degrees; taper: how much a branch narrows along itself;
    # ratio: a child's length; flat: how far the levels bend toward the horizontal; wood: levels
    # drawn as wood (finer ones are only leaves); segs, sides: a branch's rings and sides at level 0;
    # density: leaf cards per branch end — and the crown's: outward, how far its normals bend out
    # from its middle, so it shades as one mass, not as a patchwork of cards each catching the sun
    # or not; sky, then how far they lean skyward (the lit underside). The pine's own: bole, its bare
    # trunk; rise, how far the limbs climb above it before they run flat (no wood higher: the roof's
    # underside); roof, how hard the clumps are pulled to one gently domed top; clump, card: their
    # size; squash: how flat a clump is; roll: how far its cards tilt off its skin, to show side-on.
    'pine': dict(build=stone_pine, spray='pine_spray', bark='bark_pine', seed=3, label='pine_', P=dict(
        bole=8.6, lean=0.1, radius=0.3, limbs=5, length=2.75, depth=4, split=24, taper=0.4, ratio=0.78,
        flat=1.0, wander=0.12, wood=3, segs=3, sides=5, mids=False, density=4,
        rise=3.4, roof=0.55, clump=0.85, card=2.1, squash=0.45, roll=0.7, outward=0.85, sky=0.4)),
    'cypress': dict(build=cypress, spray='cypress_spray', bark='bark_cypress', seed=4, label='cypress_', P=dict(
        height=11.0, width=2.3, radius=0.22, taper=0.9, whorl=3, depth=1, split=24, ratio=0.6, flat=0.0,
        wander=0.08, wood=1, segs=3, sides=4, density=7, outward=0.8, sky=0.2)),
}


def far_cards(name, objs, M, label=''):
    """Render the tree front and side onto two crossed cards (the `far` mesh)."""
    bb = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(v.x for v in bb), min(v.y for v in bb), max(0.0, min(v.z for v in bb))))
    hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    H = hi.z - lo.z
    W = max(hi.x - lo.x, hi.y - lo.y, 2 * max(abs(lo.x), abs(hi.x), abs(lo.y), abs(hi.y)))
    S = max(W, H) * 1.02
    rh = 1024 if H >= W else int(1024 * H / W) // 16 * 16
    rw = 1024 if W > H else int(1024 * W / H) // 16 * 16
    zc = lo.z + H / 2
    paths = {}
    for kind in ('flat', 'nrm'):
        for o in objs:
            o.data.materials[0] = M[o['part']][kind]
        for view in ('front', 'side'):
            ortho_camera((0, 0, zc), S, view, (rw, rh))
            paths[(kind, view)] = render(os.path.join(TEX, f'{name}_{view}_{kind}.png'), raw=(kind == 'nrm'))
        for o in objs:
            o.data.materials[0] = M[o['part']]['game']
    col = combine([paths[('flat', 'front')], paths[('flat', 'side')]], os.path.join(TEX, f'{name}_far.png'), (2 * rw, rh))
    nrm = combine([paths[('nrm', 'front')], paths[('nrm', 'side')]], os.path.join(TEX, f'{name}_far_n.png'), (2 * rw, rh))
    bleed(col); bleed(nrm, alpha_from=col)
    # The two cards: the frame each camera saw, standing crossed at the trunk.
    w = S * rw / max(rw, rh) / 2; h = S * rh / max(rw, rh) / 2
    m = Mesh()
    m.poly([Vector((-w, 0, zc - h)), Vector((w, 0, zc - h)), Vector((w, 0, zc + h)), Vector((-w, 0, zc + h))], (1, 1, 1),
           [(0, 0), (0.5, 0), (0.5, 1), (0, 1)])
    m.poly([Vector((0, -w, zc - h)), Vector((0, w, zc - h)), Vector((0, w, zc + h)), Vector((0, -w, zc + h))], (1, 1, 1),
           [(0.5, 0), (1, 0), (1, 1), (0.5, 1)])
    far = materials('far', col, nrm, cutout=True, label=label + 'far')
    ob = m.obj('far', far['game'])
    if 'Col' in ob.data.color_attributes: ob.data.color_attributes.remove(ob.data.color_attributes['Col'])
    return ob


def build(name):
    spec = TREES[name]
    reset()
    bpy.context.scene.cycles.samples = 32
    lb = spec.get('label', '')
    M = {
        'leaf': materials('leaf', os.path.join(TEX, spec['spray'] + '.png'), os.path.join(TEX, spec['spray'] + '_n.png'), cutout=True, roughness=0.8, label=lb + 'leaf'),
        'bark': materials('bark', os.path.join(TEX, spec['bark'] + '.png'), os.path.join(TEX, spec['bark'] + '_n.png'), cutout=False, roughness=0.95, label=lb + 'bark'),
    }
    rng = random.Random(spec['seed'])
    trunk, crown = spec['build'](rng, M, spec['P']) if 'P' in spec else spec['build'](rng, M)
    trunk['part'], crown['part'] = 'bark', 'leaf'
    far = far_cards(name, [trunk, crown], M, lb)
    far.location.x += 0   # (kept at the origin: the game puts each part at the tree's place)
    tris = sum(len(p.vertices) - 2 for o in (trunk, crown) for p in o.data.polygons)
    print(f'TREE {name}: near {tris} triangles')
    export_glb(os.path.join(OUT, f'tree_{name}.glb'), [trunk, crown, far], attributes='P' in spec)
    if os.environ.get('PREVIEW'): preview(name, [trunk, crown], far)


def preview(name, near, far):
    """A lit look at the tree, and its far cards beside it, for checking by eye."""
    sc = bpy.context.scene
    sc.render.film_transparent = False
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.55, 0.65, 0.8, 1); bg.inputs['Strength'].default_value = 0.8
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(35)); sc.collection.objects.link(sun)
    bb = [o.matrix_world @ Vector(c) for o in near for c in o.bound_box]
    H = max(v.z for v in bb)
    half = max(max(abs(v.x) for v in bb), max(abs(v.y) for v in bb))
    far.location.x = half * 2 + 1
    cam = bpy.data.objects.new('pcam', bpy.data.cameras.new('pcam')); sc.collection.objects.link(cam)
    cam.data.lens = 35
    span = max(H * 1.5, (far.location.x + half * 2) * 1.0)
    cam.location = (far.location.x / 2, -span * 1.25, H * 0.5); cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 1200, 800
    sc.view_settings.view_transform = 'AgX'
    sc.render.filepath = os.path.join(TEX, f'{name}_preview.png')
    bpy.ops.render.render(write_still=True)
    far.location.x = 0


if __name__ == '__main__':
    for name in (os.environ.get('ONLY') or ','.join(TREES)).split(','):
        build(name)
    print('TREES DONE')
