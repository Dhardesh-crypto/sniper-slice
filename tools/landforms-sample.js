// Dev page: builds the sample map (tools/landforms-sample-map.js) with the game's own World (its
// terrain, trees, grass, ground detail and water, no site and no soldiers) and renders six fixed
// views onto one contact sheet. Open /tools/landforms-sample.html on the dev server, or run
// tools/landforms-sheet.mjs, which saves the sheet to tasks/landforms-sample.jpg.
//   ?biome=coast|heath|bocage|limestone   the same land under another biome (and a sea at the
//                                         valley floor for the coast), to compare them
// When it is done: window.sample = { sheet (a JPEG data URL), report }.
import * as THREE from 'three';
import { useMap, heightAt, waterAt, nearestRoad, inPlayArea } from '../src/world/terrain.js';
import { World } from '../src/world/world.js';
import { loadProps } from '../src/world/props.js';
import { plantProps } from '../src/world/biomes.js';
import { usePhotoTextures } from '../src/world/textures.js';
import { horizonReady } from '../src/world/horizon.js';
import { inTallGrass } from '../src/world/vegetation.js';
import { Builder } from '../src/world/kit.js';
import { buildCover } from '../src/world/cover.js';
import { map, SAMPLE } from './landforms-sample-map.js';

const log = (t) => { document.getElementById('log').textContent += '\n' + t; };
const q = new URLSearchParams(location.search), W = +(q.get('w') ?? 800), H = +(q.get('h') ?? 500);
const biome = q.get('biome');
if (biome) {
  map.biome = biome;
  if (biome === 'coast') map.waterLevel = SAMPLE.LAKE_LEVEL - 4;       // (a sea up the valley floor, so there are dunes)
  if (biome === 'bocage') map.hedges = [[[-650, 150], [-420, 130], [-200, 150]], [[-420, 130], [-400, 250]], [[60, 120], [80, 260]], [[150, 110], [380, 140], [640, 120]], [[380, 140], [360, 280]]];
}

const t0 = performance.now();
await loadProps([...plantProps(map), 'groundDetail', 'crates', 'ruinKit']);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
useMap(map);
const y = (x, z, up = 0) => heightAt(x, z) + up;
// The site: nothing but the map's built cover (walls, crates, ruins, the windmill: world/cover.js).
let high = null;
const world = new World(scene, renderer, (sc) => { const b = new Builder(sc); high = buildCover(b); return { solids: b.solids, boxes: b.boxes, ladders: high.ladders, soldiers: [], spawn: new THREE.Vector3(map.start.x, y(map.start.x, map.start.z), map.start.z) }; });
await usePhotoTextures(scene);
await horizonReady;
const built = Math.round(performance.now() - t0);

// The checks a mission's builder would make: how much is too steep to walk, and whether the
// places that matter can be reached on foot from the start (wading the stream at most).
const P = SAMPLE.PLAY, inside = (x, z) => inPlayArea(x, z);
const steep = map.heightAt.steep(P, { maxSlope: map.maxSlope, inside });
const walk = map.heightAt.reach(map.start, { bounds: P, maxSlope: map.maxSlope, inside, waterAt, wade: map.wade });
const places = { alp: SAMPLE.ALP, lakeShore: { x: SAMPLE.LAKE.x - 125, z: 30 }, bog: { x: SAMPLE.BOG.x, z: 95 }, quarryFloor: SAMPLE.QUARRY, laneTop: { x: -200, z: 262 }, northBank: { x: 0, z: -90 } };
// Cover, which is what the game is about: on a 6 m grid over the dry playable ground, is there a
// place that hides you (tall grass, brush) within 15 m, or something solid to get behind (a trunk,
// a boulder, a hedge within 8 m; a wall, crates, a ruin, the mill within 12 m), and how far is it
// to the nearest of either?
const cover = (() => {
  let n = 0, hideNear = 0, blockNear = 0, hid = 0, any = 0, builtN = 0, gaps = [];
  const boxGrid = new Map();
  for (const q of world.boxes) for (let gx = Math.floor((q.min.x - 12) / 30); gx <= Math.floor((q.max.x + 12) / 30); gx++) for (let gz = Math.floor((q.min.z - 12) / 30); gz <= Math.floor((q.max.z + 12) / 30); gz++) { const k = `${gx},${gz}`; if (!boxGrid.has(k)) boxGrid.set(k, []); boxGrid.get(k).push(q); }
  const hides = [], R = 15;
  for (let z = P.z0; z <= P.z1; z += 3) for (let x = P.x0; x <= P.x1; x += 3) if (inTallGrass(world.grassPatches, x, z)) { hides.push(x, z); }
  const grid = new Map(), key = (x, z) => `${Math.floor(x / 30)},${Math.floor(z / 30)}`;
  for (let i = 0; i < hides.length; i += 2) { const k = key(hides[i], hides[i + 1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(hides[i], hides[i + 1]); }
  for (let z = P.z0; z <= P.z1; z += 6) for (let x = P.x0; x <= P.x1; x += 6) {
    if (!inside(x, z) || waterAt(x, z) != null) continue;
    n++;
    if (inTallGrass(world.grassPatches, x, z)) hid++;
    let best = Infinity;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const l = grid.get(key(x + i * 30, z + j * 30)); if (l) for (let m = 0; m < l.length; m += 2) best = Math.min(best, Math.hypot(l[m] - x, l[m + 1] - z)); }
    if (best <= R) hideNear++;
    gaps.push(Math.min(best, 60));
    let block = false; for (const t of world.treesNear(x, z)) if (Math.hypot(t.x - x, t.z - z) < 8) { block = true; break; }
    const bx = boxGrid.get(key(x, z)); if (bx) for (const q of bx) if (Math.max(q.min.x - x, x - q.max.x, 0) < 12 && Math.max(q.min.z - z, z - q.max.z, 0) < 12) { block = true; builtN++; break; }
    if (block) blockNear++;
    if (block || best <= R) any++;
  }
  gaps.sort((a, b) => a - b);
  const pct = (v) => Math.round(100 * v / n);
  return { someCoverWithinReachPct: pct(any), hiddenGroundPct: pct(hid), hidingPlaceWithin15mPct: pct(hideNear), solidCoverNearPct: pct(blockNear), builtCoverWithin12mPct: pct(builtN), boxes: world.boxes.length, medianMetresToHide: Math.round(gaps[gaps.length >> 1]), worstTenthMetresToHide: Math.round(gaps[Math.floor(gaps.length * 0.9)]), tallGrassPatches: world.grassPatches.length };
})();
// The high places: is there a floor where each ladder lets you off, how far above the ground, and
// how much of the playable ground can be seen from standing there (rays to a 25 m grid, 1 m up)?
const perches = high.perches.map((p, i) => {
  const L = high.ladders[i], eyes = [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].map(([dx, dz]) => new THREE.Vector3(p.x + dx, p.y + 1.45, p.z + dz));   // (you move to the slit or the wall you look out of)
  let seen = 0, n = 0;
  for (let z = P.z0; z <= P.z1; z += 25) for (let x = P.x0; x <= P.x1; x += 25) {
    if (!inside(x, z) || Math.hypot(x - p.x, z - p.z) > 450) continue;
    n++;
    const to = new THREE.Vector3(x, heightAt(x, z) + 1, z);
    if (eyes.some(eye => { const hit = world.raycastSegment(eye, to); return !hit || hit.distance > eye.distanceTo(to) - 1.5; })) seen++;
  }
  return { kind: p.kind, x: Math.round(p.x), z: Math.round(p.z), metresUp: +(p.y - heightAt(p.x, p.z)).toFixed(1), floorAtLadderTop: +(world.floorAt(L.topSpot.x, L.topSpot.z, L.top + 0.3) - L.top).toFixed(2),
    groundFootClear: world.clearAbove(L.foot.x, L.foot.z, L.bottom + 0.6, L.bottom + 1.7), seesPctWithin450m: Math.round(100 * seen / n) };
});
const report = {
  cover, perches,
  biome: map.biome, builtMs: built, trees: world.trees.length, grassTufts: world.tuftCount,
  waters: world.waters.length, waterAt: { lake: waterAt(SAMPLE.LAKE.x, SAMPLE.LAKE.z), streamTop: waterAt(...SAMPLE.STREAM[1]), streamLow: waterAt(...SAMPLE.STREAM[6]), bog: SAMPLE.BOG_LEVEL, dryHill: waterAt(0, 250) },
  road: nearestRoad(0, 60) && { id: nearestRoad(0, 60).id, d: +nearestRoad(0, 60).d.toFixed(1) },
  steepShare: +steep.share.toFixed(3), steepWorst: steep.patches.slice(0, 5).map(p => `${p.x},${p.z} slope ${p.slope.toFixed(1)} ${p.area} m²`),
  walkableKm2: +(walk.area / 1e6).toFixed(2), reached: Object.fromEntries(Object.entries(places).map(([k, p]) => [k, walk.can(p.x, p.z)])),
  heights: { valleyFloor: +y(0, 40).toFixed(1), lake: +SAMPLE.LAKE_LEVEL.toFixed(1), alp: +y(SAMPLE.ALP.x, SAMPLE.ALP.z).toFixed(1), northRidge: +y(0, -335).toFixed(1), southRidge: +y(0, 335).toFixed(1) },
};
log(JSON.stringify(report, null, 1));

// Six fixed views: [label, eye (x, z, metres above the ground), what it looks at (x, z, above), fov].
const { LAKE, BOG, ALP, QUARRY } = SAMPLE;
const VIEWS = [
  ['1 The valley from the west end, looking east', [-640, 120, 55], [100, 0, 0], 55],
  ['2 The lake from its west shore', [LAKE.x - 76, 14, 7], [LAKE.x + 90, -95, 8], 62],
  ['3 The stream coming down the ravine', [-207, -64, 3.2], [-241, -215, 9], 60],
  ['4 From the windmill loft, through the north slit', [252, 195.0, 0, 'loft'], [240, -150, 20], 62],
  ['5 The windmill: doorway south, ladder inside to the loft', [243, 212, 1.6], [252, 196, 5.4], 74],
  ['6 The whole map from above the south side (1400 × 700 m)', [0, 900, 620], [0, -40, 0], 50],
];
const sheet = document.createElement('canvas');
sheet.width = W * 3; sheet.height = H * 2;
const g = sheet.getContext('2d');
world.tick(0.016);
VIEWS.forEach(([label, e, t, fov], i) => {
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.1, 6000);
  cam.position.set(e[0], e[3] === 'loft' ? high.perches.find(p => p.kind === 'windmill').y + 1.25 : y(e[0], e[1], e[2]), e[1]);
  const at = new THREE.Vector3(t[0], y(t[0], t[1], t[2]), t[1]);
  cam.lookAt(at); cam.updateMatrixWorld();
  world.cullTrees(cam.position, i === 5 ? 40 : 1);        // (from far above: whole trees, no near cards to miss)
  world.nearGrass.update(cam.position.x, cam.position.z);
  world.focusShadows(i === 5 || i === 0 ? at : cam.position.clone().lerp(at, 0.15));
  renderer.render(scene, cam);
  const x0 = (i % 3) * W, y0 = Math.floor(i / 3) * H;
  g.drawImage(renderer.domElement, x0, y0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x0, y0 + H - 26, W, 26);
  g.fillStyle = '#fff'; g.font = '15px sans-serif'; g.fillText(label + (biome ? ` · ${biome}` : ''), x0 + 10, y0 + H - 8);
});
window.sample = { sheet: sheet.toDataURL('image/jpeg', 0.9), report };
log('done');
