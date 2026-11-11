// The terrain kit (src/world/landforms.js), a map's water at several heights (waters.js) and its
// roads (roads.js): the pure parts, without three.js or a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makePath, pointAt, locator, region, rolling, ridge, valley, terraces, cliffBand, ravine, plateau, riverBed, lakeBasin,
  marshFlat, quarry, sunkenLane, ditch, embankment, roadBed, coast, rim, compose, slopeAt, steep, reach,
} from '../src/world/landforms.js';
import { makeWaters } from '../src/world/waters.js';
import { makeRoads } from '../src/world/roads.js';
import { biomeOf, plantProps, plantedTrees, BIOMES } from '../src/world/biomes.js';

const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const LINE = [[-200, 0], [200, 0]];           // west to east along z = 0

test('paths: length, points along, nearest point and side', () => {
  const P = makePath([[0, 0], [100, 0], [100, 100]], { smooth: false });
  near(P.length, 200);
  const q = pointAt(P, 150);
  near(q.x, 100); near(q.z, 50); near(q.dz, 1);
  const n = locator(P, 30)(40, 12);
  near(n.d, 12); near(n.t, 40); near(n.x, 40); near(n.z, 0);
  assert.ok(n.s > 0, 'toward +z of a path running +x is its + side');
  assert.ok(locator(P, 30)(40, -12).s < 0);
  assert.equal(locator(P, 30)(40, 31), null, 'beyond its reach: nothing');
  // A long smooth path answers the same through its grid as by trying every segment.
  const wavy = makePath(Array.from({ length: 40 }, (_, i) => [i * 30 - 600, 80 * Math.sin(i * 0.7)]));
  const fast = locator(wavy, 50), slow = locator(wavy, Infinity, { exact: true });
  for (let i = 0; i < 400; i++) {
    const x = -640 + (i * 97) % 1280, z = -140 + (i * 53) % 280, a = fast(x, z), d = a?.d, b = slow(x, z).d;
    if (b <= 50) near(d, b, 1e-9, `at ${x},${z}`); else assert.equal(a, null);
  }
  // A wide reach is answered from a coarser line: within a couple of metres of the exact one here.
  const wide = locator(wavy, 200);
  for (let i = 0; i < 200; i++) { const x = -640 + (i * 97) % 1280, z = -140 + (i * 53) % 280; near(wide(x, z).d, slow(x, z).d, 4, `wide at ${x},${z}`); }
  // Smoothing passes through the given points.
  for (const [x, z] of [[-600, 0], [-570, 80 * Math.sin(0.7)]]) near(slow(x, z).d, 0, 1e-6);
});

test('areas: circle, box, polygon (an L), strip; blend fades out past the edge', () => {
  const c = region({ x: 10, z: 0, r: 20, blend: 10 });
  assert.equal(c(10, 0), 1); assert.equal(c(29, 0), 1); near(c(35, 0), 0.5); assert.equal(c(45, 0), 0);
  const L = region({ poly: [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]] });
  assert.equal(L(20, 80), 1); assert.equal(L(80, 20), 1); assert.equal(L(80, 80), 0, 'the notch of the L is outside');
  near(L.sd(80, 80), 40); near(L.sd(20, 20), -20);
  const b = region({ x0: -10, x1: 10, z0: -5, z1: 5 });
  near(b.sd(13, 9), 5); near(b.sd(0, 0), -5);
  const s = region({ path: LINE, width: 10 });
  assert.equal(s(50, 4), 1); assert.equal(s(50, 6), 0);
});

test('ridge and valley: highest/lowest on the line, gone beyond the width, ends tapered', () => {
  const r = ridge({ path: LINE, height: 30, width: 80, rough: 0, taper: 50 });
  near(r(0, 0, 5), 35); near(r(0, 80, 5), 5); assert.ok(r(0, 40, 5) > 5 && r(0, 40, 5) < 35);
  near(r(-200, 0, 5), 5, 1e-9, 'the end tapers to nothing');
  assert.ok(r(0, 20, 0) > r(0, 30, 0), 'falls away from the crest');
  const v = valley({ path: LINE, depth: 20, floor: 40, width: 100 });
  near(v(0, 0, 50), 30); near(v(0, 19, 50), 30, 1e-9, 'flat floor'); near(v(0, 120, 50), 50);
});

test('terraces: level treads with short risers, only inside the area', () => {
  const t = terraces({ area: { x: 0, z: 0, r: 100 }, step: 3, riser: 0.2 });
  for (const h of [3.1, 4, 5.3]) near(t(0, 0, h), 3, 1e-9, 'tread');
  assert.ok(t(0, 0, 5.9) > 5 && t(0, 0, 5.9) < 6, 'riser');
  near(t(500, 0, 4), 4);
  // Monotonic: higher ground never ends up lower.
  let last = -Infinity;
  for (let h = 0; h < 12; h += 0.05) { const y = t(0, 0, h); assert.ok(y >= last - 1e-9); last = y; }
});

test('cliff band: a step across the line, steep in the face, sloping back behind', () => {
  const c = cliffBand({ path: LINE, height: 15, run: 4, reach: 120, side: 1, rough: 0, taper: 0 });
  near(c(0, -10, 0), 0); near(c(0, 2, 0), 15, 1e-9, 'top of the face'); near(c(0, 120, 0), 0);
  assert.ok(c(0, 60, 0) > 0 && c(0, 60, 0) < 15);
  const f = compose(0, [c]);
  assert.ok(slopeAt(f, 0, 0) > 2, 'the face is a wall');
  assert.ok(slopeAt(f, 0, 60) < 0.3, 'the back slope is walkable');
  const other = cliffBand({ path: LINE, height: 15, run: 4, side: -1, rough: 0, taper: 0 });
  near(other(0, -2, 0), 15); near(other(0, 10, 0), 0);
});

test('ravine and plateau', () => {
  const r = ravine({ path: LINE, depth: 12, width: 30, bed: 3, taper: 0 });
  near(r(0, 0, 40), 28); near(r(0, 1.4, 40), 28, 1e-9, 'bed'); near(r(0, 15, 40), 40); near(r(0, 30, 40), 40);
  assert.ok(slopeAt(compose(40, [r]), 0, 8) > 0.8, 'its sides are steep');
  const p = plateau({ area: { x0: -50, x1: 50, z0: -50, z1: 50, blend: 20 }, level: 60, rough: 0 });
  near(p(0, 0, 10), 60); near(p(60, 0, 10), 35); near(p(80, 0, 10), 10);
  near(plateau({ area: { x: 0, z: 0, r: 10 }, height: 8, rough: 0 })(0, 0, 10), 18);
});

test('river bed: its surface falls along it and never rises; the bed is under it', () => {
  const r = riverBed({ path: LINE, width: 8, depth: 1.2, from: 30, to: 20, banks: 8 });
  near(r.levelAt(0), 30); near(r.levelAt(400), 20); near(r.levelAt(200), 25);
  near(r(0, 0, 50), 25 - 1.2, 1e-6, 'mid-stream'); near(r(0, 4, 50), 25, 0.01, 'the water line');
  near(r(0, 12, 50), 50, 1e-6, 'past the banks');
  assert.ok(r(0, 6, 10) > 25, 'low land is banked up above the water');
  // Levels per point: a pool, a weir, a run; an uphill level is pressed down.
  const w = riverBed({ path: [[0, 0], [100, 0], [110, 0], [200, 0]], smooth: false, levels: [12, 12, 9, 9.5] });
  near(w.levelAt(50), 12); near(w.levelAt(150), 9); assert.ok(w.levelAt(105) < 12 && w.levelAt(105) > 9);
  let last = Infinity;
  for (let t = 0; t <= 200; t += 2) { assert.ok(w.levelAt(t) <= last + 1e-9); last = w.levelAt(t); }
  assert.equal(r.water.kind, 'river');
});

test('lake, marsh, quarry', () => {
  const lake = lakeBasin({ x: 0, z: 0, r: 60, level: 22, depth: 4, shore: 30, wobble: 0 });
  near(lake(0, 0, 40), 18); near(lake(60, 0, 40), 22, 0.01); near(lake(200, 0, 40), 40);
  assert.ok(lake(75, 0, 5) > 22, 'low land round it is raised over the water');
  const m = marshFlat({ area: { x0: -100, x1: 100, z0: -100, z1: 100 }, level: 10, hummock: 0.35 });
  let wet = 0, n = 0;
  for (let x = -90; x <= 90; x += 6) for (let z = -90; z <= 90; z += 6) { const h = m(x, z, 30); assert.ok(Math.abs(h - 10) <= 0.36); n++; if (h < 10) wet++; }
  assert.ok(wet / n > 0.15 && wet / n < 0.85, `pools and hummocks both (${(wet / n).toFixed(2)} wet)`);
  const q = compose(50, [quarry({ x: 0, z: 0, r: 45, depth: 18, benches: 3, floor: 0.4, ramp: 0, seed: 1 })]);
  near(q(0, 0), 32); near(q(80, 0), 50);
  const levels = new Set();
  for (let d = 0; d < 44; d += 0.5) levels.add(Math.round(q(0, -d)));         // (straight north: no ramp there)
  assert.ok(levels.size >= 3, 'benches');
  // Along the ramp the climb is even; across from it there are bench faces.
  let worstRamp = 0, worstBench = 0;
  for (let d = 20; d < 40; d += 1) { worstRamp = Math.max(worstRamp, Math.abs(q(d + 1, 0) - q(d, 0))); worstBench = Math.max(worstBench, Math.abs(q(0, d + 1) - q(0, d))); }
  assert.ok(worstRamp < worstBench, `ramp ${worstRamp.toFixed(2)} gentler than bench ${worstBench.toFixed(2)}`);
});

test('sunken lane, ditch, embankment, road bed', () => {
  const slope = (x, z) => 20 + z * 0.2;                       // ground rising to the south
  const lane = compose(slope, [sunkenLane({ path: LINE, width: 4, depth: 2, banks: 2, taper: 0 })]);
  near(lane(0, 0), 18); near(lane(0, 1.9), 18, 1e-9, 'level across its floor'); near(lane(0, 10), 22);
  const d = ditch({ path: LINE, width: 3, depth: 0.9, level: 5 });
  near(d(0, 0, 5.4), 4.1); assert.ok(d(0, 2, 4) >= 5, 'banked above its water');
  const bank = compose(slope, [embankment({ path: LINE, top: 5, height: 4, slope: 1.5 })]);
  near(bank(0, 0), 24); near(bank(0, 2.4), 24, 1e-9, 'flat top'); near(bank(0, 2.5 + 3), 22);
  const rail = compose(slope, [embankment({ path: LINE, top: 5, from: 26, to: 26, slope: 1.5, cut: true })]);
  near(rail(0, 0), 26); near(rail(0, -40), slope(0, -40)); near(rail(0, 2.5 + 1.5), 25, 1e-9, 'banked up where the ground is lower');
  const cutting = compose(40, [embankment({ path: LINE, top: 5, from: 26, to: 26, slope: 1.5, cut: true })]);
  near(cutting(0, 0), 26); near(cutting(0, 2.5 + 3), 28, 1e-9, 'the side of the cutting'); near(cutting(0, 60), 40);
  const bed = compose(slope, [roadBed({ path: LINE, width: 5, shoulder: 5 })]);
  near(bed(0, 2), bed(0, -2), 1e-9, 'level across the road'); near(bed(0, 30), slope(0, 30));
});

test('coast and rim: natural borders for a map that is not a square', () => {
  const c = coast({ path: [[-700, 300], [700, 300]], smooth: false, side: 1, seabed: -8, run: 60 });
  near(c(0, 200, 12), 12); near(c(0, 360, 12), -8); near(c(0, 500, 12), -8);
  const L = { poly: [[-700, -350], [0, -350], [0, 0], [700, 0], [700, 350], [-700, 350]] };
  const r = rim({ area: L, height: 26, run: 110 });
  near(r(-300, 0, 10), 10, 1e-9, 'inside'); assert.ok(r(300, -200, 10) > 30, 'hills in the notch of the L');
});

test('compose: pieces in order, below() sees the pieces before; steep and reach reports', () => {
  const river = riverBed({ path: [[-300, 0], [300, 0]], width: 8, from: 12, to: 6 });
  const f = compose(rolling({ amp: 10, level: 30, seed: 2 }), [
    valley({ path: [[-300, 0], [300, 0]], depth: 14, floor: 60, width: 120 }),
    river,
    cliffBand({ path: [[-300, -120], [300, -120]], height: 20, run: 4, side: -1, rough: 0, taper: 0 }),
  ]);
  assert.equal(f.waters.length, 1);
  assert.ok(f(0, 0) < f(0, 60), 'the river is the low line');
  const B = { x0: -300, x1: 300, z0: -250, z1: 250 };
  const s = f.steep(B, { maxSlope: 0.9 });
  assert.ok(s.share > 0 && s.share < 0.05, `only the cliff is too steep (${s.share})`);
  assert.ok(s.patches.every(p => Math.abs(p.z + 120) < 40), 'and it is found where the cliff is');
  assert.ok(s.worst.slope > 2);
  // From the south bank: the valley, but not the top of the cliff (too steep), nor across deep water.
  const W = makeWaters({ waters: f.waters }, f);
  const got = f.reach({ x: 0, z: 100 }, { bounds: B, maxSlope: 0.9, waterAt: W.waterAt, wade: 0.5 });
  assert.ok(got.can(100, 60)); assert.ok(!got.can(0, -200), 'the cliff top');
  assert.ok(!got.can(0, -60), 'the far bank (1.2 m of water, wading 0.5)');
  assert.ok(f.reach({ x: 0, z: 100 }, { bounds: B, waterAt: W.waterAt, wade: 1.5 }).can(0, -60), 'waded');
});

test('waterAt: the old single sheet answers as it always stood', () => {
  const ground = (x) => x * 0.1;                                 // rises eastward: the shore at x = 0
  const W = makeWaters({ waterLevel: 0 }, ground);
  assert.equal(W.waterAt(-50, 0), 0); assert.equal(W.waterAt(50, 0), null);
  assert.equal(W.surfaceAt(50, 0), 0, 'its level, even on dry land');
  assert.equal(W.declared, false);
  const none = makeWaters({}, ground);
  assert.equal(none.waterAt(-50, 0), null); assert.equal(none.any, false);
});

test('waterAt: a falling river, a pond above it and the sea below, each at its own height', () => {
  const river = riverBed({ path: [[-400, 0], [200, 0]], smooth: false, width: 8, depth: 1.2, from: 30, to: 0.5 });
  const pond = lakeBasin({ x: -400, z: 0, r: 40, level: 30, depth: 3, shore: 20, wobble: 0 });
  const f = compose((x) => 34 - (x + 400) * 0.055, [coast({ path: [[200, -500], [200, 500]], smooth: false, side: -1, seabed: -6, run: 50 }), river, pond]);
  const W = makeWaters({ waterLevel: 0, wade: 0.8, waters: f.waters }, f);
  near(W.waterAt(-400, 10), 30, 1e-9, 'the pond');
  const mid = W.waterAt(-100, 0);
  near(mid, river.levelAt(300), 1e-9, 'the river, part-way down'); assert.ok(mid < 30 && mid > 0.5);
  assert.ok(W.waterAt(-250, 0) > W.waterAt(50, 0), 'it falls');
  assert.equal(W.waterAt(-100, 40), null, 'dry on its bank'); assert.equal(W.surfaceAt(-100, 40), 0, 'only the sea level there');
  assert.equal(W.waterAt(300, 0), 0, 'the sea');
  assert.equal(W.bodyAt(-100, 0).kind, 'river'); assert.equal(W.bodyAt(300, 100).kind, 'sea'); assert.equal(W.bodyAt(-400, 10).kind, 'pond');
  assert.equal(W.bodyAt(-100, 0).wade, 0.8, "the map's wading depth, unless the body sets its own");
  assert.equal(W.declared, true);
  // from/to given straight on the map (no landform): the same river.
  const plain = makeWaters({ waters: [{ kind: 'river', path: [[-400, 0], [200, 0]], width: 8, from: 30, to: 0.5 }, { kind: 'pond', level: 30, area: { x: -400, z: 0, r: 60 } }] }, f);
  near(plain.waterAt(-100, 0), mid, 0.02);
});

test('nearestRoad: several roads and tracks; the old one-road function still answers', () => {
  const R = makeRoads({ roads: [
    { id: 'main', path: [[-500, 0], [500, 0]], smooth: false },
    { id: 'mill', kind: 'track', path: [[0, 0], [0, 300]], smooth: false },
    { id: 'ridge', kind: 'path', path: [[-300, -200], [300, -220]] },
  ] });
  let n = R.nearestRoad(100, 12);
  assert.equal(n.id, 'main'); near(n.d, 12); near(n.x, 100); near(n.z, 0); near(n.t, 600); near(n.dx, 1); assert.equal(n.on, false);
  n = R.nearestRoad(8, 150);
  assert.equal(n.id, 'mill'); assert.equal(n.kind, 'track'); assert.equal(n.width, 3); near(n.d, 8); near(n.dz, 1);
  assert.equal(R.nearestRoad(1, 150).on, true);
  assert.equal(R.nearestRoad(0, -190).id, 'ridge');
  assert.equal(R.nearestRoad(4000, 3000).id, 'main', 'however far off');
  near(R.centerZ(120), 0); assert.ok(Number.isNaN(R.centerZ(900)), 'the main road does not reach there');
  assert.ok(R.clear(100, 2) && !R.clear(100, 20) && R.clear(100, 20, 20));
  assert.ok(R.wear(100, 0).w > 0.9 && R.wear(100, 0).kind === 'road' && R.wear(100, 30) === null);
  // An old map: z for each x.
  const old = makeRoads({ roadCenterZ: (x) => (x > 62 ? NaN : 10 + x * 0.5) });
  n = old.nearestRoad(20, 35);
  near(n.z, 20); near(n.d, 15); assert.ok(n.dx > 0 && n.dz > 0);
  assert.equal(old.nearestRoad(100, 0), null); assert.equal(makeRoads({}).nearestRoad(0, 0), null);
  assert.equal(old.any, false);
});

test('biomes: tuscan is the untouched default; the others name their trees and models', () => {
  assert.equal(biomeOf({}), null); assert.equal(biomeOf({ biome: 'tuscan' }), null);
  assert.deepEqual(plantedTrees({ half: 400 }), ['olive', 'cypress', 'pine']);
  assert.deepEqual(plantProps({ half: 400 }), ['treeOlive', 'treeCypress', 'treePine']);
  assert.deepEqual(plantProps({ half: 500, forest: { counts: { fir: 6500, beech: 2200, olive: 0 } } }), ['treeFir', 'treeBeech']);
  for (const k of ['alpine', 'coast', 'heath', 'bocage', 'limestone']) assert.ok(BIOMES[k].trees && BIOMES[k].ground && BIOMES[k].paint, k);
  const a = biomeOf({ biome: { kind: 'alpine', treeLine: 120 } });
  assert.equal(a.o.treeLine, 120); assert.equal(a.o.snowLine, 135);
  assert.deepEqual(plantProps({ size: { x: 1400, z: 700 }, biome: 'alpine' }), ['treeLarch', 'treeFir', 'groundBiome']);
  assert.equal(biomeOf({ biome: 'heath-marsh' }).kind, 'heath');
  // Alpine: trees below the line, none above; snow only high up.
  const at = (y) => ({ x: 10, z: 20, y, up: 1, slope: 0, water: null, sea: null, o: a.o });
  let low = 0, high = 0;
  for (let i = 0; i < 200; i++) { const p = { ...at(40), x: i * 37, z: i * 11 }; low += a.trees.density('larch', p); high += a.trees.density('larch', { ...p, y: 170 }); }
  assert.ok(low > 5 && high === 0, `larch ${low.toFixed(1)} below, ${high} above the tree line`);
  const c = { r: 0.4, g: 0.5, b: 0.2 }; a.paint(c, at(200));
  assert.ok(c.r > 0.85 && c.b > 0.85, 'snow up top');
});
