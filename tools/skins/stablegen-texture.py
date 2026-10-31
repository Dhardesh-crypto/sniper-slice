# Texture the farmhouse shell with StableGen, unattended (run in Blender with its window open, and
# a ComfyUI server on 127.0.0.1:8188 with StableGen's SDXL package and RealVisXL V5):
#   Blender --online-mode --python stablegen-texture.py -- <workdir>
# Steps: import <workdir>/farmhouse.obj (the builder's walls, slab and parapet: export-walls.js in the
# game), keep only the faces seen from outside, cameras square on to every stretch of wall, the
# ARCHITECTURE preset on RealVisXL, bake to a 4096 texture, export farmhouse_skin.glb.
import bpy, bmesh, sys, json, math, time, traceback, importlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

WORK = Path(sys.argv[sys.argv.index('--') + 1])
PROMPT = ('war-damaged rough fieldstone wall of an Italian farmhouse, 1944, close-up, '
          'heavy shell damage, bullet holes and chipped stones, black scorch marks and soot streaks, '
          'crumbling lime mortar, broken patches of old ochre plaster, damp stains and moss at the base, '
          'sharp detailed photograph, overcast daylight')
NEG = 'window, door, roof tiles, sky, landscape, people, text, blurry, smooth, clean, new, cartoon, painting'
LOG = WORK / 'drive.log'

def log(*a):
    with open(LOG, 'a') as f: f.write(time.strftime('%H:%M:%S ') + ' '.join(map(str, a)) + '\n')

pkg = next(m for m in sys.modules if m.endswith('.stablegen') and m.startswith('bl_ext'))
state = importlib.import_module(pkg + '.core.state')
utils = importlib.import_module(pkg + '.utils')
gen = importlib.import_module(pkg + '.texturing.generator')

def setup():
    prefs = bpy.context.preferences.addons[pkg].preferences
    prefs.server_address = '127.0.0.1:8188'
    prefs.output_dir = str(WORK / 'sg_out') + '/'
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)   # (the start-up cube, camera, light)
    bpy.ops.wm.obj_import(filepath=str(WORK / 'farmhouse.obj'))
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = 'Farmhouse'
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)   # (the import's Y-up turn into the mesh: z is up below)
    # Only the faces seen from outside: a ray out along each face's normal must leave the house.
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    tree = BVHTree.FromBMesh(bm)
    gone = [f for f in bm.faces if f.normal.z < -0.5 or tree.ray_cast(f.calc_center_median() + f.normal * 0.01, f.normal, 40)[0] is not None]
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bm.to_mesh(ob.data); bm.free()
    log('faces kept', len(ob.data.polygons), 'removed', len(gone))
    for m in list(ob.data.materials): ob.data.materials.clear()
    # UVs for the bake (the OBJ has none): smart project, a little margin between islands.
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    # Cameras, square on to the walls 4.8 m out: each sees a 5 m stretch from the plinth to the top of
    # the parapet (twice the detail of one view per wall, and the parapet face on); one straight down
    # on the roof, two from high up for the parapet's inner faces. The first is the style reference.
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    lo, hi = Vector([min(v[i] for v in vs) for i in range(3)]), Vector([max(v[i] for v in vs) for i in range(3)])
    mid, D, Z = (lo + hi) / 2, 4.8, (lo.z + hi.z) / 2
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = 1024
    shots = []                                                   # (position, look at, lens)
    for sy in (-1, 1):                                           # the long walls (along x): three each
        for x in (-3.8, 0, 3.8):
            p = Vector((mid.x + x, (hi.y if sy > 0 else lo.y) + sy * D, Z)); shots.append((p, p - Vector((0, sy, 0)), 35))
    for sx in (-1, 1):                                           # the short walls (along y): two each
        for y in (-2.1, 2.1):
            p = Vector(((hi.x if sx > 0 else lo.x) + sx * D, mid.y + y, Z)); shots.append((p, p - Vector((sx, 0, 0)), 35))
    shots.append((Vector((mid.x, mid.y + 0.01, hi.z + 12)), Vector((mid.x, mid.y, hi.z)), 35))
    for sy in (-1, 1): shots.append((Vector((mid.x, mid.y + sy * 9, hi.z + 7)), Vector((mid.x, mid.y, hi.z)), 30))
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
        (WORK / 'drive.status').write_text(json.dumps({'ok': ok, 'phase': self.phase, 'seconds': round(time.time() - self.t0)}))
        bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'farmhouse.blend'))
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
            sc.comfyui_prompt, sc.comfyui_negative_prompt = PROMPT, NEG
            sc.seed, sc.control_after_generate = 1944, 'fixed'
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
                r = bpy.ops.object.bake_textures('EXEC_DEFAULT', texture_resolution=4096, bake_pbr=False, add_material=True,
                                                 flatten_for_refine=False, try_unwrap='none', overlap_only=False)
            if r != {'RUNNING_MODAL'}: raise RuntimeError(f'bake did not start: {r}')
            self.phase, self.settle = 'bake', 0
            return 3.0
        if self.phase == 'bake':
            if any(op.bl_idname == 'OBJECT_OT_bake_textures' for w in bpy.context.window_manager.windows for op in w.modal_operators): return 3.0
            self.settle += 1
            if self.settle < 3: return 2.0
            log('bake done', round(time.time() - self.t0), [m.name for m in self.ob.data.materials])
            for o in sc.objects: o.select_set(o == self.ob)
            with ui(): bpy.ops.export_scene.gltf(filepath=str(WORK / 'farmhouse_skin.glb'), use_selection=True, export_format='GLB',
                                      export_image_format='WEBP', export_image_quality=82, export_normals=True)
            self.phase = 'exported'; log('exported'); self.done(True); return None

run = Run()
bpy.app.timers.register(run.tick, first_interval=2.0)
