// Operation Black Pine: a fir forest in the Apennines, autumn mist. A German counter-sniper unit
// hunts the partisans from a hunting lodge deep in the woods; its fuel comes up the forest road
// to a logging camp. Kill its commander, destroy the fuel dump, and (if you can) shoot the three
// counter-snipers out of their hunting stands and take their target list from the lodge safe.
//
// 1 km map, nearly all forest: the trees hide you (more of them close by, the harder you are to
// make out) and block shots, the mist keeps sight lines short. Open ground: the forest road,
// the logging camp, the lodge clearing, a hay meadow and a firebreak cut straight through the
// woods, which one of the counter-snipers watches.
import * as THREE from 'three';
import { fbm, lerp, smoothstep } from '../world/noise.js';
import { M, Builder } from '../world/kit.js';
import { building, furniture, ladder } from '../world/buildings.js';
import { Soldier } from '../world/soldier.js';
import { vehicleModel } from '../world/vehicle-models.js';
import { hasProp, propModel, clipAbove, dressProps } from '../world/props.js';

const LODGE = { x: 95, z: -45 }, CAMP = { x: -140, z: 52 }, START = { x: 330, z: 300 }, MEADOW = { x: -10, z: 190 };
const FB = 200;                                  // the firebreak runs north–south along x = 200
const STANDS = [                                 // the hunting stands, and what each one watches
  { x: -92, z: 14, look: [-140, 52] },           // the camp and the road
  { x: FB - 9, z: 60, look: [FB, 300] },         // down the firebreak
  { x: 128, z: -8, look: [230, 110] },           // the woods south-east of the lodge
];
const face = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z));

// The forest road: from the west edge past the camp and up to the lodge, where it ends.
const ROAD = [[-540, 30], [-330, 18], [-200, 22], [-120, 8], [-20, -22], [62, -42]];
function roadZ(x) {
  if (x > 62) return NaN;
  if (x <= ROAD[0][0]) return ROAD[0][1];
  for (let i = 0; i < ROAD.length - 1; i++) {
    const [x0, z0] = ROAD[i], [x1, z1] = ROAD[i + 1];
    if (x <= x1) return lerp(z0, z1, (1 - Math.cos((x - x0) / (x1 - x0) * Math.PI)) / 2);
  }
  return NaN;
}

// Rolling mountain ground; the lodge on a rise, mountains round the edge.
function base(x, z) {
  let h = 40 + (fbm(x * 0.0032 + 11, z * 0.0032 - 4, 4) - 0.5) * 80;
  h += 18 * Math.exp(-((x - LODGE.x) ** 2 + (z - LODGE.z) ** 2) / (2 * 110 * 110));
  h += 14 * Math.exp(-((x - START.x) ** 2 + (z - START.z) ** 2) / (2 * 60 * 60));
  const r = Math.max(Math.abs(x), Math.abs(z));
  if (r > 400) { const t = (r - 400) / 100; h += t * t * (40 + 50 * fbm(x * 0.006 + 1.1, z * 0.006, 3)); }
  return h;
}
// The road's level: the ground along it, smoothed.
const roadCache = new Map();
function roadH(x) {
  const k = Math.round(x);
  let v = roadCache.get(k);
  if (v === undefined) {
    v = 0;
    for (let i = -2; i <= 2; i++) { const xx = Math.min(62, k + i * 8); v += base(xx, roadZ(xx)) / 5; }
    roadCache.set(k, v);
  }
  return v;
}
// Flat clearings (the camp and the lodge level with the road through them).
const CLEAR = [
  { ...LODGE, r: 34, h: roadH(62) }, { ...CAMP, r: 46, h: roadH(CAMP.x) },
  { ...START, r: 12, h: base(START.x, START.z) }, { ...MEADOW, r: 30, h: base(MEADOW.x, MEADOW.z) },
];
function heightAt(x, z) {
  let h = base(x, z);
  const rz = roadZ(x);
  if (!Number.isNaN(rz)) { const d = Math.abs(z - rz); if (d < 14) h = lerp(roadH(x), h, smoothstep(4, 14, d)); }
  for (const c of CLEAR) { const d = Math.hypot(x - c.x, z - c.z); if (d < c.r + 30) h = lerp(c.h, h, smoothstep(c.r * 0.7, c.r + 30, d)); }
  return h;
}
const fromLodge = (routes) => Object.fromEntries(Object.entries(routes).map(([k, pts]) => [k, pts.map(([x, z, w]) => [x - LODGE.x, z - LODGE.z, w])]));
const NEEDLES = new THREE.Color(0x4a3a28);
const inFirebreak = (x, z, m = 0) => Math.abs(x - FB) < 8 + m && Math.abs(z) < 470;

const map = {
  // A wet autumn morning: rain under a low grey sky, the sun no more than a glow in the east.
  light: { zenith: 72, azimuth: 115, sun: 0xdde2e6, sunIntensity: 1.1, turbidity: 10, clouds: 0.95, hemi: 0.7, hemiSky: 0xb8c0c4, env: 0.26, exposure: 0.8 },
  weather: { rain: 1 },   // steady rain: it hides a little of your noise
  animals: [['deer', -150, 220, 30, 3]],   // red deer, far from the lodge
  half: 500, playHalf: 470, focus: { x: LODGE.x, z: LODGE.z, r: 60 }, start: START, navHalf: 285,
  fog: { color: 0xb6bfbd, density: 0.008 },          // mist: half gone at 100 m, nearly all at 200 m
  canopyShade: true,
  heightAt,
  roadCenterZ: roadZ,
  keepClear(x, z, m = 0) {
    if (CLEAR.some(c => Math.hypot(x - c.x, z - c.z) < c.r + m)) return true;
    const rz = roadZ(x);
    if (!Number.isNaN(rz) && Math.abs(z - rz) < 5 + m) return true;
    if (inFirebreak(x, z, m)) return true;
    return STANDS.some(s => Math.hypot(x - s.x, z - s.z) < 3 + m);
  },
  // Firs, with beech in the lower, damper hollows; thick in the middle, thinner toward the edge.
  forest: {
    counts: { fir: 6500, beech: 2200 }, spacing: 3.5, viewDistance: 260,   // (98% mist at 250 m)
    density(x, z, name) {
      const p = 0.2 + 0.8 * (1 - smoothstep(320, 430, Math.max(Math.abs(x), Math.abs(z))));
      const beech = smoothstep(0.45, 0.6, fbm(x * 0.008 + 3, z * 0.008 + 9, 2));
      return (name === 'beech' ? beech : 1 - beech) * p;
    },
  },
  // Grass in the open; under the trees, only a little, in patches.
  grassDensity(x, z) {
    const open = CLEAR.some(c => Math.hypot(x - c.x, z - c.z) < c.r + 4) || inFirebreak(x, z, 1);
    return open ? 1 : 0.35 * smoothstep(0.4, 0.65, fbm(x * 0.03 + 7, z * 0.03, 2));
  },
  coverPatches: [{ x: 250, z: 230, r: 10 }, { x: 160, z: 40, r: 9 }, { x: -60, z: 30, r: 9 }],
  paint(c, x, z, { road, dirt, yard, mowed }) {
    const open = CLEAR.some(cl => Math.hypot(x - cl.x, z - cl.z) < cl.r + 6) || inFirebreak(x, z, 2);
    if (!open) c.lerp(NEEDLES, 0.8);                                      // needles and leaf litter
    else if (inFirebreak(x, z, 2)) c.lerp(mowed, 0.4);
    c.lerp(yard, 0.8 * (1 - smoothstep(30, 44, Math.hypot(x - CAMP.x, z - CAMP.z))));   // sawdust and mud
    c.lerp(yard, 0.5 * (1 - smoothstep(16, 26, Math.hypot(x - LODGE.x, z - LODGE.z))));
    const rz = roadZ(x);
    if (!Number.isNaN(rz)) c.lerp(road, 1 - smoothstep(2, 3.5, Math.abs(z - rz)));
  },
  truck: { from: -600, stop: -200 },
  reinforceHome: [CAMP.x, CAMP.z],
  flee: [CAMP.x, CAMP.z],
  // (Routes are read relative to the focus, the lodge; written here in map coordinates.)
  routes: fromLodge({
    Hauptmann: [[82, -45, 15], [92, -44, 25], [82, -45], [112, -34, 10], [104, -64, 8], [82, -45]],
    'Lodge patrol': [[75, -70], [120, -70, 6], [120, -20], [75, -20, 6], [75, -70]],
    'Camp patrol': [[-180, 30], [-100, 30, 6], [-100, 90], [-180, 92, 6], [-180, 30]],
    'Track patrol': [[-105, roadZ(-105)], [40, roadZ(40), 8], [-105, roadZ(-105), 8]],
    'Firebreak patrol': [[FB, -160], [FB, 260, 10], [FB, -160, 10]],
  }),
  pickups: layout,
};

// ---- the forest's buildings ----
function site(scene) {
  const b = new Builder(scene);
  const ladders = [], doors = [], soldiers = [], hotspotDefs = [], towerTops = [];
  const add = (x, z, yaw, opts) => {
    const s = new Soldier({ position: new THREE.Vector3(x, opts.y ?? heightAt(x, z), z), yaw, ...opts });
    scene.add(s.root);
    soldiers.push(s);
    return s;
  };
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4f5a4a, roughness: 0.6, metalness: 0.5 });
  const bark = new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 1 });
  const cut = new THREE.MeshStandardMaterial({ color: 0xc9a46c, roughness: 0.9 });

  // ---- the hunting lodge: a hall with the trophies, the stairs; upstairs Vogel's office (the
  // safe) and the room where the unit plans its hunts. A porch along the front. ----
  const { x: lx, z: lz } = LODGE, ly = CLEAR[0].h;
  const lodge = building(b, { x: lx, z: lz, y: ly, w: 18, d: 11, floors: 2, h: 3.2, mat: M.darkWood, roof: 'gable',
    openings: [
      { side: 'w', at: 0, w: 1.4, door: true }, { side: 'e', at: 2, w: 1.1, door: true },
      ...[-3.5, 3.5].map(at => ({ side: 'w', at, w: 1.1, window: true })),
      ...[-3.5, 3.5].map(at => ({ side: 'w', at, w: 1.1, window: true, floor: 1 })),
      ...[-6, -1, 5].map(at => ({ side: 'n', at, w: 1.1, window: true })), ...[-6, 5].map(at => ({ side: 'n', at, w: 1.1, window: true, floor: 1 })),
      ...[-6, -1, 5].map(at => ({ side: 's', at, w: 1.1, window: true })), ...[-6, 0, 5].map(at => ({ side: 's', at, w: 1.1, window: true, floor: 1 })),
      { side: 'e', at: -3, w: 1.1, window: true, floor: 1 },
    ],
    stairs: { at: [7.6, 3.6], dir: 'n', w: 0.9 },
    walls: [0, 1].map(f => ({ axis: 'z', at: 2, from: -5.25, to: 5.25, floor: f, openings: [{ at: 0, w: 1.0, door: true }] })),
  });
  doors.push(...lodge.doors);
  b.box(18.6, 0.6, 11.6, M.stone, lx, ly - 0.55, lz, { solid: false });          // the stone footing
  b.box(2.6, 0.3, 11, M.wood, lx - 10.3, ly - 0.3, lz);                          // the porch
  for (const dz of [-5.2, 5.2]) b.box(0.2, 2.9, 0.2, M.wood, lx - 11.4, ly, lz + dz);
  b.box(2.8, 0.15, 11.4, M.roof, lx - 10.3, ly + 2.9, lz, { solid: false });
  const up = ly + 3.2;
  furniture.table(b, lx - 4, ly, lz - 1, 2.6, 1.2);                              // the hall's long table
  furniture.desk(b, lx - 7, ly, lz + 3.4);
  furniture.cabinet(b, lx - 8.3, ly, lz - 4.5, 1.2, 0.45, 1.6);
  furniture.desk(b, lx - 5, up, lz + 2);
  furniture.bed(b, lx + 4.5, up, lz + 3.8);
  furniture.table(b, lx + 4.5, up, lz - 3.4, 2.2, 1.2);                          // the hunt-planning table
  lodge.safe = { at: new THREE.Vector3(lx - 8.4, up, lz - 3.5), yaw: Math.PI / 2 };
  lodge.docs = {
    orders: new THREE.Vector3(lx - 7.1, ly + 0.79, lz + 3.3),
    plan: new THREE.Vector3(lx + 4.3, up + 0.79, lz - 3.3),
  };
  // Antlers over the hall table (a row of pale tines on the north wall).
  for (let i = 0; i < 4; i++) b.box(0.6, 0.4, 0.06, new THREE.MeshStandardMaterial({ color: 0xd8ccb0 }), lx - 7 + i * 1.8, ly + 2.2, lz - 5.2, { solid: false });
  b.box(5, 2.6, 3, M.wood, lx + 20, ly, lz + 15);                                // the woodshed
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 11, 6), steel);   // the radio mast
  mast.position.set(lx + 9.5, ly + 5.5, lz - 6.5); b.group.add(mast);
  // Vogel's Kübelwagen at the end of the road.
  const [kx, kz] = [70, -30];
  const kubel = vehicleModel('car');
  kubel.position.set(kx, heightAt(kx, kz), kz); kubel.rotation.y = Math.PI / 2;
  b.group.add(kubel);
  const ky = heightAt(kx, kz);
  b.box(2.6, 0.9, 1.6, hidden, kx + 0.4, ky + 0.3, kz);
  const carEngine = b.box(0.9, 0.75, 1.5, hidden, kx - 1.3, ky + 0.45, kz);

  // ---- the logging camp: the sawmill shed, log piles, the crew's hut, the fuel dump, the tanker ----
  const { x: cx, z: cz } = CAMP, cy = CLEAR[1].h;
  {   // the sawmill: a roof on posts over the saw bench
    const [sx, sz] = [cx - 25, cz - 7];
    for (const dx of [-10, -3.3, 3.3, 10]) for (const dz of [-4.5, 4.5]) b.box(0.3, 4.4, 0.3, M.wood, sx + dx, cy, sz + dz);
    b.box(21, 0.2, 10, M.roof, sx, cy + 4.4, sz, { solid: false });
    const bench = propModel('sawBench', { x: 7.4, z: 1.7 }, { stretch: true });
    b.box(7, 0.9, 1.3, bench ? hidden : M.wood, sx, cy, sz);
    if (bench) { bench.position.set(sx, cy, sz); b.group.add(bench); }
    else {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 6, 12).rotateZ(Math.PI / 2), bark);
      log.position.set(sx - 1, cy + 1.35, sz); log.castShadow = true; b.group.add(log);
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.03, 24).rotateX(Math.PI / 2), steel);
      blade.position.set(sx + 2.8, cy + 1.0, sz); b.group.add(blade);
    }
  }
  // Log piles: you can hide behind them (and climb on them).
  for (const [px, pz] of [[cx + 20, cz - 20], [cx - 30, cz - 24], [cx + 28, cz + 10]]) {
    b.box(8, 2.1, 3, hidden, px, cy, pz);
    const pile = propModel('logs', { x: 8.4, y: 2.2, z: 3.2 }, { stretch: true });
    if (pile) { pile.position.set(px, cy, pz); b.group.add(pile); continue; }
    for (let row = 0; row < 3; row++) for (let k = 0; k < 4 - row; k++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 8, 10).rotateZ(Math.PI / 2), bark);
      l.position.set(px, cy + 0.4 + row * 0.66, pz - 1.1 + k * 0.75 + row * 0.37); l.castShadow = l.receiveShadow = true; b.group.add(l);
      const ends = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 8.04, 10, 1, false).rotateZ(Math.PI / 2), cut);
      ends.position.copy(l.position); ends.scale.set(1, 0.98, 0.98); b.group.add(ends);
    }
  }
  // The crew's hut.
  const hut = building(b, { x: cx + 20, z: cz + 23, y: cy, w: 12, d: 7, floors: 1, h: 3, mat: M.wood, roof: 'gable',
    openings: [{ side: 's', at: -3, w: 1.1, door: true }, ...[2, -5].map(at => ({ side: 'n', at, w: 1.0, window: true })), { side: 's', at: 3, w: 1.0, window: true }] });
  doors.push(...hut.doors);
  furniture.bed(b, cx + 16, cy, cz + 21); furniture.bed(b, cx + 24, cy, cz + 21);
  furniture.table(b, cx + 20, cy, cz + 25, 1.6, 0.9);
  hut.docs = { notebook: new THREE.Vector3(cx + 20.2, cy + 0.79, cz + 25) };
  // The fuel dump: three stacks of drums in a ring of sandbags, and the tanker that brought them.
  const drumMat = new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.7, metalness: 0.3 });
  const dumps = [];
  for (const dx of [-8, 0, 8]) {
    const [dxp, dzp] = [cx - 18 + dx, cz + 26];
    const parts = [];
    const stack = propModel('drums', { x: 2.1, y: 1.85, z: 1.45 }, { stretch: true, own: true, bright: 1.9 });
    if (stack) { stack.position.set(dxp, cy, dzp); b.group.add(stack); parts.push(...stack.userData.meshes); }
    else for (let layer = 0; layer < 2; layer++) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.88, 12), drumMat);
      d.position.set(dxp - 0.66 + i * 0.66, cy + 0.44 + layer * 0.9, dzp - 0.33 + j * 0.66); d.castShadow = true; b.group.add(d); parts.push(d);
    }
    const box = b.box(2.0, 1.8, 1.32, hidden, dxp, cy, dzp);
    dumps.push(box);
    hotspotDefs.push({ kind: 'fuel', title: 'FUEL DRUMS', explosive: true, hitsToExplode: 2, meshes: [box], parts,
      blast: { radius: 8, hurt: 15, size: 1.8, burn: true, chain: 12, label: 'FUEL DUMP' } });
  }
  for (let a = 0; a < 14; a++) {
    const ang = a / 14 * Math.PI * 2; if (a === 3) continue;                    // the way in, toward the road
    b.box(1.6, 0.9, 0.6, M.sandbag, cx - 18 + Math.cos(ang) * 13, cy, cz + 26 + Math.sin(ang) * 5, { rotY: -ang });
  }
  const tanker = vehicleModel('truck');
  tanker.position.set(cx + 2, cy, cz + 34); tanker.rotation.y = Math.PI / 2; b.group.add(tanker);
  b.box(3.6, 2.4, 2.3, hidden, cx + 0.8, cy + 0.35, cz + 34); b.box(1.2, 2.0, 2.1, hidden, cx + 3.2, cy + 0.35, cz + 34);
  const tankerEngine = b.box(1.2, 1.25, 1.8, hidden, cx + 4.4, cy + 0.5, cz + 34);
  // The alarm siren on a pole by the hut.
  const [sx, sz] = [cx + 8, cz + 14];
  b.box(0.2, 5.2, 0.2, M.wood, sx, cy, sz);
  const junction = b.box(0.36, 0.46, 0.2, M.metal, sx, cy + 1.0, sz + 0.2, { solid: false });
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.12, 0.55, 14, 1, true).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a8d84, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
  horn.position.set(sx + 0.25, cy + 5.0, sz);
  const hornBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.35, 12).rotateZ(Math.PI / 2), M.metal);
  hornBody.position.set(sx - 0.05, cy + 5.0, sz);
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.8, 5), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }));
  wire.position.set(sx + 0.12, cy + 3.1, sz + 0.12);
  for (const m of [horn, hornBody, wire]) { m.castShadow = true; b.group.add(m); }
  const siren = { pos: new THREE.Vector3(sx, cy, sz), junction: junction.position.clone(), horn: horn.position.clone(), hornMeshes: [horn, hornBody], wire, standAt: new THREE.Vector3(sx, cy, sz + 0.9) };

  // ---- the hay meadow: a hut and bales ----
  const { x: mx, z: mz } = MEADOW, my = CLEAR[3].h;
  const hay = building(b, { x: mx, z: mz, y: my, w: 6, d: 5, floors: 1, h: 2.8, mat: M.wood, roof: 'gable',
    openings: [{ side: 's', at: 0, w: 1.1, door: true }, { side: 'e', at: 0, w: 0.9, window: true }] });
  doors.push(...hay.doors);
  furniture.table(b, mx - 1.5, my, mz - 1.2, 1.4, 0.8);
  hay.docs = { letter: new THREE.Vector3(mx - 1.5, my + 0.79, mz - 1.2) };
  const baleMat = new THREE.MeshStandardMaterial({ color: 0xb9a35e, roughness: 1 });
  for (const [bx, bz] of [[12, 6], [15, -8], [-14, 10], [-10, -14], [4, 16]]) {
    const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 16).rotateZ(Math.PI / 2), baleMat);
    bale.position.set(mx + bx, heightAt(mx + bx, mz + bz) + 0.75, mz + bz); bale.castShadow = true; b.group.add(bale); b.addSolid(bale);
  }

  // ---- the hunting stands: a cabin on four posts, rails on three sides, a ladder up the fourth ----
  for (const s of STANDS) {
    const y = heightAt(s.x, s.z), top = y + 5;
    // The modelled stand (when loaded) gives the legs and its ladder to the south: it's cut off just
    // under the cabin floor (its generated cabin is solid where the picture had openings and hid the
    // sniper); the floor, rails, posts and roof above are ours.
    const model = hasProp('huntingStand') && propModel('huntingStand', { y: 5 / 0.62 });
    const wood = model ? hidden : M.wood;
    for (const [dx, dz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) b.box(0.18, 7.4, 0.18, wood, s.x + dx, y - 0.3, s.z + dz);
    b.box(2.4, 0.15, 2.4, M.wood, s.x, top - 0.15, s.z);
    b.box(2.4, 1.0, 0.08, M.wood, s.x, top, s.z - 1.16);
    b.box(0.08, 1.0, 2.4, M.wood, s.x - 1.16, top, s.z);
    b.box(0.08, 1.0, 2.4, M.wood, s.x + 1.16, top, s.z);
    b.box(2.9, 0.12, 2.9, M.roof, s.x, top + 2.0, s.z, { solid: false });
    const before = b.group.children.length;
    ladders.push(ladder(b, { x: s.x, z: s.z + 1.25, y, top, face: 's' }));
    if (model) {
      for (const o of b.group.children.slice(before)) o.material = hidden;   // (the model has its ladder)
      model.position.set(s.x, y, s.z + 0.82);
      b.group.add(model);
      clipAbove(model, top - 0.2);
      for (const [dx, dz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) b.box(0.14, 2.0, 0.14, M.wood, s.x + dx, top, s.z + dz, { solid: false });
    }
    s.top = new THREE.Vector3(s.x, top, s.z);
    towerTops.push(s.top);
    add(s.x, s.z - 0.3, face(s.x, s.z, ...s.look), { y: top, name: 'Counter-sniper', stance: 'alert', look: 'guardCamo' });
  }

  // ---- the unit ----
  add(82, -45, -Math.PI / 2, { officer: true, name: 'Hauptmann', look: 'officerLieutenant' });
  add(lx - 12, lz - 3, Math.PI / 2, { name: 'Lodge guard', stance: 'alert', look: 'guardSergeant' });
  add(lx - 12, lz + 3, Math.PI / 2, { name: 'Lodge guard', stance: 'alert' });
  add(75, -70, 0, { name: 'Lodge patrol', look: 'guardCamo' });
  add(lx + 4, lz + 1, Math.PI / 2, { y: up, name: 'Lodge sentry', stance: 'alert' });          // upstairs, at the windows
  add(-180, 30, Math.PI / 2, { name: 'Camp patrol' });
  add(cx - 18, cz + 20, Math.PI, { name: 'Dump guard', stance: 'alert', look: 'guardSergeant' });
  add(cx - 10, cz + 31, -Math.PI / 2, { name: 'Dump guard' });
  add(cx - 22, cz - 4, Math.PI / 2, { name: 'Sawmill guard' });
  add(cx, roadZ(cx) + 4, -Math.PI / 2, { name: 'Road guard', stance: 'alert' });
  add(-105, roadZ(-105), Math.PI / 2, { name: 'Track patrol', look: 'guardCamo' });
  add(FB, -160, Math.PI, { name: 'Firebreak patrol' });
  add(mx + 2, mz + 4, 0, { name: 'Meadow sentry' });

  const dressed = dressProps(scene, dressing(), heightAt, b.boxes, vehicleModel);
  b.solids.push(...dressed.solids); b.boxes.push(...dressed.boxes);

  return {
    solids: b.solids, boxes: b.boxes, soldiers, ladders, doors, siren, towerTops,
    spawn: new THREE.Vector3(START.x, heightAt(START.x, START.z), START.z),
    staffCar: { title: 'STAFF CAR ENGINE', engine: carEngine, parts: [kubel.userData.mesh] },
    vehicles: [{ title: 'FUEL TRUCK ENGINE', engine: tankerEngine, parts: [tanker.userData.mesh] }],
    hotspotDefs, lodge, hut, hay, dumps, stands: STANDS,
  };
}

// Set dressing: the camp's tents and kitchen, a truck on the road, the lodge's motorcycle and
// stores, haystacks and a cart in the meadow, poles and a signpost along the road.
function dressing() {
  const poles = [-420, -380, -340, -300, -260, -220].map(x => ['pole', x, roadZ(x) + 6]);
  return [
    ...poles, ['signpost', -112, roadZ(-112) + 5, 0.5],
    ['tent', -186, 50, Math.PI / 2], ['tent', -186, 38, Math.PI / 2], ['kitchen', -126, 40, 0.3], ['truck', -150, roadZ(-150) + 7, Math.PI / 2],
    ['supplies', -132, 72], ['drums', -105, 45, 0.4],
    ['motorcycle', 74, -24, 0.5], ['supplies', 112, -23], ['sandbags', 78, -58, 0], ['halftrack', 30, roadZ(30) + 8, Math.PI / 2],
    ['haystack', -36, 196], ['haystack', 6, 176], ['cart', 12, 202, 0.6], ['well', -24, 178],
    ['felledTree', -60, 30, 0.4], ['felledTree', 25, -85, 1.3], ['felledTree', -20, 125, 2.2], ['horseCart', -105, roadZ(-105) + 8, Math.PI / 2],
    ['rock', 150, 150], ['rock', -250, -200, 1], ['rock', 210, -60, 2],
  ];
}

// ---- what's to be found ----
function layout({ world, on }) {
  const sp = world.spawn, { x: cx, z: cz } = CAMP, { x: lx, z: lz } = LODGE;
  const boxes = [
    { kind: 'parts', where: 'the lodge porch', at: on(lx - 10.6, lz + 4) },
    { kind: 'parts', where: 'the sawmill', at: on(cx - 31, cz - 4) },
    { kind: 'parts', where: 'the hay hut', at: on(MEADOW.x + 1.8, MEADOW.z - 1.3) },
    { kind: 'parts', where: 'under the firebreak stand', at: on(STANDS[1].x + 0.6, STANDS[1].z - 0.4) },
    { kind: 'parts', where: 'behind the crew hut', at: on(cx + 20, cz + 28) },
    { kind: 'weapon', weapon: 'delisle', where: 'the hay hut', at: on(MEADOW.x + 1.8, MEADOW.z + 1.2) },
    { kind: 'weapon', weapon: 'mg42', where: 'the sawmill', at: on(cx - 18, cz - 10) },
  ];
  for (const [type, x, z] of [
    ['ammo', cx + 24, cz - 14], ['medical', cx - 4, cz - 22], ['explosives', cx + 12, cz + 8], ['heavy', cx - 34, cz + 14],
    ['bottles', lx + 20, lz + 18], ['ammo', lx - 14, lz + 14], ['medical', MEADOW.x - 8, MEADOW.z + 6],
    ['ammo', FB + 12, 150], ['explosives', 40, 80], ['medical', 150, 190], ['ammo', -40, -60], ['bottles', -60, 120],
    ['ammo', sp.x + 6, sp.z + 3], ['medical', sp.x + 4, sp.z - 6], ['explosives', sp.x - 5, sp.z + 4],
  ]) boxes.push({ kind: 'supply', type, where: type, at: on(x, z) });
  const benches = [{ where: 'start', at: on(sp.x + 2.5, sp.z - 4) }, { where: 'the hay meadow', at: on(MEADOW.x + 5, MEADOW.z + 5) }];
  return { boxes, benches };
}

// ---- documents, the safe, the objectives ----
const SAFE = { id: 'forest-safe', name: "VOGEL'S SAFE", combination: '31 – 08 – 15' };

function intel(it, world, { pickups, arsenal, items, mission }) {
  const { lodge, hut, hay } = world.site;
  it.addSafe({ ...SAFE, at: lodge.safe.at, yaw: lodge.safe.yaw, objective: 'safe', objectiveText: 'THE TARGET LIST TAKEN',
    docs: [{ id: 'forest-targets', title: 'Target list: partisan bands, Monte Nero',
      text: 'Jagdkommando Vogel. Bands located: "Garibaldi" at the charcoal burners\' huts (grid 47-12), "Stella Rossa" in the quarry caves, ' +
        'couriers through the hay meadow at dusk.\n\nTo be cleared before the 20th. Informer "Falco" to be paid in tobacco and fuel.' }],
    contents: () => { const got = []; const part = pickups?.givePart?.(); if (part) got.push(`part: ${part.name}`); if (arsenal) { arsenal.weapons.rifle.ammo.ap += 4; got.push('+4 AP rounds'); } return got; } });
  it.addDocument({ id: 'forest-combination', title: "A sergeant's notebook", at: hut.docs.notebook, reveals: SAFE.id,
    text: `Rota for the stands. Fuel: 40 drums, 6 for the Hauptmann's car.\n\nThe Hauptmann had me open his safe again while he was out hunting: ${SAFE.combination}. He'll never change it.` });
  it.addDocument({ id: 'forest-orders', title: 'Orders for the Jagdkommando', at: lodge.docs.orders,
    text: 'The unit is to hunt the partisan snipers with their own methods: patience, camouflage, the stands. Men on the stands do not leave them before relief. ' +
      'Every shot fired in the forest is to be reported to the lodge by runner.' });
  it.addDocument({ id: 'forest-stands', title: 'Map of the stands', at: lodge.docs.plan,
    text: 'Stand 1: above the road east of the camp, watching the camp and the road.\nStand 2: on the firebreak, watching south.\nStand 3: south-east of the lodge, watching the slope.\n\nIn the mist they see little past 150 metres. Nobody comes through the trees quietly.' });
  it.addDocument({ id: 'forest-letter', title: 'A letter in the hay hut', at: hay.docs.letter,
    text: 'Paolo — the Germans keep their petrol at the sawmill now, the green drums in the sandbags. One shot in the right place and the whole camp will know about it.\n' +
      'Don\'t cross the firebreak by day. They have a man up a stand there with a telescope. — M.' });
  mission.papersDoc = { id: 'forest-papers', title: "Hauptmann Vogel's papers", reveals: SAFE.id,
    text: `Soldbuch of Hauptmann E. Vogel, Jagdkommando. A hunting licence from Bavaria, 1937. On a slip in the back: ${SAFE.combination}.` };
  mission.documentsTotal = 6;
}

const def = {
  target: 'Hauptmann Vogel',
  targetArea: LODGE,
  extraction: START,
  killText: 'VOGEL IS DEAD',
  extractText: 'THE HUNTERS ARE BROKEN · GET BACK TO WHERE YOU STARTED',
  papersText: "VOGEL'S PAPERS TAKEN",
  objectives: [
    { id: 'officer', text: 'Eliminate Hauptmann Vogel, the counter-sniper commander (at the hunting lodge)' },
    { id: 'dump', text: 'Destroy the fuel dump at the logging camp' },
    { id: 'stands', text: 'Kill the three counter-snipers on the hunting stands', optional: true },
    { id: 'safe', text: "Take the target list from Vogel's safe", optional: true },
    { id: 'papers', text: "Take Vogel's papers", optional: true },
    { id: 'extract', text: 'Get back to where you started', hidden: true },
  ],
  tick(m) {
    const w = m.world;
    if (!m.obj('dump').done && w.site.dumps.every(d => w.hotspots.find(h => h.meshes[0] === d)?.exploded)) m.complete('dump', 'THE FUEL DUMP IS BURNING');
    if (!m.obj('stands').done && w.soldiers.filter(s => s.name === 'Counter-sniper').every(s => !s.alive)) m.complete('stands', 'THE STANDS ARE EMPTY');
  },
  markers(m) {
    const out = [];
    if (!m.obj('dump').done) out.push({ pos: new THREE.Vector3(CAMP.x - 18, CLEAR[1].h + 2, CAMP.z + 26), kind: 'tank', label: 'FUEL DUMP', height: 1 });
    return out;
  },
};

const briefing = `
  <p class="brief">Monte Nero, October 1944. A German Jagdkommando, a unit of hunters, is killing the partisans' snipers one by one.
    It lives at a hunting lodge deep in the fir forest, and its fuel comes up the forest road to a logging camp. Its commander
    is Hauptmann Vogel.</p>
  <ul class="goals">
    <li><b>Eliminate Hauptmann Vogel</b> at the hunting lodge, at the end of the forest road.</li>
    <li><b>Destroy the fuel dump</b> at the logging camp: the drums in the sandbag ring. Shoot them twice, or use explosives.</li>
    <li><b>Optional:</b> kill the three counter-snipers on their hunting stands; take the target list from Vogel's safe
      (the combination is written down somewhere, and Vogel carries it); take his papers.</li>
    <li><b>Then</b> get back to where you started, where green smoke marks the pick-up.</li>
  </ul>
  <p class="brief">The mist keeps everyone's sight short. Among the trees you are hard to make out, and their trunks stop bullets;
    the road, the clearings and the firebreak are open ground, and one of the stands watches the firebreak.
    If the siren at the camp sounds, a truck of reinforcements comes up the road.</p>`;

export default { id: 'forest', props: ['huntingStand', 'drums', 'logs', 'sawBench', 'tent', 'kitchen', 'supplies', 'motorcycle', 'sandbags', 'halftrack', 'haystack', 'cart', 'well', 'pole', 'signpost', 'felledTree', 'horseCart', 'rock'], subtitle: 'Operation Black Pine · Apennines, 1944', map, site, def, intel, briefing };
