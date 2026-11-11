# Before rigging a new character: the checklist in tasks/lessons.md ("Rigging and animation checklist").
# A Tripo character (image-to-3D, unrigged) put on our own 24-bone skeleton, so every clip in the
# game plays on it, at a third of the cost of a rigged Meshy character. (The method from a post by
# Kensei: Tripo's mesh comes in hundreds of loose pieces, split along its seams with duplicate
# vertices; merged, it is one mesh again and can be rigged in Blender.)
#   blender -b -P tools/blender/tripo_rig.py -- <tripo.glb> <out.glb> [--turn DEG] [--sheet DIR] [--arms DEG]
# Steps:
#   1. Our guard (models-src/guard_idle.glb) gives the skeleton (in its rest A-pose) and its skin
#      weights, which Meshy tuned for these bones.
#   2. The Tripo model: every part joined, duplicate vertices merged (the loose pieces closed into
#      one mesh), turned to face the way ours do (-y in Blender), scaled to the guard's height and
#      stood where he stands. The reference picture asks for the same A-pose (arms ~30° out), or,
#      for a coat, a cape or a pack, for arms held wider (up to a T-pose: 90), given as --arms DEG:
#      the skeleton's arms are raised to match while the weights are made, so the arm's weights
#      don't bleed onto the coat's side, and the mesh is then brought down to the rest pose.
#   3. Weights copied from the guard's body to the nearest point of the new one (a soldier's body
#      is a soldier's body: the coat and boots take the weights of what's under them), at most four
#      bones a vertex, normalized.
#   4. Parented to the skeleton and written as a GLB like the others (mesh + armature, no clips),
#      for tools/prepare-models.mjs. --sheet renders the result front, side and three-quarter, posed in a stride,
#      to check the weights.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(name, default=None):
    if name in argv:
        i = argv.index(name); v = argv[i + 1]; del argv[i:i + 2]; return v
    return default
TURN = float(opt('--turn', 0))
SHEET = opt('--sheet')
ARMS = opt('--arms')
SRC, OUT = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
upd = bpy.context.view_layer.update

# ---- 1. our skeleton and weights
bpy.ops.import_scene.gltf(filepath=f'{ROOT}/models-src/guard_idle.glb')
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
guard = next(o for o in bpy.data.objects if o.type == 'MESH' and o.vertex_groups)
for o in list(bpy.data.objects):
    if o not in (arm, guard) and o.parent is None and o.type == 'MESH': bpy.data.objects.remove(o, do_unlink=True)
arm.animation_data_clear()
for pb in arm.pose.bones: pb.matrix_basis = Matrix.Identity(4)
upd()
def bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
glo, ghi = bbox(guard)

# ---- 2. the Tripo model, closed into one mesh
known = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=SRC)
parts = [o for o in bpy.data.objects if o not in known and o.type == 'MESH']
for o in [o for o in bpy.data.objects if o not in known and o.type != 'MESH']: pass
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
bpy.context.view_layer.objects.active = parts[0]
if len(parts) > 1: bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'char1'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in [o for o in bpy.data.objects if o not in known and o is not body]: bpy.data.objects.remove(o, do_unlink=True)

bm = bmesh.new(); bm.from_mesh(body.data)
def islands(bm):
    seen, n = set(), 0
    for v in bm.verts:
        if v in seen: continue
        n += 1; stack = [v]; seen.add(v)
        while stack:
            cur = stack.pop()
            for e in cur.link_edges:
                w = e.other_vert(cur)
                if w not in seen: seen.add(w); stack.append(w)
    return n
before = islands(bm)
size = max(body.dimensions)
merged = bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=size * 2e-5)
after = islands(bm)
bm.normal_update(); bm.to_mesh(body.data); bm.free()
print(f'TRIPO pieces {before} -> {after}, vertices {len(body.data.vertices)}')

# Turn to face -y (ours do), found from his feet: the toes reach out in front of the ankles, so
# the boots' lowest slice sits ahead of the slice at the ankle. (Tripo's own facing varies.)
def facing():
    zs = [v.co.z for v in body.data.vertices]; z0, h = min(zs), max(zs) - min(zs)
    sole = [v.co for v in body.data.vertices if v.co.z < z0 + 0.02 * h]
    ankle = [v.co for v in body.data.vertices if z0 + 0.06 * h < v.co.z < z0 + 0.09 * h]
    c = lambda pts: sum((Vector((p.x, p.y)) for p in pts), Vector((0, 0))) / max(1, len(pts))
    return (c(sole) - c(ankle)).normalized()
f = facing()
auto = math.degrees(math.atan2(-1, 0) - math.atan2(f.y, f.x))   # (rotate by this about z and the toes point -y)
auto = 90 * round(auto / 90)                     # (Tripo exports square to an axis; splayed feet are only a rough compass)
print('FACING', tuple(round(v, 2) for v in f), 'turn', round(auto, 1))
body.data.transform(Matrix.Rotation(math.radians(auto + TURN), 4, 'Z'))   # (on the mesh itself: no object transform to apply)
body.data.update()
print('FACING after', tuple(round(v, 2) for v in facing()))
bpy.context.view_layer.objects.active = body
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True)
lo, hi = bbox(body)
k = (ghi.z - glo.z) / (hi.z - lo.z)
body.scale = (k, k, k); bpy.ops.object.transform_apply(scale=True)
lo, hi = bbox(body)
body.location += Vector(((glo.x + ghi.x) / 2 - (lo.x + hi.x) / 2, (glo.y + ghi.y) / 2 - (lo.y + hi.y) / 2, glo.z - lo.z))
bpy.ops.object.transform_apply(location=True)
print('HEIGHT', round(bbox(body)[1].z - bbox(body)[0].z, 3), 'guard', round(ghi.z - glo.z, 3))

# --arms DEG: the model was made with its arms DEG from hanging straight down (the guard rests at
# about 33). The skeleton's arms are turned up to that about each shoulder, in the plane he faces,
# and that pose made the rest pose for as long as the weights take; afterwards (below) the arms
# come back down, taking the mesh with them, and the old rest pose is the rest pose again.
def raise_arms(sign):
    bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    M = arm.matrix_world
    for side in ('Left', 'Right'):
        pb = arm.pose.bones[side + 'Arm']
        s = M @ pb.head; h = M @ arm.pose.bones[side + 'Hand'].head
        now = math.atan2(abs(h.x - s.x), -(h.z - s.z))
        turn = (math.radians(float(ARMS)) - now) if sign > 0 else -RAISED[side]
        if sign > 0: RAISED[side] = turn
        # (about the front-to-back axis through the shoulder: the left arm, at +x, goes up with a
        #  negative turn about +y, the right with a positive one)
        R = Matrix.Translation(s) @ Matrix.Rotation(turn * (-1 if h.x > s.x else 1), 4, 'Y') @ Matrix.Translation(-s)
        pb.matrix = M.inverted() @ R @ M @ pb.matrix
        upd()
# The bones as imported are metres long (glTF has no bone lengths), and bone heat weighs by the whole
# bone: the shin's bone ran on behind the heel and stretched a strip of boot out with every stride,
# and with the arm held out level the shoulder's ran through the whole arm and took the sleeve.
# Each bone is cut to end at its nearest child (same direction and roll, so nothing changes in
# the file written: glTF keeps only where a bone starts).
bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for eb in arm.data.edit_bones:
    eb.length = min([(c.head - eb.head).length for c in eb.children if (c.head - eb.head).length > 1e-4] or [eb.length * 0.01])
bpy.ops.object.mode_set(mode='OBJECT')
RAISED = {}
if ARMS:
    raise_arms(1)
    bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.armature_apply(); bpy.ops.object.mode_set(mode='OBJECT')
    print('ARMS raised to', ARMS, {k: round(math.degrees(v), 1) for k, v in RAISED.items()})

# ---- 3. weights. First Blender's own (bone heat: each bone weighs what it can "see" nearby, so the
# side of a coat goes with the chest, not with the arm hanging next to it), which needs the mesh in
# one closed piece, hence the merge. Where heat fails (vertices left without weight), the guard's
# weights copied from the nearest point of his body fill in.
WEIGHTS = opt('--weights', 'auto')
if WEIGHTS == 'auto':
    bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    try: bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    except RuntimeError as e: print('HEAT failed:', e)
    body.parent = None
    for m in list(body.modifiers): body.modifiers.remove(m)
    bpy.context.view_layer.objects.active = body
    bare = [v.index for v in body.data.vertices if not any(g.weight > 1e-4 for g in v.groups)]
    print('HEAT unweighted', len(bare), 'of', len(body.data.vertices))
    if len(bare) > 0.02 * len(body.data.vertices): WEIGHTS = 'copy'
if WEIGHTS == 'copy':
    for g in list(body.vertex_groups): body.vertex_groups.remove(g)
for g in guard.vertex_groups:
    if g.name not in body.vertex_groups: body.vertex_groups.new(name=g.name)
if WEIGHTS == 'copy':
    mod = body.modifiers.new('weights', 'DATA_TRANSFER')
    mod.object = guard
    mod.use_vert_data = True
    mod.data_types_verts = {'VGROUP_WEIGHTS'}
    mod.vert_mapping = 'POLYINTERP_NEAREST'
    mod.layers_vgroup_select_src = 'ALL'
    mod.layers_vgroup_select_dst = 'NAME'
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
print('WEIGHTS', WEIGHTS)
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
# --rigid-back D: whatever stands more than D metres behind the upper spine (a pack, the
# flamethrower's fuel tanks) is carried rigidly by the spine; bone heat gave the tanks by the
# shoulders to the arms, and a raised arm bent the tank with it.
RIGID = opt('--rigid-back')
if RIGID:
    sp = arm.matrix_world @ arm.data.bones['Spine02'].head_local
    hips = arm.matrix_world @ arm.data.bones['Hips'].head_local
    la = arm.matrix_world @ arm.data.bones['LeftArm'].head_local       # (only between the shoulders:
    half = abs(la.x - sp.x) + 0.04                                       #  the back of a sleeve stays the arm's)
    back = [v for v in body.data.vertices if v.co.y > sp.y + float(RIGID) and v.co.z > hips.z and abs(v.co.x - sp.x) < half]
    gi = body.vertex_groups['Spine02'].index
    for v in back:
        for g in list(v.groups): body.vertex_groups[g.group].remove([v.index])
        body.vertex_groups[gi].add([v.index], 1.0, 'REPLACE')
    print('RIGID back', len(back), 'vertices on Spine02')
if ARMS:      # back down to the guard's rest pose, the mesh carried along by its new weights
    raise_arms(-1)
    am = body.modifiers.new('down', 'ARMATURE'); am.object = arm
    bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=am.name)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.armature_apply(); bpy.ops.object.mode_set(mode='OBJECT')
unweighted = sum(1 for v in body.data.vertices if not any(g.weight > 0 for g in v.groups))
print('UNWEIGHTED', unweighted)

# ---- 4. on the skeleton, and out
bpy.data.objects.remove(guard, do_unlink=True)
# The skeleton works in centimetres (the armature is scaled 0.01, as Meshy made it), and glTF
# skinning ignores the mesh object's own transform: so the vertices themselves go into the
# armature's space, with the mesh object sitting at identity under it, as in Meshy's files.
# (Parented with its world transform kept, it came out 100 times too big in the game.)
body.data.transform(arm.matrix_world.inverted() @ body.matrix_world)
body.data.update()
body.parent = arm
body.matrix_parent_inverse = Matrix.Identity(4)
body.matrix_basis = Matrix.Identity(4)
am = body.modifiers.new('Armature', 'ARMATURE'); am.object = arm

if SHEET:
    os.makedirs(SHEET, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x, sc.render.resolution_y = 360, 480
    w = bpy.data.worlds.new('w'); sc.world = w; w.color = (0.78, 0.8, 0.82)
    cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.3
    P = arm.pose.bones
    def stride(s):        # a walking pose and a raised arm, to see the weights bend
        for pb in P: pb.matrix_basis = Matrix.Identity(4)
        if s:
            P['LeftUpLeg'].rotation_mode = P['RightUpLeg'].rotation_mode = P['LeftLeg'].rotation_mode = 'XYZ'
            P['RightArm'].rotation_mode = P['LeftForeArm'].rotation_mode = 'XYZ'
            P['LeftUpLeg'].rotation_euler = (math.radians(-30), 0, 0); P['RightUpLeg'].rotation_euler = (math.radians(25), 0, 0)
            P['LeftLeg'].rotation_euler = (math.radians(35), 0, 0)
            P['RightArm'].rotation_euler = (0, 0, math.radians(-60)); P['LeftForeArm'].rotation_euler = (math.radians(-50), 0, 0)
        upd()
    for i, s in enumerate((False, True)):
        stride(s)
        # (three-quarter too: front and side can both look right over an arm that is crooked)
        for view, loc, r in (('front', (0, -5, 0.9), (math.pi / 2, 0, 0)), ('side', (-5, 0, 0.9), (math.pi / 2, 0, -math.pi / 2)),
                             ('quarter', (-3.54, -3.54, 0.9), (math.pi / 2, 0, -math.pi / 4))):
            cam.location = loc; cam.rotation_euler = r
            sc.render.filepath = f'{SHEET}/{os.path.basename(OUT)[:-4]}_{view}_{i}.png'
            bpy.ops.render.render(write_still=True)
    stride(False)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=False, export_skins=True, export_yup=True)
print('WROTE', OUT)
