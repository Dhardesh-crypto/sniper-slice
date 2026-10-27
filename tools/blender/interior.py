# The interior kit: what makes the rooms of the walk-in houses lived in, and lived in by soldiers
# (run: blender -b -P tools/blender/interior.py -- <models dir> <textures dir>).
# Writes interior_kit.glb (one mesh per part, real size, placed by src/world/interior.js) and the
# terracotta floor tiles cotto.jpg / cotto_n.jpg, rendered from modelled tiles.
#   beam (1 m, stretched along x; its top at y = 0, under the ceiling), skirting (1 m), leaf (an
#   inward-opening casement leaf, 1 x 1, hinged at x = 0), curtain (1 m tall), picture_0..2, clock,
#   notice, map_board, shelf, credenza, fireplace, coat_rack, rug, pendant (hangs from y = 0), chair,
#   papers, bottles, phone, typewriter, sacks, demijohn; standing in the room: table (1.6 x 0.85,
#   top at 0.76), bench, stool, bed (headboard at z = 0), wardrobe, washstand, chest, crates,
#   jerrycans; and for a table top: radio, map_table.
# Wall pieces stand on the wall's face at z = 0 and come out along +z (into the room); floor and
# table pieces stand on y = 0, facing +z.
import bpy, math, os, random, sys
from mathutils import Vector, Matrix
sys.path.append(os.path.dirname(__file__))
from kitparts import srgb, jitter, Part, export
from common import reset, albedo_material, normal_material, vertex_color, ortho_camera, render

MODELS, TEXTURES = sys.argv[-2], sys.argv[-1]
rng = random.Random(11)
bpy.ops.wm.read_factory_settings(use_empty=True)
J = lambda h, k=0.08: jitter(srgb(h), k)
DARK = 0x4a3524; OAK = 0x7a5a3a; WHITE = 0xd9d3c4; IRON = 0x262625; GREY = 0x5d6152
parts = []

# ---- the room itself ----
p = Part()                                    # a rough-hewn ceiling beam
p.box(0, 1, -0.2, 0, -0.08, 0.08, J(0x8a6646, 0.12), skip=('top',))   # (old chestnut: lighter than it looks, the rooms are dim)
parts.append(p.obj('beam', 'wood', 0.012))

p = Part()
p.box(0, 1, 0, 0.1, 0, 0.016, J(DARK, 0.04), skip=('back', 'bottom', 'left', 'right'))
parts.append(p.obj('skirting', 'wood'))

p = Part()                                    # a casement leaf: frame, glazing bars, glass (both sides)
for x0, x1, y0, y1 in ((0, 0.07, 0, 1), (0.93, 1, 0, 1), (0, 1, 0, 0.08), (0, 1, 0.92, 1), (0.07, 0.93, 0.36, 0.39), (0.07, 0.93, 0.63, 0.66)):
    p.quad([(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)], srgb(0xc9c1ae))
parts.append(p.obj('leaf', 'frame'))
p = Part()
p.quad([(0.07, 0.08, -0.002), (0.93, 0.08, -0.002), (0.93, 0.92, -0.002), (0.07, 0.92, -0.002)], srgb(0x8fa2a8))
parts.append(p.obj('leaf_glass', 'pane'))       # (see-through: the game's 'pane')

p = Part()                                    # a curtain: pleats (tinted in the game), 0.7 wide, 1 m tall
n = 9
for i in range(n):
    x0, x1 = -0.35 + i * 0.7 / n, -0.35 + (i + 1) * 0.7 / n
    z0, z1 = (0.02, 0.07) if i % 2 == 0 else (0.07, 0.02)
    p.quad([(x0, 0, z0), (x1, 0, z1), (x1, 1, z1), (x0, 1, z0)], [c * (0.92 if i % 2 else 1.0) for c in srgb(0xe8e2d2)])
parts.append(p.obj('curtain', 'cloth'))

# ---- on the walls ----
LAND = [0x6f8a5a, 0x9db0c4, 0xc9a65e, 0x50663e, 0x8a6a4a, 0xd8c9a0, 0x3d5268, 0xb07a52]
for k, (fw, fh, frame) in enumerate(((0.62, 0.46, 0x9c7a3c), (0.4, 0.52, 0x3a2a1c), (0.8, 0.5, 0x8a6a3a))):
    p = Part()
    t = 0.05
    for x0, x1, y0, y1 in ((-fw / 2, fw / 2, 0, t), (-fw / 2, fw / 2, fh - t, fh), (-fw / 2, -fw / 2 + t, t, fh - t), (fw / 2 - t, fw / 2, t, fh - t)):
        p.box(x0, x1, y0, y1, 0, 0.035, J(frame, 0.05), skip=('back',))
    # The painting: a sky, hills, a field, a few strokes.
    cx0, cx1, cy0, cy1 = -fw / 2 + t, fw / 2 - t, t, fh - t
    bands = sorted(rng.uniform(cy0, cy1) for _ in range(3))
    ys = [cy0] + bands + [cy1]
    for i in range(4):
        col = srgb(rng.choice(LAND)) if i < 3 else srgb(0xa8bccc)
        p.quad([(cx0, ys[i], 0.02), (cx1, ys[i], 0.02), (cx1, ys[i + 1], 0.02), (cx0, ys[i + 1], 0.02)], col)
    for _ in range(5):
        x, y, s = rng.uniform(cx0, cx1 - 0.06), rng.uniform(cy0, cy1 - 0.06), rng.uniform(0.02, 0.06)
        p.quad([(x, y, 0.021), (x + s, y, 0.021), (x + s, y + s * 1.6, 0.021), (x, y + s * 1.6, 0.021)], srgb(rng.choice(LAND)))
    parts.append(p.obj(f'picture_{k}', 'wood'))

p = Part()                                    # a wall clock
for i in range(16):                            # its rim
    a0, a1 = 2 * math.pi * i / 16, 2 * math.pi * (i + 1) / 16
    p.quad([(0.17 * math.cos(a0), 0.17 * math.sin(a0), 0.0), (0.17 * math.cos(a1), 0.17 * math.sin(a1), 0.0), (0.17 * math.cos(a1), 0.17 * math.sin(a1), 0.05), (0.17 * math.cos(a0), 0.17 * math.sin(a0), 0.05)], srgb(DARK))
face = [(0.15 * math.cos(2 * math.pi * i / 16), 0.15 * math.sin(2 * math.pi * i / 16), 0.051) for i in range(16)]
p.quad(face, srgb(0xe6dfcc))
p.quad([(-0.005, 0, 0.053), (0.005, 0, 0.053), (0.005, 0.11, 0.053), (-0.005, 0.11, 0.053)], srgb(IRON))
p.quad([(0, -0.005, 0.054), (0.08, -0.005, 0.054), (0.08, 0.005, 0.054), (0, 0.005, 0.054)], srgb(IRON))
parts.append(p.obj('clock', 'wood'))

p = Part()                                    # an official notice: a printed sheet, heading and lines
p.quad([(-0.22, 0, 0.003), (0.22, 0, 0.003), (0.22, 0.6, 0.003), (-0.22, 0.6, 0.003)], srgb(0xe2d9bd))
p.quad([(-0.17, 0.5, 0.004), (0.17, 0.5, 0.004), (0.17, 0.55, 0.004), (-0.17, 0.55, 0.004)], srgb(0x1a1a1a))
for i in range(12):
    y = 0.44 - i * 0.032
    w = 0.17 if i % 4 else 0.12
    p.quad([(-0.17, y, 0.004), (w, y, 0.004), (w, y + 0.012, 0.004), (-0.17, y + 0.012, 0.004)], srgb(0x3a3a3a))
p.quad([(0.08, 0.04, 0.004), (0.17, 0.04, 0.004), (0.17, 0.08, 0.004), (0.08, 0.08, 0.004)], srgb(0x8a1c1c))   # the stamp
parts.append(p.obj('notice', 'paper'))

p = Part()                                    # a staff map on a board: terrain, rivers, roads, pins and arrows
p.box(-0.62, 0.62, 0, 0.88, 0, 0.025, J(0x8a6a48, 0.04), skip=('back',))
for _ in range(14):
    x, y, w, h = rng.uniform(-0.58, 0.3), rng.uniform(0.04, 0.6), rng.uniform(0.1, 0.3), rng.uniform(0.08, 0.24)
    p.quad([(x, y, 0.026), (x + w, y, 0.026), (x + w, y + h, 0.026), (x, y + h, 0.026)], srgb(rng.choice([0xd9cfa8, 0xc8d0a0, 0xb8c89a, 0xdcd4b4])))
for (x0, y0, x1, y1, col) in ((-0.55, 0.2, 0.5, 0.65, 0x4a7aa8), (-0.5, 0.75, 0.55, 0.15, 0x8a5a3a), (-0.2, 0.05, -0.05, 0.85, 0x8a5a3a)):
    dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy); nx, ny = -dy / L * 0.007, dx / L * 0.007
    p.quad([(x0 - nx, y0 - ny, 0.027), (x1 - nx, y1 - ny, 0.027), (x1 + nx, y1 + ny, 0.027), (x0 + nx, y0 + ny, 0.027)], srgb(col))
for _ in range(9):
    x, y = rng.uniform(-0.5, 0.5), rng.uniform(0.1, 0.78)
    p.box(x - 0.01, x + 0.01, y - 0.01, y + 0.01, 0.026, 0.045, srgb(rng.choice([0xb02020, 0x2040a0])), skip=('back',))
for (x0, y0, x1, y1) in ((0.1, 0.3, 0.35, 0.5), (-0.3, 0.6, -0.05, 0.45)):    # red arrows
    dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy); nx, ny = -dy / L * 0.012, dx / L * 0.012
    p.quad([(x0 - nx, y0 - ny, 0.028), (x1 - nx, y1 - ny, 0.028), (x1 + nx, y1 + ny, 0.028), (x0 + nx, y0 + ny, 0.028)], srgb(0xb02020))
parts.append(p.obj('map_board', 'paper'))

p = Part()                                    # a wall shelf on brackets: bottles, jars, books
p.box(-0.5, 0.5, -0.03, 0, 0, 0.24, J(OAK), skip=('back',))
for sx in (-0.38, 0.38): p.box(sx - 0.015, sx + 0.015, -0.2, -0.03, 0, 0.2, J(DARK), skip=('back',))
x = -0.46
while x < 0.44:
    kind = rng.random()
    if kind < 0.45:                            # a bottle
        r, h = rng.uniform(0.03, 0.04), rng.uniform(0.2, 0.3)
        col = srgb(rng.choice([0x2f4a2a, 0x4a3018, 0x6a7a6a, 0x3a2a3a]))
        p.cylinder((x + r, 0, 0.12), r, h * 0.7, 'y', col, segs=8)
        p.cylinder((x + r, h * 0.7, 0.12), r * 0.35, h * 0.3, 'y', col, segs=6)
        x += 2 * r + 0.02
    elif kind < 0.7:                           # a jar
        r = rng.uniform(0.045, 0.06)
        p.cylinder((x + r, 0, 0.12), r, rng.uniform(0.1, 0.16), 'y', srgb(rng.choice([0xb87a4a, 0xd8cfb8, 0x8a5a3a])), segs=10)
        x += 2 * r + 0.02
    else:                                      # a row of books
        for _ in range(rng.randint(3, 6)):
            w, h = rng.uniform(0.025, 0.045), rng.uniform(0.18, 0.24)
            p.box(x, x + w, 0, h, 0.03, 0.2, srgb(rng.choice([0x6a2a22, 0x2a3a5a, 0x3a4a2a, 0x7a6a4a, 0x4a3a2a])), skip=('back', 'bottom'))
            x += w + 0.003
        x += 0.02
parts.append(p.obj('shelf', 'wood'))

p = Part()                                    # a credenza: two panelled doors, drawers, a marble top, a jug and plates
p.box(-0.7, 0.7, 0.1, 0.86, 0, 0.45, J(OAK, 0.04), skip=('back',))
for sx in (-0.66, 0.6): p.box(sx, sx + 0.06, 0, 0.1, 0.02, 0.41, J(DARK), skip=('back',))
for sx in (-1, 1):
    p.box(sx * 0.03, sx * 0.66, 0.16, 0.62, 0.45, 0.47, J(DARK, 0.03), skip=('back',))   # door panels
    p.box(sx * 0.03, sx * 0.66, 0.66, 0.8, 0.45, 0.47, J(DARK, 0.03), skip=('back',))    # drawers
    p.box(sx * 0.1 - 0.012, sx * 0.1 + 0.012, 0.38, 0.42, 0.47, 0.49, srgb(0x9c8a4a), skip=('back',))
p.box(-0.73, 0.73, 0.86, 0.9, -0.0, 0.48, srgb(0xd8d2c6), skip=('back',))                  # marble
p.cylinder((0.35, 0.9, 0.22), 0.07, 0.2, 'y', srgb(0xc9b89a), segs=10)                      # the jug
p.cylinder((0.35, 1.1, 0.22), 0.035, 0.05, 'y', srgb(0xc9b89a), segs=8)
for i, sx in enumerate((-0.4, -0.2)):                                                       # plates leaning on the wall
    disc = [(sx + 0.13 * math.cos(2 * math.pi * k / 14), 1.03 + 0.13 * math.sin(2 * math.pi * k / 14), 0.05 + 0.02 * i) for k in range(14)]
    p.quad(disc, srgb(0xe8e4da if i else 0x3a5a8a))
parts.append(p.obj('credenza', 'wood'))

p = Part()                                    # a fireplace: stone jambs and mantel, a plaster hood to the ceiling, soot, logs
S = 0xb9ad94
for sx in (-1, 1): p.box(sx * 0.55, sx * 0.75, 0, 1.0, 0, 0.42, J(S), skip=('back',))
p.box(-0.82, 0.82, 1.0, 1.14, 0, 0.5, J(S), skip=('back',))                                  # the mantel
p.box(-0.55, 0.55, 0.0, 1.0, 0, 0.02, srgb(0x161210), skip=('back',))                        # the soot-black back
p.box(-0.55, 0.55, 0.0, 0.03, 0.02, 0.42, srgb(0x2a2420), skip=('back', 'bottom'))            # the hearth
bm_hood = [(-0.72, 1.14, 0.45), (0.72, 1.14, 0.45), (0.45, 2.3, 0.2), (-0.45, 2.3, 0.2)]
p.quad(bm_hood, J(0xd6c7a6))
for sx in (-1, 1): p.quad([(sx * 0.72, 1.14, 0), (sx * 0.72, 1.14, 0.45), (sx * 0.45, 2.3, 0.2), (sx * 0.45, 2.3, 0)][::(1 if sx > 0 else -1)], J(0xcdbd9b))
for i in range(3):                                                                            # logs on andirons
    p.cylinder((-0.3, 0.08 + i * 0.06, 0.18 + (i % 2) * 0.08), 0.045, 0.6, 'x', J(0x3a2a1c, 0.15), segs=6)
for sx in (-0.3, 0.3): p.box(sx - 0.015, sx + 0.015, 0.0, 0.12, 0.12, 0.36, srgb(IRON), skip=())
p.box(-0.25, 0.25, 0.03, 0.07, 0.15, 0.33, srgb(0x9a3a10), skip=('back',))                   # embers
parts.append(p.obj('fireplace', 'stone'))

p = Part()                                    # a coat rack: pegs, a field-grey greatcoat, a helmet, a cap
p.box(-0.5, 0.5, 1.62, 1.72, 0, 0.025, J(DARK), skip=('back',))
for sx in (-0.4, -0.13, 0.13, 0.4): p.box(sx - 0.012, sx + 0.012, 1.65, 1.68, 0.02, 0.1, srgb(0x9c8a4a), skip=('back',))
FG = 0x55594a
p.blob((-0.32, 1.25, 0.1), 0.22, J(FG, 0.04), (0.85, 1.9, 0.45), segs=10, rings=7)            # the greatcoat
p.blob((-0.32, 1.6, 0.1), 0.12, J(FG, 0.04), (1.4, 0.5, 0.8), segs=8, rings=5)                # its shoulders
p.blob((0.13, 1.57, 0.14), 0.13, J(0x4e5444, 0.05), (1.0, 0.7, 1.15), segs=12, rings=6)        # a Stahlhelm
p.box(0.03, 0.23, 1.5, 1.53, 0.02, 0.27, J(0x4e5444, 0.05), skip=('back',))                    # its brim
p.blob((0.4, 1.6, 0.1), 0.09, J(FG, 0.04), (1.2, 0.55, 1.0), segs=8, rings=4)                 # a field cap
parts.append(p.obj('coat_rack', 'cloth'))

# ---- on the floor and the tables ----
p = Part()                                    # a rug: a field, a border, a medallion (2 x 1.3)
RUGS = [(0x7a2a22, 0xc9a66a, 0x2a3a5a), (0x2a3a5a, 0xc9b88a, 0x7a2a22), (0x5a4a2a, 0xd8c9a0, 0x6a2a22)]
fc, bc, mc = (srgb(c) for c in rng.choice(RUGS))
for (x0, x1, z0, z1, c, y) in ((-1, 1, -0.65, 0.65, bc, 0.004), (-0.88, 0.88, -0.53, 0.53, fc, 0.006), (-0.3, 0.3, -0.2, 0.2, mc, 0.008), (-0.12, 0.12, -0.08, 0.08, bc, 0.009)):
    p.quad([(x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0)], c)
for k in range(10):                                                                           # stripes on the border
    x = -0.95 + k * 0.21
    for z in (-0.6, 0.55):
        p.quad([(x, 0.007, z + 0.05), (x + 0.08, 0.007, z + 0.05), (x + 0.08, 0.007, z), (x, 0.007, z)], mc)
parts.append(p.obj('rug', 'cloth'))

p = Part()                                    # a pendant lamp: flex, enamel shade, bulb (hangs down from y = 0)
p.cylinder((0, -0.75, 0), 0.006, 0.75, 'y', srgb(IRON), segs=4)
shade = 12
top, bot = [], []
for k in range(shade):
    a = 2 * math.pi * k / shade
    top.append((0.04 * math.cos(a), -0.75, 0.04 * math.sin(a))); bot.append((0.2 * math.cos(a), -0.9, 0.2 * math.sin(a)))
for k in range(shade):
    j = (k + 1) % shade
    p.quad([top[k], top[j], bot[j], bot[k]], srgb(0xe6e2d6))
    p.quad([bot[k], bot[j], top[j], top[k]], srgb(0x2a3a4a))                                 # dark enamel outside
p.blob((0, -0.86, 0), 0.04, srgb(0xfff2c8), segs=6, rings=4)
parts.append(p.obj('pendant', 'ceramic'))

p = Part()                                    # a rush-seated chair, facing +z
for sx in (-0.19, 0.17):
    for sz in (-0.19, 0.17): p.box(sx, sx + 0.025, 0, 0.44, sz, sz + 0.025, J(OAK), skip=())
p.box(-0.21, 0.21, 0.42, 0.46, -0.21, 0.21, J(0xb09a62), skip=())
for sx in (-0.19, 0.17): p.box(sx, sx + 0.025, 0.44, 0.92, -0.21, -0.185, J(OAK), skip=())
for y in (0.62, 0.78, 0.9): p.box(-0.19, 0.19, y, y + 0.04, -0.21, -0.19, J(OAK), skip=())
parts.append(p.obj('chair', 'wood'))

p = Part()                                    # papers on a desk or the floor
for _ in range(7):
    a = rng.uniform(0, math.pi); c, s = math.cos(a), math.sin(a)
    x, z, y = rng.uniform(-0.25, 0.25), rng.uniform(-0.2, 0.2), rng.uniform(0.001, 0.006)
    pts = [(x + u * c - v * s, y, z + u * s + v * c) for u, v in ((-0.105, -0.15), (0.105, -0.15), (0.105, 0.15), (-0.105, 0.15))]
    p.quad(pts[::-1], srgb(rng.choice([0xe8e2d0, 0xddd2b0, 0xe8e8e0])))
parts.append(p.obj('papers', 'paper'))

p = Part()                                    # a table's wine: two bottles, a glass, a plate with bread
for (x, z, col) in ((-0.08, 0.0, 0x2f4a2a), (0.05, -0.06, 0x4a3018)):
    p.cylinder((x, 0, z), 0.035, 0.2, 'y', srgb(col), segs=8); p.cylinder((x, 0.2, z), 0.013, 0.09, 'y', srgb(col), segs=6)
p.cylinder((0.12, 0, 0.08), 0.03, 0.1, 'y', srgb(0x9aa8a8), segs=8)
disc = [(-0.15 + 0.11 * math.cos(2 * math.pi * k / 14), 0.004, 0.12 + 0.11 * math.sin(2 * math.pi * k / 14)) for k in range(14)][::-1]
p.quad(disc, srgb(0xe6e0d2))
p.blob((-0.15, 0.03, 0.12), 0.05, srgb(0xb8884a), (1.4, 0.6, 0.9), segs=8, rings=4)
parts.append(p.obj('bottles', 'ceramic'))

p = Part()                                    # a field telephone: its case, the handset on its cradle, the crank
p.box(-0.13, 0.13, 0, 0.12, -0.1, 0.1, J(0x3a3024, 0.05), skip=('bottom',))
p.box(-0.11, 0.11, 0.12, 0.15, -0.03, 0.03, srgb(0x1a1a18), skip=('bottom',))
p.box(0.13, 0.17, 0.05, 0.07, -0.01, 0.01, srgb(IRON), skip=())
parts.append(p.obj('phone', 'wood'))

p = Part()                                    # a typewriter with a sheet in it
p.box(-0.16, 0.16, 0, 0.08, -0.13, 0.13, srgb(0x1c1c1c), skip=('bottom',))
p.box(-0.18, 0.18, 0.08, 0.13, -0.06, 0.0, srgb(0x2a2a2a), skip=('bottom',))
p.quad([(-0.1, 0.12, -0.03), (0.1, 0.12, -0.03), (0.1, 0.3, -0.06), (-0.1, 0.3, -0.06)], srgb(0xe8e4d8))
for k in range(4):
    p.box(-0.13, 0.13, 0.08 - k * 0.015, 0.09 - k * 0.015, 0.03 + k * 0.025, 0.05 + k * 0.025, srgb(0x8a8a80), skip=('bottom',))
parts.append(p.obj('typewriter', 'iron'))

p = Part()                                    # grain sacks, slumped against each other
for (x, z, r, y) in ((-0.3, 0.0, 0.3, 0.0), (0.25, 0.05, 0.28, 0.0), (0.0, -0.05, 0.27, 0.42)):
    p.blob((x, y + r * 0.75, z), r, J(0xb0a07a, 0.08), (1.0, 0.8, 0.75), segs=10, rings=6)
parts.append(p.obj('sacks', 'cloth'))

p = Part()                                    # a demijohn in its wicker
p.blob((0, 0.24, 0), 0.22, J(0x8a6a3a, 0.05), (1, 1.05, 1), segs=12, rings=8)
p.cylinder((0, 0.44, 0), 0.04, 0.12, 'y', srgb(0x3a5a3a), segs=8)
parts.append(p.obj('demijohn', 'cloth'))

# ---- furniture standing in the room ----
p = Part()                                    # a farmhouse table, 1.6 x 0.85, its top at 0.76
p.box(-0.8, 0.8, 0.72, 0.76, -0.425, 0.425, J(OAK, 0.04), skip=())
for sx in (-0.72, 0.66):
    for sz in (-0.36, 0.3): p.box(sx, sx + 0.06, 0, 0.72, sz, sz + 0.06, J(DARK), skip=('top',))
for sz in (-0.36, 0.3): p.box(-0.66, 0.66, 0.6, 0.68, sz + 0.01, sz + 0.05, J(DARK), skip=())      # aprons
p.box(-0.66, 0.66, 0.1, 0.14, -0.02, 0.02, J(DARK), skip=())                                        # the stretcher
parts.append(p.obj('table', 'wood', 0.006))

p = Part()                                    # a bench to go with it
p.box(-0.7, 0.7, 0.42, 0.46, -0.14, 0.14, J(OAK, 0.05), skip=())
for sx in (-0.6, 0.55): p.box(sx, sx + 0.05, 0, 0.42, -0.1, 0.1, J(DARK), skip=('top',))
parts.append(p.obj('bench', 'wood'))

p = Part()                                    # a three-legged stool
p.cylinder((0, 0.42, 0), 0.16, 0.04, 'y', J(OAK), segs=10)
for k in range(3):
    a = 2 * math.pi * k / 3
    x, z = 0.1 * math.cos(a), 0.1 * math.sin(a)
    p.box(x - 0.015, x + 0.015, 0, 0.42, z - 0.015, z + 0.015, J(DARK), skip=('top',))
parts.append(p.obj('stool', 'wood'))

p = Part()                                    # an iron bedstead: headboard at z = 0 (the wall), 0.95 x 1.95
for sx in (-0.47, 0.44):
    p.cylinder((sx + 0.015, 0, 0.02), 0.018, 1.05, 'y', srgb(IRON), segs=6)                       # head posts
    p.cylinder((sx + 0.015, 0, 1.93), 0.018, 0.75, 'y', srgb(IRON), segs=6)                       # foot posts
for y in (0.55, 0.98): p.cylinder((-0.47, y, 0.02), 0.012, 0.94, 'x', srgb(IRON), segs=5)
for y in (0.5, 0.7): p.cylinder((-0.47, y, 1.93), 0.012, 0.94, 'x', srgb(IRON), segs=5)
for k in range(7):                                                                                   # the headboard's rails
    x = -0.39 + k * 0.13
    p.box(x - 0.006, x + 0.006, 0.55, 0.98, 0.014, 0.026, srgb(IRON), skip=())
p.box(-0.46, 0.46, 0.3, 0.5, 0.05, 1.9, J(0xd8d0bc, 0.03), skip=('bottom', 'back'))                # the mattress
p.box(-0.48, 0.48, 0.36, 0.53, 0.55, 1.92, J(0x6a3a2a, 0.05), skip=('bottom', 'back'))             # the blanket
p.box(-0.48, 0.48, 0.1, 0.36, 1.9, 1.92, J(0x6a3a2a, 0.05), skip=('back',))                        # its fall at the foot
p.blob((0, 0.56, 0.3), 0.2, srgb(0xe8e4d8), (1.6, 0.35, 0.8), segs=10, rings=5)                     # the pillow
parts.append(p.obj('bed', 'cloth'))

p = Part()                                    # a wardrobe: two panelled doors, a cornice, a suitcase on top
p.box(-0.5, 0.5, 0.06, 1.9, 0, 0.55, J(OAK, 0.04), skip=('back',))
p.box(-0.55, 0.55, 1.9, 1.98, 0, 0.6, J(DARK), skip=('back',))
p.box(-0.5, 0.5, 0, 0.06, 0.02, 0.53, J(DARK), skip=('back',))
for sx in (-1, 1):
    p.box(min(sx * 0.03, sx * 0.44), max(sx * 0.03, sx * 0.44), 0.2, 1.05, 0.55, 0.57, J(DARK, 0.03), skip=('back',))
    p.box(min(sx * 0.03, sx * 0.44), max(sx * 0.03, sx * 0.44), 1.12, 1.78, 0.55, 0.57, J(DARK, 0.03), skip=('back',))
    p.box(sx * 0.05 - 0.01, sx * 0.05 + 0.01, 1.0, 1.12, 0.57, 0.59, srgb(0x9c8a4a), skip=('back',))
p.box(-0.35, 0.25, 1.98, 2.2, 0.1, 0.48, J(0x6a4a2a, 0.06), skip=('bottom',))                       # the suitcase
parts.append(p.obj('wardrobe', 'wood'))

p = Part()                                    # a washstand: basin and jug, a towel, a little mirror
p.box(-0.35, 0.35, 0.74, 0.78, 0, 0.42, srgb(0xd8d2c6), skip=('back',))
for sx in (-0.32, 0.28):
    for sz in (0.02, 0.36): p.box(sx, sx + 0.04, 0, 0.74, sz, sz + 0.04, J(OAK), skip=('top',))
p.box(-0.32, 0.32, 0.12, 0.15, 0.02, 0.4, J(OAK), skip=())
p.cylinder((-0.05, 0.78, 0.22), 0.16, 0.08, 'y', srgb(0xe8e4da), segs=12)
p.cylinder((0.2, 0.78, 0.18), 0.06, 0.2, 'y', srgb(0xe8e4da), segs=10)
p.box(0.33, 0.37, 0.4, 0.72, 0.08, 0.34, srgb(0xe6e0d0), skip=())                                   # the towel
p.box(-0.18, 0.18, 1.15, 1.6, 0, 0.02, J(DARK), skip=('back',))
p.quad([(-0.15, 1.18, 0.021), (0.15, 1.18, 0.021), (0.15, 1.57, 0.021), (-0.15, 1.57, 0.021)], srgb(0x9aa8b0))
parts.append(p.obj('washstand', 'ceramic'))

p = Part()                                    # a cassone: a chest for the foot of a bed or under a window
p.box(-0.55, 0.55, 0.06, 0.5, 0, 0.48, J(0x6a4a2a, 0.05), skip=('back',))
p.box(-0.58, 0.58, 0.5, 0.56, 0, 0.51, J(DARK), skip=('back',))
p.box(-0.55, 0.55, 0, 0.06, 0.02, 0.46, J(DARK), skip=('back',))
for sx in (-0.3, 0.3): p.box(sx - 0.18, sx + 0.18, 0.14, 0.42, 0.48, 0.495, J(0x5a3a22, 0.04), skip=('back',))
parts.append(p.obj('chest', 'wood'))

def turned(turn):
    c, s = math.cos(turn), math.sin(turn)
    return Matrix(((c, 0, s), (0, 1, 0), (-s, 0, c)))

p = Part()                                    # ammunition boxes, stacked, stencilled, rope handles
for (x, y, z, turn) in ((-0.3, 0, 0, 0), (0.28, 0, 0.02, 0), (-0.02, 0.3, 0.0, 0.12)):
    w, h, d, rot = 0.55, 0.3, 0.38, turned(turn)
    p.box(x - w / 2, x + w / 2, y, y + h, z - d / 2, z + d / 2, J(0x5a5c44, 0.08), rot=rot, pivot=(x, 0, z), skip=('bottom',))
    p.box(x - 0.12, x + 0.12, y + h, y + h + 0.003, z - 0.06, z + 0.06, srgb(0xd8d0b0), rot=rot, pivot=(x, 0, z), skip=('bottom',))
    for sx in (-1, 1): p.box(x + sx * w / 2 - 0.02, x + sx * w / 2 + 0.02, y + h * 0.55, y + h * 0.7, z - 0.06, z + 0.06, srgb(IRON), rot=rot, pivot=(x, 0, z), skip=())
parts.append(p.obj('crates', 'wood'))

p = Part()                                    # jerrycans
for (x, z, turn) in ((-0.17, 0, 0.0), (0.17, 0.02, 0.15)):
    rot = turned(turn)
    p.box(x - 0.17, x + 0.17, 0, 0.47, z - 0.08, z + 0.08, J(0x4e5444, 0.05), rot=rot, pivot=(x, 0, z), skip=('bottom',))
    p.box(x - 0.12, x + 0.04, 0.47, 0.51, z - 0.02, z + 0.02, J(0x3e4436, 0.05), rot=rot, pivot=(x, 0, z), skip=('bottom',))
    p.box(x - 0.13, x + 0.13, 0.16, 0.3, z + 0.08, z + 0.086, J(0x5a6050, 0.05), rot=rot, pivot=(x, 0, z), skip=('back',))   # the X pressing
parts.append(p.obj('jerrycans', 'iron'))

p = Part()                                    # a field radio for a table: the set, its dials, the handset, a whip aerial
p.box(-0.2, 0.2, 0, 0.3, -0.13, 0.13, J(0x4e5444, 0.04), skip=('bottom',))
p.quad([(-0.17, 0.04, 0.131), (0.17, 0.04, 0.131), (0.17, 0.27, 0.131), (-0.17, 0.27, 0.131)], srgb(0x2a2a26))
for (x, y) in ((-0.1, 0.2), (0.0, 0.2), (0.1, 0.2), (-0.06, 0.1), (0.06, 0.1)):
    p.box(x - 0.016, x + 0.016, y - 0.016, y + 0.016, 0.131, 0.15, srgb(0xc8c0a8), skip=('back',))
p.box(0.1, 0.16, 0.3, 0.33, -0.08, 0.08, srgb(0x1a1a18), skip=('bottom',))
p.cylinder((0.16, 0.3, -0.1), 0.004, 0.9, 'y', srgb(IRON), segs=4)
parts.append(p.obj('radio', 'iron'))

p = Part()                                    # a staff map spread on a table, a river and an arrow on it, and a lamp
r2 = random.Random(12)                        # (its own, so the cotto below keeps its tiles)
p.quad([(-0.45, 0.003, 0.32), (0.45, 0.003, 0.32), (0.45, 0.003, -0.32), (-0.45, 0.003, -0.32)], srgb(0xd9cfa8))
for _ in range(9):
    x, z, w, d = r2.uniform(-0.42, 0.25), r2.uniform(-0.3, 0.15), r2.uniform(0.08, 0.2), r2.uniform(0.06, 0.15)
    p.quad([(x, 0.004, z + d), (x + w, 0.004, z + d), (x + w, 0.004, z), (x, 0.004, z)], srgb(r2.choice([0xc8d0a0, 0xb8c89a, 0xdcd4b4])))
p.quad([(-0.45, 0.005, 0.065), (0.45, 0.005, -0.105), (0.45, 0.005, -0.12), (-0.45, 0.005, 0.05)], srgb(0x4a7aa8))
p.quad([(0.05, 0.006, 0.02), (0.2, 0.006, 0.12), (0.2, 0.006, 0.1), (0.05, 0.006, 0.0)], srgb(0xb02020))
p.cylinder((0.6, 0, 0.0), 0.08, 0.02, 'y', srgb(IRON), segs=8)
p.cylinder((0.6, 0.02, 0.0), 0.01, 0.32, 'y', srgb(IRON), segs=4)
p.blob((0.6, 0.36, 0.0), 0.08, srgb(0x3a4a3a), (1, 0.6, 1), segs=8, rings=4)
parts.append(p.obj('map_table', 'paper'))

os.makedirs(MODELS, exist_ok=True)
export(parts, os.path.join(MODELS, 'interior_kit.glb'))

# ---- the cotto: square terracotta tiles, 25 cm, in a 2 m repeat, rendered from above ----
reset()
sc = bpy.context.scene
import kitparts
kitparts.MATS.clear()                         # (the reset removed the kit's materials)
from kitparts import Part as P2
tiles = P2()
N = 8
for i in range(N):
    for j in range(N):
        x0, z0 = i * 0.25 + 0.004, j * 0.25 + 0.004
        c = srgb(rng.choice([0xc98a62, 0xd09468, 0xbf7c56, 0xc48660, 0xb87452, 0xcf9a72]))
        f = 0.9 + 0.2 * rng.random()
        h = 0.012 + rng.uniform(-0.002, 0.002)
        tiles.box(x0, x0 + 0.242, 0, h, -z0 - 0.242, -z0, [min(1, v * f) for v in c], skip=('bottom',))
tiles.box(0, 2, -0.01, 0.004, -2, 0, srgb(0x9a8a74), skip=('bottom',))          # the grout
ob = tiles.obj('tiles', 'stone', 0.003)
cam = ortho_camera((1, 1, 0), 2.0, 'top', (1024, 1024))
alb = albedo_material('alb', vertex_color, ao=0.35, ao_dist=0.01)
nrm = normal_material('nrm')
sc.render.film_transparent = False
os.makedirs(TEXTURES, exist_ok=True)
tmp = bpy.app.tempdir
render(os.path.join(tmp, 'cotto.png'), alb)
render(os.path.join(tmp, 'cotto_n.png'), nrm, raw=True)
for name in ('cotto', 'cotto_n'):
    im = bpy.data.images.load(os.path.join(tmp, name + '.png'))
    im.file_format = 'JPEG'
    sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 88
    im.save_render(os.path.join(TEXTURES, name + '.jpg'), scene=sc)
print('wrote cotto textures', TEXTURES)
