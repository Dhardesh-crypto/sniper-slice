// A biome per mission: what grows on a map and what its bare ground looks like, picked with one
// setting on the map,
//   biome: 'alpine'          or, with its own numbers,   biome: { kind: 'alpine', treeLine: 120, snowLine: 150 }
// so no two missions' country looks alike. A biome is only a set of defaults for things a map
// could already say for itself, and a map's own setting still wins: its `forest` (which trees, how
// many, where: vegetation.js), its `ground` (the detail scattered on it: ground.js), its
// `grassDensity`, and the ground's colours (terrain.js paints the biome first, then the map's own
// `paint` on top).
//
//   tuscan      today's default and the reference: olive groves, cypress, umbrella pine. A map
//               with no `biome` is this, built exactly as before (nothing here is consulted).
//   alpine      larch and fir up to a tree line, thinning as they climb; juniper and fern under
//               them; above it scree and bare rock, and snow above the snow line.
//   coast       gorse on the dry ground, marram grass on the dunes, sand below, a few wind-bent
//               pines inland; stones along the shore.
//   heath       heath and marsh: heather everywhere dry, birch in clumps, reeds along every water's
//               edge and through the wet ground, dark peat where it is low.
//   bocage      hedged fields: small fields in different greens (some ploughed), hedges along the
//               map's `hedges` lines, beech and birch standing in the fields.
//   limestone   limestone scrub: pale rock showing through thin dry grass, juniper and lentisk,
//               stones and scree, hardly a tree.
//
// Counts are per square kilometre of map, so a 1400 × 700 m map and an 800 m one are equally
// dense. Where a thing grows is decided from `at`: { x, z, y (height), up (the ground normal's y:
// 1 level, 0.7 about 45°), water (the surface of the water whose outline covers the spot, or
// null), sea (the map's waterLevel or null), o (the biome's numbers) }.
// New species come from the repo's own Blender tools (tools/blender/trees.py: larch, birch;
// biome_ground.py: gorse, heather, reed, marram, juniper, hedge, scree → models/ground_biome.glb).
import { fbm, smoothstep, clamp } from './noise.js';

const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
// Blend the colour being painted (a THREE.Color, or anything with r, g, b) toward [r, g, b] by k.
const toward = (c, [r, g, b], k) => { c.r += (r - c.r) * k; c.g += (g - c.g) * k; c.b += (b - c.b) * k; };
const dryAbove = (at, m = 0.4) => at.water == null || at.y > at.water + m;
const SNOW = rgb(0xeef1f6), SCREE = rgb(0x8f8b84), SAND = rgb(0xcdbb8e), PEAT = rgb(0x3d3528), HEATH = rgb(0x6d5a52),
  CHALK = rgb(0xc9c4b4), PLOUGH = rgb(0x6f5a44), LUSH = rgb(0x5c8a34), HAY = rgb(0xa9a45a), MOOR = rgb(0x6e7440);

export const BIOMES = {
  tuscan: null,

  alpine: {
    o: { treeLine: 95, snowLine: 135 },             // metres of height: trees stop, snow begins
    trees: {
      counts: { larch: 5200, fir: 2600 }, spacing: 4,
      // Larch on the open slopes and up to the tree line (the last ones scattered), fir in the
      // lower, damper ground; nothing on rock too steep to root in.
      density(name, at) {
        if (at.up < 0.72 || !dryAbove(at, 0.6)) return 0;
        const line = 1 - smoothstep(at.o.treeLine - 35, at.o.treeLine, at.y + (fbm(at.x * 0.01, at.z * 0.01, 2) - 0.5) * 30);
        const low = smoothstep(0.42, 0.6, fbm(at.x * 0.006 + 3, at.z * 0.006 + 9, 2)) * (1 - smoothstep(at.o.treeLine - 60, at.o.treeLine - 20, at.y));
        const stand = smoothstep(0.3, 0.55, fbm(at.x * 0.009 + 21, at.z * 0.009 - 5, 3));   // (woods and clearings)
        return line * stand * (name === 'fir' ? low : 1 - 0.8 * low);
      },
    },
    ground: {
      fern: { n: 5200, where: (at) => at.y < at.o.treeLine - 25 && dryAbove(at) },
      juniper: { n: 1500, where: (at) => at.y > at.o.treeLine - 70 && at.y < at.o.treeLine + 25 && dryAbove(at) },
      scree: { n: 2600, where: (at) => (at.y > at.o.treeLine + 8 || at.up < 0.86) && dryAbove(at) },
      rock1: 900, rock2: 2400, rock3: 260, branch: 900,
      reed: { n: 700, where: (at) => at.water != null && at.y > at.water - 0.45 && at.y < at.water + 0.3 },
    },
    grass: (at) => (1 - smoothstep(at.o.treeLine + 5, at.o.treeLine + 45, at.y)) * 0.8,
    grassColor: { base: 0x46602a, tip: 0xa3ad5e },
    paint(c, at) {
      // Alpine meadow below; grey scree and rock above the trees and on anything steep; snow on
      // what is level enough to hold it above the snow line, its edge ragged.
      const hi = smoothstep(at.o.treeLine + 5, at.o.treeLine + 45, at.y + (fbm(at.x * 0.02, at.z * 0.02, 2) - 0.5) * 24);
      toward(c, SCREE, Math.max(hi * 0.75, smoothstep(0.2, 0.42, at.slope) * 0.7));
      const snow = smoothstep(at.o.snowLine - 8, at.o.snowLine + 14, at.y + (fbm(at.x * 0.03 + 5, at.z * 0.03, 3) - 0.5) * 30);
      toward(c, SNOW, snow * (1 - smoothstep(0.35, 0.7, at.slope)));
    },
  },

  coast: {
    cover: 2,                                         // (tall-grass patches: twice the usual, for want of trees)
    o: { dune: 7 },                                   // metres above the sea that the sand and marram reach
    trees: {
      counts: { pine: 420 }, spacing: 6,
      density: (name, at) => (at.up > 0.8 && at.y > (at.sea ?? 0) + at.o.dune + 3 ? smoothstep(0.52, 0.68, fbm(at.x * 0.008 + 4, at.z * 0.008, 3)) : 0),
    },
    ground: {
      marram: { n: 9000, where: (at) => at.y > (at.sea ?? 0) + 0.8 && at.y < (at.sea ?? 0) + at.o.dune + 2 },
      gorse: { n: 3600, where: (at) => at.y > (at.sea ?? 0) + at.o.dune },
      heather: { n: 2600, where: (at) => at.y > (at.sea ?? 0) + at.o.dune + 4 },
      rock1: { n: 700, where: (at) => at.y < (at.sea ?? 0) + 4 }, rock2: 1500, rock3: 150,
    },
    grass: (at) => smoothstep((at.sea ?? 0) + at.o.dune - 2, (at.sea ?? 0) + at.o.dune + 6, at.y) * 0.9,
    grassColor: { base: 0x4d6a30, tip: 0xb6b877 },
    paint(c, at) {
      const s = at.sea ?? 0;
      toward(c, SAND, 1 - smoothstep(s + at.o.dune - 3, s + at.o.dune + 4, at.y + (fbm(at.x * 0.03, at.z * 0.03, 2) - 0.5) * 5));
      toward(c, MOOR, smoothstep(s + at.o.dune + 3, s + at.o.dune + 20, at.y) * 0.35);
    },
  },

  heath: {
    cover: 2.2,
    o: { wet: 1.2 },                                  // metres above the nearest water that still counts as wet ground
    trees: {
      counts: { birch: 900, pine: 120 }, spacing: 5,
      density: (name, at) => (at.up > 0.85 && dryAbove(at, at.o.wet) ? smoothstep(0.56, 0.7, fbm(at.x * 0.01 + (name === 'pine' ? 30 : 7), at.z * 0.01, 3)) : 0),
    },
    ground: {
      heather: { n: 16000, where: (at) => dryAbove(at, 0.5) },
      gorse: { n: 1300, where: (at) => dryAbove(at, at.o.wet) },
      reed: { n: 9000, where: (at) => at.water != null && at.y > at.water - 0.5 && at.y < at.water + 0.45 },
      bush: { n: 500, where: (at) => dryAbove(at, at.o.wet) }, rock2: 300,
    },
    grass: (at) => (dryAbove(at, 0.2) ? 0.45 : 0),
    grassColor: { base: 0x54562c, tip: 0xb0a368 },
    paint(c, at) {
      toward(c, HEATH, 0.35 + 0.3 * fbm(at.x * 0.02 + 8, at.z * 0.02, 3));
      if (at.water != null) toward(c, PEAT, (1 - smoothstep(at.water + 0.1, at.water + at.o.wet, at.y)) * 0.8);
    },
  },

  bocage: {
    cover: 1.6,
    o: { field: 90 },                                 // metres: about the size of a field
    trees: {
      counts: { beech: 300, birch: 220 }, spacing: 7,
      density: (name, at) => (at.up > 0.85 && dryAbove(at, 0.6) ? smoothstep(0.6, 0.72, fbm(at.x * 0.012 + (name === 'birch' ? 11 : 2), at.z * 0.012, 2)) : 0),
    },
    ground: { bush: 900, fern: { n: 1500, where: (at) => dryAbove(at) }, rock2: 250,
      reed: { n: 600, where: (at) => at.water != null && at.y > at.water - 0.45 && at.y < at.water + 0.3 } },
    grass: () => 1,
    grassColor: { base: 0x3f6424, tip: 0x9dba58 },
    paint(c, at) {
      // Each field its own crop: pasture, hay or plough, by which square of an uneven grid it is in.
      const F = at.o.field, fx = Math.floor((at.x + 40 * Math.sin(at.z / 170)) / F), fz = Math.floor((at.z + 40 * Math.sin(at.x / 210)) / F);
      const k = Math.abs(Math.sin(fx * 127.1 + fz * 311.7) * 43758.5453) % 1;
      toward(c, k < 0.45 ? LUSH : k < 0.75 ? HAY : PLOUGH, k < 0.75 ? 0.5 : 0.7);
    },
  },

  limestone: {
    cover: 2,
    o: {},
    trees: {
      counts: { cypress: 60, olive: 160 }, spacing: 6,
      density: (name, at) => (at.up > 0.85 ? smoothstep(0.62, 0.74, fbm(at.x * 0.012 + 17, at.z * 0.012, 2)) : 0),
    },
    ground: { juniper: 2600, bush: 2200, scree: { n: 2600, where: (at) => at.up < 0.95 }, rock1: 1500, rock2: 3600, rock3: 420 },
    grass: (at) => 0.35 * smoothstep(0.45, 0.6, fbm(at.x * 0.015, at.z * 0.015, 2)),
    grassColor: { base: 0x6a6a34, tip: 0xc0b577 },
    paint(c, at) {
      // Pavement and outcrop: pale rock wherever the thin soil gives out, more of it on any slope.
      const bare = smoothstep(0.42, 0.62, fbm(at.x * 0.018 + 2, at.z * 0.018 - 6, 3)) * 0.7 + smoothstep(0.1, 0.3, at.slope) * 0.6;
      toward(c, CHALK, clamp(bare, 0, 0.9));
    },
  },
};
const ALIAS = { 'heath-marsh': 'heath', marsh: 'heath', 'limestone-scrub': 'limestone', scrub: 'limestone' };

// The biome a map asks for, with its numbers filled in: { kind, o, trees, ground, … }, or null for
// the Tuscan default (and for a name nobody knows, with a warning, so a typo isn't a silent desert).
export function biomeOf(map) {
  const b = map?.biome;
  if (!b) return null;
  const name = typeof b === 'string' ? b : b.kind, kind = ALIAS[name] ?? name, B = BIOMES[kind];
  if (B === undefined) console.warn(`biome "${name}" unknown: using tuscan`);
  if (!B) return null;
  return { ...B, kind, o: { ...B.o, ...(typeof b === 'object' ? b : null) } };
}

// The map's ground in square kilometres (what the per-km² counts are multiplied by).
export const areaKm2 = (map) => {
  const hx = map.size ? map.size.x / 2 : map.half, hz = map.size ? map.size.z / 2 : map.half;
  return 4 * hx * hz / 1e6;
};

// Which tree kinds a map plants: its own forest's, its biome's, or the Tuscan three.
export function plantedTrees(map) {
  const B = biomeOf(map);
  if (map?.forest) return Object.entries(map.forest.counts ?? {}).filter(([, n]) => n > 0).map(([k]) => k);
  return B ? Object.keys(B.trees.counts) : ['olive', 'cypress', 'pine'];
}

// The ground kinds that live in the second model (ground_biome.glb): loaded only by maps that use them.
export const BIOME_KINDS = ['gorse', 'heather', 'reed', 'marram', 'juniper', 'hedge', 'scree'];
export function groundCounts(map) {
  return map?.ground ?? biomeOf(map)?.ground ?? null;
}
const TREE_PROPS = { fir: 'treeFir', beech: 'treeBeech', olive: 'treeOlive', cypress: 'treeCypress', pine: 'treePine', larch: 'treeLarch', birch: 'treeBirch' };

// The models (props.js keys) a map's growth needs before it can be built: its trees, and the
// second ground model if anything in it is used.
export function plantProps(map) {
  const trees = plantedTrees(map).map(k => TREE_PROPS[k]).filter(Boolean);
  const g = groundCounts(map) ?? {};
  const second = map?.hedges?.length || Object.keys(g).some(k => BIOME_KINDS.includes(k));
  return second ? [...trees, 'groundBiome'] : trees;
}
