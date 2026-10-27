# The architecture kit: the dressing that turns the game's box-built houses into Italian ones
# (run: blender -b -P tools/blender/architecture.py -- <out dir (public/models)>).
# Writes arch_kit.glb, one mesh per part, each modelled at 1 m along the axis the game stretches it
# on (see src/world/arch.js), with the stone chamfered (a bevel catches the light where a box doesn't):
#   win_sill, win_lintel (stretched along x), win_jamb (along y), win_casement, win_glass (1 x 1),
#   shutter (1 x 1, a louvred persiana hinged on its x = 0 edge), door_jamb, door_lintel (keystone),
#   eave (1 m of cornice: a moulding, rafter tails and the tile ends), ridge (1 m of ridge tiles),
#   plinth (1 m of the stone base), quoin (one storey of corner stones), chimney, balcony, pipe.
# Coordinates as the game sees them: x along the wall, y up, +z out of the wall (its face at z = 0);
# an opening's part has its origin at the bottom centre of the opening.
# Colours are vertex colours (the game makes one material per part's material name: stone, wood,
# frame, glass, tile, iron) with a little variation per block.
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix

OUT = sys.argv[-1]
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
rng = random.Random(7)


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def jitter(c, k=0.06):
    f = 1 + (rng.random() * 2 - 1) * k
    return [min(1, x * f) for x in c]


G2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # game (x, y up, z out) -> Blender (x, -z, y)


class Part:
    """Polygons in game coordinates, with a colour per polygon."""
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')

    def paint(self, faces, color):
        for f in faces:
            for l in f.loops: l[self.col] = (*color, 1.0)

    def box(self, x0, x1, y0, y1, z0, z1, color, rot=None, pivot=(0, 0, 0), skip=('back',)):
        """An axis-aligned box (then turned by `rot`, a Matrix, about `pivot`). skip: faces left out,
        by the way they look (back: into the wall, never seen; bottom, top, left, right, front)."""
        r = bmesh.ops.create_cube(self.bm, size=1)
        vs = r['verts']
        for v in vs:
            v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0), (z0 + z1) / 2 + v.co.z * (z1 - z0)))
        faces = list({f for v in vs for f in v.link_faces})
        dirs = {'back': (0, 0, -1), 'front': (0, 0, 1), 'bottom': (0, -1, 0), 'top': (0, 1, 0), 'left': (-1, 0, 0), 'right': (1, 0, 0)}
        drop = []
        for f in faces:
            f.normal_update()
            if any(f.normal.dot(Vector(dirs[k])) > 0.9 for k in skip): drop.append(f)
        bmesh.ops.delete(self.bm, geom=drop, context='FACES_ONLY')
        faces = [f for f in faces if f not in drop]
        if rot:
            for v in vs:
                if v.is_valid: v.co = rot @ (v.co - Vector(pivot)) + Vector(pivot)
        self.paint(faces, color)
        return faces

    def quad(self, pts, color):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        self.paint([f], color)
        return f

    def profile(self, pts, x0, x1, color, caps=True):
        """A moulding: the (y, z) outline `pts` (from the wall out and back) swept along x. caps:
        close its ends (not needed on a run that's laid end to end)."""
        n = len(pts)
        a = [self.bm.verts.new((x0, y, z)) for y, z in pts]
        b = [self.bm.verts.new((x1, y, z)) for y, z in pts]
        fs = [self.bm.faces.new((a[i], a[i + 1], b[i + 1], b[i])) for i in range(n - 1)]
        if caps:
            fs.append(self.bm.faces.new(list(reversed(a))))
            fs.append(self.bm.faces.new(b))
        self.paint(fs, color)
        return fs

    def cylinder(self, c, r, length, axis, color, segs=8, half=False):
        """A cylinder (or its upper half) of radius r along `axis` ('x' or 'y') from c."""
        ring = []
        n = segs if not half else segs // 2
        for i in range(n + 1 if half else n):
            t = (math.pi * i / n) if half else 2 * math.pi * i / n
            ring.append((math.cos(t) * r, math.sin(t) * r))
        def at(u, s):
            if axis == 'x': return Vector((c[0] + s, c[1] + u[1], c[2] + u[0]))
            return Vector((c[0] + u[0], c[1] + s, c[2] + u[1]))
        a = [self.bm.verts.new(at(u, 0)) for u in ring]
        b = [self.bm.verts.new(at(u, length)) for u in ring]
        m = len(ring)
        fs = []
        for i in range(m - 1 if half else m):
            j = (i + 1) % m
            fs.append(self.bm.faces.new((a[i], b[i], b[j], a[j])))
        if not half:
            fs.append(self.bm.faces.new(list(reversed(a)))); fs.append(self.bm.faces.new(b))
        self.paint(fs, color)
        return fs

    def obj(self, name, mat, bevel=0.0):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(name)
        self.bm.transform(G2B)
        self.bm.to_mesh(me)
        self.bm.free()
        me.color_attributes.active_color_name = 'Col'        # (or the exporter writes plain white)
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.append(material(mat))
        if bevel:
            m = ob.modifiers.new('bevel', 'BEVEL')
            m.width = bevel; m.segments = 1; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(40)
            m.harden_normals = True
        return ob


MATS = {}
def material(name):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'Col'
    nt.links.new(ca.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = {'glass': 0.15, 'iron': 0.6}.get(name, 0.9)
    bsdf.inputs['Metallic'].default_value = {'glass': 0.3, 'iron': 0.4}.get(name, 0.0)
    MATS[name] = m
    return m


STONE = srgb(0xb3a68b)      # pietra serena / travertine dressing (taken down for the game's sun)
BASE = srgb(0x8e8270)       # the weathered base course
TILE = srgb(0xa65a3b)       # terracotta
WOOD = srgb(0xe8e8e8)       # shutters: painted, tinted per house in the game
FRAME = srgb(0xbdb4a2)      # casements: old white paint
GLASS = srgb(0x1a2025)
IRON = srgb(0x262625)
parts = []
# Kept lean: a town has a thousand windows. No face against the wall, single-sided louvres and
# railings (the game draws those materials from both sides), and bevels only where they catch the eye.

# ---- windows ----
p = Part()                                    # the sill: a slab proud of the wall
p.box(-0.5, 0.5, -0.07, 0, -0.03, 0.11, jitter(STONE))
parts.append(p.obj('win_sill', 'stone', 0.012))

p = Part()                                    # the lintel, with a thin cornice on top
p.box(-0.5, 0.5, 0, 0.14, -0.02, 0.045, jitter(STONE), skip=('back', 'bottom'))
p.profile([(0.14, -0.02), (0.14, 0.06), (0.19, 0.085), (0.19, -0.02)], -0.52, 0.52, jitter(STONE))
parts.append(p.obj('win_lintel', 'stone'))

p = Part()                                    # a jamb of the surround (0.12 wide)
p.box(-0.06, 0.06, 0, 1, -0.02, 0.035, jitter(STONE), skip=('back', 'top', 'bottom'))
parts.append(p.obj('win_jamb', 'stone'))

p = Part()                                    # the casement: frame, mullion and two transoms (1 x 1)
for x0, x1, y0, y1 in ((-0.5, -0.45, 0, 1), (0.45, 0.5, 0, 1), (-0.5, 0.5, 0, 0.06), (-0.5, 0.5, 0.94, 1),
                       (-0.022, 0.022, 0, 1), (-0.5, 0.5, 0.64, 0.675), (-0.5, 0.5, 0.31, 0.335)):
    p.quad([(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)], jitter(FRAME, 0.03))
parts.append(p.obj('win_casement', 'frame'))

p = Part()
p.quad([(-0.5, 0, -0.025), (0.5, 0, -0.025), (0.5, 1, -0.025), (-0.5, 1, -0.025)], GLASS)
parts.append(p.obj('win_glass', 'glass'))

p = Part()                                    # a louvred shutter, hinged at x = 0, 1 wide and 1 tall
for x0, x1, y0, y1 in ((0, 0.08, 0, 1), (0.92, 1, 0, 1), (0.08, 0.92, 0, 0.07), (0.08, 0.92, 0.93, 1), (0.08, 0.92, 0.47, 0.53)):
    p.quad([(x0, y0, 0.04), (x1, y0, 0.04), (x1, y1, 0.04), (x0, y1, 0.04)], WOOD)
tilt = Matrix.Rotation(math.radians(-40), 3, 'X')
for y0, y1 in ((0.07, 0.47), (0.53, 0.93)):
    n = 6
    for i in range(n):
        yc = y0 + (i + 0.5) * (y1 - y0) / n
        h = (y1 - y0) / n * 0.95
        pts = [Vector((0.08, -h / 2, 0)), Vector((0.92, -h / 2, 0)), Vector((0.92, h / 2, 0)), Vector((0.08, h / 2, 0))]
        p.quad([tilt @ q + Vector((0, yc, 0.022)) for q in pts], [c * 0.9 for c in WOOD])
parts.append(p.obj('shutter', 'wood'))

# ---- doors ----
p = Part()                                    # a door jamb (0.2 wide, a step out from the wall)
p.box(-0.1, 0.1, 0.12, 1, -0.02, 0.06, jitter(STONE), skip=('back', 'bottom', 'top'))
p.box(-0.13, 0.13, 0, 0.12, -0.02, 0.09, jitter(STONE, 0.1), skip=('back', 'bottom'))   # its plinth block
parts.append(p.obj('door_jamb', 'stone', 0.012))

p = Part()                                    # the lintel over a door, with its keystone
p.box(-0.5, 0.5, 0, 0.26, -0.02, 0.06, jitter(STONE))
p.box(-0.09, 0.09, -0.04, 0.3, -0.02, 0.1, jitter(STONE, 0.1))
p.profile([(0.26, -0.02), (0.26, 0.08), (0.32, 0.11), (0.32, -0.02)], -0.55, 0.55, jitter(STONE))
parts.append(p.obj('door_lintel', 'stone', 0.012))

# ---- roofs ----
p = Part()                                    # 1 m of eave: a moulded cornice and two rafter tails
p.profile([(0.0, -0.01), (0.0, 0.04), (0.06, 0.07), (0.1, 0.14), (0.16, 0.16), (0.16, -0.01)], 0, 1, jitter(STONE, 0.03), caps=False)
for x in (0.25, 0.75):                         # the rafter tails (mensole)
    p.box(x - 0.045, x + 0.045, 0.16, 0.26, -0.01, 0.48, jitter(srgb(0x5e4a38), 0.08), skip=('back', 'top'))
p.box(0, 1, 0.26, 0.29, -0.01, 0.5, jitter(srgb(0x8a7258), 0.05), skip=('back', 'top', 'left', 'right'))   # the boards over them
parts.append(p.obj('eave', 'stone'))

p = Part()                                    # 1 m of ridge: three overlapping coppi
for i in range(3):
    p.cylinder((i / 3 - 0.01, 0.0, 0.0), 0.12 + 0.012 * (i % 2), 0.36, 'x', jitter(TILE, 0.14), segs=10, half=True)
parts.append(p.obj('ridge', 'tile'))

p = Part()                                    # the stone base course (0.7 tall): two courses and a chamfered top
p.profile([(0.0, 0.05), (0.34, 0.05), (0.35, 0.04)], 0, 1, jitter(BASE, 0.03), caps=False)
p.profile([(0.35, 0.04), (0.36, 0.05), (0.7, 0.05), (0.74, 0.0)], 0, 1, [c * 1.08 for c in BASE], caps=False)
parts.append(p.obj('plinth', 'stone'))

p = Part()                                    # one storey (1.6 m) of quoins: long and short blocks turn the corner
for i, (y0, y1) in enumerate(((0, 0.38), (0.4, 0.78), (0.8, 1.18), (1.2, 1.58))):
    lx, lz = (0.62, 0.32) if i % 2 == 0 else (0.32, 0.62)
    c = jitter(STONE, 0.08)
    p.box(-lx, 0.04, y0, y1, -0.0, 0.04, c, skip=('back', 'right'))   # on the face looking +z (the corner at x = 0)
    p.box(0.0, 0.04, y0, y1, -lz, 0.0, c, skip=('left', 'front'))    # and on the face looking +x
parts.append(p.obj('quoin', 'stone'))

p = Part()                                    # a chimney: plastered stack, a tile cap on brick piers
STUCCO = srgb(0xb09d80)
p.box(-0.32, 0.32, 0, 1.3, -0.32, 0.32, jitter(STUCCO), skip=('bottom',))
p.box(-0.38, 0.38, 1.3, 1.38, -0.38, 0.38, jitter(STONE), skip=())
for sx in (-0.26, 0.26):
    for sz in (-0.26, 0.26): p.box(sx - 0.06, sx + 0.06, 1.38, 1.62, sz - 0.06, sz + 0.06, jitter(srgb(0x8c4f35), 0.1), skip=('top', 'bottom'))
p.box(-0.44, 0.44, 1.62, 1.68, -0.44, 0.44, jitter(STONE), skip=())
for sz in (-0.18, 0.18): p.cylinder((-0.46, 1.72, sz), 0.13, 0.92, 'x', jitter(TILE, 0.1), segs=8, half=True)
parts.append(p.obj('chimney', 'stone'))

p = Part()                                    # a balcony: a stone slab on corbels, a wrought-iron rail
p.box(-0.8, 0.8, -0.12, 0, 0, 0.62, jitter(STONE))
for sx in (-0.6, 0, 0.6): p.box(sx - 0.07, sx + 0.07, -0.42, -0.12, 0, 0.45, jitter(STONE), skip=('back', 'top'))
r = Part()
for y in (0.08, 0.92): r.quad([(-0.78, y, 0.6), (0.78, y, 0.6), (0.78, y + 0.035, 0.6), (-0.78, y + 0.035, 0.6)], IRON)
for x in [-0.78 + i * 0.104 for i in range(16)]:
    r.quad([(x - 0.01, 0.08, 0.6), (x + 0.01, 0.08, 0.6), (x + 0.01, 0.92, 0.6), (x - 0.01, 0.92, 0.6)], IRON)
for sx in (-0.78, 0.78):
    for y in (0.08, 0.92): r.quad([(sx, y, 0), (sx, y, 0.6), (sx, y + 0.035, 0.6), (sx, y + 0.035, 0)], IRON)
    for zz in [0.1 * i for i in range(1, 6)]: r.quad([(sx, 0.08, zz - 0.01), (sx, 0.92, zz - 0.01), (sx, 0.92, zz + 0.01), (sx, 0.08, zz + 0.01)], IRON)
parts.append(p.obj('balcony', 'stone'))
parts.append(r.obj('railing', 'iron'))

p = Part()                                    # 1 m of downpipe, with a bracket
p.cylinder((0, 0, 0.09), 0.05, 1.0, 'y', jitter(srgb(0x63676a), 0.05), segs=6)
p.box(-0.065, 0.065, 0.45, 0.5, 0, 0.12, IRON)
parts.append(p.obj('pipe', 'iron'))

bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
path = os.path.join(OUT, 'arch_kit.glb')
kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
try: bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
except TypeError: bpy.ops.export_scene.gltf(**kw)
print('wrote', path, sum(len(o.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.polygons) for o in parts), 'faces')
for o in parts:
    print(' ', o.name, len(o.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.polygons))
