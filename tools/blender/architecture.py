# The architecture kit: the dressing that turns the game's box-built houses into Italian ones
# (run: blender -b -P tools/blender/architecture.py -- <out dir (public/models)>).
# Writes arch_kit.glb, one mesh per part, each modelled at 1 m along the axis the game stretches it
# on (see src/world/arch.js), with the stone chamfered (a bevel catches the light where a box doesn't):
#   win_sill, win_lintel (stretched along x), win_jamb (along y), win_casement, win_glass (1 x 1),
#   shutter (1 x 1, a louvred persiana hinged on its x = 0 edge), door_jamb, door_lintel (keystone),
#   eave (1 m of cornice: a moulding, rafter tails and the tile ends), ridge (1 m of ridge tiles),
#   plinth (1 m of the stone base), quoin (one storey of corner stones), chimney, balcony, pipe.
# Coordinates as the game sees them: x along the wall, y up, +z out of the wall (its face at z = 0);
# an opening's part has its origin at the bottom centre of the opening.
# Colours are vertex colours (the game makes one material per part's material name: stone, wood,
# frame, glass, tile, iron) with a little variation per block.
import bpy, math, os, sys
from mathutils import Vector, Matrix
sys.path.append(os.path.dirname(__file__))
from kitparts import srgb, jitter, Part, export, rng

OUT = sys.argv[-1]
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

STONE = srgb(0xb3a68b)      # pietra serena / travertine dressing (taken down for the game's sun)
BASE = srgb(0x8e8270)       # the weathered base course
TILE = srgb(0xa65a3b)       # terracotta
WOOD = srgb(0xe8e8e8)       # shutters: painted, tinted per house in the game
FRAME = srgb(0xbdb4a2)      # casements: old white paint
GLASS = srgb(0x1a2025)
IRON = srgb(0x262625)
parts = []
# Kept lean: a town has a thousand windows. No face against the wall, single-sided louvres and
# railings (the game draws those materials from both sides), and bevels only where they catch the eye.

# ---- windows ----
p = Part()                                    # the sill: a slab proud of the wall
p.box(-0.5, 0.5, -0.07, 0, -0.03, 0.11, jitter(STONE))
parts.append(p.obj('win_sill', 'stone', 0.012))

p = Part()                                    # the lintel, with a thin cornice on top
p.box(-0.5, 0.5, 0, 0.14, -0.02, 0.045, jitter(STONE), skip=('back', 'bottom'))
p.profile([(0.14, -0.02), (0.14, 0.06), (0.19, 0.085), (0.19, -0.02)], -0.52, 0.52, jitter(STONE))
parts.append(p.obj('win_lintel', 'stone'))

p = Part()                                    # a jamb of the surround (0.12 wide)
p.box(-0.06, 0.06, 0, 1, -0.02, 0.035, jitter(STONE), skip=('back', 'top', 'bottom'))
parts.append(p.obj('win_jamb', 'stone'))

p = Part()                                    # the casement: frame, mullion and two transoms (1 x 1)
for x0, x1, y0, y1 in ((-0.5, -0.45, 0, 1), (0.45, 0.5, 0, 1), (-0.5, 0.5, 0, 0.06), (-0.5, 0.5, 0.94, 1),
                       (-0.022, 0.022, 0, 1), (-0.5, 0.5, 0.64, 0.675), (-0.5, 0.5, 0.31, 0.335)):
    p.quad([(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)], jitter(FRAME, 0.03))
parts.append(p.obj('win_casement', 'frame'))

p = Part()
p.quad([(-0.5, 0, -0.025), (0.5, 0, -0.025), (0.5, 1, -0.025), (-0.5, 1, -0.025)], GLASS)
parts.append(p.obj('win_glass', 'glass'))

p = Part()                                    # a louvred shutter, hinged at x = 0, 1 wide and 1 tall
for x0, x1, y0, y1 in ((0, 0.08, 0, 1), (0.92, 1, 0, 1), (0.08, 0.92, 0, 0.07), (0.08, 0.92, 0.93, 1), (0.08, 0.92, 0.47, 0.53)):
    p.quad([(x0, y0, 0.04), (x1, y0, 0.04), (x1, y1, 0.04), (x0, y1, 0.04)], WOOD)
tilt = Matrix.Rotation(math.radians(-40), 3, 'X')
for y0, y1 in ((0.07, 0.47), (0.53, 0.93)):
    n = 6
    for i in range(n):
        yc = y0 + (i + 0.5) * (y1 - y0) / n
        h = (y1 - y0) / n * 0.95
        pts = [Vector((0.08, -h / 2, 0)), Vector((0.92, -h / 2, 0)), Vector((0.92, h / 2, 0)), Vector((0.08, h / 2, 0))]
        p.quad([tilt @ q + Vector((0, yc, 0.022)) for q in pts], [c * 0.9 for c in WOOD])
parts.append(p.obj('shutter', 'wood'))

# ---- doors ----
p = Part()                                    # a door jamb (0.2 wide, a step out from the wall)
p.box(-0.1, 0.1, 0.12, 1, -0.02, 0.06, jitter(STONE), skip=('back', 'bottom', 'top'))
p.box(-0.13, 0.13, 0, 0.12, -0.02, 0.09, jitter(STONE, 0.1), skip=('back', 'bottom'))   # its plinth block
parts.append(p.obj('door_jamb', 'stone', 0.012))

p = Part()                                    # the lintel over a door, with its keystone
p.box(-0.5, 0.5, 0, 0.26, -0.02, 0.06, jitter(STONE))
p.box(-0.09, 0.09, -0.04, 0.3, -0.02, 0.1, jitter(STONE, 0.1))
p.profile([(0.26, -0.02), (0.26, 0.08), (0.32, 0.11), (0.32, -0.02)], -0.55, 0.55, jitter(STONE))
parts.append(p.obj('door_lintel', 'stone', 0.012))

# ---- roofs ----
p = Part()                                    # 1 m of eave: a moulded cornice and two rafter tails
p.profile([(0.0, -0.01), (0.0, 0.04), (0.06, 0.07), (0.1, 0.14), (0.16, 0.16), (0.16, -0.01)], 0, 1, jitter(STONE, 0.03), caps=False)
for x in (0.25, 0.75):                         # the rafter tails (mensole)
    p.box(x - 0.045, x + 0.045, 0.16, 0.26, -0.01, 0.48, jitter(srgb(0x5e4a38), 0.08), skip=('back', 'top'))
p.box(0, 1, 0.26, 0.29, -0.01, 0.5, jitter(srgb(0x8a7258), 0.05), skip=('back', 'top', 'left', 'right'))   # the boards over them
parts.append(p.obj('eave', 'stone'))

p = Part()                                    # 1 m of ridge: three overlapping coppi
for i in range(3):
    p.cylinder((i / 3 - 0.01, 0.0, 0.0), 0.12 + 0.012 * (i % 2), 0.36, 'x', jitter(TILE, 0.14), segs=10, half=True)
parts.append(p.obj('ridge', 'tile'))

p = Part()                                    # the stone base course (0.7 tall): two courses and a chamfered top
p.profile([(0.0, 0.05), (0.34, 0.05), (0.35, 0.04)], 0, 1, jitter(BASE, 0.03), caps=False)
p.profile([(0.35, 0.04), (0.36, 0.05), (0.7, 0.05), (0.74, 0.0)], 0, 1, [c * 1.08 for c in BASE], caps=False)
parts.append(p.obj('plinth', 'stone'))

p = Part()                                    # one storey (1.6 m) of quoins: long and short blocks turn the corner
for i, (y0, y1) in enumerate(((0, 0.38), (0.4, 0.78), (0.8, 1.18), (1.2, 1.58))):
    lx, lz = (0.62, 0.32) if i % 2 == 0 else (0.32, 0.62)
    c = jitter(STONE, 0.08)
    p.box(-lx, 0.04, y0, y1, -0.0, 0.04, c, skip=('back', 'right'))   # on the face looking +z (the corner at x = 0)
    p.box(0.0, 0.04, y0, y1, -lz, 0.0, c, skip=('left', 'front'))    # and on the face looking +x
parts.append(p.obj('quoin', 'stone'))

p = Part()                                    # a chimney: plastered stack, a tile cap on brick piers
STUCCO = srgb(0xb09d80)
p.box(-0.32, 0.32, 0, 1.3, -0.32, 0.32, jitter(STUCCO), skip=('bottom',))
p.box(-0.38, 0.38, 1.3, 1.38, -0.38, 0.38, jitter(STONE), skip=())
for sx in (-0.26, 0.26):
    for sz in (-0.26, 0.26): p.box(sx - 0.06, sx + 0.06, 1.38, 1.62, sz - 0.06, sz + 0.06, jitter(srgb(0x8c4f35), 0.1), skip=('top', 'bottom'))
p.box(-0.44, 0.44, 1.62, 1.68, -0.44, 0.44, jitter(STONE), skip=())
for sz in (-0.18, 0.18): p.cylinder((-0.46, 1.72, sz), 0.13, 0.92, 'x', jitter(TILE, 0.1), segs=8, half=True)
parts.append(p.obj('chimney', 'stone'))

p = Part()                                    # a balcony: a stone slab on corbels, a wrought-iron rail
p.box(-0.8, 0.8, -0.12, 0, 0, 0.62, jitter(STONE))
for sx in (-0.6, 0, 0.6): p.box(sx - 0.07, sx + 0.07, -0.42, -0.12, 0, 0.45, jitter(STONE), skip=('back', 'top'))
r = Part()
for y in (0.08, 0.92): r.quad([(-0.78, y, 0.6), (0.78, y, 0.6), (0.78, y + 0.035, 0.6), (-0.78, y + 0.035, 0.6)], IRON)
for x in [-0.78 + i * 0.104 for i in range(16)]:
    r.quad([(x - 0.01, 0.08, 0.6), (x + 0.01, 0.08, 0.6), (x + 0.01, 0.92, 0.6), (x - 0.01, 0.92, 0.6)], IRON)
for sx in (-0.78, 0.78):
    for y in (0.08, 0.92): r.quad([(sx, y, 0), (sx, y, 0.6), (sx, y + 0.035, 0.6), (sx, y + 0.035, 0)], IRON)
    for zz in [0.1 * i for i in range(1, 6)]: r.quad([(sx, 0.08, zz - 0.01), (sx, 0.92, zz - 0.01), (sx, 0.92, zz + 0.01), (sx, 0.08, zz + 0.01)], IRON)
parts.append(p.obj('balcony', 'stone'))
parts.append(r.obj('railing', 'iron'))

p = Part()                                    # 1 m of downpipe, with a bracket
p.cylinder((0, 0, 0.09), 0.05, 1.0, 'y', jitter(srgb(0x63676a), 0.05), segs=6)
p.box(-0.065, 0.065, 0.45, 0.5, 0, 0.12, IRON)
parts.append(p.obj('pipe', 'iron'))


# ---- facades, pass 2: what stops a house reading as a box ----
p = Part()                                    # a string course: the stone band between storeys (1 m)
p.profile([(0.0, -0.01), (0.0, 0.05), (0.09, 0.075), (0.13, 0.045), (0.16, 0.0)], 0, 1, jitter(STONE, 0.03), caps=False)
parts.append(p.obj('band', 'stone'))

p = Part()                                    # a panelled double door, set back in its opening (1 x 1, stretched)
for sx in (-1, 1):
    x0, x1 = (-0.5, -0.01) if sx < 0 else (0.01, 0.5)
    p.quad([(x0, 0, -0.08), (x1, 0, -0.08), (x1, 1, -0.08), (x0, 1, -0.08)], WOOD)
    for y0, y1 in ((0.08, 0.42), (0.5, 0.92)):                          # the raised panels
        a, b = x0 + 0.07, x1 - 0.07
        p.box(a, b, y0, y1, -0.08, -0.06, [c * 0.9 for c in WOOD], skip=('back',))
    k = 0.04 if sx < 0 else -0.04
p.box(-0.06, -0.03, 0.47, 0.5, -0.08, -0.04, srgb(0x9c8a4a), skip=('back',))   # the handles
p.box(0.03, 0.06, 0.47, 0.5, -0.08, -0.04, srgb(0x9c8a4a), skip=('back',))
parts.append(p.obj('door_leaf', 'wood'))

p = Part()                                    # a shop front: a round-arched stone surround (2.4 x 3.2), plank shutters, a fanlight
W, H, R = 2.4, 3.2, 1.2
spring = H - R
for sx in (-1, 1): p.box(sx * W / 2, sx * (W / 2 + 0.28), 0, spring, -0.02, 0.07, jitter(STONE), skip=('back',))
n = 11
for i in range(n):                                                  # the voussoirs
    a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
    pts = [(R * math.cos(a0), spring + R * math.sin(a0)), (R * math.cos(a1), spring + R * math.sin(a1)),
           ((R + 0.3) * math.cos(a1), spring + (R + 0.3) * math.sin(a1)), ((R + 0.3) * math.cos(a0), spring + (R + 0.3) * math.sin(a0))]
    c = jitter(STONE, 0.1) if i != n // 2 else jitter(STONE, 0.02)
    p.quad([(x, y, 0.07 + (0.03 if i == n // 2 else 0)) for x, y in pts][::-1], c)   # (wound to face out)
    p.quad([(pts[0][0], pts[0][1], -0.02), (pts[1][0], pts[1][1], -0.02), (pts[1][0], pts[1][1], 0.07), (pts[0][0], pts[0][1], 0.07)], [v * 0.85 for v in c])
for k in range(10):                                                 # the plank shutters, pulled down
    x0 = -W / 2 + k * W / 10
    p.quad([(x0, 0, -0.1), (x0 + W / 10 - 0.01, 0, -0.1), (x0 + W / 10 - 0.01, spring, -0.1), (x0, spring, -0.1)], [c * (0.85 + 0.15 * (k % 2)) for c in srgb(0x6a5038)])
for i in range(n):                                                  # the fanlight: dark glass behind an iron fan
    a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
    p.quad([(0, spring, -0.1), (R * math.cos(a0), spring + R * math.sin(a0), -0.1), (R * math.cos(a1), spring + R * math.sin(a1), -0.1)], GLASS)
    p.quad([(0.02 * math.cos(a0), spring, -0.09), (R * math.cos(a0) - 0.01, spring + R * math.sin(a0), -0.09), (R * math.cos(a0) + 0.01, spring + R * math.sin(a0), -0.09)], IRON)
p.box(-W / 2, W / 2, spring - 0.06, spring, -0.12, -0.04, srgb(0x4a3828), skip=('back',))
parts.append(p.obj('shop', 'frame'))           # (a double-sided material: its arch is single sheets)

p = Part()                                    # a striped canvas awning over a shop (2.6 wide), on iron arms
STRIPES = (srgb(0xc9b89a), srgb(0x8a3a2a))
for k in range(13):
    x0, x1 = -1.3 + k * 0.2, -1.1 + k * 0.2
    c = STRIPES[k % 2]
    p.quad([(x0, 0, 0.05), (x1, 0, 0.05), (x1, -0.55, 0.95), (x0, -0.55, 0.95)], c)
    p.quad([(x0, -0.55, 0.95), (x1, -0.55, 0.95), (x1, -0.75, 0.97), (x0, -0.75, 0.97)], [v * 0.9 for v in c])   # the valance
for sx in (-1.25, 1.25): p.box(sx - 0.012, sx + 0.012, -0.57, -0.53, 0, 0.95, IRON, skip=())
parts.append(p.obj('awning', 'cloth'))

p = Part()                                    # a window box of geraniums (1 m, stretched to the window)
p.box(-0.5, 0.5, 0, 0.16, 0.0, 0.2, jitter(srgb(0x9a5a3a), 0.05), skip=('back',))
for i in range(8):                            # (kept to a few blobs: a town has hundreds of these)
    x = -0.42 + i * 0.12 + rng.uniform(-0.02, 0.02)
    p.blob((x, 0.2, 0.1 + rng.uniform(-0.04, 0.04)), 0.075, jitter(srgb(0x3e5a2a), 0.12), (1, 0.7, 1), segs=5, rings=3)
    if rng.random() < 0.8:
        p.blob((x + rng.uniform(-0.02, 0.02), 0.28, 0.1 + rng.uniform(-0.05, 0.05)), 0.045, srgb(rng.choice([0xc0202a, 0xd8405a, 0xe06878, 0xb01820, 0xe8e0e0])), segs=4, rings=3)
parts.append(p.obj('planter', 'tile'))

p = Part()                                    # a wall lantern on a scrolled iron bracket
p.box(-0.02, 0.02, 0, 0.25, 0, 0.02, IRON, skip=('back',))
p.box(-0.01, 0.01, 0.2, 0.23, 0, 0.42, IRON, skip=())
p.box(-0.08, 0.08, -0.08, 0.14, 0.34, 0.5, srgb(0x1c1c1a), skip=())
p.box(-0.065, 0.065, -0.06, 0.12, 0.355, 0.485, srgb(0xe8d8a0), skip=())                  # its glass
p.box(-0.1, 0.1, 0.14, 0.17, 0.32, 0.52, srgb(0x1c1c1a), skip=())
parts.append(p.obj('lantern', 'iron'))

p = Part()                                    # a street shrine: a little arched niche with a Madonna and flowers
p.box(-0.32, 0.32, 0, 0.06, 0, 0.16, jitter(STONE), skip=('back',))
for sx in (-1, 1): p.box(sx * 0.22, sx * 0.3, 0.06, 0.62, 0, 0.08, jitter(STONE), skip=('back',))
for i in range(7):
    a0, a1 = math.pi * i / 7, math.pi * (i + 1) / 7
    p.quad([(0.22 * math.cos(a0), 0.62 + 0.22 * math.sin(a0), 0.08), (0.22 * math.cos(a1), 0.62 + 0.22 * math.sin(a1), 0.08),
            (0.3 * math.cos(a1), 0.62 + 0.3 * math.sin(a1), 0.08), (0.3 * math.cos(a0), 0.62 + 0.3 * math.sin(a0), 0.08)], jitter(STONE, 0.04))
p.quad([(-0.22, 0.06, 0.005), (0.22, 0.06, 0.005), (0.22, 0.84, 0.005), (-0.22, 0.84, 0.005)], srgb(0x2a4a7a))   # its blue ground
p.blob((0, 0.32, 0.06), 0.07, srgb(0x3a5a9a), (0.8, 2.2, 0.6), segs=8, rings=5)                     # the figure's robe
p.blob((0, 0.52, 0.06), 0.035, srgb(0xd8c0a0), segs=6, rings=4)
for sx in (-0.15, 0.15): p.blob((sx, 0.1, 0.1), 0.04, srgb(0xd8405a), segs=6, rings=4)
parts.append(p.obj('shrine', 'stone'))

export(parts, os.path.join(OUT, 'arch_kit.glb'))
