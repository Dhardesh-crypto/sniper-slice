# Far versions of modelled props for the game's level of detail
# (run: blender -b -P tools/blender/lods.py -- <in.glb> <out.glb> <triangles>).
# The model is decimated (edge collapse, keeping its UVs and silhouette as best it can) to about
# the given number of triangles, its texture kept; the game draws it beyond LOD_NEAR (vegetation.js).
import bpy, sys
src, dst, target = sys.argv[-3], sys.argv[-2], int(sys.argv[-1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
dg = bpy.context.evaluated_depsgraph_get()
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
for o in meshes:
    m = o.modifiers.new('decimate', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = min(1.0, target / max(tris, 1))
    m.use_collapse_triangulate = True
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_apply=True, export_image_format='NONE')   # (the game keeps the full model's texture)
dg = bpy.context.evaluated_depsgraph_get()
after = sum(len(o.evaluated_get(dg).data.polygons) for o in meshes)
print(f'lod {src} -> {dst}: {tris} -> {after} triangles')
