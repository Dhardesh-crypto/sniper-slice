# The guard dog, rigged and animated: a real canine skeleton on the static German shepherd
# (models-src/animal_dog.glb, Tripo) and its gaits, all from numbers, so it can be rebuilt.
#   blender -b -P tools/blender/dog_rig.py -- [out.glb] [--sheet dir]
# Metres, feet on z = 0, nose toward -y (glTF +z, the way the game's root walks). +x is its left.
import bpy, bmesh, json, math, os, sys
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'models-src', 'animal_dog.glb')
LENGTH = 1.3     # m nose to tail tip, as the game has always had it

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SHEET = argv[argv.index('--sheet') + 1] if '--sheet' in argv else None
OUT = argv[0] if argv and not argv[0].startswith('--') else os.path.join(ROOT, 'public', 'models', 'animal_dog.glb')

# The skeleton: (name, head, tail, parent), read off the side and rear views.
SPINE = [
    ('root', (0, 0, 0), (0, -0.2, 0), None),
    ('pelvis', (0, 0.33, 0.50), (0, 0.18, 0.53), 'root'),
    ('spine1', (0, 0.18, 0.53), (0, 0.03, 0.54), 'pelvis'),
    ('spine2', (0, 0.03, 0.54), (0, -0.12, 0.54), 'spine1'),
    ('chest', (0, -0.12, 0.54), (0, -0.30, 0.55), 'spine2'),
    ('neck1', (0, -0.30, 0.55), (0, -0.37, 0.64), 'chest'),
    ('neck2', (0, -0.37, 0.64), (0, -0.445, 0.71), 'neck1'),
    ('head', (0, -0.445, 0.71), (0, -0.645, 0.625), 'neck2'),
    ('jaw', (0, -0.50, 0.625), (0, -0.60, 0.586), 'head'),
    ('tail1', (0, 0.41, 0.50), (0, 0.44, 0.40), 'pelvis'),
    ('tail2', (0, 0.44, 0.40), (0, 0.46, 0.30), 'tail1'),
    ('tail3', (0, 0.46, 0.30), (0, 0.50, 0.21), 'tail2'),
    ('tail4', (0, 0.50, 0.21), (0, 0.56, 0.125), 'tail3'),
    ('tail5', (0, 0.56, 0.125), (0, 0.64, 0.04), 'tail4'),
    ('ear.L', (0.055, -0.455, 0.775), (0.075, -0.455, 0.85), 'head'),
    ('ear.R', (-0.055, -0.455, 0.775), (-0.075, -0.455, 0.85), 'head'),
]
# Each leg, its joints from the top down to the toe tip. L is +x. It stands with its hinds staggered.
LEGS = {
    'FL': dict(s=1, top=(0.06, -0.25, 0.575), sh=(0.09, -0.34, 0.445), el=(0.085, -0.232, 0.312), wr=(0.075, -0.277, 0.105), pw=(0.08, -0.325, 0.042), toe=(0.085, -0.385, 0.012)),
    'FR': dict(s=-1, top=(-0.06, -0.25, 0.575), sh=(-0.09, -0.34, 0.445), el=(-0.085, -0.222, 0.312), wr=(-0.075, -0.25, 0.105), pw=(-0.08, -0.30, 0.042), toe=(-0.085, -0.365, 0.012)),
    'HL': dict(s=1, sh=(0.09, 0.29, 0.445), el=(0.09, 0.216, 0.27), wr=(0.08, 0.456, 0.184), pw=(0.095, 0.41, 0.04), toe=(0.105, 0.35, 0.012)),
    'HR': dict(s=-1, sh=(-0.09, 0.29, 0.445), el=(-0.09, 0.183, 0.27), wr=(-0.08, 0.357, 0.163), pw=(-0.095, 0.235, 0.035), toe=(-0.105, 0.175, 0.01)),
}


def bone_list():
    out = list(SPINE)
    for n, g in LEGS.items():
        par = 'pelvis'
        if n[0] == 'F':
            out.append((f'scap{n}', g['top'], g['sh'], 'chest'))
            par = f'scap{n}'
        out += [(f'up{n}', g['sh'], g['el'], par), (f'lo{n}', g['el'], g['wr'], f'up{n}'),
                (f'meta{n}', g['wr'], g['pw'], f'lo{n}'), (f'paw{n}', g['pw'], g['toe'], f'meta{n}')]
    return out


# The mesh to size, its seams welded (heat weighting needs one skin; the UVs stay on the loops).
def load_mesh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    o = next(x for x in bpy.data.objects if x.type == 'MESH')
    M = o.matrix_world.copy()
    o.parent = None
    me = o.data
    me.transform(M)
    o.matrix_world = Matrix.Identity(4)
    k = LENGTH / (max(v.co.y for v in me.vertices) - min(v.co.y for v in me.vertices))
    low = min(v.co.z for v in me.vertices)
    me.transform(Matrix.Scale(k, 4) @ Matrix.Translation((0, 0, -low)))
    for x in list(bpy.data.objects):
        if x is not o:
            bpy.data.objects.remove(x)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    mouth(bm)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    for name, rgb, rough in (('palate', (0.16, 0.025, 0.03), 0.6), ('tongue', (0.5, 0.09, 0.1), 0.5), ('teeth', (0.8, 0.75, 0.62), 0.4)):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        b.inputs['Base Color'].default_value = (*rgb, 1)
        b.inputs['Roughness'].default_value = rough
        me.materials.append(m)
    o.name = me.name = 'dog'
    return o


# The model's mouth is shut and solid. Cut the lip line round the muzzle, part the two lips, close
# each with a palate or a tongue-pink floor, and set four canines in, so the jaw can really open.
LIP = ((-0.63, 0.603), (-0.49, 0.60))      # (y, z) at the nose and the corner of the mouth
CORNER = -0.495


def mouth(bm):
    mask = bm.verts.layers.float.new('jawmask')
    faces = [f for f in bm.faces if all(v.co.y < CORNER for v in f.verts)]
    edges = list({e for f in faces for e in f.edges})
    verts = list({v for f in faces for v in f.verts})
    co = Vector((0, LIP[0][0], LIP[0][1]))
    dy, dz = LIP[1][0] - LIP[0][0], LIP[1][1] - LIP[0][1]
    no = Vector((0, -dz, dy)).normalized()
    if no.z < 0:
        no = -no
    r = bmesh.ops.bisect_plane(bm, geom=faces + edges + verts, plane_co=co, plane_no=no, dist=1e-5)
    cut = [e for e in r['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    above = lambda p: (p - co).dot(no)
    for f in bm.faces:
        if all(v.co.y < CORNER + 1e-4 for v in f.verts):
            c = f.calc_center_median()
            for v in f.verts:
                v[mask] = 1 if above(c) < 0 else 2
    bmesh.ops.split_edges(bm, edges=cut)
    for v in bm.verts:       # (the lips' verts, now one per side, take their own face's side)
        sides = {above(f.calc_center_median()) < 0 for f in v.link_faces}
        if v[mask] and len(sides) == 1:
            v[mask] = 1 if sides.pop() else 2
    rims = {True: [], False: []}
    for e in bm.edges:
        if len(e.link_faces) == 1 and all(abs(above(v.co)) < 1e-3 for v in e.verts):     # (not the holes Tripo left)
            rims[above(e.link_faces[0].calc_center_median()) < 0].append(e)
    print('MOUTH cut edges', len(cut), 'rims', len(rims[True]), len(rims[False]))
    for lower, es in rims.items():
        deg = {}
        for e in es:
            for v in e.verts:
                deg.setdefault(v, []).append(e)
        ends = [v for v, l in deg.items() if len(l) == 1]
        print('MOUTH rim ends', len(ends))
        v, chain, seen = ends[0], [ends[0]], set()
        while True:
            nxt = [e for e in deg[v] if e not in seen]
            if not nxt:
                break
            seen.add(nxt[0])
            v = nxt[0].other_vert(v)
            chain.append(v)
        f = bm.faces.new(chain)
        f.normal_update()
        if (f.normal.z > 0) != lower:
            f.normal_flip()
        f.material_index = 2 if lower else 1
        f.smooth = False
    # The canines: a little four-sided spike each, up from the jaw and down from the palate.
    zl = lambda y: co.z + (y - co.y) * dz / dy
    for sx in (1, -1):
        for y, m, up in ((-0.572, 2, -1), (-0.56, 1, 1)):
            z = zl(y) - up * 0.003
            base = [bm.verts.new((sx * 0.021 + ax, y + ay, z)) for ax, ay in ((-0.004, -0.004), (0.004, -0.004), (0.004, 0.004), (-0.004, 0.004))]
            tip = bm.verts.new((sx * 0.021, y, z + up * 0.016))
            for v in base + [tip]:
                v[mask] = m
            for i in range(4):
                f = bm.faces.new((base[i], base[(i + 1) % 4], tip) if up < 0 else (base[(i + 1) % 4], base[i], tip))
                f.material_index = 3


def build_armature():
    arm = bpy.data.armatures.new('dogrig')
    ob = bpy.data.objects.new('dogrig', arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for n, h, t, p in bone_list():
        b = arm.edit_bones.new(n)
        b.head, b.tail = Vector(h), Vector(t)
        b.use_deform = n != 'root'
    for n, h, t, p in bone_list():
        if p:
            arm.edit_bones[n].parent = arm.edit_bones[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def skin(mesh, arm):
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    print('SKIN unweighted', sum(1 for v in mesh.data.vertices if not v.groups), 'of', len(mesh.data.vertices))
    # A left bone never moves the right side of the dog; four bones at most on any vertex.
    names = {g.index: g.name for g in mesh.vertex_groups}
    for v in mesh.data.vertices:
        ws = {names[g.group]: g.weight for g in v.groups}
        for n in list(ws):
            if n[-2:] in LEGS and v.co.x * LEGS[n[-2:]]['s'] < -0.01:
                ws.pop(n)
        top = sorted(ws.items(), key=lambda kv: -kv[1])[:4]
        s = sum(w for _, w in top) or 1
        for n in names.values():
            mesh.vertex_groups[n].remove([v.index])
        for n, w in top:
            mesh.vertex_groups[n].add([v.index], w / s, 'REPLACE')
    # The muzzle is rigid: above the lip line it is the head, below it the jaw, easing in at the corner.
    mask = mesh.data.attributes['jawmask'].data
    for v in mesh.data.vertices:
        m = mask[v.index].value
        if not m:
            continue
        f = ease((CORNER - v.co.y) / 0.03) if m == 1 else 0
        for n in names.values():
            mesh.vertex_groups[n].remove([v.index])
        if f > 0:
            mesh.vertex_groups['jaw'].add([v.index], f, 'REPLACE')
        if f < 1:
            mesh.vertex_groups['head'].add([v.index], 1 - f, 'REPLACE')


def camera(scene, res=(1000, 760), scale=1.5):
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x, scene.render.resolution_y = res
    cam = bpy.data.objects.new('c', bpy.data.cameras.new('c'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    return cam


# ---- Posing. Everything is solved in armature space, in Python: a spec says where each paw is and
# how the body lies, and solve() turns it into each bone's local transform.
BONES = bone_list()
PAWLEN = {}


class Rig:
    def __init__(self, ob):
        self.ob = ob
        self.rest = {b.name: b.matrix_local.copy() for b in ob.data.bones}
        self.q = {n: m.to_quaternion() for n, m in self.rest.items()}
        self.err = 0
        self.legs = {}
        for n, g in LEGS.items():
            sh, el, wr, pw, toe = (Vector(g[k]) for k in ('sh', 'el', 'wr', 'pw', 'toe'))
            self.legs[n] = dict(a=(el - sh).length, c=(wr - el).length, m=(pw - wr).length, p=(toe - pw).length,
                                dxp=pw.x - toe.x, dxw=wr.x - pw.x, toe=toe,
                                b=math.atan2(pw.z - toe.z, pw.y - toe.y), al=math.atan2(-(wr.y - pw.y), wr.z - pw.z))

    def rest_leg(self, n):
        L = self.legs[n]
        return (L['toe'].copy(), L['b'], L['al'])

    def solve(self, spec):
        P, B = {}, {}
        aims = {}
        for n, h, t, par in BONES:
            base = P[par] @ self.rest[par].inverted() @ self.rest[n] if par else self.rest[n].copy()
            if n[:2] == 'up' and n[2:] in spec['legs']:
                aims.update(self.leg(n[2:], base.translation.copy(), spec['legs'][n[2:]]))
            if n in aims:
                q = (self.rest[n].to_3x3() @ Vector((0, 1, 0))).rotation_difference(aims[n]) @ self.q[n]
                M = Matrix.Translation(base.translation) @ q.to_matrix().to_4x4()
                B[n] = base.inverted() @ M
            elif n in spec['abs']:
                q = euler(spec['abs'][n]) @ self.q[n]
                B[n] = base.inverted() @ Matrix.Translation(base.translation) @ q.to_matrix().to_4x4()
            else:
                r = euler(spec['fk'].get(n, (0, 0, 0)))
                qb = self.q[n].inverted() @ r @ self.q[n]
                l = self.q[n].inverted() @ Vector(spec['loc'].get(n, (0, 0, 0)))
                B[n] = Matrix.Translation(l) @ qb.to_matrix().to_4x4()
            P[n] = base @ B[n]
        return B

    # A leg: from the toe up, the paw and pastern at their given angles, then the two-bone IK from
    # the shoulder or hip down to the wrist or hock. Elbows bend back, stifles forward.
    def leg(self, n, S, target):
        T, b, a = target
        L = self.legs[n]
        Pw = T + Vector((L['dxp'], L['p'] * math.cos(b), L['p'] * math.sin(b))).normalized() * L['p']
        W = Pw + Vector((L['dxw'], -L['m'] * math.sin(a), L['m'] * math.cos(a))).normalized() * L['m']
        D = W - S
        d = D.length
        far = (L['a'] + L['c']) * 0.998
        if d > far:
            self.err = max(self.err, d - far)
            d = far
        Dn = D.normalized()
        W2 = S + Dn * d
        x = (L['a'] ** 2 - L['c'] ** 2 + d * d) / (2 * d)
        h = math.sqrt(max(0, L['a'] ** 2 - x * x))
        pole = Vector((0, 1 if n[0] == 'F' else -1, 0))
        nrm = (pole - Dn * pole.dot(Dn)).normalized()
        E = S + Dn * x + nrm * h
        return {f'up{n}': (E - S).normalized(), f'lo{n}': (W2 - E).normalized(),
                f'meta{n}': (Pw - W).normalized(), f'paw{n}': (T - Pw).normalized()}


def euler(r):
    return (Quaternion((1, 0, 0), r[0]) @ Quaternion((0, 1, 0), r[1]) @ Quaternion((0, 0, 1), r[2]))


def spec0():
    return dict(loc={}, fk={}, abs={}, legs={})


def ease(k):
    k = min(1, max(0, k))
    return k * k * (3 - 2 * k)


def curve(k, pts):
    for (k0, v0), (k1, v1) in zip(pts, pts[1:]):
        if k <= k1:
            return v0 + (v1 - v0) * ease((k - k0) / (k1 - k0))
    return pts[-1][1]


TAU = math.tau
sn = lambda ph: math.sin(TAU * ph)

# The gaits. frames at 60 fps for one stride; stride in metres (so stride / time is the speed the
# clip is true at, and the game plays it faster or slower to keep the paws from sliding); duty: the
# share of the stride a paw is down; phase: when each paw lands. The walk is lateral four-beat, the
# trot diagonal pairs (hinds a touch after the fores), the gallop rotary with two suspensions.
GAITS = {
    'walk': dict(frames=34, stride=0.76, duty=(0.60, 0.60), phase=dict(HL=0, FL=0.25, HR=0.5, FR=0.75), home=(-0.335, 0.27), track=0.075,
                 F=dict(td=-0.25, mid=-0.55, off=0.35, sw=1.25, boff=1.0, bsw=1.5, lift=0.055), H=dict(td=-0.45, mid=-0.3, off=0.5, sw=0.9, boff=0.9, bsw=1.4, lift=0.05), scap=0.2),
    'trot': dict(frames=26, stride=1.40, duty=(0.40, 0.40), phase=dict(FL=0, HR=0.03, FR=0.5, HL=0.53), home=(-0.345, 0.27), track=0.05,
                 F=dict(td=-0.2, mid=-0.6, off=0.45, sw=1.45, boff=1.1, bsw=1.6, lift=0.09), H=dict(td=-0.5, mid=-0.3, off=0.6, sw=1.0, boff=1.0, bsw=1.5, lift=0.08), scap=0.3),
    'gallop': dict(frames=23, stride=2.50, duty=(0.20, 0.23), phase=dict(HL=0, HR=0.1, FR=0.5, FL=0.6), home=(-0.36, 0.25), track=0.07,
                   F=dict(td=-0.1, mid=-0.65, off=0.5, sw=1.5, boff=1.15, bsw=1.6, lift=0.14), H=dict(td=-0.5, mid=-0.3, off=0.65, sw=1.1, boff=1.1, bsw=1.5, lift=0.12), scap=0.36),
}


def foot(rig, g, n, ph, stride=None):
    front = n[0] == 'F'
    c = g['F' if front else 'H']
    d = g['duty'][0 if front else 1]
    S = (stride or g['stride']) * d
    home = g['home'][0 if front else 1]
    s = LEGS[n]['s']
    b0 = rig.legs[n]['b']
    u = (ph - g['phase'][n]) % 1
    if u < d:
        k = u / d
        y, z = home - S / 2 + S * k, 0.012
        a = curve(k, [(0, c['td']), (0.45, c['mid']), (1, c['off'])])
        b = curve(k, [(0, b0), (0.6, b0), (1, c['boff'])])
    else:
        k = (u - d) / (1 - d)
        k2, k3 = k * k, k * k * k
        p0, p1, m = S / 2, -S / 2, 0.5 * S
        y = home + (2 * k3 - 3 * k2 + 1) * p0 + (k3 - 2 * k2 + k) * m + (-2 * k3 + 3 * k2) * p1 + (k3 - k2) * m
        z = 0.012 + c['lift'] * math.sin(math.pi * k ** 0.85)
        a = curve(k, [(0, c['off']), (0.4, c['sw']), (1, c['td'])])
        b = curve(k, [(0, c['boff']), (0.4, c['bsw']), (1, b0)])
    return (Vector((s * g['track'] + s * 0.012, y, z)), b, a), (y - home) / (S / 2)


def tail(sp, lift, ph, amp, droop=0.0):
    for i in range(5):
        w = sn(ph - 0.11 * i) * amp * (0.5 + 0.25 * i)
        sp['fk'][f'tail{i + 1}'] = ((lift if i == 0 else droop), w * 0.7, w * 0.7)


def spine_yaw(sp, y):
    for n, k in (('spine1', 1), ('spine2', 0.2), ('chest', -1)):
        x = sp['fk'].get(n, (0, 0, 0))
        sp['fk'][n] = (x[0], x[1], y * k)


def gait_spec(rig, name, ph, nose=False):
    g = GAITS[name]
    sp = spec0()
    for n in LEGS:
        sp['legs'][n], off = foot(rig, g, n, ph)
        if n[0] == 'F':
            sp['fk'][f'scap{n}'] = (g['scap'] * off, 0, 0)
    if name == 'walk':
        sp['loc']['pelvis'] = (0, 0, -0.014 + 0.007 * math.cos(2 * TAU * (ph - 0.05)))
        sp['fk']['pelvis'] = (0.012 * sn(2 * ph), 0.028 * sn(ph + 0.1), 0)
        spine_yaw(sp, 0.035 * sn(ph + 0.2))
        sp['fk']['neck1'] = (0.22 + 0.02 * sn(2 * ph), 0, -0.03 * sn(ph + 0.2))
        sp['fk']['neck2'] = (0.05, 0, 0)
        sp['abs']['head'] = (0.14 + 0.02 * sn(2 * ph + 0.1), 0, 0.02 * sn(ph))
        tail(sp, 0.12, ph, 0.05, 0.02)
    elif name == 'trot':
        sp['loc']['pelvis'] = (0, 0, -0.03 + 0.016 * math.cos(2 * TAU * (ph - 0.2)))
        sp['fk']['pelvis'] = (0.015 * sn(2 * ph + 0.1), 0.02 * sn(ph), 0)
        spine_yaw(sp, 0.022 * sn(ph))
        sp['fk']['neck1'] = (0.48, 0, 0)
        sp['fk']['neck2'] = (0.08, 0, 0)
        sp['abs']['head'] = (0.3 + 0.015 * sn(2 * ph), 0, 0)
        tail(sp, 0.55, ph, 0.05, 0.05)
        sp['fk']['ear.L'] = sp['fk']['ear.R'] = (-0.2, 0, 0)
    else:
        flex = math.cos(TAU * (ph - 0.95))
        f = flex if flex > 0 else 0.7 * flex
        sp['loc']['pelvis'] = (0, -0.05 * flex, -0.05 + 0.03 * math.cos(2 * TAU * (ph - 0.35)))
        sp['fk']['pelvis'] = (-0.2 * f + 0.05 * sn(ph - 0.1), 0.02 * sn(ph), 0)
        for n in ('spine1', 'spine2', 'chest'):
            sp['fk'][n] = (0.15 * f, 0, 0)
        sp['fk']['neck1'] = (0.62 - 0.22 * flex, 0, 0)
        sp['fk']['neck2'] = (0.1, 0, 0)
        sp['abs']['head'] = (0.34 + 0.05 * sn(ph), 0, 0)
        tail(sp, 0.95 + 0.2 * sn(ph + 0.2), ph, 0.03, 0.08)
        sp['fk']['ear.L'] = sp['fk']['ear.R'] = (-0.55, 0, 0)
    if nose:      # on the scent: head and neck down, muzzle along the ground, shoulders dropped
        d = 0.04 + 0.012 * sn(2 * ph)
        l = sp['loc']['pelvis']
        sp['loc']['pelvis'] = (l[0], l[1], l[2] - 0.02)
        sp['fk']['pelvis'] = (0.1, sp['fk']['pelvis'][1], 0)
        sp['fk']['chest'] = (0.12, 0, sp['fk'].get('chest', (0, 0, 0))[2])
        sp['fk']['neck1'] = (0.72, 0, 0)
        sp['fk']['neck2'] = (0.12, 0, 0)
        sp['abs']['head'] = (0.62 + d, 0, 0)
    return sp


def idle_spec(rig, t):
    sp = spec0()
    for n in LEGS:
        sp['legs'][n] = rig.rest_leg(n)
    br = math.sin(TAU * t / 2.0)        # (a loop of 8 s; panting-free breath every 2 s)
    sw = math.sin(TAU * t / 8.0)
    sp['loc']['pelvis'] = (0.006 * sw, 0, 0.002 * br)
    sp['fk']['chest'] = (0.012 * br, 0, 0)
    look = curve((t % 8) / 8, [(0, 0), (0.15, 0.28), (0.4, 0.28), (0.5, -0.05), (0.7, -0.3), (0.85, -0.3), (1, 0)])
    sp['fk']['neck1'] = (0.08, 0, 0.3 * look)
    sp['fk']['neck2'] = (0.02, 0, 0.3 * look)
    sp['abs']['head'] = (0.05 + 0.02 * sw, 0, 0.75 * look)
    flick = max(0, math.sin(TAU * t / 8 * 3 - 1)) ** 24
    sp['fk']['ear.L'] = (-0.25 * flick, 0, 0)
    sp['fk']['ear.R'] = (-0.2 * max(0, math.sin(TAU * t / 8 * 2 + 0.6)) ** 24, 0, 0)
    tail(sp, 0.04, t / 4, 0.03)
    return sp


def bite_spec(rig, t):
    sp = spec0()
    for n in LEGS:
        sp['legs'][n] = rig.rest_leg(n)
    load = curve(t, [(0, 0), (0.14, 1), (0.26, -1), (0.44, -1), (0.72, 0)])     # gathers, drives in
    sp['loc']['pelvis'] = (0, -0.15 * max(0, -load) + 0.07 * max(0, load), -0.07 * max(0, load) - 0.03 * max(0, -load))
    sp['fk']['pelvis'] = (0.08 * max(0, -load), 0, 0)
    sp['fk']['neck1'] = (0.7 * max(0, -load) - 0.1 * max(0, load), 0, 0)
    sp['fk']['neck2'] = (0.2 * max(0, -load), 0, 0)
    shake = 0.3 * math.sin(TAU * (t - 0.3) / 0.11) * curve(t, [(0, 0), (0.3, 0), (0.34, 1), (0.48, 1), (0.56, 0), (0.72, 0)])
    sp['abs']['head'] = (0.1 + 0.1 * max(0, -load), 0, shake)
    sp['fk']['jaw'] = (curve(t, [(0, 0), (0.14, 0.15), (0.24, 0.62), (0.29, 0.05), (0.5, 0.05), (0.72, 0)]), 0, 0)
    sp['fk']['ear.L'] = sp['fk']['ear.R'] = (-0.5 * abs(load), 0, 0)
    tail(sp, 0.25 * abs(load), t * 2, 0.04)
    return sp


# Hit: the hinds go first, then it rolls onto its left side and the legs slacken out.
def die_spec(rig, t):
    sp = spec0()
    buckle = ease(t / 0.35)
    k = ease((t - 0.1) / 0.6)
    slack = ease((t - 0.45) / 0.65)
    ang = k * k * math.pi / 2 * 0.97
    sp['fk']['root'] = (0, ang, 0)
    sp['loc']['root'] = (-0.52 * k, 0, 0.135 * k)
    sp['loc']['pelvis'] = (0, 0, -0.17 * buckle * (1 - k))
    sp['fk']['pelvis'] = (-0.12 * buckle * (1 - k), 0, 0)
    for n in LEGS:
        s = LEGS[n]['s']
        hind = n[0] == 'H'
        fold = buckle * (1 - slack)
        v = 0.14 if s > 0 else 0.3
        sp['fk'][f'up{n}'] = ((-0.55 if hind else 0.4) * fold + v * slack * (-1 if hind else 1), 0, 0)
        sp['fk'][f'lo{n}'] = ((0.95 if hind else -0.8) * fold + 0.25 * slack * (1 if hind else -1), 0, 0)
        sp['fk'][f'meta{n}'] = ((-0.4 if hind else 0.4) * fold + 0.2 * slack * (-1 if hind else 1), 0, 0)
        sp['fk'][f'paw{n}'] = (0.5 * slack, 0, 0)
    sp['fk']['neck1'] = (-0.25 * k, 0, 0)
    sp['fk']['neck2'] = (-0.1 * k, 0, 0.1 * slack)
    sp['fk']['head'] = (0.2 * slack, 0, 0.12 * slack)
    sp['fk']['jaw'] = (0.3 * ease(t / 0.2) * (1 - 0.6 * slack), 0, 0)
    sp['fk']['ear.L'] = sp['fk']['ear.R'] = (-0.4 * slack, 0, 0)
    for i in range(5):
        sp['fk'][f'tail{i + 1}'] = ((0.5 * buckle * (1 - k) if i == 0 else 0) + 0.08 * slack, 0, 0.1 * slack)
    return sp


def bake(rig, name, frames, fn, step=1):
    ob = rig.ob
    ob.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ob.animation_data.action = act
    rig.err = 0
    last = {}
    for f in list(range(0, frames, step)) + [frames]:
        B = rig.solve(fn(f))
        for pb in ob.pose.bones:
            m = B[pb.name]
            q = m.to_quaternion()
            if pb.name in last and last[pb.name].dot(q) < 0:
                q = -q
            last[pb.name] = q
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=f)
            if pb.name in ('root', 'pelvis'):
                pb.location = m.translation
                pb.keyframe_insert('location', frame=f)
    print(f'CLIP {name}: {frames} frames, {frames / 60:.3f} s, worst overreach {rig.err * 100:.1f} cm')
    return act


def clips(rig):
    out = []
    for name in ('walk', 'trot', 'gallop'):
        N = GAITS[name]['frames']
        out.append(bake(rig, name, N, lambda f, n=name, N=N: gait_spec(rig, n, f / N)))
        print('  true at', round(GAITS[name]['stride'] / (N / 60), 2), 'm/s')
    for name in ('walk', 'trot'):
        N = GAITS[name]['frames'] * 2           # (the head casts left and right over two strides)
        out.append(bake(rig, name + '_nose', N, lambda f, n=name, N=N: nose_spec(rig, n, f / N)))
    out.append(bake(rig, 'idle', 480, lambda f: idle_spec(rig, f / 60), step=4))
    out.append(bake(rig, 'bite', 44, lambda f: bite_spec(rig, f / 60)))
    out.append(bake(rig, 'die', 72, lambda f: die_spec(rig, f / 60), step=2))
    return out


def nose_spec(rig, n, ph2):
    sp = gait_spec(rig, n, (ph2 * 2) % 1, nose=True)
    c = 0.14 * sn(ph2)
    sp['fk']['neck1'] = (sp['fk']['neck1'][0], 0, c)
    sp['fk']['neck2'] = (sp['fk']['neck2'][0], 0, c)
    sp['abs']['head'] = (sp['abs']['head'][0], 0, 2 * c)
    return sp


def sheet(rig, acts, out):
    s = bpy.context.scene
    cam = camera(s, (480, 360), 1.75)
    d = Vector((1, 0, 0))
    cam.location = Vector((0, 0, 0.43)) + d * 3
    cam.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    for a in acts:
        rig.ob.animation_data.action = a
        lo, hi = a.frame_range
        if a.name == 'bite':       # (and the mouth, close to, at its widest)
            cam.data.ortho_scale, cam.location = 0.5, Vector((1.5, -0.75, 0.7)) + Vector((1, -0.5, 0)) * 0
            cam.rotation_euler = Vector((1.5, 0.4, 0.05)).to_track_quat('Z', 'Y').to_euler()
            s.frame_set(15)
            s.render.filepath = os.path.join(out, 'mouth.png')
            bpy.ops.render.render(write_still=True)
            cam.data.ortho_scale = 1.75
            cam.location = Vector((0, 0, 0.43)) + d * 3
            cam.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        for i in range(8):
            s.frame_set(int(lo + (hi - lo) * i / 8))
            s.render.filepath = os.path.join(out, f'{a.name}_{i}.png')
            bpy.ops.render.render(write_still=True)
        if a.name in GAITS:        # (every frame of the stride, for a loop to watch)
            for f in range(int(lo), int(hi)):
                s.frame_set(f)
                s.render.filepath = os.path.join(out, f'{a.name}_f{f:03}.png')
                bpy.ops.render.render(write_still=True)


def export(rig, mesh, path):
    ob = rig.ob
    ob.animation_data.action = None
    for pb in ob.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.scene.render.fps = 60
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_animations=True, export_animation_mode='ACTIONS',
                              export_skins=True, export_yup=True, export_optimize_animation_size=False,
                              export_force_sampling=False, export_image_format='AUTO')


if __name__ == '__main__':
    mesh = load_mesh()
    arm = build_armature()
    skin(mesh, arm)
    bpy.context.scene.render.fps = 60
    rig = Rig(arm)
    acts = clips(rig)
    if SHEET:
        sheet(rig, acts, SHEET)
    export(rig, mesh, OUT)
    print('WROTE', OUT, os.path.getsize(OUT))
