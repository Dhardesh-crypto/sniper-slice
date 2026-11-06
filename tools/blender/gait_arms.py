# Free-swinging arms for the player's gaits, from numbers: the legs and spine of each clip stay as
# they are, the arms are solved against the chest, opposite the legs and the same on both sides.
#   blender -b -P tools/blender/gait_arms.py -- <out dir> [--sheet dir] [clip ...]
# Writes <out dir>/<clip>.arms.json (each arm bone's local rotation per key, glTF order x y z w);
# node tools/set-gait-arms.mjs puts them in the clips, so nothing else in a clip is touched.
# --sheet renders one cycle on his real model from a locked side and front camera.
import bpy, json, math, os, sys
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SHEET = None
if '--sheet' in argv:
    i = argv.index('--sheet'); SHEET = argv[i + 1]; del argv[i:i + 2]
OUT = argv[0]

# Degrees. swing: upper arm from the chest's vertical, + forward, (back, forward); flex: elbow bend
# from straight, at the back and front of the swing; out: arm from the body's side; cross: the
# forearm's turn in toward the middle; lag: how far the arm trails the opposite leg, in cycles.
GAITS = {
    'anim_walk_free': dict(swing=(-20, 16), flex=(14, 32), out=9, cross=8, lag=0.04, clavicle=2),
    'anim_jog': dict(swing=(-36, 15), flex=(72, 96), out=10, cross=6, lag=0.03, clavicle=4),
    'anim_run': dict(swing=(-50, 24), flex=(80, 106), out=10, cross=8, lag=0.02, clavicle=6),
}
CLIPS = argv[1:] or list(GAITS)

def scene_for(clip):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f'{ROOT}/models-src/player_idle.glb', bone_heuristic='BLENDER')
    body = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{ROOT}/models-src/{clip}.glb', bone_heuristic='BLENDER')
    src = next(o for o in set(bpy.data.objects) - before if o.type == 'ARMATURE')
    action = src.animation_data.action
    slot = src.animation_data.action_slot if hasattr(src.animation_data, 'action_slot') else None
    body.animation_data_clear()
    body.animation_data_create()
    body.animation_data.action = action
    if slot is not None: body.animation_data.action_slot = slot
    for o in set(bpy.data.objects) - before: bpy.data.objects.remove(o, do_unlink=True)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and not o.parent: bpy.data.objects.remove(o, do_unlink=True)
    for pb in body.pose.bones: pb.rotation_mode = 'QUATERNION'
    return body, action

def rot(m): return m.to_quaternion()
def along(axis, deg): return Quaternion(axis, math.radians(deg))

def solve(clip):
    g = GAITS[clip]
    body, action = scene_for(clip)
    P = body.pose.bones
    f0, f1 = (int(round(x)) for x in action.frame_range)
    n = f1 - f0
    sc = bpy.context.scene
    keys = {b: [] for s in ('Left', 'Right') for b in (s + 'Shoulder', s + 'Arm', s + 'ForeArm', s + 'Hand')}
    chest_rest = rot(body.data.bones['Spine02'].matrix_local)
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        phase = ((f - f0) % n) / n
        C = rot(P['Spine02'].matrix) @ chest_rest.inverted()     # the chest's turn from rest
        for s, sign, off in (('Left', 1, 0.0), ('Right', -1, 0.5)):
            # The cycle starts on the left heel: left leg forward, so the left arm is at its furthest back.
            c = 0.5 - 0.5 * math.cos(2 * math.pi * (phase + off - g['lag']))   # 0 back, 1 forward
            sw = g['swing'][0] + (g['swing'][1] - g['swing'][0]) * c
            fx = g['flex'][0] + (g['flex'][1] - g['flex'][0]) * c
            side = Vector((1, 0, 0))
            # Body axes in Blender: +x his left, -y forward, +z up. Down, then out, then swung.
            up_dir = along(Vector((0, 1, 0)), -sign * g['out']) @ Vector((0, 0, -1))
            up_dir = along(side, -sw) @ up_dir
            fo_dir = along(side, -(sw + fx)) @ Vector((0, 0, -1))
            fo_dir = along(Vector((0, 0, 1)), -sign * g['cross'] * fx / 90) @ fo_dir
            # The collarbone follows the swing a little.
            sh = P[s + 'Shoulder']
            sh.matrix_basis = Matrix.Identity(4)
            sh.rotation_quaternion = Quaternion((1, 0, 0, 0))
            bpy.context.view_layer.update()
            m = sh.matrix.copy()
            turn = along(Vector((0, 0, 1)), sign * g['clavicle'] * (2 * c - 1))
            sh.matrix = Matrix.LocRotScale(m.to_translation(), C @ turn @ C.inverted() @ rot(m), None)
            bpy.context.view_layer.update()
            for bone, want in ((s + 'Arm', up_dir), (s + 'ForeArm', fo_dir)):
                pb = P[bone]
                pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
                bpy.context.view_layer.update()
                m = pb.matrix.copy()
                # (this rig's bones keep their node axes, so a bone's length is the way to its child)
                child = P[{'Arm': s + 'ForeArm', 'ForeArm': s + 'Hand'}[bone[len(s):]]]
                now = (child.head - pb.head).normalized()
                pb.matrix = Matrix.LocRotScale(m.to_translation(), now.rotation_difference(C @ want) @ rot(m), None)
                bpy.context.view_layer.update()
            hand = P[s + 'Hand']
            hand.rotation_quaternion = Quaternion((1, 0, 0, 0))
            bpy.context.view_layer.update()
            for b in (s + 'Shoulder', s + 'Arm', s + 'ForeArm', s + 'Hand'):
                pb = P[b]
                local = pb.parent.matrix.inverted() @ pb.matrix
                q = local.to_quaternion()
                keys[b].append([q.x, q.y, q.z, q.w])       # (a bone's local turn is the node's, no axis swap)
                pb.keyframe_insert('rotation_quaternion', frame=f)
    os.makedirs(OUT, exist_ok=True)
    json.dump({'frames': n + 1, 'bones': keys}, open(f'{OUT}/{clip}.arms.json', 'w'))
    if SHEET: sheet(clip, body, f0, n)

def sheet(clip, body, f0, n):
    os.makedirs(SHEET, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    sc.display.shading.show_shadows = False
    sc.render.resolution_x, sc.render.resolution_y = 300, 420
    sc.render.image_settings.file_format = 'PNG'
    w = bpy.data.worlds.new('w'); sc.world = w; w.color = (0.75, 0.78, 0.8)
    cam = bpy.data.objects.new('c', bpy.data.cameras.new('c'))
    sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.2
    for view, loc, r in (('side', (-4, 0, 0.95), (math.pi / 2, 0, -math.pi / 2)), ('front', (0, -4, 0.95), (math.pi / 2, 0, 0))):
        cam.location = loc; cam.rotation_euler = r
        for i in range(8):
            sc.frame_set(f0 + round(i * n / 8))
            sc.render.filepath = f'{SHEET}/{clip}_{view}_{i}.png'
            bpy.ops.render.render(write_still=True)

for c in CLIPS: solve(c)
