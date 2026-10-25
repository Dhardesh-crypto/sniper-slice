// Operation Iron Road: a railway junction in the Po valley. A railway gun is coming through
// on a special train; it stops at the station for water and then goes on west to the front.
// Stop it, destroy the gun, and take the timetables from the stationmaster's safe.
//
// The train keeps its own time: it is due a few minutes in, stands at the water tower for
// a while, then leaves. Stop it first: pull the home-signal lever in the signal box (it then
// waits at the signal, or stays at the platform), or wreck the locomotive's boiler. The gun is
// armoured (a satchel on its breech, armour-piercing or anti-tank hits), and the ammunition
// wagon coupled in front of it goes up if you shoot it, taking the gun with it.
// If the train gets away with the gun, the mission is lost.
//
// 1 km map: the main line east–west through the station, a yard of sidings with an engine shed
// and a goods shed, the town's road from the west, open fields and hills around.
import * as THREE from 'three';
import { fbm, lerp, smoothstep, makeRng } from '../world/noise.js';
import { M, Builder } from '../world/kit.js';
import { building, furniture, ladder } from '../world/buildings.js';
import { Soldier } from '../world/soldier.js';

const Y = 10;                                   // the line's level
const START = { x: 330, z: 300 };
const ROAD_Z = -38;
const BRANCH = [[115, 4], [480, 230]];          // the branch line, off to the south-east
const HOME_SIGNAL = 170, STATION_STOP = -75;    // where the train's front stops
const T_DUE = 300, STAND = 150;                 // it comes into sight at 5:00 and stands 2:30

function segDist(x, z, [[x0, z0], [x1, z1]]) {
  const dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz));
}
// How far (x, z) is outside the flat ground: the yard and station, the line, the branch.
function flatDist(x, z) {
  const yard = Math.hypot(Math.max(0, -230 - x, x - 200), Math.max(0, -75 - z, z - 45));
  return Math.min(yard, Math.max(0, Math.abs(z) - 14), Math.max(0, segDist(x, z, BRANCH) - 10));
}
function heightAt(x, z) {
  let h = (fbm(x * 0.0035 + 3, z * 0.0035 - 8, 4) - 0.5) * 70 + Math.max(0, Math.abs(z) - 80) * 0.06;
  h += 26 * Math.exp(-((x - START.x) ** 2 + (z - START.z) ** 2) / (2 * 75 * 75));
  const r = Math.max(Math.abs(x), Math.abs(z));
  if (r > 400) { const t = (r - 400) / 100; h += t * t * (30 + 40 * fbm(x * 0.006 + 1.1, z * 0.006, 3)); }
  return Y + Math.max(-4, h) * smoothstep(0, 70, flatDist(x, z));
}

const map = {
  half: 500, playHalf: 470, focus: { x: 0, z: 0, r: 120 }, start: START, navHalf: 280,
  heightAt,
  roadCenterZ: (x) => (x <= 20 ? ROAD_Z : NaN),
  keepClear(x, z, m = 0) {
    if (x > -240 - m && x < 210 + m && z > -80 - m && z < 50 + m) return true;     // the station, yard and town edge
    if (Math.abs(z) < 9 + m || segDist(x, z, BRANCH) < 7 + m) return true;
    if (x <= 20 && Math.abs(z - ROAD_Z) < 5 + m) return true;
    return Math.hypot(x - START.x, z - START.z) < 12 + m;
  },
  paint(c, x, z, { road, rock, dirt, yard }) {
    const inYard = x > -235 && x < 205 && z > -30 && z < 42;
    if (inYard) c.lerp(dirt, 0.6);
    const ballast = Math.min(Math.abs(z), Math.abs(z - 10), Math.abs(z - 15), Math.abs(z - 24) + (x > -120 ? 99 : 0), segDist(x, z, BRANCH));
    c.lerp(rock, 0.8 * (1 - smoothstep(1.6, 2.6, ballast)));
    if (x <= 20) c.lerp(road, 1 - smoothstep(2.5, 4, Math.abs(z - ROAD_Z)));
    c.lerp(yard, 0.8 * (x > -25 && x < 25 && z > ROAD_Z - 3 && z < -20 ? 1 : 0));       // the station forecourt
  },
  truck: { from: -600, stop: -130 },
  reinforceHome: [-30, -30],
  flee: [-60, -45],
  routes: {
    Major: [[0, -5, 20], [40, -5, 6], [-50, -5, 10], [0, -5], [0, -14, 25], [0, -5]],
    'Platform patrol': [[-55, -5], [45, -5, 8], [-55, -5, 8]],
    'Yard patrol': [[-190, 6], [30, 6, 8], [30, 19.5], [-190, 19.5, 8], [-190, 6]],
    'Crossing patrol': [[100, -20], [200, -20, 6], [200, 20], [100, 20, 6], [100, -20]],
  },
  pickups: layout,
};

// ---- the junction ----
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
  const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 });

  // Track along x: two rails and the sleepers (instanced).
  const sleeperGeo = new THREE.BoxGeometry(0.24, 0.14, 2.5);
  const track = (x0, x1, z) => {
    for (const s of [-0.72, 0.72]) b.box(x1 - x0, 0.15, 0.08, steel, (x0 + x1) / 2, Y + 0.14, z + s, { solid: false });
    const n = Math.floor((x1 - x0) / 0.8), im = new THREE.InstancedMesh(sleeperGeo, sleeperMat, n), m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) im.setMatrixAt(i, m.makeTranslation(x0 + (i + 0.5) * 0.8, Y + 0.07, z));
    im.receiveShadow = true;
    b.group.add(im);
  };
  track(-520, 520, 0);                                             // the main line
  for (const [x0, x1, z] of [[-200, 40, 10], [-190, 20, 15], [-200, -132, 24]]) track(x0, x1, z);
  {   // the branch: its rails turned along its line
    const [[x0, z0], [x1, z1]] = BRANCH, len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(-(z1 - z0), x1 - x0);
    const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    for (const s of [-0.72, 0.72]) {
      const cx = (x0 + x1) / 2 - uz * s, cz = (z0 + z1) / 2 + ux * s;
      const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.15, 0.08), steel);
      r.position.set(cx, Y + 0.21, cz); r.rotation.y = ang; b.group.add(r);
    }
    const n = Math.floor(len / 0.8), im = new THREE.InstancedMesh(sleeperGeo, sleeperMat, n), m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; im.setMatrixAt(i, m.compose(new THREE.Vector3(lerp(x0, x1, t), Y + 0.07, lerp(z0, z1, t)), q, new THREE.Vector3(1, 1, 1))); }
    b.group.add(im);
  }

  // ---- the station: the platform along the main line, the building behind it ----
  b.box(110, 0.5, 6.3, M.stone, -5, Y, -5.35);                     // low enough to step up onto
  for (const x of [-40, -10, 20]) { b.box(0.25, 3.2, 0.25, M.darkWood, x, Y + 0.5, -7.6); }
  b.box(70, 0.15, 4, M.roof, -10, Y + 3.7, -6.4, { solid: false });          // the platform canopy
  const [sx, sz] = [0, -16];
  const st = building(b, { x: sx, z: sz, y: Y, w: 26, d: 10, floors: 2, h: 3.4, mat: M.plaster2, roof: 'gable',
    openings: [
      { side: 's', at: 0, w: 1.6, h: 2.4, door: true }, { side: 'n', at: 0, w: 1.6, h: 2.4, door: true },
      ...[-9, -6, 6, 9].map(at => ({ side: 's', at, w: 1.1, window: true })), ...[-9, -6, 0, 6, 9].map(at => ({ side: 's', at, w: 1.1, window: true, floor: 1 })),
      ...[-9, -6, 6, 9].map(at => ({ side: 'n', at, w: 1.1, window: true })), ...[-9, -3, 3, 9].map(at => ({ side: 'n', at, w: 1.1, window: true, floor: 1 })),
      { side: 'w', at: 0, w: 1.1, window: true, floor: 1 }, { side: 'e', at: 0, w: 1.1, window: true, floor: 1 }, { side: 'e', at: 2, w: 1.1, door: true },
    ],
    stairs: { at: [-11.6, 3.2], dir: 'n', w: 0.9 },
    walls: [0, 1].flatMap(f => [-4, 4].map(at => ({ axis: 'z', at, from: -4.75, to: 4.75, floor: f, openings: [{ at: 1.5, w: 1.0, door: true }] }))),
  });
  doors.push(...st.doors);
  const up = Y + 3.4;
  b.box(5, 1.1, 0.6, M.darkWood, sx, Y, sz - 2);                    // the ticket counter
  furniture.desk(b, sx - 8, Y, sz + 1);
  furniture.cabinet(b, sx - 6, Y, sz - 4.4, 1.2, 0.45, 1.8);
  furniture.desk(b, sx - 7, up, sz + 1.5);
  furniture.desk(b, sx + 8, up, sz - 1.5);
  furniture.table(b, sx + 8, Y, sz + 1, 2.2, 1);                     // the waiting room
  st.safe = { at: new THREE.Vector3(sx - 8, up, sz - 4.4), yaw: 0 };
  st.docs = {
    timetable: new THREE.Vector3(sx - 8.1, Y + 0.79, sz + 0.9),
    orders: new THREE.Vector3(sx + 8.1, up + 0.79, sz - 1.6),
  };
  // A clock over the platform door and a nameboard.
  b.box(6, 0.8, 0.1, new THREE.MeshStandardMaterial({ color: 0x23324a }), sx, Y + 2.7, sz + 5.06, { solid: false });

  // ---- the signal box, east of the platform: the levers upstairs, a ladder up its south side ----
  const [bx, bz] = [78, -11];
  const box = building(b, { x: bx, z: bz, y: Y, w: 6, d: 4.5, floors: 2, h: 3.2, mat: M.wood, roof: 'gable',
    openings: [
      { side: 'n', at: 0, w: 1.1, door: true }, { side: 'w', at: 0, w: 1.0, window: true },
      { side: 's', at: 0, w: 1.0, h: 2.1, floor: 1 },                          // the doorway at the ladder's top
      ...[-1.8, 1.8].map(at => ({ side: 's', at, w: 1.4, window: true, floor: 1 })),
      ...[-1.5, 1.5].map(at => ({ side: 'n', at, w: 1.4, window: true, floor: 1 })),
      { side: 'e', at: 0, w: 1.6, window: true, floor: 1 }, { side: 'w', at: 0, w: 1.6, window: true, floor: 1 },
    ] });
  doors.push(...box.doors);
  ladders.push(ladder(b, { x: bx, z: bz + 2.25 + 0.35, y: Y, top: Y + 3.2, face: 's' }));
  furniture.desk(b, bx + 1.5, Y, bz - 0.6);
  box.docs = { log: new THREE.Vector3(bx + 1.4, Y + 0.79, bz - 0.7) };
  const leverMat = new THREE.MeshStandardMaterial({ color: 0x9a2a20, roughness: 0.5, metalness: 0.4 });
  b.box(4.4, 0.5, 0.6, M.darkWood, bx, Y + 3.2, bz - 1.6);           // the lever frame
  for (let i = 0; i < 8; i++) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), leverMat);
    l.position.set(bx - 1.9 + i * 0.54, Y + 3.2 + 0.95, bz - 1.5); l.rotation.x = -0.25; b.group.add(l);
  }
  box.lever = new THREE.Vector3(bx, Y + 3.2, bz - 0.6);

  // The home signal east of the station: a semaphore arm (raised: clear; level: danger).
  b.box(0.25, 8, 0.25, steel, HOME_SIGNAL - 4, Y, -3);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.3), new THREE.MeshStandardMaterial({ color: 0xb02a1e, roughness: 0.6 }));
  arm.geometry.translate(0, 0.8, 0);
  arm.position.set(HOME_SIGNAL - 4, Y + 7.2, -2.75); arm.rotation.x = 0; arm.rotation.z = -Math.PI / 4;
  b.group.add(arm);

  // ---- the water tower beside the line at the west end of the platform ----
  const [wx, wz] = [-72, -12];
  for (const [dx, dz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) b.box(0.4, 9, 0.4, M.stone, wx + dx, Y, wz + dz);
  b.box(8, 0.15, 8, M.wood, wx, Y + 8.85, wz);                        // the walkway round the tank
  const tankMesh = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 4, 24), new THREE.MeshStandardMaterial({ color: 0x5d4a3a, roughness: 0.8 }));
  tankMesh.position.set(wx, Y + 11, wz); tankMesh.castShadow = true; b.group.add(tankMesh);
  b.box(6.4, 4, 6.4, hidden, wx, Y + 9, wz);
  ladders.push(ladder(b, { x: wx, z: wz + 4.3, y: Y, top: Y + 9, face: 's' }));
  b.box(0.3, 0.3, 9, steel, wx + 1, Y + 6.5, wz + 5.5, { solid: false });   // the water crane's arm, out over the line
  towerTops.push(new THREE.Vector3(wx + 3.6, Y + 9, wz));

  // ---- the yard: sidings with goods wagons, the engine shed, the coal stage, the goods shed ----
  const wagonMat = new THREE.MeshStandardMaterial({ color: 0x6b4434, roughness: 0.85 });
  for (const [x, z] of [[-120, 10], [-100, 10], [-40, 10], [-160, 15], [-60, 15], [0, 15], [-180, 24]]) {
    b.box(10, 3.2, 2.8, wagonMat, x, Y + 0.7, z);
    b.box(10.3, 0.2, 3.0, M.roof, x, Y + 3.9, z, { solid: false });
    for (const dx of [-3.5, 3.5]) b.box(1.4, 0.7, 2.4, steel, x + dx, Y, z, { solid: false });
  }
  {   // the engine shed: open at both ends, the siding running through
    const [ex, ez] = [-150, 24];
    for (const dz of [-6, 6]) b.box(36, 7, 0.4, M.stone, ex, Y, ez + dz);
    b.box(37, 0.3, 12.8, M.roof, ex, Y + 7, ez, { solid: false });
    for (const dx of [-17.8, 17.8]) for (const dz of [-4.6, 4.6]) b.box(0.4, 7, 2.4, M.stone, ex + dx, Y, ez + dz);
    furniture.crates(b, ex + 10, Y, ez + 4.5, 3);
    furniture.crates(b, ex - 8, Y, ez - 4.5, 2);
  }
  b.box(10, 2.2, 4, M.stone, -110, Y, 34);                           // the coal stage
  const coal = new THREE.Mesh(new THREE.ConeGeometry(3, 1.6, 8), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1 }));
  coal.position.set(-110, Y + 3, 34); coal.scale.z = 0.6; b.group.add(coal);
  const goods = building(b, { x: 60, z: 26, y: Y, w: 22, d: 10, floors: 1, h: 4.5, mat: M.plaster, roof: 'gable',
    openings: [{ side: 'n', at: -4, w: 3, h: 3.2, door: true }, { side: 's', at: 6, w: 1.2, door: true },
      ...[-8, 8].map(at => ({ side: 'n', at, w: 1.2, h: 0.9, sill: 3, window: true }))] });
  doors.push(...goods.doors);
  for (let i = 0; i < 4; i++) furniture.crates(b, 52 + i * 4.5, Y, 29.5, 2 + (i % 2));
  b.box(22, 1.0, 3, M.stone, 60, Y, 19.5);                            // the loading dock

  // ---- the town's edge north of the road ----
  const rng = makeRng(77);
  for (let x = -150; x <= 60; x += 21) {
    const w = 12 + rng() * 6, d = 9, h = 6 + rng() * 4;
    b.box(w, h, d, rng() < 0.5 ? M.plaster : M.plaster2, x, Y, -54);
    b.gable(w, 2.4, d, M.roof, x, Y + h, -54);
  }

  // ---- the train ----
  const train = buildTrain(scene, hidden, steel);
  b.solids.push(...train.solids);
  b.boxes.push(...train.boxes.map(t => t.box));
  hotspotDefs.push(
    { kind: 'boiler', title: 'LOCOMOTIVE BOILER', explosive: true, hitsToExplode: 3, meshes: [train.boiler], parts: train.locoParts,
      blast: { radius: 6, hurt: 12, size: 1.6, burn: true, label: 'LOCOMOTIVE WRECKED' } },
    { kind: 'ammo', title: 'AMMUNITION WAGON', explosive: true, hitsToExplode: 2, meshes: [train.ammo], parts: train.ammoParts,
      blast: { radius: 10, hurt: 18, size: 2.3, burn: true, heavy: true, chain: 22, label: 'AMMUNITION WAGON' } },   // (reaches the gun's breech, not the engine)
    { kind: 'railgun', title: 'RAIL GUN', explosive: true, armored: true, hitsToExplode: 3, meshes: [train.breech], parts: train.gunParts,
      blast: { radius: 8, hurt: 14, size: 2.2, burn: true, heavy: true, label: 'RAIL GUN DESTROYED' } },
  );
  // Its crew rides on the wagons (and stays aboard when it stops).
  train.riders = [];
  for (const [lx, ly, lz, name, look] of [[25, 1.3, -0.6, 'Flak crew', 'guardSergeant'], [31, 1.3, 0.6, 'Flak crew', null], [50, 2.7, 0.5, 'Gun crew', null], [68, 2.7, -0.5, 'Gun crew', 'guardCamo']]) {
    const s = add(train.front + lx, lz, Math.PI / 2, { y: Y + ly, name, stance: 'alert', ...(look ? { look } : {}) });
    s.root.visible = false;                                      // (out of sight until it comes)
    train.riders.push({ s, lx, ly, lz });
  }
  train.arm = arm;
  // A moving train is loud: it covers shots near the line.
  world.soundSources = [{ name: 'train', at: (pos) => {
    if (!train.group.visible || train.v < 1) return 0;
    const d = Math.hypot(pos.z, Math.max(0, train.front - pos.x, pos.x - (train.front + train.length)));
    return Math.max(0, Math.min(1, 1.4 - d / 150));
  } }];

  // ---- the garrison ----
  add(0, -5, Math.PI, { officer: true, name: 'Major', look: 'officerLieutenant' });
  add(-55, -5, -Math.PI / 2, { name: 'Platform patrol' });
  add(0, -23, 0, { name: 'Station guard', stance: 'alert', look: 'guardSergeant' });
  add(sx - 6, sz - 2, Math.PI, { y: up, name: 'Office guard' });
  add(bx - 1, bz - 0.4, Math.PI, { y: Y + 3.2, name: 'Signalman', look: 'guardSergeant' });
  add(wx + 3.6, wz, -Math.PI / 2, { y: Y + 9, name: 'Tower lookout', stance: 'alert', look: 'guardCamo' });
  add(-190, 6, -Math.PI / 2, { name: 'Yard patrol' });
  add(30, 19.5, Math.PI / 2, { name: 'Yard patrol', look: 'guardCamo' });
  add(-140, 24, Math.PI / 2, { name: 'Shed guard' });
  add(60, 18, 0, { name: 'Goods shed guard', stance: 'alert' });
  add(-200, ROAD_Z - 3, Math.PI / 2, { name: 'Checkpoint', stance: 'alert' });
  add(-200, ROAD_Z + 3, Math.PI / 2, { name: 'Checkpoint', look: 'guardSergeant' });
  add(100, -20, -Math.PI / 2, { name: 'Crossing patrol' });

  return {
    solids: b.solids, boxes: b.boxes, soldiers, ladders, doors, towerTops,
    spawn: new THREE.Vector3(START.x, heightAt(START.x, START.z), START.z),
    hotspotDefs, station: st, signalBox: box, goods, train,
  };
}

// ---- the special train: locomotive and tender, a flak wagon, the ammunition wagon, the
// railway gun on its carriage, and a coach. Built with its front at local x = 0, running toward
// −x (west); everything behind is +x. Its collision blocks move with it. ----
function buildTrain(scene, hidden, steel) {
  const g = new THREE.Group();
  g.position.set(0, Y + 0.15, 0);
  scene.add(g);
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.55, metalness: 0.5 });
  const red = new THREE.MeshStandardMaterial({ color: 0x7a1e18, roughness: 0.6, metalness: 0.3 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x585c52, roughness: 0.7, metalness: 0.3 });
  const olive = new THREE.MeshStandardMaterial({ color: 0x5a5f45, roughness: 0.7, metalness: 0.35 });
  const meshes = [], solids = [], wheels = [];
  const box = (w, h, d, mat, x0, y0, z = 0, solid = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x0 + w / 2, y0 + h / 2, z); m.castShadow = m.receiveShadow = true;
    g.add(m); meshes.push(m); if (solid) solids.push(m);
    return m;
  };
  const cyl = (r0, r1, len, mat, x, y, z = 0, axis = 'x') => {
    const geo = new THREE.CylinderGeometry(r0, r1, len, 18);
    if (axis === 'x') geo.rotateZ(Math.PI / 2); else if (axis === 'z') geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = true;
    g.add(m); meshes.push(m);
    return m;
  };
  const wheelSet = (x0, x1, n, r) => {
    for (let i = 0; i < n; i++) for (const z of [-0.75, 0.75]) {
      const w = cyl(r, r, 0.14, r > 0.6 ? red : black, lerp(x0, x1, n > 1 ? i / (n - 1) : 0.5), r, z, 'z');
      w.userData.r = r; wheels.push(w);
    }
  };
  // The locomotive (a war engine): boiler, smokebox, chimney, dome, smoke deflectors, cab; tender.
  const locoStart = meshes.length;
  box(21, 0.45, 2.7, black, 0, 0.9);
  const boiler = cyl(0.95, 0.95, 8.5, black, 5.3, 2.4);
  cyl(1.02, 1.02, 1.3, black, 0.8, 2.4);
  cyl(0.28, 0.32, 1.1, black, 1.4, 3.85, 0, 'y');
  cyl(0.38, 0.45, 0.7, black, 5.5, 3.55, 0, 'y');
  for (const z of [-1.3, 1.3]) box(2.4, 1.8, 0.06, black, 0.2, 1.6, z, false);
  box(3.6, 2.9, 2.9, black, 9.6, 1.35);
  box(3.9, 0.15, 3.2, black, 9.45, 4.25, 0, false);
  box(7.4, 2.5, 2.8, black, 13.8, 1.2);
  wheelSet(2.4, 8.6, 5, 0.72); wheelSet(14.6, 20.4, 4, 0.48);
  const locoParts = meshes.slice(locoStart);
  // The flak wagon: a deck with steel sides and a quadruple 2 cm gun.
  box(12, 0.4, 2.8, grey, 22.4, 0.9);
  for (const z of [-1.35, 1.35]) box(12, 0.9, 0.1, olive, 22.4, 1.3, z, false);
  box(1.2, 0.9, 1.2, olive, 27.8, 1.3);
  for (const dz of [-0.18, 0.18]) for (const dy of [-0.15, 0.15]) { const bar = cyl(0.04, 0.04, 2.2, black, 27.1, 2.6 + dy, dz); bar.rotation.z = -0.6; }
  wheelSet(24, 33, 2, 0.45);
  // The ammunition wagon: a closed van.
  const ammoStart = meshes.length;
  const ammo = box(10.5, 3, 2.8, olive, 35, 1.1);
  box(10.8, 0.2, 3, grey, 34.85, 4.1, 0, false);
  wheelSet(36.5, 44, 2, 0.45);
  const ammoParts = meshes.slice(ammoStart);
  // The railway gun: a long carriage on two bogies, the cradle and breech, a barrel reaching
  // forward over the ammunition wagon.
  const gunStart = meshes.length;
  box(26, 1.6, 3.0, olive, 46.5, 1.1);
  const breech = box(3.2, 2.2, 2.4, olive, 60.4, 2.7);
  box(4.5, 1.6, 2.9, olive, 63.6, 2.7);
  const barrel = cyl(0.25, 0.4, 22, olive, 50.5, 5.0);
  barrel.rotation.z = -0.07;                                 // raised a little toward the muzzle (−x)
  wheelSet(47.5, 53, 3, 0.45); wheelSet(66, 71.5, 3, 0.45);
  const gunParts = meshes.slice(gunStart);
  // The coach.
  box(16, 3.2, 2.9, new THREE.MeshStandardMaterial({ color: 0x3e4a3a, roughness: 0.7 }), 73.5, 1.1);
  box(15, 0.7, 2.94, new THREE.MeshStandardMaterial({ color: 0x1d2226, roughness: 0.2, metalness: 0.4 }), 74, 2.7, 0, false);
  wheelSet(75, 88, 2, 0.45);

  g.updateMatrixWorld(true);
  const boxes = solids.map(m => { const base = new THREE.Box3().setFromObject(m); return { base, box: base.clone() }; });
  const t = { group: g, solids, boxes, wheels, boiler, ammo, breech, locoParts, ammoParts, gunParts, length: 89.5,
    front: 680, v: 0, phase: 'due', held: false, standT: 0, said: {} };
  t.setFront = (f) => {
    const dx = f - t.front;
    t.front = f;
    g.position.x = f;
    g.updateMatrixWorld(true);
    for (const { base, box: bb } of boxes) bb.copy(base).translate(new THREE.Vector3(f, 0, 0));
    for (const w of wheels) w.rotation.z -= dx / w.userData.r;      // rolling (the axle is along z)
  };
  t.setFront(680);
  g.visible = false;
  return t;
}

// ---- what's to be found ----
function layout({ world, on }) {
  const sp = world.spawn;
  const boxes = [
    { kind: 'parts', where: 'the engine shed', at: on(-160, 20) },
    { kind: 'parts', where: 'the signal box', at: on(78 - 2.2, -11 + 1.2) },
    { kind: 'parts', where: 'the coal stage', at: on(-110, 37.5) },
    { kind: 'parts', where: 'the goods shed', at: on(66, 23) },
    { kind: 'parts', where: 'the platform end', at: on(48, -6) },
    { kind: 'weapon', weapon: 'panzerschreck', where: 'the goods shed', at: on(56, 23.5) },
    { kind: 'weapon', weapon: 'g43', where: 'the engine shed', at: on(-138, 28) },
  ];
  for (const [type, x, z] of [
    ['ammo', -90, 6], ['medical', 10, 6], ['explosives', -60, 19.5], ['heavy', 70, 15], ['bottles', -30, -30],
    ['ammo', 120, -25], ['explosives', 150, 30], ['medical', -170, 35], ['heavy', -125, 18], ['ammo', 200, 120],
    ['ammo', sp.x + 6, sp.z + 3], ['medical', sp.x + 4, sp.z - 6], ['explosives', sp.x - 5, sp.z + 4],
  ]) boxes.push({ kind: 'supply', type, where: type, at: on(x, z) });
  const benches = [{ where: 'start', at: on(sp.x + 2.5, sp.z - 4) }, { where: 'the engine shed', at: on(-150, 28.5) }];
  return { boxes, benches };
}

// ---- documents, the safe, the lever, the objectives ----
const SAFE = { id: 'station-safe', name: "THE STATIONMASTER'S SAFE", combination: '22 – 06 – 41' };

function intel(it, world, { pickups, arsenal, mission }) {
  const { station, signalBox, train } = world.site;
  it.addSafe({ ...SAFE, at: station.safe.at, yaw: station.safe.yaw, objective: 'safe', objectiveText: 'THE TIMETABLES TAKEN',
    docs: [{ id: 'station-timetables', title: 'Military timetables, October',
      text: 'Reichsbahndirektion Verona. Military trains through the junction this month: 31. Special trains "Dora" (heavy artillery) on the 9th, 17th and 26th, ' +
        'to the Gothic Line. Water at Ponte Rosso. Paths, timings, escort strengths attached.' }],
    contents: () => { const got = []; const part = pickups?.givePart?.(); if (part) got.push(`part: ${part.name}`); if (arsenal) { arsenal.weapons.rifle.ammo.ap += 5; got.push('+5 AP rounds'); } return got; } });
  it.addDocument({ id: 'station-combination', title: "The signalman's register", at: signalBox.docs.log, reveals: SAFE.id,
    text: `08:12 goods to Mantua. 09:40 light engine. Special "Dora 2" expected 12:40, stops for water, then west.\n\n(In the margin, for the stationmaster's deputy: the safe, ${SAFE.combination}.)` });
  it.addDocument({ id: 'station-timetable', title: 'Notice: special train', at: station.docs.timetable,
    text: 'Special train "Dora 2". Stops at platform 1 for water: 2½ minutes. Platform to be cleared of civilians. The home signal stays at clear: the train is not to be held for any reason.' });
  it.addDocument({ id: 'station-orders', title: "The Major's orders", at: station.docs.orders,
    text: 'Major Krüger, transport officer. The railway gun and its ammunition must reach the front by the 14th. The ammunition van is coupled ahead of the gun: no smoking within 50 metres. Any delay will be answered for.' });
  // The home-signal lever: set it to danger and the train stops at the signal (or stays at the platform).
  it.addLever({ at: signalBox.lever, label: 'SET THE HOME SIGNAL TO DANGER (HOLDS THE TRAIN)', busy: 'PULLING THE LEVER…', time: 2,
    onUse: () => { train.held = true; mission.hud.message(train.phase === 'due' ? 'SIGNAL AT DANGER · THE TRAIN WILL STOP AT THE SIGNAL' : 'SIGNAL AT DANGER · THE TRAIN IS HELD', ''); } });
  mission.papersDoc = { id: 'station-papers', title: "Major Krüger's papers", reveals: SAFE.id,
    text: `Pay book of Major W. Krüger, Transportkommandantur. A railway pass. In the back, written small: ${SAFE.combination}.` };
  mission.documentsTotal = 6;
}

// The train's run: due at T_DUE, brakes for its stop (the home signal if it's at danger, else the
// water tower), stands, then leaves west unless held or wrecked. Called each tick.
function runTrain(m, dt) {
  const w = m.world, t = w.site.train, a = m.audio, hs = w.hotspots;
  const wrecked = hs.some(h => (h.kind === 'boiler' || h.kind === 'railgun') && h.exploded);
  const listener = m.player.pos, dist = Math.abs(listener.z) + Math.max(0, t.front - listener.x, listener.x - (t.front + t.length));
  const say = (key, text) => { if (!t.said[key]) { t.said[key] = true; if (text) m.hud.message(text, ''); return true; } return false; };
  if (t.phase === 'due') {
    if (m.time > T_DUE - 120) say('2min', 'THE GUN TRAIN IS DUE IN TWO MINUTES');
    if (m.time > T_DUE - 25 && say('whistle')) a.steamWhistle(Math.abs(listener.x - 600) + 50, 2.2);
    if (m.time < T_DUE) return;
    t.phase = 'arriving'; t.v = 14; t.group.visible = true;
    for (const r of t.riders) r.s.root.visible = true;
    m.hud.message('THE GUN TRAIN IS COMING IN', '');
  }
  // Where it will stop: the home signal if that's at danger before it gets there, else the water tower.
  if (t.phase === 'arriving' && t.held && t.stopAt == null && t.front - HOME_SIGNAL > 2 + t.v * t.v / 4) t.stopAt = HOME_SIGNAL;   // (if it can still stop there)
  const stopAt = t.stopAt ?? STATION_STOP;
  if (wrecked && t.v > 0) t.v = Math.max(0, t.v - 1.5 * dt);
  else if (t.phase === 'arriving') {
    const left = t.front - stopAt;
    if (left <= 0.3 || (t.v < 0.3 && left < 3)) { t.v = 0; t.phase = 'standing'; t.standT = 0; a.steamHiss(dist); }
    else if (t.v * t.v / (2 * left) >= 0.45) t.v = Math.max(0.4, t.v - (t.v * t.v / (2 * left)) * dt);
  } else if (t.phase === 'standing') {
    t.standT += dt;
    if (t.standT > STAND && !t.held && !wrecked) { t.phase = 'departing'; a.steamWhistle(dist); m.hud.message('THE GUN TRAIN IS LEAVING', ''); }
  } else if (t.phase === 'departing') {
    if (t.held) { t.v = Math.max(0, t.v - 1.0 * dt); if (t.v === 0) t.phase = 'standing'; }
    else t.v = Math.min(12, t.v + 0.25 * dt);
    if (t.front + t.length < -560) {
      t.phase = 'gone'; t.group.visible = false;
      if (!hs.find(h => h.kind === 'railgun').exploded) m.fail('THE GUN TRAIN GOT AWAY');
    }
  }
  if (t.v > 0) {
    t.setFront(t.front - t.v * dt);
    // Its crew rides along.
    for (const r of t.riders) if (r.s.alive) {
      r.s.root.position.set(t.front + r.lx, Y + 0.15 + r.ly, r.lz);
      r.s.home?.copy(r.s.root.position);
      if (r.s.brain) r.s.brain.fixed = true;
    }
    // Chuffing, and smoke from the chimney.
    t.chuffT = (t.chuffT ?? 0) - dt;
    if (t.chuffT <= 0 && !wrecked) {
      t.chuffT = Math.max(0.13, 1.1 / t.v);
      a.trainChuff(dist);
      m.fx.emit(new THREE.Vector3(t.front + 1.4, Y + 4.6, 0), new THREE.Vector3(0, 1, 0), { color: 0x4a4744, count: 1, speed: 2.5, size: 1.4, life: 4, grow: 3, gravity: 0.5 });
    }
  } else if (t.phase === 'standing' && !wrecked) {
    t.hissT = (t.hissT ?? 4) - dt;
    if (t.hissT <= 0) { t.hissT = 7; a.steamHiss(dist); m.fx.emit(new THREE.Vector3(t.front + 3, Y + 1.2, 1.5), new THREE.Vector3(0, 0.3, 1), { color: 0xe8e8e8, count: 3, speed: 2, size: 1, life: 2, grow: 3, gravity: 0.3 }); }
  }
  // The signal arm: level at danger, raised at clear.
  t.arm.rotation.z = t.held ? -Math.PI / 2 : -Math.PI / 4;
  // Stopped for good: held at a standstill, or wrecked.
  if (!m.obj('train').done && t.v === 0 && t.phase !== 'due' && (t.held || wrecked)) m.complete('train', 'THE GUN TRAIN IS STOPPED');
}

const def = {
  target: 'Major Krüger',
  targetArea: { x: 0, z: -8 },
  extraction: START,
  killText: 'KRÜGER IS DEAD',
  extractText: 'THE GUN IS FINISHED · GET BACK TO THE HILL',
  papersText: "KRÜGER'S PAPERS TAKEN",
  objectives: [
    { id: 'train', text: 'Stop the gun train (the home-signal lever in the signal box, or wreck the locomotive)' },
    { id: 'gun', text: 'Destroy the railway gun (a satchel on its breech, AP or anti-tank hits, or its ammunition wagon)' },
    { id: 'safe', text: "Take the timetables from the stationmaster's safe", optional: true },
    { id: 'officer', text: 'Eliminate Major Krüger, the transport officer', optional: true },
    { id: 'papers', text: "Take Krüger's papers", optional: true },
    { id: 'extract', text: 'Get back to the hill you came from', hidden: true },
  ],
  tick(m, dt) {
    runTrain(m, dt);
    if (!m.obj('gun').done && m.world.hotspots.some(h => h.kind === 'railgun' && h.exploded)) m.complete('gun', 'THE RAILWAY GUN IS DESTROYED');
  },
  markers(m) {
    const t = m.world.site.train, out = [];
    if (!m.obj('train').done && !t.held) out.push({ pos: m.world.site.signalBox.lever.clone().setY(Y + 7.5), kind: 'tank', label: 'SIGNAL BOX', height: 1 });
    if (!m.obj('gun').done && t.phase !== 'due' && t.phase !== 'gone') out.push({ pos: t.breech.getWorldPosition(new THREE.Vector3()).setY(Y + 6), kind: 'tank', label: 'RAIL GUN', height: 1.5 });
    return out;
  },
  // Saves: where the train is and what it's doing.
  save(m) {
    const t = m.world.site.train;
    return { front: t.front, v: t.v, phase: t.phase, held: t.held, standT: t.standT, stopAt: t.stopAt ?? null, said: { ...t.said } };
  },
  load(m, d) {
    const t = m.world.site.train;
    Object.assign(t, { v: d.v, phase: d.phase, held: d.held, standT: d.standT, stopAt: d.stopAt ?? undefined, said: d.said ?? {} });
    t.setFront(d.front);
    t.group.visible = t.phase !== 'due' && t.phase !== 'gone';
    for (const r of t.riders) { r.s.root.visible = t.group.visible || !r.s.alive; if (r.s.brain) r.s.brain.fixed = true; }
  },
};

const briefing = `
  <p class="brief">Ponte Rosso junction, Po valley. A special train is bringing a railway gun through on its way to the front.
    It stops at the station for water, about five minutes from now, and stands at the platform for two and a half minutes
    before it goes on west.</p>
  <ul class="goals">
    <li><b>Stop the train.</b> Pull the home-signal lever in the signal box (up the ladder on its south side): the train
      waits at the signal, or stays at the platform. Or wreck the locomotive's boiler.</li>
    <li><b>Destroy the railway gun.</b> It is armoured: a satchel on its breech, armour-piercing or anti-tank hits. The
      ammunition wagon coupled in front of it goes up if you shoot it, and takes the gun with it.</li>
    <li><b>Optional:</b> take the timetables from the stationmaster's safe (upstairs in the station; the combination is written
      down somewhere, and the transport officer, Major Krüger, carries it); eliminate Krüger; take his papers.</li>
    <li><b>Then</b> get back to the hill you started from, where green smoke marks the pick-up.</li>
  </ul>
  <p class="brief">If the train gets away with the gun, the mission is lost. A moving train is loud: it covers your shots.
    The ground round the junction is open; a lookout stands on the water tower.</p>`;

export default { id: 'railway', subtitle: 'Operation Iron Road · Po valley, 1944', map, site, def, intel, briefing };
