// Operation Sea Wall: a radar station and coastal battery on a headland, the last mission. The
// radars on the cliff top watch the beaches where the landings will come; the battery's guns
// cover them. Destroy both radars and the three guns, take the codebooks from the command
// bunker, and get back down to the beach.
//
// You come ashore in the west cove. The cliffs are too steep to climb except up the gully at the
// west end or the iron ladder below the lighthouse. The surf at the foot of the cliffs covers
// shots from the beach. On top: the radars on their pads, the casemates along the edge (their
// guns are armoured: armour-piercing rounds or a satchel at the magazine door at the back),
// trenches linking them, pillboxes, the command bunker, the barracks and the lighthouse, with a
// lookout on its gallery.
import * as THREE from 'three';
import { fbm, lerp, smoothstep } from '../world/noise.js';
import { M, Builder } from '../world/kit.js';
import { building, furniture, ladder } from '../world/buildings.js';
import { Soldier } from '../world/soldier.js';
import { vehicleModel } from '../world/vehicle-models.js';
import { propModel, dressProps } from '../world/props.js';
import { trenchSystem, dressTrenches, besideTrench } from '../world/trenches.js';
import { Tunnels } from '../world/tunnels.js';

const Y = 45, BEACH = 3, WATER = 0;
const GULLY_X = -260, LADDER_X = 120;
const zc = (x) => -140 + 22 * Math.sin(x * 0.011) - 30 * Math.exp(-(((x - 200) / 70) ** 2));   // the cliff edge
const START = { x: -330, z: zc(-330) - 26 };
const ROAD_Z = 220;
const TRENCHES = [
  [[-200, zc(-200) + 22], [-170, zc(-170) + 26], [-140, zc(-140) + 20], [-110, zc(-110) + 26], [-60, zc(-60) + 34], [-30, 18]],
  [[-30, 18], [0, -20], [40, zc(40) + 40], [90, zc(90) + 26], [130, zc(130) + 24]],
];
const RADARS = [{ key: 'freya', x: 20, z: -40, title: 'FREYA RADAR' }, { key: 'radar', x: -25, z: -52, title: 'WÜRZBURG RADAR' }];
const CASEMATES = [-170, -110, 50].map(x => ({ x, z: zc(x) + 12 }));
const LIGHT = { x: 200, z: zc(200) + 9 };
// The trenches walled and duckboarded (world/trenches.js), with a dugout let into each; a tunnel
// from a cave at the foot of the cliffs up into the west trench.
const SYS = trenchSystem(TRENCHES, { depth: 1.8, half: 0.85, bank: 0.9, dugouts: [besideTrench(TRENCHES[0], 70, 1), besideTrench(TRENCHES[1], 60, 1)] });
const CAVE = { x: -75, z: zc(-75) - 12 };

const trenchDist = (x, z) => SYS.dist(x, z);

function plateau(x, z) {
  let h = Y + (fbm(x * 0.004 + 2, z * 0.004 - 7, 3) - 0.5) * 10 + Math.max(0, z - 150) * 0.08;
  const r = Math.max(Math.abs(x), z);
  if (r > 400) { const t = (r - 400) / 100; h += t * t * (30 + 40 * fbm(x * 0.006 + 1.1, z * 0.006, 3)); }
  return h;
}
// Below the cliff: the beach falling to the sea, then the seabed.
const shore = (d) => (d > -45 ? lerp(0.3, BEACH, smoothstep(-45, -10, d)) : lerp(-6, 0.3, smoothstep(-70, -45, d)));
function heightAt(x, z) {
  const d = z - zc(x), top = plateau(x, z);
  const sheer = Math.abs(x - LADDER_X) < 6 ? 0.3 : 10;                 // under the lighthouse the face is sheer (the ladder)
  let h = d >= 0 ? top : d > -sheer ? lerp(shore(d), top, smoothstep(-sheer, 0, d)) : shore(d);
  // The gully: a ramp from the beach up to the top, cut into the plateau.
  const gw = 1 - smoothstep(6, 12, Math.abs(x - GULLY_X));
  if (gw > 0 && d < 90) h = lerp(h, lerp(shore(Math.min(d, -10)), top, smoothstep(-30, 85, d)), gw);
  // Trenches across the top.
  // (Steep walls; every 32 m a way out: world/trenches.js.)
  if (d > 4) h -= SYS.carve(x, z);
  return h;
}
const slopeAt = (x, z) => Math.max(Math.abs(heightAt(x + 0.7, z) - heightAt(x - 0.7, z)), Math.abs(heightAt(x, z + 0.7) - heightAt(x, z - 0.7))) / 1.4;

const map = {
  // Dusk before the landings: a low sun in the west under heavy cloud, haze over the sea.
  light: { zenith: 79, azimuth: 290, sun: 0xff9868, sunIntensity: 1.7, turbidity: 10, rayleigh: 2.2, clouds: 0.75, hemiSky: 0xa8b0b8, hemi: 0.6, exposure: 0.95 },
  fog: { color: 0xa6adb2, near: 180, far: 1100 },
  weather: { spray: true },   // the surf throws spray at the foot of the cliffs
  animals: [['goat', -250, 120, 25, 5]],   // goats on the heath inland
  half: 500, playHalf: 470, focus: { x: 0, z: 0, r: 160 }, start: START, navHalf: 320, waterLevel: WATER,
  maxSlope: 0.9,
  navBlocked: (x, z) => { const d = z - zc(x); return (d < 15 || (Math.abs(x - GULLY_X) < 14 && d < 95)) && slopeAt(x, z) > 0.9; },   // the cliffs and the gully's walls
  heightAt,
  roadCenterZ: (x) => (x <= -40 ? ROAD_Z : NaN),
  keepClear(x, z, m = 0) {
    const d = z - zc(x);
    if (d < 25 + m) return true;                                                      // the cliff edge, the beach, the sea
    if (Math.abs(x - GULLY_X) < 14 + m && d < 95) return true;
    if (trenchDist(x, z) < 4 + m) return true;
    if (x > -230 && x < 230 && z < 110) return true;                                // the station
    if (x <= -40 && Math.abs(z - ROAD_Z) < 5 + m) return true;
    return Math.hypot(x - LIGHT.x, z - LIGHT.z) < 20 + m;
  },
  paint(c, x, z, { road, rock, dirt, dry }) {
    const d = z - zc(x);
    if (d < -8) c.lerp(new THREE.Color(0xcdb98e), 0.85);                          // sand
    if (slopeAt(x, z) > 0.8) c.lerp(rock, 0.9);                                     // the cliff faces
    else if (d > 0 && d < 40) c.lerp(dry, 0.4);
    if (d > 4 && trenchDist(x, z) < 2.6) c.lerp(dirt, 0.8);
    if (x <= -40 && Math.abs(z - ROAD_Z) < 3) c.lerp(road, 1);
    for (const r of RADARS) if (Math.hypot(x - r.x, z - r.z) < 9) c.lerp(rock, 0.7);
  },
  truck: { from: -600, stop: -120 },
  reinforceHome: [-30, 40],
  flee: [-30, 40],
  routes: {
    Major: [[-35, 21, 20], [-110, zc(-110) + 20, 10], [-170, zc(-170) + 20, 10], [-35, 21, 15], [50, zc(50) + 22, 10], [-35, 21]],
    'Radar sentry': [[-40, -70], [40, -70, 5], [40, -25], [-40, -25, 5], [-40, -70]],
    'Trench patrol': TRENCHES[0].map(([x, z]) => [x, z]).concat([[...TRENCHES[0][0], 8]]),
    'East trench patrol': TRENCHES[1].map(([x, z]) => [x, z]).concat([[...TRENCHES[1][0], 8]]),
    'Beach patrol': [[-220, zc(-220) - 20], [-40, zc(-40) - 20, 10], [-220, zc(-220) - 20, 10]],
    'East beach patrol': [[-20, zc(-20) - 20], [180, zc(180) - 22, 10], [-20, zc(-20) - 20, 10]],
  },
  pickups: layout,
};

// ---- the headland ----
function site(scene, world) {
  const b = new Builder(scene);
  const ladders = [], doors = [], soldiers = [], hotspotDefs = [], towerTops = [];
  const add = (x, z, yaw, opts) => {
    const s = new Soldier({ position: new THREE.Vector3(x, opts.y ?? heightAt(x, z), z), yaw, ...opts });
    scene.add(s.root);
    soldiers.push(s);
    return s;
  };
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4d4f4b, roughness: 0.5, metalness: 0.7 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8b8a82, roughness: 0.95 });
  const place = (m, x, y, z, rotY = 0) => { if (m) { m.position.set(x, y, z); m.rotation.y = rotY; b.group.add(m); } return m; };

  // ---- the radars on their concrete pads (each: its cabin is the weak spot) ----
  const radars = RADARS.map(r => {
    const y = heightAt(r.x, r.z);
    b.box(10, 0.4, 10, concrete, r.x, y - 0.2, r.z);
    const model = place(propModel(r.key, { y: r.key === 'freya' ? 11 : 12 }, { own: true }), r.x, y + 0.2, r.z, r.key === 'freya' ? 0.4 : Math.PI);
    const cabin = b.box(3, 2.6, 3.4, model ? hidden : M.metal, r.x, y + 0.2, r.z);
    hotspotDefs.push({ kind: 'radar', title: r.title, explosive: true, hitsToExplode: 3, meshes: [cabin], parts: model ? model.userData.meshes : [cabin],
      blast: { radius: 8, hurt: 14, size: 2.0, burn: true, label: `${r.title} WRECKED` } });
    return { ...r, model, cabin };
  });
  const gen = b.box(1.6, 1.1, 1, M.metal, 5, heightAt(5, -30), -30);
  place(propModel('flak', { y: 2.9 }), 60, heightAt(60, -20), -20, Math.PI / 2);
  for (let a = 0; a < 8; a++) { const ang = a / 8 * Math.PI * 2; if (a === 2) continue; b.box(1.6, 0.9, 0.6, M.sandbag, 60 + Math.cos(ang) * 3.2, heightAt(60, -20), -20 + Math.sin(ang) * 3.2, { rotY: -ang }); }

  // ---- the battery: three casemates on the edge, guns to the sea. The magazine door on the
  // east side of each is where a satchel goes; armour-piercing rounds work too. ----
  const casemates = CASEMATES.map(c => {
    const y = heightAt(c.x, c.z);
    const model = place(propModel('casemate', { x: 14, y: 6.5, z: 11 }, { stretch: true, own: true }), c.x, y - 0.6, c.z);
    b.box(12, 5, 9, model ? hidden : concrete, c.x, y - 0.6, c.z);
    const door = b.box(0.6, 2.4, 2.2, model ? hidden : steel, c.x + 7.2, y - 0.2, c.z + 2);   // (on its east side, toward the back)
    hotspotDefs.push({ kind: 'gun', title: 'COASTAL GUN', explosive: true, armored: true, hitsToExplode: 2, meshes: [door], parts: model ? model.userData.meshes : [door],
      blast: { radius: 9, hurt: 16, size: 2.4, burn: true, heavy: true, label: 'COASTAL GUN DESTROYED' } });
    return { ...c, model, door };
  });
  // Pillboxes on the edge between them.
  const pits = [[-140, zc(-140) + 9], [-50, zc(-50) + 9], [100, zc(100) + 9]];
  for (const [px, pz] of pits) {
    const py = heightAt(px, pz);
    place(propModel('tobruk', { x: 4.5, y: 1.6, z: 4.5 }, { stretch: true }), px, py - 0.4, pz, Math.PI);
    b.box(3.2, 0.9, 3.2, hidden, px, py, pz);
  }

  // ---- the command bunker: concrete, earth-banked, one big room and the signals room ----
  const [bx, bz] = [-30, 30], by = heightAt(bx, bz);
  const bunker = building(b, { x: bx, z: bz, y: by, w: 16, d: 10, floors: 1, h: 3, mat: concrete, roof: 'flat',
    openings: [{ side: 'n', at: -5, w: 1.2, door: true }, { side: 's', at: 5, w: 1.2, door: true }, ...[2, 5].map(at => ({ side: 'n', at, w: 0.9, h: 0.4, sill: 1.9, window: true }))],
    walls: [{ axis: 'z', at: 2, from: -4.75, to: 4.75, openings: [{ at: 0, w: 1.0, door: true }] }] });
  doors.push(...bunker.doors);
  for (const s of [-1, 1]) { b.box(17, 1.4, 1.4, M.earth, bx, by, bz + s * 5.7); b.box(1.4, 1.4, 10, M.earth, bx + s * 8.7, by, bz); }
  furniture.desk(b, bx - 4, by, bz + 3); furniture.table(b, bx - 3, by, bz - 1, 3, 1.2);
  furniture.desk(b, bx + 5, by, bz + 3.4);
  bunker.safe = { at: new THREE.Vector3(bx + 7.3, by, bz - 3.6), yaw: -Math.PI / 2 };
  bunker.docs = { orders: new THREE.Vector3(bx - 4.1, by + 0.79, bz + 2.9), signals: new THREE.Vector3(bx + 5.1, by + 0.79, bz + 3.3) };
  b.box(0.15, 10, 0.15, steel, bx - 6, by + 3, bz + 3, { solid: false });            // the aerial

  // ---- the barracks: two huts shut, one you can walk into ----
  const hut = building(b, { x: 60, z: 70, y: heightAt(60, 70), w: 14, d: 7, floors: 1, h: 3, mat: M.wood, roof: 'gable',
    openings: [{ side: 'n', at: -4, w: 1.1, door: true }, ...[1, 5].map(at => ({ side: 'n', at, w: 1.0, window: true })), ...[-4, 0, 4].map(at => ({ side: 's', at, w: 1.0, window: true }))] });
  doors.push(...hut.doors);
  const hy = heightAt(60, 70);
  furniture.bed(b, 55, hy, 72); furniture.bed(b, 60, hy, 72); furniture.table(b, 65, hy, 70, 1.6, 0.9);
  hut.docs = { diary: new THREE.Vector3(65.2, hy + 0.79, 70) };
  for (const hx of [-90, 105]) { const yy = heightAt(hx, 72); b.box(14, 3, 7, M.wood, hx, yy, 72); b.gable(14, 1.4, 7, M.roof, hx, yy + 3, 72); }

  // ---- the lighthouse, a lookout on its gallery; an iron ladder down the sheer cliff below ----
  const ly = heightAt(LIGHT.x, LIGHT.z);
  const light = place(propModel('lighthouse', { y: 24 }), LIGHT.x, ly, LIGHT.z);
  b.box(5.2, 24, 5.2, light ? hidden : M.plaster, LIGHT.x, ly, LIGHT.z);
  const gallery = ly + 24 * 0.63;                                      // (the gallery's floor: measured on the model)
  b.box(1.4, 0.2, 1.4, hidden, LIGHT.x, gallery - 0.2, LIGHT.z - 3.1);               // where the lookout stands
  towerTops.push(new THREE.Vector3(LIGHT.x, gallery, LIGHT.z - 3.1));
  place(propModel('searchlight', { y: 2.6 }), LIGHT.x - 14, heightAt(LIGHT.x - 14, LIGHT.z + 4), LIGHT.z + 4, 2.5);
  const lz = zc(LADDER_X) - 0.5;
  ladders.push(ladder(b, { x: LADDER_X, z: lz, y: heightAt(LADDER_X, lz - 0.95), top: heightAt(LADDER_X, lz + 0.7), face: 'n' }));

  // ---- the beach: steel obstacles and wire; our boat in the cove ----
  for (let i = 0; i < 14; i++) {
    const x = -230 + i * 30 + Math.sin(i * 7) * 8, z = zc(x) - 22 - (i % 3) * 7;
    place(propModel('hedgehog', { x: 2.2, y: 1.6, z: 2.2 }, { stretch: true }), x, heightAt(x, z), z, i * 1.3);
  }
  const boat = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 5), new THREE.MeshStandardMaterial({ color: 0x3a3c33, roughness: 0.9 }));
  boat.position.set(START.x - 4, heightAt(START.x - 4, START.z - 8) + 0.3, START.z - 8); boat.rotation.y = 0.5; b.group.add(boat);

  // ---- the trenches: plank walls, duckboards, sandbags on the lips, the dugouts ----
  const dug = dressTrenches(b, SYS, heightAt);
  // The flak gun by the radars: armoured (AP rounds or a charge at its breech).
  const flakCore = b.box(1.4, 1.2, 1.4, hidden, 60, heightAt(60, -20), -20);
  hotspotDefs.push({ kind: 'flak20', title: '2 CM FLAK GUN', explosive: true, armored: true, hitsToExplode: 2, meshes: [flakCore], parts: [flakCore],
    blast: { radius: 6, hurt: 12, size: 1.4, burn: true, heavy: true, label: 'FLAK GUN DESTROYED' } });

  // The siren by the bunker.
  const [sx, sz] = [-10, 20], sy = heightAt(sx, sz);
  b.box(0.2, 5.2, 0.2, M.wood, sx, sy, sz);
  const junction = b.box(0.36, 0.46, 0.2, M.metal, sx, sy + 1.0, sz + 0.2, { solid: false });
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.12, 0.55, 14, 1, true).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a8d84, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
  horn.position.set(sx + 0.25, sy + 5.0, sz);
  const hornBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.35, 12).rotateZ(Math.PI / 2), M.metal);
  hornBody.position.set(sx - 0.05, sy + 5.0, sz);
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.8, 5), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }));
  wire.position.set(sx + 0.12, sy + 3.1, sz + 0.12);
  for (const m of [horn, hornBody, wire]) { m.castShadow = true; b.group.add(m); }
  const siren = { pos: new THREE.Vector3(sx, sy, sz), junction: junction.position.clone(), horn: horn.position.clone(), hornMeshes: [horn, hornBody], wire, standAt: new THREE.Vector3(sx, sy, sz + 0.9) };

  // The surf at the foot of the cliffs covers shots from the beach.
  world.soundSources = [{ name: 'surf', at: (pos) => { const d = pos.z - zc(pos.x); return pos.y < 15 && d < 0 ? Math.max(0, Math.min(0.8, 1.2 - Math.max(0, d + 45) / 40)) : 0; } }];

  // ---- the garrison ----
  add(-35, 21, Math.PI, { officer: true, name: 'Major', look: 'officerColonel' });
  add(bx - 5, bz - 6.5, Math.PI, { name: 'Bunker guard', stance: 'alert', look: 'guardSergeant' });
  add(bx + 4, bz - 1, 0, { name: 'Signaller' });
  add(-40, -70, 0, { name: 'Radar sentry' });
  add(RADARS[0].x + 2.5, RADARS[0].z + 3, Math.PI, { name: 'Radar operator' });
  for (const c of casemates) add(c.x + 9, c.z + 3, -Math.PI / 2, { name: 'Gun crew', look: 'guardSergeant' });
  for (const [px, pz] of pits) add(px + 2.2, pz + 0.8, Math.PI, { name: 'Pillbox crew', stance: 'alert' });
  add(...TRENCHES[0][0], 0, { name: 'Trench patrol', look: 'guardCamo' });
  add(...TRENCHES[1][0], 0, { name: 'East trench patrol' });
  add(LIGHT.x, LIGHT.z - 3.1, Math.PI, { y: gallery, name: 'Lighthouse lookout', stance: 'alert', look: 'guardCamo' });
  add(-220, zc(-220) - 20, -Math.PI / 2, { name: 'Beach patrol' });
  add(-20, zc(-20) - 20, -Math.PI / 2, { name: 'East beach patrol', look: 'guardCamo' });
  add(GULLY_X, zc(GULLY_X) + 88, Math.PI, { name: 'Gully guard', stance: 'alert' });
  for (const g of dug) add(g.inside.x, g.inside.z, g.yaw, { y: g.floor, name: 'Off-duty gunner' });
  add(60, 64, 0, { name: 'Barracks guard' });
  add(-60, ROAD_Z - 4, Math.PI / 2, { name: 'Road guard', stance: 'alert' });

  const dressed = dressProps(scene, dressing(), heightAt, b.boxes, vehicleModel);
  b.solids.push(...dressed.solids); b.boxes.push(...dressed.boxes);

  return {
    solids: b.solids, boxes: b.boxes, soldiers, ladders, doors, siren, towerTops,
    generator: gen.position.clone(), generatorMesh: gen,
    spawn: new THREE.Vector3(START.x, heightAt(START.x, START.z), START.z),
    hotspotDefs, radars, casemates, bunker, hut, dug,
  };
}

// Set dressing: vehicles by the bunker, stores behind the casemates, sandbags along the edge, wire
// on the beach, the barracks' kitchen and tents, a gun on the approach, boats in the cove, poles
// along the road.
function dressing() {
  const poles = [-400, -360, -320, -280, -240, -200, -160, -120].map(x => ['pole', x, ROAD_Z + 6]);
  return [
    ...poles, ['signpost', -46, ROAD_Z - 6, 0.3],
    ['truck', -62, 40, Math.PI / 2], ['car', -6, 46, 0], ['motorcycle', -15, 42, 0.4],
    ...CASEMATES.map(c => ['supplies', c.x - 4, c.z + 10, 0.4]),
    ...[-200, -80, 20, 140].map(x => ['sandbags', x, zc(x) + 5, 0]),
    ...[-200, -170, -140, -110, -80, -50, -20, 10, 40, 70].map(x => ['wire', x, zc(x) - 30, 0]),
    ...TRENCHES.flatMap(tr => tr.slice(1).flatMap(([x1, z1], i) => { const [x0, z0] = tr[i], n = Math.max(1, Math.floor(Math.hypot(x1 - x0, z1 - z0) / 5.4)); return Array.from({ length: n }, (_, k) => { const x = x0 + (x1 - x0) * (k + 0.5) / n, z = z0 + (z1 - z0) * (k + 0.5) / n; return ['wire', x, Math.min(z, zc(x) + 16) - 3.5, Math.abs(z1 - z0) > Math.abs(x1 - x0) ? Math.PI / 2 : 0]; }); })),   // (a belt of wire on the seaward side of the trenches)
    ['kitchen', 40, 82, 0], ['tent', 86, 92], ['tent', 98, 96, 0.3], ['pak40', -60, 0, Math.PI / 2],
    ['mgNest', GULLY_X + 10, zc(GULLY_X) + 100], ['searchlight', -100, zc(-100) + 7, 0.4],
    ['fishingBoat', START.x + 9, START.z + 5, 0.4], ['fishingBoat', START.x - 12, START.z + 2, -0.3],
    ['rowboat', START.x + 5, START.z - 6, 0.5], ['rock', START.x + 25, START.z + 10, 0.4], ['rock', START.x - 22, START.z + 8, 1.7], ['rock', -260, 60, 1],
  ];
}

// ---- what's to be found ----
function layout({ world, on }) {
  const sp = world.spawn;
  const boxes = [
    { kind: 'parts', where: 'the gully', at: on(GULLY_X + 3, zc(GULLY_X) + 30) },
    { kind: 'parts', where: 'the bunker', at: on(-24, 33) },
    { kind: 'parts', where: 'the lighthouse', at: on(LIGHT.x + 4, LIGHT.z + 3) },
    { kind: 'parts', where: 'behind a casemate', at: on(CASEMATES[1].x - 4, CASEMATES[1].z + 8) },
    { kind: 'parts', where: 'the barracks', at: on(55, 69) },
    { kind: 'weapon', weapon: 'panzerfaust', where: 'the west trench', at: on(TRENCHES[0][2][0], TRENCHES[0][2][1]) },
    { kind: 'weapon', weapon: 'g43', where: 'the foot of the ladder', at: on(LADDER_X + 2, zc(LADDER_X) - 4) },
  ];
  for (const [type, x, z] of [
    ['ammo', -60, 60], ['medical', 20, 60], ['explosives', -120, zc(-120) + 40], ['heavy', 80, zc(80) + 40], ['bottles', -5, 55],
    ['explosives', 150, 0], ['ammo', -200, 60], ['medical', 140, 120], ['ammo', 0, 180],
    ['ammo', sp.x + 4, sp.z + 3], ['medical', sp.x + 6, sp.z - 2], ['explosives', sp.x - 3, sp.z + 4],
  ]) boxes.push({ kind: 'supply', type, where: type, at: on(x, z) });
  const benches = [{ where: 'the cove', at: on(sp.x + 2.5, sp.z + 4) }, { where: 'the barracks', at: on(66, 74) }];
  return { boxes, benches };
}

// ---- documents, the safe, the objectives ----
const SAFE = { id: 'bunker-safe', name: 'THE BUNKER SAFE', combination: '06 – 06 – 44' };

function intel(it, world, extras) {
  const { pickups, arsenal, mission } = extras;
  const { bunker, hut, radars } = world.site;
  it.addSafe({ ...SAFE, at: bunker.safe.at, yaw: bunker.safe.yaw, objective: 'safe', objectiveText: 'THE CODEBOOKS TAKEN',
    docs: [{ id: 'coast-codebooks', title: 'Codebooks, Kriegsmarine coastal command',
      text: 'The keys for the coming month, the radar stations\' reporting codes, and the call signs of the coastal batteries from here to the French border.' }],
    contents: () => { const got = []; const part = pickups?.givePart?.(); if (part) got.push(`part: ${part.name}`); if (arsenal) { arsenal.weapons.rifle.ammo.ap += 6; got.push('+6 AP rounds'); } return got; } });
  it.addDocument({ id: 'coast-combination', title: "A gunner's diary", at: hut.docs.diary, reveals: SAFE.id,
    text: `The Major set the new safe combination today and wrote it on the blackboard before he wiped it: ${SAFE.combination}. Some of us have good memories.` });
  it.addDocument({ id: 'coast-orders', title: 'Battery orders', at: bunker.docs.orders,
    text: 'The radars report every contact at sea to the bunker at once. The guns are to engage any landing craft inside 12 km. Magazine doors are to be kept shut.' });
  it.addDocument({ id: 'coast-signals', title: 'Signals log', at: bunker.docs.signals,
    text: '04:10 Freya: contact, bearing 195, range 60 km, lost. 04:40 Würzburg: aircraft, 3, high. 05:15 the lighthouse lookout reports a boat in the west cove: fishermen.' });
  it.addDocument({ id: 'coast-note', title: 'A note under a stone in the cove', at: new THREE.Vector3(START.x + 3, heightAt(START.x + 3, START.z - 2) + 0.05, START.z - 2),
    text: 'Two ways up: the gully at the end of the cove (a guard at the top), or the keepers\' iron ladder below the lighthouse. The lookout up there watches the ladder. — the fishermen' });
  mission.papersDoc = { id: 'coast-papers', title: "Major Stoltz's papers", reveals: SAFE.id,
    text: `Pay book of Major F. Stoltz, Heeres-Küstenartillerie. On the inside cover, in ink: ${SAFE.combination}.` };
  mission.documentsTotal = 6;
  // A smugglers' passage from a cave at the foot of the cliffs up into the west trench's dugout.
  const dg = world.site.dug?.[0];
  if (dg && extras?.scene) world.tunnels = new Tunnels({ scene: extras.scene, world, player: extras.player, interactions: it, audio: extras.audio, hud: extras.hud,
    pairs: [[{ x: CAVE.x, z: CAVE.z }, { x: dg.entrance.x, z: dg.entrance.z, y: dg.floor }]] });
}

const def = {
  target: 'Major Stoltz',
  targetArea: { x: -35, z: 21 },
  extraction: START,
  killText: 'STOLTZ IS DEAD',
  extractText: 'THE SEA WALL IS BLIND AND SILENT · GET BACK DOWN TO THE COVE',
  papersText: "STOLTZ'S PAPERS TAKEN",
  objectives: [
    { id: 'radar', text: 'Wreck both radars, the Freya and the Würzburg' },
    { id: 'guns', text: 'Destroy the three coastal guns (AP rounds, or a satchel at a magazine door)' },
    { id: 'safe', text: 'Take the codebooks from the command bunker safe' },
    { id: 'officer', text: 'Eliminate Major Stoltz, the battery commander', optional: true },
    { id: 'flak', text: 'Destroy the flak gun by the radars', optional: true },
    { id: 'papers', text: "Take Stoltz's papers", optional: true },
    { id: 'extract', text: 'Get back down to the cove', hidden: true },
  ],
  tick(m) {
    const hs = m.world.hotspots, site = m.world.site;
    const radarsLeft = hs.filter(h => h.kind === 'radar' && !h.exploded).length;
    if (radarsLeft === 0) m.complete('radar', 'BOTH RADARS WRECKED');
    const gunsLeft = hs.filter(h => h.kind === 'gun' && !h.exploded).length;
    if (gunsLeft === 0) m.complete('guns', 'ALL THREE GUNS DESTROYED');
    if (hs.some(h => h.kind === 'flak20' && h.exploded)) m.complete('flak', 'THE FLAK GUN IS DESTROYED');
    else if (site.gunsLeft !== undefined && gunsLeft < site.gunsLeft) m.hud.message(`COASTAL GUN DESTROYED · ${gunsLeft} LEFT`, '');
    site.gunsLeft = gunsLeft;
    for (const r of site.radars) if (r.model && !r.down && hs.find(h => h.meshes[0] === r.cabin)?.exploded) { r.down = true; r.model.rotation.z = 0.45; r.model.position.y -= 0.8; }
  },
  markers(m) {
    const out = [];
    if (!m.obj('radar').done) for (const r of RADARS) out.push({ pos: new THREE.Vector3(r.x, heightAt(r.x, r.z) + 13, r.z), kind: 'tank', label: 'RADAR', height: 1 });
    return out;
  },
};

const briefing = `
  <p class="brief">The night before the landings. On a headland above the beaches the Germans have a radar station and a coastal
    battery: whatever they see, the guns will shoot at. You come ashore in the west cove under the cliffs.</p>
  <ul class="goals">
    <li><b>Wreck both radars</b> on the cliff top, the big Freya array and the Würzburg dish: shoot their cabins, or satchels.</li>
    <li><b>Destroy the three coastal guns</b> in their casemates along the edge. They're armoured: armour-piercing rounds,
      or a satchel at the magazine door at the back of each.</li>
    <li><b>Take the codebooks</b> from the safe in the command bunker (the combination is written down somewhere, and the battery
      commander, Major Stoltz, carries it).</li>
    <li><b>Optional:</b> eliminate Stoltz; take his papers.</li>
    <li><b>Then</b> get back down to the cove, where green smoke marks the pick-up.</li>
  </ul>
  <p class="brief">The cliffs can't be climbed: go up the gully at the west end of the cove, or the iron ladder below the lighthouse,
    where a lookout stands on the gallery. Down on the beach, the surf covers your shots.</p>`;

export default { id: 'radar', props: ['freya', 'radar', 'casemate', 'lighthouse', 'hedgehog', 'tobruk', 'flak', 'searchlight', 'generator', 'motorcycle', 'supplies', 'sandbags', 'wire', 'kitchen', 'tent', 'pak40', 'mgNest', 'fishingBoat', 'pole', 'signpost', 'rowboat', 'rock'],
  subtitle: 'Operation Sea Wall · Ligurian coast, 1944', map, site, def, intel, briefing };
