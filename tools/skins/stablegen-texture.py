# Texture a building's shell with StableGen, unattended (run in Blender with its window open, and
# a ComfyUI server on 127.0.0.1:8188 with StableGen's SDXL package and RealVisXL V5):
#   Blender --online-mode --python stablegen-texture.py -- <workdir> <name> <style> [seed]
# Steps: import <workdir>/<name>.obj (the builder's walls, slab and parapet: export-walls.js in the
# game), keep only the faces seen from outside, cameras square on to every stretch of wall, the
# ARCHITECTURE preset on RealVisXL with the region's walls in the prompt, bake, export <name>.glb.
# <style> is the map's wallStyle (style-textures.py has the same regions).
import bpy, bmesh, sys, json, math, time, traceback, importlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index('--') + 1:]
WORK, NAME, STYLE = Path(ARGS[0]), ARGS[1], ARGS[2]
SEED = int(ARGS[3]) if len(ARGS) > 3 else 1944   # (another seed for a redo when a view goes wrong)
# The walls of each region, by what the building is made of (its walls' material in the game).
WALLS = {
    'tuscany':  {'stone': 'rough Tuscan rubble masonry of sandstone and limestone with a few red bricks',
                 'plaster': 'pale ochre lime plaster of a Tuscan farmhouse, patched, with rubble stone showing where it has fallen'},
    'umbria':   {'stone': 'pale pink and grey Umbrian limestone ashlar in courses, a medieval hill town',
                 'plaster': 'faded cream and rose lime plaster of an Umbrian town house, with pale stone showing where it has fallen'},
    'liguria':  {'stone': 'grey Ligurian rubble stone and slate, salt-stained',
                 'plaster': 'salt-weathered pastel painted plaster of a Ligurian harbour building, peeling',
                 'concrete': 'weathered grey coastal bunker concrete with faint board marks and rust streaks'},
    'apennine': {'stone': 'dark grey rough Apennine rubble stone, deep mortar joints, lichen',
                 'plaster': 'rough grey lime render of an Apennine mountain house, with rubble stone showing where it has fallen',
                 'wood': 'dark weathered timber planks of a mountain hut, on a rough stone base',
                 'concrete': 'weathered grey military concrete with faint board marks'},
    'po':       {'stone': 'sooty red brick of a Po valley railway building',
                 'plaster': 'grimy pale yellow plaster of a railway station, soot streaks, brick showing where it has fallen'},
    'lombardy': {'stone': 'weathered red brick of a Lombard farm building',
                 'plaster': 'pale cream plaster of a military building, weathered, rain streaks',
                 'concrete': 'weathered grey concrete of an airfield building'},
}
TIMBER = 'weathered grey timber planks of a 1940s wooden hut, on a low rough stone base'
NEG = 'window, door, doorway, opening, hole, trees, sky, landscape, house, roof tiles, people, text, blurry, smooth, clean, new, cartoon, painting'
LOG = WORK / f'{NAME}.log'
KIND, BAKE = 'stone', 4096

def prompt_for(kind):
    walls = WALLS[STYLE].get(kind) or (TIMBER if kind == 'wood' else WALLS[STYLE]['stone'])
    return (f'war-damaged old wall, Italy 1944, close-up, {walls}, shell damage, bullet holes and chips, '
            'soot streaks, crumbling mortar, damp stains at the base, sharp detailed photograph, overcast daylight')

def log(*a):
    with open(LOG, 'a') as f: f.write(time.strftime('%H:%M:%S ') + ' '.join(map(str, a)) + '\n')

pkg = next(m for m in sys.modules if m.endswith('.stablegen') and m.startswith('bl_ext'))
state = importlib.import_module(pkg + '.core.state')
utils = importlib.import_module(pkg + '.utils')
gen = importlib.import_module(pkg + '.texturing.generator')

def setup():
    prefs = bpy.context.preferences.addons[pkg].preferences
    prefs.server_address = '127.0.0.1:8188'
    (WORK / 'sg_out').mkdir(exist_ok=True)
    prefs.output_dir = str(WORK / 'sg_out') + '/'
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)   # (the start-up cube, camera, light)
    bpy.ops.wm.obj_import(filepath=str(WORK / f'{NAME}.obj'))
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    # What it's mostly made of (export-walls.js names each part wall<k>_<material>).
    area = {}
    for o in objs:
        kind = o.name.split('_')[-1].split('.')[0]
        rot = o.matrix_world.to_3x3()
        area[kind] = area.get(kind, 0) + sum(p.area for p in o.data.polygons if abs((rot @ p.normal).normalized().z) < 0.3)   # (walls, not floors)
    global KIND
    KIND = max(area, key=area.get) if area else 'stone'
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = NAME
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)   # (the import's Y-up turn into the mesh: z is up below)
    # Only the faces seen from outside: a ray out along each face's normal must leave the house.
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    tree = BVHTree.FromBMesh(bm)
    gone = [f for f in bm.faces if f.normal.z < -0.5 or tree.ray_cast(f.calc_center_median() + f.normal * 0.01, f.normal, 40)[0] is not None]
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    log('faces kept', len(bm.faces), 'removed', len(gone))
    # Caps over the doorways and windows, 2 cm behind the wall face, for the generation only: with
    # holes in its depth guide SDXL paints openings with the country behind them, bigger than the
    # real ones and not quite where they are, and the trees land on the stone round them. Capped,
    # the wall reads as solid and gets stone all over. Tiles of 10 cm wherever a ray at the wall
    # finds no wall; marked, and deleted again before export.
    tree = BVHTree.FromBMesh(bm)
    planes = {}
    for f in bm.faces:
        n = f.normal
        if abs(n.z) > 0.3 or f.calc_area() < 0.05: continue
        ax = 0 if abs(n.x) > abs(n.y) else 1
        sign = 1 if n[ax] > 0 else -1
        planes.setdefault((ax, sign, round(f.calc_center_median()[ax], 2)), []).extend(v.co.copy() for v in f.verts)
    cap = bm.faces.layers.int.new('sg_cap')
    S = 0.1
    for (ax, sign, off), pts in planes.items():
        u = 1 - ax                                               # (the in-plane horizontal axis)
        u0, u1 = min(p[u] for p in pts), max(p[u] for p in pts)
        z0, z1 = min(p.z for p in pts), max(p.z for p in pts)
        normal = Vector((sign, 0, 0)) if ax == 0 else Vector((0, sign, 0))
        for i in range(int((u1 - u0) / S)):
            for j in range(int((z1 - z0) / S)):
                c = Vector((0, 0, z0 + (j + 0.5) * S)); c[u] = u0 + (i + 0.5) * S; c[ax] = off
                if tree.ray_cast(c + normal * 0.5, -normal, 0.6)[0] is not None: continue
                corners = []
                for du, dz in ((0, 0), (1, 0), (1, 1), (0, 1)):
                    q = Vector((0, 0, z0 + (j + dz) * S + (dz - 0.5) * 0.1)); q[u] = u0 + (i + du) * S + (du - 0.5) * 0.1   # (5 cm over: no slits at the edges)
                    q[ax] = off - sign * 0.02
                    corners.append(bm.verts.new(q))
                face = bm.faces.new(corners if (sign > 0) == (ax == 1) else corners[::-1])
                face.normal_update()
                if face.normal.dot(normal) < 0: face.normal_flip()
                face[cap] = 1
    log('cap tiles', sum(1 for f in bm.faces if f[cap]))
    bm.to_mesh(ob.data); bm.free()
    for m in list(ob.data.materials): ob.data.materials.clear()
    # UVs for the bake (the OBJ has none): smart project, a little margin between islands.
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    # Cameras square on to the walls, each seeing a square stretch C metres across from far enough out
    # (a 35 mm lens sees about as wide as it is far): 5 m on a house (the farmhouse's detail), wider
    # on a big one so it stays at 16 views at most; as many rows as the walls are tall. A flat
    # roof gets one view straight down and two from high up for its parapet. The first is the style
    # reference.
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    lo, hi = Vector([min(v[i] for v in vs) for i in range(3)]), Vector([max(v[i] for v in vs) for i in range(3)])
    mid, size = (lo + hi) / 2, hi - lo
    count = lambda C: 2 * (math.ceil(size.x / (C * 0.9)) + math.ceil(size.y / (C * 0.9))) * max(1, math.ceil(size.z / (C * 0.95)))
    C = 5.0
    while count(C) > 16: C *= 1.08                               # (a big building: wider views, at most 16)
    D = C / 1.03
    rows = max(1, math.ceil(size.z / (C * 0.95)))
    zs = [lo.z + size.z * (r + 0.5) / rows for r in range(rows)]
    global BAKE
    BAKE = 4096 if 2 * (size.x + size.y) * size.z > 150 else 2048
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = 1024
    shots = []                                                   # (position, look at, lens)
    for ax, length in ((0, size.x), (1, size.y)):                # walls along x (facing ±y), then along y
        n = max(1, math.ceil(length / (C * 0.9)))
        for s in (-1, 1):
            for k in range(n):
                along = (lo[ax] + length * (k + 0.5) / n) if n > 1 else mid[ax]
                for z in zs:
                    p = Vector((0, 0, z)); p[ax] = along
                    face = hi[1 - ax] if s > 0 else lo[1 - ax]
                    p[1 - ax] = face + s * D
                    look = p.copy(); look[1 - ax] -= s
                    shots.append((p, look, 35))
    up = sum(f.area for f in ob.data.polygons if f.normal.z > 0.9)
    if up > 10:
        top = max(size.x, size.y) * 1.05
        shots.append((Vector((mid.x, mid.y + 0.01, hi.z + top)), Vector((mid.x, mid.y, hi.z)), 35))
        for s in (-1, 1): shots.append((Vector((mid.x, mid.y + s * top * 0.75, hi.z + top * 0.6)), Vector((mid.x, mid.y, hi.z)), 30))
    log('kind', KIND, 'cameras', len(shots), 'C', round(C, 1), 'rows', rows, 'bake', BAKE)
    for i, (p, at, lens) in enumerate(shots):
        cam = bpy.data.objects.new(f'Cam_{i:02d}', bpy.data.cameras.new(f'Cam_{i:02d}'))
        cam.data.lens = lens
        sc.collection.objects.link(cam)
        cam.location = p
        cam.rotation_euler = (at - p).to_track_quat('-Z', 'Y').to_euler()
    for o in sc.objects: o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    sc.camera = sc.objects['Cam_00']
    return ob

def ui():
    # The window's 3D view, for operators run from a timer (which has no context of its own).
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
    return bpy.context.temp_override(window=win, area=area, region=next(r for r in area.regions if r.type == 'WINDOW'))

class Run:
    def __init__(self): self.phase, self.t0, self.ob = 'setup', time.time(), None
    def tick(self):
        try: return self.step()
        except Exception:
            log('ERROR', traceback.format_exc()); self.done(False); return None
    def done(self, ok):
        (WORK / f'{NAME}.status').write_text(json.dumps({'ok': ok, 'phase': self.phase, 'seconds': round(time.time() - self.t0)}))
        bpy.ops.wm.save_as_mainfile(filepath=str(WORK / f'{NAME}.blend'))
        bpy.ops.wm.quit_blender()
    def step(self):
        sc = bpy.context.scene
        if self.phase == 'setup':
            with ui(): self.ob = setup()
            self.phase = 'refresh'; utils._sg_bypass_modal_check = True
            with ui(): bpy.ops.stablegen.refresh_controlnet_mappings(); bpy.ops.stablegen.refresh_checkpoint_list(); bpy.ops.stablegen.refresh_lora_list()
            return 1.0
        if self.phase == 'refresh':
            if state._pending_refreshes: return 1.0
            sc.stablegen_preset = 'ARCHITECTURE'
            with ui(): ok = bpy.ops.stablegen.apply_preset()
            if ok != {'FINISHED'}: raise RuntimeError('preset failed')
            sc.model_name = 'RealVisXL_V5.0_fp16.safetensors'
            sc.comfyui_prompt, sc.comfyui_negative_prompt = prompt_for(KIND), NEG
            sc.seed, sc.control_after_generate = SEED, 'fixed'
            for u in sc.controlnet_units: u.strength = 0.95       # (the preset's 0.6 let it invent a bigger house)
            sc.cfg = 2.0                                          # (a little more of the prompt: the damage)
            sc.generation_mode, sc.texture_objects, sc.ask_object_prompts = 'standard', 'selected', False
            for o in sc.objects: o.select_set(o == self.ob or o.type == 'CAMERA')
            self.phase = 'generate'; log('generate start')
            with ui():
                r = bpy.ops.object.test_stable('INVOKE_DEFAULT')
            if r != {'RUNNING_MODAL'}: raise RuntimeError(f'generate did not start: {r}')
            return 5.0
        if self.phase == 'generate':
            if gen.ComfyUIGenerate._is_running or any(op.bl_idname == 'OBJECT_OT_test_stable' for w in bpy.context.window_manager.windows for op in w.modal_operators):
                return 5.0
            if sc.sg_last_gen_error: raise RuntimeError(sc.sg_last_gen_error_message or 'generation failed')
            log('generate done', round(time.time() - self.t0))
            for o in sc.objects: o.select_set(o == self.ob)
            bpy.context.view_layer.objects.active = self.ob
            rendering = importlib.import_module(pkg + '.texturing.rendering')
            B = rendering.BakeTextures
            B._objects, B._current_index, B._phase, B._total_objects = [self.ob], 0, 'unwrap', 1
            with ui():
                r = bpy.ops.object.bake_textures('EXEC_DEFAULT', texture_resolution=BAKE, bake_pbr=False, add_material=True,
                                                 flatten_for_refine=False, try_unwrap='none', overlap_only=False)
            if r != {'RUNNING_MODAL'}: raise RuntimeError(f'bake did not start: {r}')
            self.phase, self.settle = 'bake', 0
            return 3.0
        if self.phase == 'bake':
            if any(op.bl_idname == 'OBJECT_OT_bake_textures' for w in bpy.context.window_manager.windows for op in w.modal_operators): return 3.0
            self.settle += 1
            if self.settle < 3: return 2.0
            log('bake done', round(time.time() - self.t0), [m.name for m in self.ob.data.materials])
            # The caps go again: the real doorways and windows are holes in the skin.
            bm = bmesh.new(); bm.from_mesh(self.ob.data)
            lay = bm.faces.layers.int.get('sg_cap')
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[lay]], context='FACES')
            bm.to_mesh(self.ob.data); bm.free()
            self.ob.data.attributes.remove(self.ob.data.attributes['sg_cap'])
            for o in sc.objects: o.select_set(o == self.ob)
            with ui(): bpy.ops.export_scene.gltf(filepath=str(WORK / f'{NAME}.glb'), use_selection=True, export_format='GLB',
                                      export_image_format='WEBP', export_image_quality=82, export_normals=True)
            self.phase = 'exported'; log('exported'); self.done(True); return None

run = Run()
bpy.app.timers.register(run.tick, first_interval=2.0)
