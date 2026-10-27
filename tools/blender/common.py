# Shared helpers for the Blender scripts (run headless: blender -b -P tools/blender/<script>.py -- …).
# Textures are rendered, not painted: a model of the detail (needles, leaves, bark) is built in the
# scene and rendered from above with an orthographic camera, once for colour (unlit albedo, darkened
# by ambient occlusion) and once for normals (camera-space, as a tangent-space normal map), on a
# transparent background. Colour bleeds into the transparent pixels so mipmaps don't fringe dark.
import bpy, bmesh, math, os
import numpy as np
from mathutils import Vector


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    sc.cycles.use_denoising = False
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.world = bpy.data.worlds.new('w')
    return sc


def srgb(hexv):
    """A colour given as sRGB hex, in linear (what shaders and attributes take)."""
    c = [((hexv >> s) & 255) / 255 for s in (16, 8, 0)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def mix(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


class Mesh:
    """Polygons with a colour per polygon, built up and then made into one object."""
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.uv = self.bm.loops.layers.uv.new('UVMap')

    def poly(self, pts, color, uvs=None):
        vs = [self.bm.verts.new(p) for p in pts]
        f = self.bm.faces.new(vs)
        for i, l in enumerate(f.loops):
            l[self.col] = (*color, 1.0) if len(color) == 3 else color
            if uvs: l[self.uv].uv = uvs[i]
        return f

    def obj(self, name, mat=None):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if mat: ob.data.materials.append(mat)
        return ob


def _nodes(mat):
    try: mat.use_nodes = True
    except Exception: pass
    nt = mat.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    return nt


def albedo_material(name, color_socket_fn, alpha_fn=None, ao=0.6, ao_dist=0.03):
    """Unlit colour × ambient occlusion, cut out by alpha. color_socket_fn(nt) → a colour socket."""
    mat = bpy.data.materials.new(name)
    nt = _nodes(mat)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    col = color_socket_fn(nt)
    occ = nt.nodes.new('ShaderNodeAmbientOcclusion'); occ.inputs['Distance'].default_value = ao_dist
    k = nt.nodes.new('ShaderNodeMapRange'); k.inputs['To Min'].default_value = 1 - ao
    nt.links.new(occ.outputs['AO'], k.inputs['Value'])
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
    nt.links.new(col, mul.inputs['A']); nt.links.new(k.outputs['Result'], mul.inputs['B'])
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(mul.outputs['Result'], em.inputs['Color'])
    shader = em.outputs[0]
    if alpha_fn:
        tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mx = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(alpha_fn(nt), mx.inputs['Fac']); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(shader, mx.inputs[2])
        shader = mx.outputs[0]
    nt.links.new(shader, out.inputs['Surface'])
    return mat


def normal_material(name, normal_fn=None, alpha_fn=None):
    """Normals in camera space, encoded n·½+½ (render with the Raw view transform)."""
    mat = bpy.data.materials.new(name)
    nt = _nodes(mat)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    if normal_fn: n = normal_fn(nt)
    else: n = nt.nodes.new('ShaderNodeNewGeometry').outputs['Normal']
    vt = nt.nodes.new('ShaderNodeVectorTransform'); vt.vector_type = 'NORMAL'; vt.convert_from = 'WORLD'; vt.convert_to = 'CAMERA'
    nt.links.new(n, vt.inputs[0])
    # Blender's camera space looks down −z: flip z (and y follows the image's up) so +z faces the viewer.
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(vt.outputs[0], sep.inputs[0])
    neg = nt.nodes.new('ShaderNodeMath'); neg.operation = 'MULTIPLY'; neg.inputs[1].default_value = -1
    nt.links.new(sep.outputs['Z'], neg.inputs[0])
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(sep.outputs['X'], comb.inputs['X']); nt.links.new(sep.outputs['Y'], comb.inputs['Y']); nt.links.new(neg.outputs[0], comb.inputs['Z'])
    sc = nt.nodes.new('ShaderNodeVectorMath'); sc.operation = 'MULTIPLY_ADD'
    sc.inputs[1].default_value = (0.5, 0.5, 0.5); sc.inputs[2].default_value = (0.5, 0.5, 0.5)
    nt.links.new(comb.outputs[0], sc.inputs[0])
    em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(sc.outputs[0], em.inputs['Color'])
    shader = em.outputs[0]
    if alpha_fn:
        tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mx = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(alpha_fn(nt), mx.inputs['Fac']); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(shader, mx.inputs[2])
        shader = mx.outputs[0]
    nt.links.new(shader, out.inputs['Surface'])
    return mat


def vertex_color(nt):
    n = nt.nodes.new('ShaderNodeVertexColor'); n.layer_name = 'Col'
    return n.outputs['Color']


def ortho_camera(center, scale, look='top', res=(1024, 1024)):
    """An orthographic camera: 'top' looks down −z (image up = +y); 'front' looks +y from −y
    (image right = +x, up = +z); 'side' looks −x from +x (image right = +y, up = +z)."""
    sc = bpy.context.scene
    cam = bpy.data.objects.get('cam') or bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    if cam.name not in sc.collection.objects: sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = scale
    cam.data.clip_start = 0.01; cam.data.clip_end = 500
    cx, cy, cz = center
    if look == 'top': cam.location = (cx, cy, cz + 50); cam.rotation_euler = (0, 0, 0)
    elif look == 'front': cam.location = (cx, cy - 50, cz); cam.rotation_euler = (math.pi / 2, 0, 0)
    else: cam.location = (cx + 50, cy, cz); cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    return cam


def render(path, override=None, raw=False):
    sc = bpy.context.scene
    sc.view_settings.view_transform = 'Raw' if raw else 'Standard'
    sc.view_settings.look = 'None'
    bpy.context.view_layer.material_override = override
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.context.view_layer.material_override = None
    return path


def bleed(path, steps=24, alpha_from=None):
    """Spread the colour of opaque pixels into the transparent ones (alpha kept, or taken
    from another image), so the texture's mipmaps don't darken at the edges of leaves."""
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    px = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    if alpha_from is not None:
        a = bpy.data.images.load(alpha_from, check_existing=False)
        ap = np.empty(w * h * 4, dtype=np.float32); a.pixels.foreach_get(ap)
        px[..., 3] = ap.reshape(h, w, 4)[..., 3]
        bpy.data.images.remove(a)
    alpha = px[..., 3].copy()
    filled = alpha > 0.5
    rgb = np.where(filled[..., None], px[..., :3] / np.maximum(alpha[..., None], 1e-3), 0)
    rgb = np.clip(rgb, 0, 1)
    for _ in range(steps):
        if filled.all(): break
        acc = np.zeros_like(rgb); n = np.zeros(filled.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            acc += np.roll(np.roll(rgb * filled[..., None], dy, 0), dx, 1)
            n += np.roll(np.roll(filled.astype(np.float32), dy, 0), dx, 1)
        new = (~filled) & (n > 0)
        rgb[new] = acc[new] / n[new][:, None]
        filled = filled | new
    if not filled.all(): rgb[~filled] = rgb[filled].mean(0)
    px[..., :3] = rgb
    im.pixels.foreach_set(px.ravel())
    im.filepath_raw = path; im.file_format = 'PNG'; im.save()
    bpy.data.images.remove(im)
    return path


def combine(paths, out, size):
    """Lay images side by side into one (left to right), each scaled to its share of `size`."""
    w, h = size
    canvas = np.zeros((h, w, 4), dtype=np.float32)
    x = 0
    for p in paths:
        im = bpy.data.images.load(p, check_existing=False)
        iw, ih = im.size
        a = np.empty(iw * ih * 4, dtype=np.float32); im.pixels.foreach_get(a)
        canvas[:ih, x:x + iw] = a.reshape(ih, iw, 4)
        x += iw
        bpy.data.images.remove(im)
    img = bpy.data.images.new(os.path.basename(out), w, h, alpha=True)
    img.pixels.foreach_set(canvas.ravel())
    img.filepath_raw = out; img.file_format = 'PNG'; img.save()
    bpy.data.images.remove(img)
    return out


def game_material(name, color_png, normal_png, cutout=True, roughness=0.9):
    """The material the game gets (glTF): base colour (with alpha) and a normal map."""
    mat = bpy.data.materials.new(name)
    nt = _nodes(mat)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = roughness
    ct = nt.nodes.new('ShaderNodeTexImage'); ct.image = bpy.data.images.load(color_png, check_existing=True)
    nt.links.new(ct.outputs['Color'], bsdf.inputs['Base Color'])
    if cutout:
        nt.links.new(ct.outputs['Alpha'], bsdf.inputs['Alpha'])
        try: mat.surface_render_method = 'DITHERED'
        except Exception: pass
        mat.use_backface_culling = False
    if normal_png:
        ntx = nt.nodes.new('ShaderNodeTexImage'); ntx.image = bpy.data.images.load(normal_png, check_existing=True)
        ntx.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(ntx.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat


def export_glb(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_image_format='WEBP', export_image_quality=88, export_yup=True)
