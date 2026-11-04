# The debris of a shelled house (ruins.js scatters it over the rubble), one mesh per kind:
#   lump1–3 (masonry, fractured faces), slab (a plate of wall with its plaster on), bricks (a few
#   still mortared together), tile (a broken coppo), beam (a charred joist), girder (bent iron).
# No images: the UVs are box-projected at 1 unit = 1 m, so the game lays the map's own stone photograph
# over them, tinted by the vertex colours. Run headless:
#   blender -b -P tools/blender/ruin_kit.py -- <out dir (public/models)>
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix
sys.path.append(os.path.dirname(__file__))
from common import reset, srgb, mix, export_glb

OUT = sys.argv[-1]
STONE, MORTAR, PLASTER, BRICK = srgb(0xb9ad98), srgb(0x8f8678), srgb(0xd9c7a6), srgb(0xa8624a)
TILE, CHAR, RUST = srgb(0xb0603c), srgb(0x1c1815), srgb(0x5a3a28)


def fracture(bm, rng, cuts, size):
    """Cut a blob with random planes: flat, angular faces like broken masonry."""
    for _ in range(cuts):
        n = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=n * size * rng.uniform(0.55, 0.95),
                               plane_no=n, clear_outer=True)
        edges = [e for e in bm.edges if len(e.link_faces) < 2]
        if edges: bmesh.ops.holes_fill(bm, edges=edges, sides=0)


def finish(bm, name, colour):
    """Triangulate, colour each face (colour(face centre, normal) → rgb), box-project the UVs, make the object."""
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    col = bm.loops.layers.float_color.new('Col')
    uv = bm.loops.layers.uv.new('UVMap')
    bm.normal_update()
    for f in bm.faces:
        c = colour(f.calc_center_median(), f.normal)
        n = f.normal
        for l in f.loops:
            l[col] = (*c, 1.0)
            p = l.vert.co
            a = Vector((abs(n.x), abs(n.y), abs(n.z)))
            l[uv].uv = (p.x, p.y) if a.z >= a.x and a.z >= a.y else (p.y, p.z) if a.x >= a.y else (p.x, p.z)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    attr = nt.nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 1
    me.materials.append(m)
    return ob


def lump(name, seed, size):
    rng = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=size)
    s = Vector((rng.uniform(0.8, 1.3), rng.uniform(0.7, 1.2), rng.uniform(0.55, 0.9)))
    for v in bm.verts: v.co = Vector((v.co.x * s.x, v.co.y * s.y, v.co.z * s.z))
    fracture(bm, rng, 9, size)
    # A course of mortar through it, and old plaster on one side.
    tilt = rng.uniform(-0.2, 0.2)
    def colour(p, n):
        c = mix(STONE, MORTAR, 0.7 if abs((p.z + p.x * tilt) / size * 3 % 1 - 0.5) < 0.14 else rng.random() * 0.3)
        return mix(c, PLASTER, 0.8) if n.dot(Vector((0.6, 0.2, 0.75)).normalized()) > 0.8 else c
    return finish(bm, name, colour)


def slab():
    rng = random.Random(7)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
    for v in bm.verts: v.co = Vector((v.co.x * 1.3, v.co.y * 0.9, v.co.z * 0.16))
    fracture(bm, rng, 6, 0.62)
    return finish(bm, 'slab', lambda p, n: mix(PLASTER, srgb(0xe6dcc8), rng.random() * 0.5) if n.z > 0.7 else mix(STONE, MORTAR, rng.random()))


def bricks():
    rng = random.Random(3)
    bm = bmesh.new()
    for r in range(3):
        for i in range(3 - r % 2):
            m = Matrix.Translation(((i - 1 + r % 2 * 0.5) * 0.26 + rng.uniform(-0.01, 0.01), 0, r * 0.075)) @ Matrix.Rotation(rng.uniform(-0.05, 0.05), 4, 'Z') @ Matrix.Diagonal((0.25, 0.12, 0.065, 1))
            bmesh.ops.create_cube(bm, size=1, matrix=m)
    return finish(bm, 'bricks', lambda p, n: mix(BRICK, srgb(0x7e4a38), rng.random() * 0.7))


def tile():
    bm = bmesh.new()
    n, L, r = 7, 0.42, 0.085
    rows = []
    for j in (0, 1):
        for sgn in (1.0, 0.86):
            rows.append([bm.verts.new((j * L - L / 2, r * sgn * math.cos(a) * (1 - 0.18 * j), r * sgn * math.sin(a))) for a in [math.pi * i / (n - 1) for i in range(n)]])
    o0, i0, o1, i1 = rows
    for i in range(n - 1):
        bm.faces.new((o0[i], o0[i + 1], o1[i + 1], o1[i]))
        bm.faces.new((i0[i + 1], i0[i], i1[i], i1[i + 1]))
        bm.faces.new((o0[i + 1], o0[i], i0[i], i0[i + 1]))
        bm.faces.new((o1[i], o1[i + 1], i1[i + 1], i1[i]))
    rng = random.Random(5)
    return finish(bm, 'tile', lambda p, n: mix(TILE, srgb(0x8c4a30), rng.random() * 0.6))


def beam():
    rng = random.Random(11)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co).x) > 0.5], cuts=9, use_grid_fill=False)
    for v in bm.verts:
        k = 1 - 0.22 * rng.random()                      # burnt away unevenly along its length
        v.co = Vector((v.co.x * 2.6 + rng.uniform(-0.03, 0.03), v.co.y * 0.17 * k, v.co.z * 0.2 * k))
    for s in (1, -1):                                    # the ends, snapped
        for v in bm.verts:
            if v.co.x * s > 1.2: v.co.x += s * rng.uniform(-0.25, 0.12)
    return finish(bm, 'beam', lambda p, n: mix(CHAR, srgb(0x3a2c22), rng.random() * 0.6))


def girder():
    bm = bmesh.new()
    seg, prof = 14, [(-0.05, -0.09), (0.05, -0.09), (0.05, -0.075), (0.008, -0.075), (0.008, 0.075), (0.05, 0.075), (0.05, 0.09), (-0.05, 0.09), (-0.05, 0.075), (-0.008, 0.075), (-0.008, -0.075), (-0.05, -0.075)]
    rings = []
    for i in range(seg + 1):
        t = i / seg
        a = max(0, t - 0.42) * 2.2                       # straight, then bent over by the blast
        cx, cz = (t * 3.4, 0) if t < 0.42 else (0.42 * 3.4 + math.sin(a) / 2.2 * 3.4, (1 - math.cos(a)) / 2.2 * 3.4)
        rings.append([bm.verts.new((cx - pz * math.sin(a), px, cz + pz * math.cos(a))) for px, pz in prof])
    for i in range(seg):
        for k in range(len(prof)):
            k2 = (k + 1) % len(prof)
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    rng = random.Random(9)
    return finish(bm, 'girder', lambda p, n: mix(RUST, srgb(0x2c2622), rng.random() * 0.6))


if __name__ == '__main__':
    reset()
    objs = [lump('lump1', 1, 0.55), lump('lump2', 2, 0.32), lump('lump3', 3, 0.16), slab(), bricks(), tile(), beam(), girder()]
    for o in objs: print('RUINKIT', o.name, len(o.data.polygons))
    export_glb(os.path.join(OUT, 'ruin_kit.glb'), objs)
