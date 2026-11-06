# The crouched walk and the leopard crawl, from numbers: every bone solved per key on the player's
# rig, feet and hands placed on the ground by two-bone IK. Armature space, centimetres: +x his left,
# -y forward, +z up, the game's root at the origin.
#   blender -b -P tools/blender/low_gaits.py -- <out dir> [--sheet dir] [crouch|crawl ...]
# Writes <out dir>/anim_<name>.pose.json; node tools/set-low-gaits.mjs builds the clips from them.
import bpy, json, math, os, sys
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SHEET = None
if '--sheet' in argv:
    i = argv.index('--sheet'); SHEET = argv[i + 1]; del argv[i:i + 2]
OUT = argv[0]
WANT = argv[1:] or ['crouch', 'crawl']
TAU = 2 * math.pi
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
def R(axis, deg): return Quaternion(axis, math.radians(deg))
def smooth(u): u = min(1, max(0, u)); return u * u * (3 - 2 * u)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=f'{ROOT}/models-src/player_idle.glb', bone_heuristic='BLENDER')
body = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body.animation_data_clear()
for o in list(bpy.data.objects):
    if o.type == 'MESH' and not o.parent: bpy.data.objects.remove(o, do_unlink=True)
P = body.pose.bones
for pb in P: pb.rotation_mode = 'QUATERNION'
upd = bpy.context.view_layer.update
REST = {b.name: b.matrix_local.to_quaternion() for b in body.data.bones}
HEAD = {b.name: b.head_local.copy() for b in body.data.bones}

def clear():
    for pb in P: pb.matrix_basis = Matrix.Identity(4)
    upd()
def turn(name, D, at=None):
    """The bone turned by D from its rest attitude in armature space; `at` moves it (the hips)."""
    pb = P[name]
    pb.matrix_basis = Matrix.Identity(4); upd()
    pb.matrix = Matrix.LocRotScale(at if at is not None else pb.matrix.to_translation(), D @ REST[name], None); upd()
def aim(name, child, want):
    pb = P[name]
    pb.matrix_basis = Matrix.Identity(4); upd()
    now = (P[child].head - pb.head).normalized()
    m = pb.matrix.copy()
    pb.matrix = Matrix.LocRotScale(m.to_translation(), now.rotation_difference(want.normalized()) @ m.to_quaternion(), None); upd()
def limb(top, mid, end, target, pole):
    """Two bones reaching for target, the joint bending toward pole."""
    P[top].matrix_basis = Matrix.Identity(4); P[mid].matrix_basis = Matrix.Identity(4); upd()
    a, b = (HEAD[mid] - HEAD[top]).length, (HEAD[end] - HEAD[mid]).length
    h = P[top].head.copy()
    v = target - h
    d = min(v.length, (a + b) * 0.995)
    u = v.normalized()
    along = (a * a - b * b + d * d) / (2 * d)
    side = pole - u * pole.dot(u)
    knee = h + u * along + side.normalized() * math.sqrt(max(0, a * a - along * along))
    aim(top, mid, knee - h)
    aim(mid, end, h + u * d - knee)

# ---- Crouched walk. The game adds its own drop and lean on top (Character.lowerBody).
CROUCH = dict(T=0.8, stride=136, hip=80, stance=0.6, lift=8, width=10)
def crouch(ph):
    g = CROUCH; c = math.cos(TAU * ph)
    clear()
    at = Vector((1.5 * math.sin(TAU * (ph + 0.2)), 4, g['hip'] + 1.2 * math.cos(2 * TAU * (ph - 0.3))))
    turn('Hips', R(Z, -5 * c) @ R(X, 10), at)
    for n, yaw, pitch in (('Spine', 1, 12), ('Spine01', 3, 14), ('Spine02', 6, 16), ('neck', 2, 6), ('Head', 0, 0)):
        turn(n, R(Z, yaw * c) @ R(X, pitch))
    for s, sign, off in (('Left', 1, 0.0), ('Right', -1, 0.5)):
        u = (ph + off) % 1
        half = g['stride'] / 2 * 0.5
        rest_z = HEAD[s + 'Foot'].z
        if u < g['stance']:
            k = u / g['stance']
            y = -half + 2 * half * k
            z = rest_z + 7 * smooth((k - 0.72) / 0.28)                      # the heel comes up
            pitch = -10 * (1 - smooth(k / 0.18)) + 26 * smooth((k - 0.72) / 0.28)
        else:
            k = (u - g['stance']) / (1 - g['stance'])
            y = half - 2 * half * smooth(k)
            z = rest_z + 7 * (1 - smooth(k / 0.3)) + g['lift'] * math.sin(math.pi * k)
            pitch = 26 * (1 - smooth(k / 0.5)) - 10 * smooth((k - 0.5) / 0.5)
        ankle = Vector((sign * g['width'], y + at.y, z))
        limb(s + 'UpLeg', s + 'Leg', s + 'Foot', ankle, Vector((sign * 0.12, -1, 0.3)))
        turn(s + 'Foot', R(X, pitch))
        turn(s + 'ToeBase', R(X, 0))                                        # (flat on the ground as the heel lifts)
    # (the rifle layer covers the arms; these are for anything that shows them)
    for s, sign in (('Left', 1), ('Right', -1)):
        turn(s + 'Shoulder', R(X, 16))
        sh = P[s + 'Arm'].head
        limb(s + 'Arm', s + 'ForeArm', s + 'Hand', sh + Vector((sign * 2, -22, -34)), Vector((sign * 0.5, 0.8, -0.3)))
        turn(s + 'Hand', R(X, 60))

# ---- Leopard crawl: the left elbow reaches as the right knee draws up, then they pull and push.
CRAWL = dict(T=1.2, pull=0.56, speed=0.58)
def stroke(u, pull):
    """0 at the far end of the reach, 1 at the end of the pull, and back; and how far off the ground."""
    if u < pull: return u / pull, 0.0
    k = (u - pull) / (1 - pull)
    return 1 - smooth(k), math.sin(math.pi * k)
def crawl(ph):
    g = CRAWL; sn = math.sin(TAU * ph)
    clear()
    surge = 2.5 * math.cos(2 * TAU * ph)
    at = Vector((2.0 * sn, 22 + surge, 17))
    turn('Hips', R(Z, 7 * sn) @ R(Y, -7 * sn) @ R(X, 85), at)
    for n, yaw, roll, pitch in (('Spine', 3, -3, 80), ('Spine01', -1, 2, 74), ('Spine02', -6, 8, 68), ('neck', -4, 4, 38), ('Head', -2, 0, 14)):
        turn(n, R(Z, yaw * sn) @ R(Y, roll * sn) @ R(X, pitch))
    for s, sign, off in (('Left', 1, 0.0), ('Right', -1, 0.5)):
        k, up = stroke((ph + off) % 1, g['pull'])
        turn(s + 'Shoulder', R(Z, sign * (-14 + 22 * k)) @ R(X, 72))
        sh = P[s + 'Arm'].head
        hand = Vector((sign * (20 - 3 * k), -68 + 44 * k, 7 + 5 * up))
        limb(s + 'Arm', s + 'ForeArm', s + 'Hand', hand, Vector((sign * 1, 0.25, -0.8)))
        turn(s + 'Hand', R(X, 90))
    # The opposite leg: drawn up as the arm reaches, pushing as it pulls.
    for s, sign, off in (('Left', 1, 0.5), ('Right', -1, 0.0)):
        k, up = stroke((ph + off) % 1, g['pull'])
        ankle = Vector((sign * (34 - 19 * k), at.y + 46 + 34 * k, 13 + 3 * up))
        limb(s + 'UpLeg', s + 'Leg', s + 'Foot', ankle, Vector((sign * (1 - 0.6 * k), 0, -0.6)))
        turn(s + 'Foot', R(Z, sign * (-46 + 26 * k)) @ R(X, 104))
        turn(s + 'ToeBase', R(Z, sign * (-46 + 26 * k)) @ R(X, 104))

def setup_sheet():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x, sc.render.resolution_y = 300, 260
    w = bpy.data.worlds.new('w'); sc.world = w; w.color = (0.75, 0.78, 0.8)
    cam = bpy.data.objects.new('c', bpy.data.cameras.new('c'))
    sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.5
    return sc, cam
def shoot(sc, cam, name, i):
    for view, loc, r in (('side', (-4, 0, 0.75), (math.pi / 2, 0, -math.pi / 2)), ('front', (0, -4, 0.75), (math.pi / 2, 0, 0)), ('top', (0, 0, 4), (0, 0, -math.pi / 2))):
        cam.location = loc; cam.rotation_euler = r
        sc.render.filepath = f'{SHEET}/{name}_{view}_{i}.png'
        bpy.ops.render.render(write_still=True)

if SHEET: os.makedirs(SHEET, exist_ok=True); sc, cam = setup_sheet()
C = Quaternion(X, math.radians(-90))     # Blender's z-up armature back to the glTF hips
os.makedirs(OUT, exist_ok=True)
clear()
q0 = P['Hips'].matrix.to_quaternion()
print('REST HIPS', [round(x, 4) for x in (C @ q0)], 'REST SPINE', [round(x, 4) for x in (P['Hips'].matrix.inverted() @ P['Spine'].matrix).to_quaternion()])
for name, fn, T in (('crouch', crouch, CROUCH['T']), ('crawl', crawl, CRAWL['T'])):
    if name not in WANT: continue
    n = round(T * 30)
    keys, hips = {pb.name: [] for pb in P}, []
    for f in range(n + 1):
        fn((f % n) / n)
        for pb in P:
            q = (pb.parent.matrix.inverted() @ pb.matrix).to_quaternion() if pb.parent else C @ pb.matrix.to_quaternion()
            keys[pb.name].append([q.x, q.y, q.z, q.w])
        h = P['Hips'].matrix.to_translation()
        hips.append([h.x, h.z, -h.y])
        if SHEET and f < n and f % max(1, n // 8) == 0 and f // (n // 8) < 8: shoot(sc, cam, name, f // (n // 8))
    json.dump({'T': T, 'frames': n + 1, 'bones': keys, 'hips': hips}, open(f'{OUT}/anim_{name}.pose.json', 'w'))
