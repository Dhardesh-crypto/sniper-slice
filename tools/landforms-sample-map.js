// A sample map made only from the terrain kit (src/world/landforms.js), to look at and to copy
// from: a long alpine valley, 1400 × 700 m, with a lake at its east end, a stream that comes down a
// ravine from the north ridge and runs along the valley floor into the lake, a bog in the west, an
// alp (a level shelf) and a cliff on the north side, terraces, a quarry and a sunken lane on the
// south, a road and three tracks. No mission uses it: tools/landforms-sample.html builds it and
// tools/landforms-sheet.mjs renders its six views to tasks/landforms-sample.jpg.
// Every new map field is used here once: size, playArea, biome, roads, waters (see the note at the
// end of tasks/landforms-kit.md).
import {
  compose, rolling, ridge, valley, terraces, cliffBand, ravine, plateau, riverBed, lakeBasin, marshFlat, quarry,
  sunkenLane, embankment, roadBed, rim, fall,
} from '../src/world/landforms.js';

const SIZE = { x: 1400, z: 700 };
const PLAY = { x0: -675, x1: 675, z0: -325, z1: 325 };
const VALLEY = [[-720, 40], [-400, -10], [-100, 30], [200, -20], [450, 20], [720, 0]];
const LAKE = { x: 370, z: 0, r: 85 }, BOG = { x: -470, z: 15, r: 85 }, ALP = { x: 150, z: -205, r: 55 }, QUARRY = { x: 480, z: 200 };
// The stream: down the ravine from the north ridge, then east along the valley floor to the lake.
const GORGE = [[-265, -300], [-240, -215], [-220, -130], [-205, -55]];
const STREAM = [...GORGE, [-130, 5], [40, -5], [180, -20], [290, -5]];
const ROADS = [
  { id: 'valley', kind: 'road', width: 5, path: [[-700, 115], [-400, 80], [-100, 100], [150, 78], [420, 105], [700, 85]] },
  { id: 'alp', kind: 'track', path: [[-100, 100], [-65, 30], [10, -60], [95, -135], [150, -200]] },      // fords the stream, climbs to the alp
  { id: 'quarry', kind: 'track', path: [[420, 105], [462, 140], [480, 168]] },
  { id: 'causeway', kind: 'track', path: [[-470, 88], [-472, 15], [-465, -75], [-430, -150]] },          // across the bog on a bank
  { id: 'lake', kind: 'path', path: [[150, 78], [250, 70], [330, 100], [430, 95]] },
];
const LANE = [[-300, 110], [-262, 190], [-200, 262]];        // a sunken lane up the south slope

// The land before any water is cut: rolling ground, the valley through it, a high rough ridge to
// the north (snow on top) and a lower one to the south, hills closing the two ends.
const land = compose(rolling({ amp: 24, level: 72, seed: 5 }), [
  valley({ path: VALLEY, depth: 40, floor: 110, width: 230 }),
  ridge({ path: [[-720, -335], [-300, -350], [200, -330], [720, -345]], height: 78, width: 240, rough: 0.55, taper: 0, seed: 2 }),
  ridge({ path: [[-720, 345], [0, 335], [720, 350]], height: 42, width: 200, rough: 0.4, taper: 0, seed: 7 }),
  rim({ area: { ...PLAY, x0: -640, x1: 640, z0: -2000, z1: 2000 }, height: 30, rough: 40, run: 120, seed: 3 }),   // (the west and east ends only)
]);
const LAKE_LEVEL = land(LAKE.x, LAKE.z) - 1.5, BOG_LEVEL = land(BOG.x, BOG.z) - 0.6;
const river = riverBed({ path: STREAM, width: 7, depth: 1.0, banks: 7, levels: fall(land, STREAM, { under: 1.2, end: LAKE_LEVEL }) });

const heightAt = compose(land, [
  cliffBand({ path: [[320, -150], [520, -165], [650, -150]], height: 22, run: 6, reach: 150, side: -1, rough: 5 }),     // a scarp above the lake
  plateau({ area: { ...ALP, blend: 45, wobble: 8 }, level: land(ALP.x, ALP.z) + 2, rough: 0.4 }),                       // the alp
  terraces({ area: { x: -80, z: 215, r: 105, blend: 25, wobble: 10 }, step: 3.5, riser: 0.22 }),
  quarry({ ...QUARRY, r: 42, depth: 15, benches: 3, floor: 0.42, ramp: -Math.PI / 2, rampWidth: 9, seed: 4 }),          // its haul road runs out north
  ravine({ path: GORGE, depth: 15, width: 36, bed: 4, taper: 30 }),
  marshFlat({ area: { ...BOG, blend: 35, wobble: 18 }, level: BOG_LEVEL, hummock: 0.38, pools: 0.47, seed: 6 }),
  river,
  lakeBasin({ ...LAKE, level: LAKE_LEVEL, depth: 5, shore: 34, wobble: 0.3, seed: 1 }),
  sunkenLane({ path: LANE, width: 3.5, depth: 2.2, banks: 2.5 }),
  embankment({ path: ROADS[3].path, top: 3.5, from: BOG_LEVEL + 0.9, to: BOG_LEVEL + 0.9, slope: 1.6 }),               // the causeway's bank (held level over the bog)
  ...ROADS.filter(r => r.id !== 'causeway').map(r => roadBed({ path: r.path, width: r.width ?? 3, shoulder: r.kind === 'road' ? 6 : 3 })),
]);

export const SAMPLE = { LAKE, BOG, ALP, QUARRY, GORGE, STREAM, LANE, PLAY, LAKE_LEVEL, BOG_LEVEL };
export const map = {
  id: 'sample',
  size: SIZE,                                             // per-axis size (was: half)
  playArea: PLAY,                                         // any landforms.js area: a box here, { poly: […] } for an L
  focus: { ...ALP, r: 60 }, start: { x: -600, z: 150 },
  heightAt,
  maxSlope: 0.9,
  biome: { kind: 'alpine', treeLine: 116, snowLine: 134 },
  roads: ROADS,
  waters: heightAt.waters,                                // the stream, the lake, the bog: each at its own height
  wade: 0.9,
  // Built cover (world/cover.js): field walls on the valley floor and the south slope and round the
  // alp, crate stacks where work goes on, two ruins, a windmill on the south side, grass where a
  // way in needs it. The site sets them down with buildCover(b).
  cover: {
    walls: [
      [[-380, 100], [-330, 30], [-250, 10], [-150, 40]], [[-250, 10], [-262, -40]], [[-40, 118], [60, 150], [140, 128]], [[60, 150], [70, 230]],
      [[190, 95], [230, 30], [300, 40]], [[-560, 140], [-520, 200], [-430, 215]], [[95, -235], [150, -262], [205, -238]], [[205, -238], [212, -180]],
      [[330, 150], [400, 170], [430, 225]], [[-20, -40], [50, -95], [120, -100]],
    ],
    crates: [[140, -196, 5], [160, -214, 3], [474, 176, 4], [-468, 96, 3], [-110, 108, 3], [300, 96, 4], [-436, -150, 3]],
    ruins: [{ x: -235, z: 62, w: 9, d: 6.5, seed: 11, fallen: 1 }, { x: 118, z: -168, w: 7, d: 5.5, h: 3.6, seed: 23, fallen: 2, breach: 's' }, { x: 505, z: 120, w: 8, d: 6, seed: 31, burnt: true }],
    windmills: [{ x: 252, z: 196 }],
    grass: [{ x: -520, z: 120, r: 11 }, { x: -330, z: 95, r: 9 }, { x: -20, z: 70, r: 10 }, { x: 60, z: -150, r: 9 }, { x: 110, z: -215, r: 8 }, { x: 240, z: 110, r: 10 }, { x: 420, z: 130, r: 9 }],
  },
  horizon: 'bridge',                                      // (the alpine gorge's far country)
  keepClear: (x, z, m = 0) => Math.hypot(x - ALP.x, z - ALP.z) < 22 + m || Math.hypot(x - 252, z - 196) < 17 + m,
  light: { zenith: 58, azimuth: 150, sun: 0xfff1dc, sunIntensity: 2.9, turbidity: 3, rayleigh: 1.4, clouds: 0.35, hemi: 0.6, exposure: 0.8 },
  fog: { color: 0xc3d0d8, near: 500, far: 2600 },
};
