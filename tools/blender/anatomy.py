# The inside of a soldier for the X-ray kill cam (run: blender -b -P tools/blender/anatomy.py -- <out dir>).
# Writes anatomy.glb, one mesh per part, each at real size in metres with its origin where
# src/world/anatomy.js hangs it on the body's hit frames; the game scales each to the body it's in:
#   skull, jaw, brain, vertebra, rib_pair, sternum, clavicle, scapula, pelvis, long_bone (1 m long,
#   0.02 m shaft radius: stretched to each limb), heart, lung (the soldier's right; mirrored for the
#   left), liver, stomach, kidney, intestines (each fitting in a 1 m sphere: scaled to its organ).
# Axes as the game sees them: x to the soldier's left, y up (along a limb), z forward.
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix, noise

OUT = sys.argv[-1]
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
rng = random.Random(3)
G = lambda x, y, z: Vector((x, -z, y))          # game (x, y up, z forward) -> Blender (x, -z, y)
parts = []


def active(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def apply_all(o):
    active(o)
    if o.type != 'MESH': bpy.ops.object.convert(target='MESH')
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    return o


def join(objs, name):
    for o in objs: apply_all(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    return o


def sphere(c, r, scale=(1, 1, 1), segs=24, rings=16):
    """An ellipsoid at game point c with game radii r * scale."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=r, location=G(*c))
    o = bpy.context.object
    o.scale = (scale[0], scale[2], scale[1])
    return o


def tube(points, radii, name='tube', res=6, profile=8):
    """A smooth bevelled curve through game points, its thickness following radii."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = 1.0; cu.bevel_resolution = max(1, profile // 4); cu.resolution_u = res
    cu.use_fill_caps = True
    sp = cu.splines.new('NURBS'); sp.points.add(len(points) - 1)
    for p, (pt, r) in zip(sp.points, zip(points, radii)):
        p.co = (*G(*pt), 1); p.radius = r
    sp.use_endpoint_u = True; sp.order_u = min(4, len(points))
    o = bpy.data.objects.new(name, cu); sc.collection.objects.link(o)
    return o


def boolean(o, cutter, op='DIFFERENCE'):
    m = o.modifiers.new('b', 'BOOLEAN'); m.operation = op; m.object = cutter; m.solver = 'EXACT'
    apply_all(o)
    bpy.data.objects.remove(cutter)


def smooth(o, levels=1, shade=True):
    m = o.modifiers.new('s', 'SUBSURF'); m.levels = levels; m.render_levels = levels
    apply_all(o)
    if shade:
        for p in o.data.polygons: p.use_smooth = True


def bumpy(o, strength, size, kind='CLOUDS'):
    t = bpy.data.textures.new('t', kind); t.noise_scale = size
    m = o.modifiers.new('d', 'DISPLACE'); m.texture = t; m.strength = strength; m.mid_level = 0.5
    apply_all(o)


def done(o, name):
    o.name = name
    apply_all(o)
    for p in o.data.polygons: p.use_smooth = True
    parts.append(o)
    return o


# ---- the head: origin at the cranium's centre (the old skull sphere's centre) ----
cran = sphere((0, 0.005, -0.008), 0.092, (0.8, 0.86, 1.0), 32, 20)
face = sphere((0, -0.045, 0.045), 0.06, (0.95, 0.85, 0.75), 24, 16)        # the face below the brow
boolean(cran, face, 'UNION')                 # (a union, not a join: the cuts below need one closed surface)
sk = cran
smooth(sk, 1)
for s in (-1, 1):                                                          # the orbits
    boolean(sk, sphere((s * 0.032, -0.022, 0.088), 0.023, (1, 0.85, 1)))
boolean(sk, sphere((0, -0.06, 0.098), 0.012, (0.8, 1.5, 1)))               # the nose
for s in (-1, 1):                                                          # the cheekbones' hollows behind
    boolean(sk, sphere((s * 0.075, -0.05, 0.03), 0.026, (0.7, 1, 1.3)))
teeth = [sphere((math.sin(a) * 0.036, -0.093, 0.04 + math.cos(a) * 0.04), 0.0065, (0.9, 1.4, 0.8), 8, 6) for a in [(-1.1 + 2.2 * i / 11) for i in range(12)]]
sk = join([sk] + teeth, 'skull')
done(sk, 'skull')

jaw_pts = [(-0.05, 0.02, -0.0), (-0.052, -0.02, 0.005), (-0.04, -0.035, 0.04), (0, -0.04, 0.07), (0.04, -0.035, 0.04), (0.052, -0.02, 0.005), (0.05, 0.02, -0.0)]
jaw = tube(jaw_pts, [0.006, 0.009, 0.01, 0.011, 0.01, 0.009, 0.006], 'jaw')
jteeth = [sphere((math.sin(a) * 0.034, -0.026, 0.03 + math.cos(a) * 0.038), 0.0055, (0.9, 1.4, 0.8), 8, 6) for a in [(-1.0 + 2.0 * i / 9) for i in range(10)]]
done(join([jaw] + jteeth, 'jaw'), 'jaw')       # origin: the jaw's place in the head frame (0, -0.05, 0.035) is added in the game

brain = sphere((0, 0, 0), 0.07, (0.86, 0.78, 1.1), 48, 32)
bumpy(brain, 0.006, 0.012, 'VORONOI')
boolean(brain, sphere((0, 0.07, 0), 0.0035, (1, 20, 30)))                  # the fissure between the halves
done(brain, 'brain')

# ---- the spine: one vertebra (about 4.5 cm across), body forward, spine out the back ----
body = sphere((0, 0, 0.0), 0.02, (1.1, 0.8, 0.9), 16, 10)
arch = tube([(-0.016, 0, -0.012), (0, 0, -0.026), (0.016, 0, -0.012)], [0.004, 0.005, 0.004], 'arch')
spinous = tube([(0, 0, -0.024), (0, -0.01, -0.045)], [0.0045, 0.003], 'sp')
trans = tube([(-0.034, 0, -0.018), (0, 0, -0.022), (0.034, 0, -0.018)], [0.003, 0.004, 0.003], 'tr')
done(join([body, arch, spinous, trans], 'vertebra'), 'vertebra')

# ---- a pair of ribs: from the spine at the back, round and down to the front, then cartilage ----
def rib_side(s, w=0.15, drop=0.05):
    pts, rad = [], []
    for i in range(9):
        t = i / 8
        a = math.pi * (1 - t) * 0.95 + 0.04
        pts.append((s * math.sin(a) * w * (1.0 - 0.08 * t), -drop * t * t + 0.012 * math.sin(t * math.pi), -math.cos(a) * 0.105 - 0.005))
        rad.append(0.0065 if t < 0.85 else 0.005)
    return tube(pts, rad, 'rib', res=4, profile=6)
done(join([rib_side(1), rib_side(-1)], 'rib_pair'), 'rib_pair')

st = tube([(0, 0.1, 0.1), (0, 0.02, 0.105), (0, -0.08, 0.1)], [0.014, 0.012, 0.007], 'sternum')
st.scale = (1, 0.4, 1)
done(st, 'sternum')

done(tube([(0, 0, 0), (0.04, 0.0, 0.015), (0.08, 0.004, 0.0), (0.11, 0.0, -0.02)], [0.0075, 0.007, 0.007, 0.008], 'clavicle'), 'clavicle')   # from the sternum outward (+x); mirrored on the right

sc_ = bmesh.new()
pts = [G(-0.05, 0.06, 0), G(0.045, 0.055, 0), G(0.035, -0.07, 0)]
vs = [sc_.verts.new(p) for p in pts]
f = sc_.faces.new(vs)
r = bmesh.ops.extrude_face_region(sc_, geom=[f])
for v in [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]: v.co += Vector((0, 0.006, 0))
me = bpy.data.meshes.new('scapula'); sc_.to_mesh(me); sc_.free()
scap = bpy.data.objects.new('scapula', me); sc.collection.objects.link(scap)
smooth(scap, 2)
spine_s = tube([(-0.045, 0.035, -0.004), (0.045, 0.045, -0.012)], [0.004, 0.006], 'sspine')
done(join([scap, spine_s], 'scapula'), 'scapula')

# ---- the pelvis: two wings, the sacrum, the pubic arch and the hip sockets ----
wings = []
for s in (-1, 1):
    w = sphere((s * 0.085, 0.02, -0.005), 0.065, (0.55, 0.85, 0.28), 20, 12)
    w.rotation_euler = (math.radians(-15), math.radians(s * 25), 0)
    wings.append(w)
sac = sphere((0, -0.0, -0.045), 0.04, (0.8, 1.1, 0.4), 16, 10)
arch = tube([(-0.075, -0.035, 0.0), (-0.035, -0.06, 0.05), (0, -0.065, 0.06), (0.035, -0.06, 0.05), (0.075, -0.035, 0.0)], [0.012, 0.01, 0.009, 0.01, 0.012], 'pubis')
sockets = [sphere((s * 0.1, -0.035, 0.0), 0.022, (1, 1, 1), 12, 8) for s in (-1, 1)]
pel = join(wings + [sac, arch] + sockets, 'pelvis')
done(pel, 'pelvis')

# ---- a long bone: 1 m along y, centred; a shaft (0.02 radius) with knobbed ends ----
shaft = tube([(0, -0.5, 0), (0, 0, 0.004), (0, 0.5, 0)], [0.02, 0.017, 0.02], 'shaft', res=8, profile=8)
heads = [sphere((0, 0.47, 0), 0.032, (1, 0.9, 0.9), 14, 10), sphere((-0.012, -0.47, 0), 0.026, (1.3, 0.8, 0.9), 14, 10), sphere((0.012, -0.47, 0), 0.026, (1.3, 0.8, 0.9), 14, 10)]
done(join([shaft] + heads, 'long_bone'), 'long_bone')

# ---- organs: each fits a 1 m sphere (the game scales it to the organ's size) ----
h = sphere((0, -0.05, 0), 0.75, (0.85, 1.0, 0.8), 32, 20)               # the heart, its apex down and to the left
h.rotation_euler = (0, math.radians(25), math.radians(20))
aorta = tube([(0.05, 0.4, 0.0), (0.1, 0.95, 0.05), (-0.1, 1.0, -0.15), (-0.2, 0.7, -0.3)], [0.17, 0.17, 0.15, 0.13], 'aorta')
pulm = tube([(-0.15, 0.35, 0.2), (-0.25, 0.85, 0.15), (-0.55, 0.85, 0.0)], [0.15, 0.14, 0.11], 'pulm')
heart = join([h, aorta, pulm], 'heart')
bumpy(heart, 0.04, 0.35)
done(heart, 'heart')

lung = sphere((0, 0, 0), 0.9, (0.6, 1.05, 0.75), 32, 20)                 # the right lung: rounded outside, hollowed for the heart inside
boolean(lung, sphere((-0.75, -0.25, 0.25), 0.55, (1, 1.2, 1)))
for y in (0.15, -0.35):                                                  # the fissures between its lobes
    boolean(lung, sphere((0.2, y, 0.0), 1.2, (1, 0.012, 1)))
bumpy(lung, 0.03, 0.3)
done(lung, 'lung')

liver = sphere((0, 0, 0), 0.9, (1.0, 0.5, 0.7), 32, 16)                 # a wedge: thick on the right, tapering left
bm_ = bmesh.new(); bm_.from_mesh(liver.data)
for v in bm_.verts:
    gx = v.co.x
    v.co.z *= 1.0 - 0.45 * max(0, gx / 0.9)                                # (Blender z is the game's up)
    v.co.y *= 1.0 - 0.3 * max(0, gx / 0.9)
bm_.to_mesh(liver.data); bm_.free()
done(liver, 'liver')

stomach = tube([(-0.5, 0.65, -0.1), (-0.2, 0.4, 0.05), (0.15, 0.1, 0.15), (0.35, -0.35, 0.1), (0.05, -0.6, 0.05), (-0.45, -0.45, 0.0)], [0.22, 0.38, 0.45, 0.4, 0.3, 0.18], 'stomach', res=10, profile=12)
done(stomach, 'stomach')

kid = sphere((0, 0, 0), 0.9, (0.6, 1.0, 0.45), 24, 16)                  # a bean: its notch toward the spine
boolean(kid, sphere((-0.65, 0, 0), 0.35, (1, 1.2, 1)))
done(kid, 'kidney')

# The intestines: the small bowel as a long coiled tube in a mass, the colon framing it.
coil, rad = [], []
for i in range(140):
    t = i / 139
    a = t * 2 * math.pi * 9
    rr = 0.25 + 0.4 * (0.5 + 0.5 * math.sin(t * 2 * math.pi * 3.1))
    coil.append((math.cos(a) * rr * 0.95, 0.45 - 0.9 * t + 0.08 * math.sin(a * 0.5), math.sin(a) * rr * 0.5 + 0.1))
    rad.append(0.085)
small = tube(coil, rad, 'small', res=3, profile=6)
colon = tube([(-0.8, -0.6, 0.0), (-0.85, 0.55, 0.05), (0, 0.65, 0.2), (0.85, 0.55, 0.05), (0.8, -0.55, 0.0), (0.3, -0.75, -0.1)], [0.16, 0.17, 0.17, 0.17, 0.16, 0.14], 'colon', res=8, profile=8)
done(join([small, colon], 'intestines'), 'intestines')

# ---- export ----
mat = bpy.data.materials.new('anatomy')
for o in parts:
    o.data.materials.clear(); o.data.materials.append(mat)
    active(o)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')      # (origins stay at the world origin: positions are as modelled)
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
path = os.path.join(OUT, 'anatomy.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_normals=True)
for o in parts: print(' ', o.name, len(o.data.polygons))
print('wrote', path, sum(len(o.data.polygons) for o in parts), 'faces')
