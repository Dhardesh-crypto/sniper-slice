// Operation Night Owl: a Luftwaffe night-fighter airfield on the plain below the hills. The
// fighters are back from the night's sorties and stand in their pens and in a hangar. Destroy all
// four on the ground, wreck the Würzburg radar that guides them, and take the flight plans from
// the safe in the control tower.
//
// Planes burn easily (two hits in the fuel, one armour-piercing round, a satchel); so do the fuel
// bowsers on the apron. The radar stands on a fenced rise north of the runway: shoot its cabin
// enough, or a satchel. Every so often the mechanics run an engine up on the apron: it's loud,
// and covers shots near the hangars while it lasts.
//
// 1 km map: the runway east–west, a taxiway and dispersal pens to the south, two hangars, the
// control tower, the fuel park and the pilots' mess on the apron, a perimeter fence (cut in two
// places), flak around, and hills outside.
import * as THREE from 'three';
import { fbm, lerp, smoothstep, makeRng } from '../world/noise.js';
import { M, Builder } from '../world/kit.js';
import { building, furniture, ladder } from '../world/buildings.js';
import { Soldier } from '../world/soldier.js';
import { vehicleModel } from '../world/vehicle-models.js';
import { propModel, clipAbove, dressProps } from '../world/props.js';

const Y = 20;                                    // the airfield's level
const START = { x: 330, z: 345 };
const RADAR = { x: 60, z: -150 };
const FENCE = { x0: -400, x1: 400, z0: -200, z1: 200 };
const TAXI_Z = 70;
const ROAD_Z = 250;
const RUNUP_EVERY = 95, RUNUP_FOR = 22;          // an engine run-up on the apron: how often, how long

// How far (x, z) is outside the field's flat ground (the radar's rise is flat on top too).
function fieldDist(x, z) {
  return Math.hypot(Math.max(0, -430 - x, x - 430), Math.max(0, -230 - z, z - 230));
}
function heightAt(x, z) {
  let h = (fbm(x * 0.0035 - 5, z * 0.0035 + 2, 4) - 0.5) * 70 + Math.max(0, Math.abs(z) - 240) * 0.08;
  h += 26 * Math.exp(-((x - START.x) ** 2 + (z - START.z) ** 2) / (2 * 70 * 70));
  const r = Math.max(Math.abs(x), Math.abs(z));
  if (r > 420) { const t = (r - 420) / 80; h += t * t * (30 + 40 * fbm(x * 0.006 + 1.1, z * 0.006, 3)); }
  let y = Y + Math.max(-6, h) * smoothstep(0, 70, fieldDist(x, z));
  // The radar's rise: a low mound with a flat top.
  const dr = Math.hypot(x - RADAR.x, z - RADAR.z);
  y += 6 * (1 - smoothstep(24, 60, dr));
  return y;
}
const inRunway = (x, z) => Math.abs(z) < 22 && Math.abs(x) < 385;
const inTaxi = (x, z) => (Math.abs(z - TAXI_Z) < 8 && x > -268 && x < 208) || ((Math.abs(x + 260) < 8 || Math.abs(x - 200) < 8) && z > 0 && z < TAXI_Z);
const inApron = (x, z) => x > -130 && x < 130 && z > 78 && z < 175;

const map = {
  // Dawn after the night's flying: the sun just up in the east, cold blue shadows.
  light: { zenith: 80, azimuth: 95, sun: 0xff9c5c, sunIntensity: 2.1, turbidity: 9, rayleigh: 2.8, clouds: 0.35, hemiSky: 0xa8bcd8, hemiGround: 0x4a4038, hemi: 0.55, exposure: 0.95 },
  half: 500, playHalf: 470, focus: { x: 0, z: 0, r: 150 }, start: START, navHalf: 300,
  heightAt,
  roadCenterZ: (x) => (x <= 10 ? ROAD_Z : NaN),
  keepClear(x, z, m = 0) {
    if (x > FENCE.x0 - 8 - m && x < FENCE.x1 + 8 + m && z > FENCE.z0 - 8 - m && z < FENCE.z1 + 8 + m) return true;
    if (Math.hypot(x - RADAR.x, z - RADAR.z) < 40 + m) return true;
    if (x <= 10 && Math.abs(z - ROAD_Z) < 5 + m) return true;
    if (Math.abs(x) < 6 + m && z > FENCE.z1 && z < ROAD_Z) return true;     // the spur up to the gate
    return Math.hypot(x - START.x, z - START.z) < 12 + m;
  },
  paint(c, x, z, { road, rock, dirt, mowed }) {
    if (x > FENCE.x0 && x < FENCE.x1 && z > FENCE.z0 && z < FENCE.z1) c.lerp(mowed, 0.5);   // the field's mown grass
    if (inRunway(x, z) || inTaxi(x, z) || inApron(x, z)) c.lerp(rock, 0.85);               // concrete
    if ((x <= 10 && Math.abs(z - ROAD_Z) < 3) || (Math.abs(x) < 3 && z > FENCE.z1 - 30 && z < ROAD_Z)) c.lerp(road, 1);
    if (Math.hypot(x - RADAR.x, z - RADAR.z) < 22) c.lerp(dirt, 0.6);
  },
  truck: { from: -600, stop: -60 },
  reinforceHome: [0, 150],
  flee: [-40, 140],
  routes: {
    Major: [[40, 98, 20], [41, 108, 25], [40, 98], [-40, 98, 15], [-100, 98, 10], [40, 98]],
    'Apron patrol': [[-130, 92], [120, 92, 6], [120, 170], [-130, 170, 6], [-130, 92]],
    'Pen patrol': [[-250, 90], [-150, 90, 8], [-250, 90, 8]],
    'East pen patrol': [[130, 90], [190, 90, 8], [130, 90, 8]],
    'Perimeter patrol': [[-385, 185], [385, 185, 6], [385, -185], [-385, -185, 6], [-385, 185]],
    'Runway patrol': [[-300, 35], [300, 35, 10], [-300, 35, 10]],
    'Radar sentry': [[RADAR.x - 18, RADAR.z - 18], [RADAR.x + 18, RADAR.z - 18, 4], [RADAR.x + 18, RADAR.z + 18], [RADAR.x - 18, RADAR.z + 18, 4], [RADAR.x - 18, RADAR.z - 18]],
  },
  pickups: layout,
};

// ---- the airfield ----
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
  const place = (m, x, y, z, rotY = 0) => { if (m) { m.position.set(x, y, z); m.rotation.y = rotY; b.group.add(m); } return m; };

  // The perimeter fence (you can't climb it; it doesn't stop bullets), a gate on the spur from
  // the road, and two places where it's been cut.
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x2c2f2c, roughness: 0.8, metalness: 0.4, transparent: true, opacity: 0.5 });
  const fence = (x0, z0, x1, z1) => {
    const w = Math.max(0.08, Math.abs(x1 - x0)), d = Math.max(0.08, Math.abs(z1 - z0)), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const m = b.box(w, 2.6, d, fenceMat, cx, Y, cz, { solid: false });
    m.updateMatrixWorld(true);
    b.boxes.push(new THREE.Box3().setFromObject(m));
    for (let t = 0; t <= 1.0001; t += 4 / Math.max(w, d)) b.box(0.1, 2.8, 0.1, steel, lerp(x0, x1, t), Y, lerp(z0, z1, t), { solid: false });
  };
  const { x0, x1, z0, z1 } = FENCE;
  fence(x0, z0, -152, z0); fence(-148, z0, x1, z0);                  // north, cut at x −150
  fence(x0, z1, -6, z1); fence(6, z1, x1, z1);                       // south, the gate at x 0
  fence(x0, z0, x0, z1);
  fence(x1, z0, x1, 118); fence(x1, 122, x1, z1);                    // east, cut at z 120
  b.box(3, 2.6, 3, M.wood, 10, Y, z1 + 3);                           // the gate hut
  b.box(12, 0.15, 0.15, new THREE.MeshStandardMaterial({ color: 0xc8c2b0 }), 0, Y + 1.05, z1, { solid: false });

  // A windsock by the runway.
  b.box(0.15, 6, 0.15, steel, -40, Y, 32, { solid: false });
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 12, 1, true).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8742c, side: THREE.DoubleSide }));
  sock.position.set(-38.7, Y + 5.8, 32); b.group.add(sock);

  // ---- the night fighters: three in earth pens along the taxiway, one in a hangar ----
  // Each is a weak spot (its fuel and engines): blocks for the fuselage and the wings stop you
  // and the bullets; the model stands over them.
  const planes = [];
  const fighter = (x, z, rotY, kind) => {
    const spec = kind === 'ju88' ? { len: 14.4, span: 20, h: 4.8 } : { len: 12.3, span: 16.3, h: 3.6 };
    const m = place(propModel(kind, { x: spec.len, y: spec.h, z: spec.span }, { stretch: true, own: true }), x, Y, z, rotY);
    // (the blocks, turned with the plane: along z when it faces north/south)
    const along = Math.abs(Math.sin(rotY)) > 0.5;
    const [lx, lz] = along ? [1.8, spec.len] : [spec.len, 1.8];
    b.box(lx, 1.8, lz, hidden, x, Y + 0.9, z);
    const [wx, wz] = along ? [spec.span, 2.8] : [2.8, spec.span];
    b.box(wx, 0.35, wz, hidden, x, Y + 1.7, z);
    const core = b.box(along ? 5 : 3, 1.4, along ? 3 : 5, hidden, x, Y + 1.2, z);    // the wing roots: fuel and engines
    const def = { kind: 'plane', title: kind === 'ju88' ? 'JU 88 NIGHT FIGHTER' : 'BF 110 NIGHT FIGHTER', explosive: true, hitsToExplode: 2,
      meshes: [core], parts: m ? m.userData.meshes : [], blast: { radius: 9, hurt: 15, size: 2.2, burn: true, chain: 10, label: 'NIGHT FIGHTER DESTROYED' } };
    hotspotDefs.push(def);
    planes.push({ core, model: m, kind });
  };
  // The pens: earth walls on three sides, open toward the taxiway.
  const pen = (x, z) => {
    for (const [w, d, dx, dz] of [[24, 3, 0, 13], [3, 24, -12, 1], [3, 24, 12, 1]]) {
      b.box(w, 2.4, d, M.earth, x + dx, Y, z + dz);
      b.gable(w, 0.8, d, M.earth, x + dx, Y + 2.4, z + dz);
    }
  };
  for (const [x, kind] of [[-230, 'bf110'], [-175, 'bf110'], [160, 'ju88']]) { pen(x, 100); fighter(x, 100, -Math.PI / 2, kind); }

  // ---- the hangars: open to the taxiway; the fourth fighter stands in the first one ----
  // (30 m wide, 42 deep, the doors at the north end)
  const hangar = (x, z) => {
    const m = place(propModel('hangar', { x: 30, y: 13, z: 42 }, { stretch: true }), x, Y, z);
    const mat = m ? hidden : M.plaster2;
    b.box(30, 10, 0.6, mat, x, Y, z + 21);                          // the back wall
    for (const s of [-1, 1]) b.box(0.6, 10, 42, mat, x + s * 15, Y, z);
    b.box(31, 0.4, 43, mat, x, Y + 10, z, { solid: !m });             // the roof
    if (!m) { b.gable(30, 3, 42, M.roof, x, Y + 10.4, z, Math.PI / 2); }
  };
  hangar(-100, 133); hangar(-60, 133);
  fighter(-100, 128, -Math.PI / 2, 'bf110');
  furniture.crates(b, -112, Y, 148, 4); furniture.crates(b, -70, Y, 148, 3); furniture.crates(b, -50, Y, 145, 2);
  // An engine stand and a bench in the second hangar.
  b.box(1.4, 1.2, 1.0, steel, -62, Y, 128); furniture.table(b, -55, Y, 150, 2.4, 0.9);

  // ---- the control tower: two floors, the flight control room upstairs (the safe), a glass cab ----
  const [tx, tz] = [40, 112];
  const tower = building(b, { x: tx, z: tz, y: Y, w: 12, d: 10, floors: 2, h: 3.6, mat: M.plaster, roof: 'flat',
    openings: [
      { side: 'n', at: 0, w: 1.4, door: true }, { side: 's', at: -3, w: 1.1, door: true },
      ...[-4, 4].map(at => ({ side: 'n', at, w: 1.2, window: true })),
      ...[-4, 0, 4].map(at => ({ side: 'n', at, w: 2.2, h: 1.6, window: true, floor: 1 })),
      ...[-3.5, 3.5].map(at => ({ side: 'e', at, w: 2.0, h: 1.6, window: true, floor: 1 })),
      ...[-3.5, 3.5].map(at => ({ side: 'w', at, w: 2.0, h: 1.6, window: true, floor: 1 })),
      { side: 's', at: 3, w: 1.2, window: true }, { side: 's', at: 2, w: 1.6, window: true, floor: 1 },
    ],
    stairs: { at: [4.6, 3.2], dir: 'n', w: 0.9 },
  });
  doors.push(...tower.doors);
  const up = Y + 3.6;
  b.box(6, 2.4, 5, M.window, tx - 2, up + 3.6, tz);                   // the glass cab on the roof
  b.box(6.4, 0.2, 5.4, M.metal, tx - 2, up + 6.0, tz, { solid: false });
  furniture.desk(b, tx - 3, Y, tz + 2.5);
  furniture.table(b, tx - 2, up, tz - 1, 3, 1.2);                      // the plotting table
  furniture.desk(b, tx + 1, up, tz + 3.4);
  tower.safe = { at: new THREE.Vector3(tx - 5.3, up, tz + 3.6), yaw: Math.PI / 2 };
  tower.docs = { orders: new THREE.Vector3(tx - 3.1, Y + 0.79, tz + 2.4), plot: new THREE.Vector3(tx - 2.2, up + 0.79, tz - 1.1) };
  b.box(0.15, 8, 0.15, steel, tx + 5.5, up + 3.6, tz - 4.5, { solid: false });   // the radio mast

  // ---- the fuel park: two bowsers and drums beside the apron ----
  const bowsers = [];
  for (const [bx, bz] of [[85, 132], [85, 146]]) {
    const m = place(propModel('bowser', { x: 6.6, y: 2.7, z: 2.4 }, { stretch: true, own: true }), bx, Y, bz);
    b.box(6.2, 2.4, 2.3, hidden, bx, Y, bz);
    const tank = b.box(3.6, 1.6, 1.8, hidden, bx, Y + 1.0, bz);
    hotspotDefs.push({ kind: 'bowser', title: 'FUEL BOWSER', explosive: true, hitsToExplode: 2, meshes: [tank], parts: m ? m.userData.meshes : [],
      blast: { radius: 10, hurt: 16, size: 2.4, burn: true, chain: 14, label: 'FUEL BOWSER' } });
    bowsers.push(tank);
  }
  for (const [dx, dz] of [[0, 0], [3, 0], [0, 3]]) { const d = place(propModel('drums', { x: 2.1, y: 1.85, z: 1.45 }, { stretch: true, bright: 1.9 }), 104 + dx, Y, 132 + dz); b.box(2.0, 1.8, 1.4, d ? hidden : M.metal, 104 + dx, Y, 132 + dz); }
  const tractor = vehicleModel('truck');
  tractor.position.set(70, Y, 160); tractor.rotation.y = Math.PI / 2; b.group.add(tractor);
  b.box(6, 2.4, 2.3, hidden, 70, Y + 0.3, 160);

  // ---- the pilots' mess: a long hut you can walk into ----
  const mess = building(b, { x: -150, z: 170, y: Y, w: 16, d: 7, floors: 1, h: 3, mat: M.wood, roof: 'gable',
    openings: [{ side: 'n', at: -4, w: 1.2, door: true }, ...[0, 5].map(at => ({ side: 'n', at, w: 1.1, window: true })), ...[-5, 0, 5].map(at => ({ side: 's', at, w: 1.1, window: true }))] });
  doors.push(...mess.doors);
  furniture.table(b, -152, Y, 170, 4, 1.2); furniture.table(b, -145, Y, 170, 2, 1);
  mess.docs = { notebook: new THREE.Vector3(-151.5, Y + 0.79, 170.2), letter: new THREE.Vector3(-145, Y + 0.79, 170) };

  // ---- the radar on its rise: the dish over its cabin, a fence, the generator, a searchlight ----
  const ry = heightAt(RADAR.x, RADAR.z);
  const radar = place(propModel('radar', { y: 12 }, { own: true }), RADAR.x, ry, RADAR.z, Math.PI);
  b.box(4.2, 1.2, 4.2, radar ? hidden : M.stone, RADAR.x, ry, RADAR.z);           // the base
  const cabin = b.box(2.6, 2.4, 3.2, radar ? hidden : M.metal, RADAR.x, ry + 1.2, RADAR.z);
  let dish = null;
  if (!radar) {
    dish = new THREE.Mesh(new THREE.SphereGeometry(3.8, 20, 10, 0, Math.PI * 2, 0, Math.PI / 3.2), new THREE.MeshStandardMaterial({ color: 0x8a8d84, side: THREE.DoubleSide, metalness: 0.5 }));
    dish.rotation.x = -Math.PI / 2.4; dish.position.set(RADAR.x, ry + 7.5, RADAR.z + 1); b.group.add(dish);
  }
  hotspotDefs.push({ kind: 'radar', title: 'WÜRZBURG RADAR', explosive: true, hitsToExplode: 3, meshes: [cabin], parts: radar ? radar.userData.meshes : [dish],
    blast: { radius: 8, hurt: 14, size: 2.0, burn: true, label: 'RADAR WRECKED' } });
  for (const [ax, az, bx2, bz2] of [[-20, -20, 20, -20], [-20, 20, -3, 20], [3, 20, 20, 20], [-20, -20, -20, 20], [20, -20, 20, 20]])
    fence(RADAR.x + ax, RADAR.z + az, RADAR.x + bx2, RADAR.z + bz2);
  const gen = b.box(1.6, 1.1, 1, M.metal, RADAR.x - 10, heightAt(RADAR.x - 10, RADAR.z + 8), RADAR.z + 8);
  place(propModel('searchlight', { y: 2.6 }), RADAR.x + 12, heightAt(RADAR.x + 12, RADAR.z - 6), RADAR.z - 6, 0.6);
  place(propModel('searchlight', { y: 2.6 }), -10, Y, 95, -0.4);

  // ---- flak: three 2 cm guns in sandbag rings ----
  const flak = [[-300, 60], [250, 60], [RADAR.x + 30, RADAR.z + 25]];
  for (const [fx, fz] of flak) {
    const fy = heightAt(fx, fz);
    for (let a = 0; a < 8; a++) { const ang = a / 8 * Math.PI * 2; if (a === 2) continue; b.box(1.6, 0.9, 0.6, M.sandbag, fx + Math.cos(ang) * 3.2, fy, fz + Math.sin(ang) * 3.2, { rotY: -ang }); }
    place(propModel('flak', { y: 2.9 }), fx, fy, fz, Math.PI / 2);
    b.box(1.4, 1.2, 1.4, hidden, fx, fy, fz);
  }

  // ---- a watchtower at the north-east corner ----
  const [wx, wz] = [380, -180], wy = heightAt(wx, wz), wtop = wy + 7;
  const wt = propModel('watchtower', { x: 3.4, y: 7 / 0.6, z: 3.4 }, { stretch: true });
  if (wt) { place(wt, wx, wy, wz); clipAbove(wt, wtop - 0.25); }        // (its legs: see compound.js)
  for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) b.box(0.25, 9.2, 0.25, wt ? hidden : M.wood, wx + dx, wy, wz + dz);
  b.box(3, 0.15, 3, M.wood, wx, wtop - 0.15, wz);
  for (const [w, d, dx, dz] of [[3, 0.08, 0, -1.46], [0.08, 3, -1.46, 0], [0.08, 3, 1.46, 0]]) b.box(w, 1.0, d, M.wood, wx + dx, wtop, wz + dz);
  for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) b.box(0.18, 2.2, 0.18, M.wood, wx + dx, wtop - 0.1, wz + dz, { solid: false });
  b.box(3.4, 0.12, 3.4, M.roof, wx, wtop + 2.1, wz, { solid: false });
  ladders.push(ladder(b, { x: wx, z: wz + 1.5 + 0.35, y: wy, top: wtop, face: 's' }));
  towerTops.push(new THREE.Vector3(wx, wtop, wz));

  // The alarm siren on the apron, by the tower.
  const [sx, sz] = [26, 100];
  b.box(0.2, 5.2, 0.2, M.wood, sx, Y, sz);
  const junction = b.box(0.36, 0.46, 0.2, M.metal, sx, Y + 1.0, sz + 0.2, { solid: false });
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.12, 0.55, 14, 1, true).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a8d84, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
  horn.position.set(sx + 0.25, Y + 5.0, sz);
  const hornBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.35, 12).rotateZ(Math.PI / 2), M.metal);
  hornBody.position.set(sx - 0.05, Y + 5.0, sz);
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.8, 5), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }));
  wire.position.set(sx + 0.12, Y + 3.1, sz + 0.12);
  for (const m of [horn, hornBody, wire]) { m.castShadow = true; b.group.add(m); }
  const siren = { pos: new THREE.Vector3(sx, Y, sz), junction: junction.position.clone(), horn: horn.position.clone(), hornMeshes: [horn, hornBody], wire, standAt: new THREE.Vector3(sx, Y, sz + 0.9) };

  // The engine run-up: loud near the hangar apron while it lasts.
  const runup = { at: new THREE.Vector3(-70, Y, 100), on: false };
  world.soundSources = [{ name: 'engine run-up', at: (pos) => (runup.on ? Math.max(0, Math.min(1, 1.4 - pos.distanceTo(runup.at) / 110)) : 0) }];

  // ---- the garrison ----
  add(40, 98, Math.PI, { officer: true, name: 'Major', look: 'officerColonel' });
  add(tx, tz - 6.5, Math.PI, { name: 'Tower guard', stance: 'alert', look: 'guardSergeant' });
  add(tx + 2, tz + 1, 0, { y: up, name: 'Flight controller' });
  add(-130, 92, -Math.PI / 2, { name: 'Apron patrol' });
  add(-250, 90, -Math.PI / 2, { name: 'Pen patrol', look: 'guardCamo' });
  add(130, 90, -Math.PI / 2, { name: 'East pen patrol' });
  add(-92, 118, Math.PI, { name: 'Mechanic' });
  add(-62, 124, Math.PI / 2, { name: 'Mechanic', look: 'guardSergeant' });
  add(-385, 185, Math.PI, { name: 'Perimeter patrol' });
  add(-300, 35, -Math.PI / 2, { name: 'Runway patrol', look: 'guardCamo' });
  add(-4, z1 - 3, 0, { name: 'Gate guard', stance: 'alert' });
  add(4, z1 - 3, 0, { name: 'Gate guard', look: 'guardSergeant' });
  add(RADAR.x - 18, RADAR.z - 18, 0, { name: 'Radar sentry', stance: 'alert' });
  add(RADAR.x + 2.5, RADAR.z + 3, Math.PI, { name: 'Radar operator' });
  for (const [fx, fz] of flak) add(fx + 1.5, fz + 1.5, Math.PI, { y: heightAt(fx, fz), name: 'Flak crew', look: 'guardSergeant' });
  add(wx, wz - 0.3, Math.PI * 0.75, { y: wtop, name: 'Tower lookout', stance: 'alert', look: 'guardCamo' });
  add(-150, 162, 0, { name: 'Mess guard' });

  const dressed = dressProps(scene, dressing(), heightAt, b.boxes, vehicleModel);
  b.solids.push(...dressed.solids); b.boxes.push(...dressed.boxes);

  return {
    solids: b.solids, boxes: b.boxes, soldiers, ladders, doors, siren, towerTops,
    generator: gen.position.clone(), generatorMesh: gen,
    spawn: new THREE.Vector3(START.x, heightAt(START.x, START.z), START.z),
    hotspotDefs, planes, bowsers, tower, mess, radar, runup,
  };
}

// Set dressing: trucks and a staff car on the apron, motorcycles by the tower, the ground crew's
// tents and kitchen, a halftrack and sentry at the gate, stores by the hangars, a gun by the runway,
// poles along the road.
function dressing() {
  const poles = [-400, -360, -320, -280, -240, -200, -160, -120, -80].map(x => ['pole', x, ROAD_Z + 6]);
  return [
    ...poles, ['signpost', -8, ROAD_Z - 6, 0.3],
    ['truck', -20, 165, 0], ['truck', 112, 166, 0], ['car', 56, 98, 0], ['motorcycle', 30, 100, 0.4], ['motorcycle', 33, 103, 0.2],
    ['tent', -200, 150], ['tent', -212, 165], ['tent', -190, 172, 0.3], ['kitchen', -133, 182, 0],
    ['halftrack', 14, 188, 0], ['sentryBox', -8, 195, 0], ['mgNest', -22, 188], ['sandbags', 54, -126, 0], ['sandbags', 66, -126, 0],
    ['supplies', -82, 162], ['supplies', -118, 160, 0.5], ['pak40', 300, 42, Math.PI], ['wire', -150, -206, 0], ['wire', 120, -206, 0],
  ];
}

// ---- what's to be found ----
function layout({ world, on }) {
  const sp = world.spawn;
  const boxes = [
    { kind: 'parts', where: 'the first hangar', at: on(-110, 150) },
    { kind: 'parts', where: 'the radar fence', at: on(RADAR.x + 17, RADAR.z + 17) },
    { kind: 'parts', where: 'the gate hut', at: on(13, 203) },
    { kind: 'parts', where: 'the pilots\' mess', at: on(-158, 172) },
    { kind: 'parts', where: 'the east pen', at: on(170, 110) },
    { kind: 'weapon', weapon: 'mg42', where: 'the second hangar', at: on(-66, 148) },
    { kind: 'weapon', weapon: 'panzerfaust', where: 'the west flak pit', at: on(-300, 64) },
  ];
  for (const [type, x, z] of [
    ['ammo', -200, 125], ['medical', -60, 160], ['explosives', 110, 160], ['heavy', -230, 125], ['bottles', 0, 150],
    ['ammo', 300, 120], ['explosives', -380, 60], ['medical', 200, -120], ['ammo', RADAR.x - 30, RADAR.z - 30], ['ammo', 0, 260],
    ['ammo', sp.x + 6, sp.z + 3], ['medical', sp.x + 4, sp.z - 6], ['explosives', sp.x - 5, sp.z + 4],
  ]) boxes.push({ kind: 'supply', type, where: type, at: on(x, z) });
  const benches = [{ where: 'start', at: on(sp.x + 2.5, sp.z - 4) }, { where: 'the second hangar', at: on(-52, 140) }];
  return { boxes, benches };
}

// ---- documents, the safe, the objectives ----
const SAFE = { id: 'tower-safe', name: 'THE CONTROL TOWER SAFE', combination: '11 – 23 – 05' };

function intel(it, world, { pickups, arsenal, mission }) {
  const { tower, mess } = world.site;
  it.addSafe({ ...SAFE, at: tower.safe.at, yaw: tower.safe.yaw, objective: 'safe', objectiveText: 'THE FLIGHT PLANS TAKEN',
    docs: [{ id: 'airfield-plans', title: 'Flight plans, Nachtjagdgeschwader 4',
      text: 'Night-fighter patrol areas and beacons for the coming fortnight, the Würzburg control frequencies, the radio call signs of the ' +
        'ground controllers, and the times the bomber streams are expected over the Alps.' }],
    contents: () => { const got = []; const part = pickups?.givePart?.(); if (part) got.push(`part: ${part.name}`); if (arsenal) { arsenal.weapons.rifle.ammo.ap += 4; got.push('+4 AP rounds'); } return got; } });
  it.addDocument({ id: 'airfield-combination', title: "A pilot's notebook", at: mess.docs.notebook, reveals: SAFE.id,
    text: `Three kills this month. The Major keeps the plans in the tower safe and reads the combination off his lighter: ${SAFE.combination}. He thinks nobody sees.` });
  it.addDocument({ id: 'airfield-orders', title: 'Duty roster', at: tower.docs.orders,
    text: 'Ground crew: engine run-ups on the apron every hour and a half after the night\'s flying, 20 minutes each. Fuel bowsers to be kept apart from the aircraft.' });
  it.addDocument({ id: 'airfield-plot', title: 'The plotting table', at: tower.docs.plot,
    text: 'Last night: 2 Lancasters claimed, 1 Bf 110 lost. The Würzburg on the rise brought every interception in. Without it the night fighters fly blind.' });
  it.addDocument({ id: 'airfield-letter', title: 'A letter on the mess table', at: mess.docs.letter,
    text: 'Mother, they have cut a hole in the fence again by the north side of the runway. The guards say partisans. We fly every night and sleep in the day.' });
  mission.papersDoc = { id: 'airfield-papers', title: "Major Kessler's papers", reveals: SAFE.id,
    text: `Pay book of Major H. Kessler, Gruppenkommandeur. A silver lighter in the pocket, engraved: ${SAFE.combination}.` };
  mission.documentsTotal = 6;
}

const def = {
  target: 'Major Kessler',
  targetArea: { x: 40, z: 100 },
  extraction: START,
  killText: 'KESSLER IS DEAD',
  extractText: 'THE NIGHT FIGHTERS ARE FINISHED · GET BACK TO THE HILL',
  papersText: "KESSLER'S PAPERS TAKEN",
  objectives: [
    { id: 'planes', text: 'Destroy the four night fighters (three in the pens, one in a hangar)' },
    { id: 'radar', text: 'Wreck the Würzburg radar on the rise north of the runway' },
    { id: 'safe', text: 'Take the flight plans from the control tower safe' },
    { id: 'officer', text: 'Eliminate Major Kessler, the Gruppe commander', optional: true },
    { id: 'papers', text: "Take Kessler's papers", optional: true },
    { id: 'extract', text: 'Get back to the hill you came from', hidden: true },
  ],
  tick(m, dt) {
    const w = m.world, site = w.site, hs = w.hotspots;
    const planesLeft = hs.filter(h => h.kind === 'plane' && !h.exploded).length;
    if (!m.obj('planes').done) {
      if (planesLeft === 0) m.complete('planes', 'ALL FOUR NIGHT FIGHTERS DESTROYED');
      else if (site.lastLeft !== undefined && planesLeft < site.lastLeft) m.hud.message(`NIGHT FIGHTER DESTROYED · ${planesLeft} LEFT`, '');
      site.lastLeft = planesLeft;
    }
    const radar = hs.find(h => h.kind === 'radar');
    if (radar?.exploded && !m.obj('radar').done) m.complete('radar', 'THE RADAR IS WRECKED');
    if (radar?.exploded && site.radar && !site.radarDown) { site.radarDown = true; site.radar.rotation.z = 0.5; site.radar.position.y -= 1.2; }
    // The engine run-up: on for a while every so often (it's on the ground crew's roster).
    const t = m.time % RUNUP_EVERY, on = t > RUNUP_EVERY - RUNUP_FOR && hs.some(h => h.kind === 'plane' && !h.exploded);
    if (on !== site.runup.on) { site.runup.on = on; if (on && m.player.pos.distanceTo(site.runup.at) < 250) m.hud.message('AN ENGINE IS RUNNING UP ON THE APRON', ''); }
    m.audio.setEngine(on ? Math.max(0, 1 - m.player.pos.distanceTo(site.runup.at) / 300) * 1.2 : 0);
  },
  markers(m) {
    const out = [];
    if (!m.obj('radar').done) out.push({ pos: new THREE.Vector3(RADAR.x, heightAt(RADAR.x, RADAR.z) + 13, RADAR.z), kind: 'tank', label: 'RADAR', height: 1 });
    return out;
  },
};

const briefing = `
  <p class="brief">Dawn at a Luftwaffe night-fighter airfield. The Gruppe is back from the night's hunting over the Alps: its
    fighters stand in their earth pens along the taxiway and in a hangar, and the ground crew is refuelling them.</p>
  <ul class="goals">
    <li><b>Destroy the four night fighters</b> on the ground: three in the pens, one in the first hangar. Two hits in the fuel
      (one armour-piercing round) or a satchel. The fuel bowsers on the apron burn too.</li>
    <li><b>Wreck the Würzburg radar</b> on the fenced rise north of the runway: shoot its cabin, or a satchel.</li>
    <li><b>Take the flight plans</b> from the safe upstairs in the control tower (the combination is written down somewhere,
      and Major Kessler carries it).</li>
    <li><b>Optional:</b> eliminate Kessler; take his papers.</li>
    <li><b>Then</b> get back to the hill you started from, where green smoke marks the pick-up.</li>
  </ul>
  <p class="brief">The field is flat and open; the fence is cut on the north side and the east side. When the mechanics run an engine
    up on the apron, nobody near the hangars hears a shot.</p>`;

export default { id: 'airfield', props: ['bf110', 'ju88', 'radar', 'hangar', 'bowser', 'searchlight', 'flak', 'drums', 'watchtower', 'generator', 'motorcycle', 'tent', 'kitchen', 'halftrack', 'sentryBox', 'mgNest', 'sandbags', 'supplies', 'pak40', 'wire', 'pole', 'signpost'],
  subtitle: 'Operation Night Owl · Lombardy, 1944', map, site, def, intel, briefing };
