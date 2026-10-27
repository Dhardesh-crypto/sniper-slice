# Builds the trees from the rendered textures (run textures.py first):
#   blender -b -P tools/blender/trees.py -- <texture dir> <out dir (public/models)>
# Each tree_<kind>.glb holds three meshes: `trunk` (bark), `crown` (branch cards cut from the
# spray textures, normals bent outward so the crown shades as a volume) and `far`: two crossed
# cards with the whole tree rendered on them, front and side, for the distance.
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


def materials(name, color_png, normal_png, cutout, roughness=0.9):
    game = bpy.data.materials.new(name)
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

    def obj(self, name, mat, outward=0.65):
        ob = self.m.obj(name, mat)
        me = ob.data
        # Bend the normals outward from the crown's axis: lit like a mass of foliage, not like paper.
        normals = []
        for poly in me.polygons:
            for li in poly.loop_indices:
                v = me.vertices[me.loops[li].vertex_index].co
                radial = Vector((v.x - self.center.x, v.y - self.center.y, (v.z - self.center.z) * 0.6 + 0.4))
                n = poly.normal.copy()
                if n.z < 0: n = -n
                normals.append((n * (1 - outward) + radial.normalized() * outward).normalized())
        me.normals_split_custom_set(normals)
        if 'Col' in me.color_attributes: me.color_attributes.remove(me.color_attributes['Col'])
        return ob


# ---- the three trees ----

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


TREES = {
    'fir': dict(build=fir, spray='fir_spray', bark='bark_fir', seed=5),
    'beech': dict(build=beech, spray='beech_spray', bark='bark_beech', seed=7),
    'olive': dict(build=olive, spray='olive_spray', bark='bark_olive', seed=9),
}


def far_cards(name, objs, M):
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
            base = o.data.materials[0].name.split('_')[0]
            o.data.materials[0] = M[base][kind]
        for view in ('front', 'side'):
            ortho_camera((0, 0, zc), S, view, (rw, rh))
            paths[(kind, view)] = render(os.path.join(TEX, f'{name}_{view}_{kind}.png'), raw=(kind == 'nrm'))
        for o in objs:
            base = o.data.materials[0].name.split('_')[0]
            o.data.materials[0] = M[base]['game']
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
    far = materials('far', col, nrm, cutout=True)
    ob = m.obj('far', far['game'])
    if 'Col' in ob.data.color_attributes: ob.data.color_attributes.remove(ob.data.color_attributes['Col'])
    return ob


def build(name):
    spec = TREES[name]
    reset()
    bpy.context.scene.cycles.samples = 32
    M = {
        'leaf': materials('leaf', os.path.join(TEX, spec['spray'] + '.png'), os.path.join(TEX, spec['spray'] + '_n.png'), cutout=True, roughness=0.8),
        'bark': materials('bark', os.path.join(TEX, spec['bark'] + '.png'), os.path.join(TEX, spec['bark'] + '_n.png'), cutout=False, roughness=0.95),
    }
    trunk, crown = spec['build'](random.Random(spec['seed']), M)
    far = far_cards(name, [trunk, crown], M)
    far.location.x += 0   # (kept at the origin: the game puts each part at the tree's place)
    tris = sum(len(p.vertices) - 2 for o in (trunk, crown) for p in o.data.polygons)
    print(f'TREE {name}: near {tris} triangles')
    export_glb(os.path.join(OUT, f'tree_{name}.glb'), [trunk, crown, far])
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
