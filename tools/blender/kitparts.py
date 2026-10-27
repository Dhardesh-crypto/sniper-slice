# Shared by the kit scripts (architecture.py, interior.py): parts built as polygons in the game's
# axes (x along a wall, y up, +z out of it), coloured per polygon, exported as one GLB of named meshes.
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix

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

    def blob(self, c, r, color, scale=(1, 1, 1), segs=8, rings=5):
        """An ellipsoid (a sack, a bottle's body, a flower head) at c, radius r times scale."""
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=r)
        for v in res['verts']: v.co = Vector((c[0] + v.co.x * scale[0], c[1] + v.co.z * scale[1], c[2] + v.co.y * scale[2]))
        faces = list({f for v in res['verts'] for f in v.link_faces})
        self.paint(faces, color)
        return faces

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
    bsdf.inputs['Roughness'].default_value = {'glass': 0.15, 'iron': 0.6, 'brass': 0.35, 'ceramic': 0.3}.get(name, 0.9)
    bsdf.inputs['Metallic'].default_value = {'glass': 0.3, 'iron': 0.4, 'brass': 0.85}.get(name, 0.0)
    MATS[name] = m
    return m


def export(parts, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
    try: bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
    except TypeError: bpy.ops.export_scene.gltf(**kw)
    dg = bpy.context.evaluated_depsgraph_get()
    print('wrote', path, sum(len(o.evaluated_get(dg).data.polygons) for o in parts), 'faces')
    for o in parts: print(' ', o.name, len(o.evaluated_get(dg).data.polygons))
