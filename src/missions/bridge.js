// Operation Broken Span: a stone road bridge over a river gorge in the Apennines. An armoured
// column is coming from the east to cross it. Blow the bridge before it does (a satchel or TNT
// at the foot of each of its two piers), and kill the engineer who could repair it.
//
// The gorge: cliffs you can't climb, a river you can't swim, a strip of bank under each cliff.
// Ways down: the ladders on the piers (from the bridge deck), and two gullies, one each side,
// where the cliff eases. The other way across: a footbridge low over the river downstream.
// The column keeps its own time; if its lead vehicle gets across, the mission is lost. If the
// bridge goes while vehicles are on it, they go down with it.
import * as THREE from 'three';
import { fbm, lerp, smoothstep, makeRng } from '../world/noise.js';
import { M, Builder } from '../world/kit.js';
import { building, furniture, ladder } from '../world/buildings.js';
import { Soldier } from '../world/soldier.js';
import { vehicleModel } from '../world/vehicle-models.js';
import { turretProp, addTurret } from '../world/turrets.js';
import { addExhaust } from '../world/exhaust.js';
import { addGroundMarks } from '../world/groundmarks.js';
import { panzerModel } from '../world/tank.js';
import { hasProp, propModel, clipAbove, splitProp, dressProps } from '../world/props.js';
import { worldUVs } from '../world/textures.js';

const DECK = 40.4, BW = 3.5;                    // the deck's top and half-width
const WATER = 7;
const START = { x: -320, z: 300 };
const CAMP = { x: -140, z: 70 };
const PIER_X = 11;
const T_DUE = 420, SPEED = 7, GAP = 18;          // the column: in sight at 7:00, 7 m/s, 18 m apart
const LEAD_STOP = 46;                            // where it stops if the bridge is down

const gx = (z) => 25 * Math.sin(z * 0.006);      // the river's line
// Where the cliff band ends (wider in the two gullies: west at z +120, east at z −140).
const rimAt = (z, west) => 34 + 70 * Math.exp(-(((z - (west ? 120 : -140)) / 30) ** 2));
const roadZ = (x) => (Math.abs(x) < 150 ? 0 : 40 * Math.sin((x - 150 * Math.sign(x)) * 0.008));

function plateau(x, z, d) {
  let h = 40 + (fbm(x * 0.004 + 2, z * 0.004 + 5, 4) - 0.5) * 44 * smoothstep(50, 170, d);
  h += 22 * Math.exp(-((x - START.x) ** 2 + (z - START.z) ** 2) / (2 * 70 * 70));
  const r = Math.max(Math.abs(x), Math.abs(z));
  if (r > 400) { const t = (r - 400) / 100; h += t * t * (30 + 40 * fbm(x * 0.006 + 1.1, z * 0.006, 3)); }
  return h;
}
const roadCache = new Map();
function roadH(x) {
  const k = Math.round(x);
  let v = roadCache.get(k);
  if (v === undefined) {
    v = 0;
    for (let i = -2; i <= 2; i++) { const xx = k + i * 8, zz = roadZ(xx); v += plateau(xx, zz, Math.abs(xx - gx(zz))) / 5; }
    roadCache.set(k, v);
  }
  return v;
}
function heightAt(x, z) {
  const d = Math.abs(x - gx(z));
  if (d < 14) return 4 + 4 * smoothstep(8.5, 10.5, d);                 // the river bed, then the bank
  let top = plateau(x, z, d);
  const rz = roadZ(x), dr = Math.abs(z - rz);
  if (dr < 12 && d > 30) top = lerp(roadH(x), top, smoothstep(4, 12, dr));
  const t = Math.min(1, (d - 14) / (rimAt(z, x < gx(z)) - 14));
  return lerp(8, top, smoothstep(0, 1, t));
}
const slopeAt = (x, z) => Math.max(Math.abs(heightAt(x + 0.7, z) - heightAt(x - 0.7, z)), Math.abs(heightAt(x, z + 0.7) - heightAt(x, z - 0.7))) / 1.4;
const onBridge = (x, z) => Math.abs(x) < 40 && Math.abs(z) < BW - 0.3;

const map = {
  // Bright midday in the mountains: a high sun, crisp shadows in the gorge.
  light: { zenith: 40, azimuth: 170, sun: 0xfff0d8, sunIntensity: 2.9, turbidity: 4, rayleigh: 1.4, clouds: 0.3 },
  fog: { color: 0xb4c7cf },   // the haze takes the colour of this sky low on the horizon (and so does the far country's)
  half: 500, playHalf: 470, focus: { x: 0, z: 0, r: 120 }, start: START, navHalf: 280, waterLevel: WATER,
  maxSlope: 0.9,
  heightAt,
  roadCenterZ: roadZ,
  // Guards don't take the cliffs; the bridge deck is open while it stands.
  navBlocked: (x, z) => !onBridge(x, z) && Math.abs(x - gx(z)) < 110 && slopeAt(x, z) > 0.9,
  navOpen: (x, z) => onBridge(x, z),
  keepClear(x, z, m = 0) {
    const d = Math.abs(x - gx(z));
    if (d < 40 + m) return true;                                                         // the gorge and its rims
    if (Math.abs(z - roadZ(x)) < 6 + m) return true;
    if (Math.hypot(x - CAMP.x, z - CAMP.z) < 45 + m) return true;
    if (Math.hypot(x - 70, z) < 35 + m) return true;                                     // the east checkpoint, MG nest, tower
    return Math.hypot(x - START.x, z - START.z) < 12 + m;
  },
  paint(c, x, z, { road, rock, dirt, yard }) {
    const d = Math.abs(x - gx(z)), s = slopeAt(x, z);
    c.lerp(rock, smoothstep(0.5, 0.9, s));                              // bare rock on the cliffs
    if (d < 14) c.lerp(dirt, 0.6).lerp(rock, 0.3);                      // the banks: gravel and stones
    c.lerp(road, 1 - smoothstep(2.5, 4, Math.abs(z - roadZ(x))));
    c.lerp(yard, 0.7 * (1 - smoothstep(28, 42, Math.hypot(x - CAMP.x, z - CAMP.z))));
  },
  truck: { from: -600, stop: -120 },
  reinforceHome: [-60, 12],
  flee: [CAMP.x, CAMP.z],
  routes: {
    Hahn: [[-140, 58, 20], [-118, 76, 10], [-60, 4, 6], [-36, 0, 25], [-60, 4], [-140, 58]],
    'Bridge patrol': [[-46, 0], [46, 0, 8], [-46, 0, 8]],
    'Camp patrol': [[-170, 50], [-110, 50, 6], [-110, 95], [-170, 95, 6], [-170, 50]],
    'Bank patrol': [[gx(-60) - 12, -60, 6], [gx(90) - 12, 90, 10], [gx(-60) - 12, -60]],
    'East patrol': [[60, 2], [200, roadZ(200) + 4, 8], [60, 2, 8]],
  },
  pickups: layout,
};

// ---- the gorge's buildings ----
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
  const stone = M.stone;

  // ---- the bridge: three arched spans between the abutments, on two piers ----
  const spanShape = (x0, x1, [hx0, hx1, spring, rise]) => {
    const s = new THREE.Shape();
    s.moveTo(x0, 4); s.lineTo(x1, 4); s.lineTo(x1, DECK); s.lineTo(x0, DECK); s.closePath();
    const h = new THREE.Path();
    h.moveTo(hx0, 4.5); h.lineTo(hx1, 4.5); h.lineTo(hx1, spring);
    h.absellipse((hx0 + hx1) / 2, spring, (hx1 - hx0) / 2, rise, 0, Math.PI, false);
    h.lineTo(hx0, 4.5);
    s.holes.push(h);
    const g = new THREE.ExtrudeGeometry(s, { depth: 2 * BW, bevelEnabled: false }).translate(0, 0, -BW);
    worldUVs(g, stone.userData.tile);
    return g;
  };
  // Each span hangs in its own group so it can fall: the side spans pivot on their abutment.
  const spans = [
    { pivot: new THREE.Vector3(-34, DECK, 0), x0: -34, x1: -11, hole: [-33, -13.5, 22, 10] },
    { pivot: new THREE.Vector3(0, DECK, 0), x0: -11, x1: 11, hole: [-8.5, 8.5, 23, 9] },
    { pivot: new THREE.Vector3(34, DECK, 0), x0: 11, x1: 34, hole: [13.5, 33, 22, 10] },
  ].map(sp => {
    const g = new THREE.Group();
    g.position.copy(sp.pivot);
    const m = new THREE.Mesh(spanShape(sp.x0, sp.x1, sp.hole), stone);
    m.position.set(-sp.pivot.x, -DECK, 0); m.castShadow = m.receiveShadow = true;
    g.add(m);
    b.solids.push(m);                                       // bullets stop on it (walking: the deck blocks below)
    // The parapets (gaps where the piers' ladders come up).
    const parts = [];
    for (const z of [-BW + 0.2, BW - 0.2]) {
      const runs = sp.x0 < -20 ? [[sp.x0, -13.7]] : sp.x0 > 0 ? [[13.7, sp.x1]] : [[-8.3, 8.3]];
      for (const [a, c] of runs) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(c - a, 1.0, 0.4), stone);
        p.position.set((a + c) / 2 - sp.pivot.x, 0.5, z); p.castShadow = true; g.add(p);
        parts.push(b.box(c - a, 1.0, 0.4, hidden, (a + c) / 2, DECK, z));
      }
    }
    parts.push(b.box(sp.x1 - sp.x0, 0.6, 2 * BW, hidden, (sp.x0 + sp.x1) / 2, DECK - 0.6, 0));
    scene.add(g);
    // (b.box keeps each block's Box3 last in b.boxes: find them by their mesh when it falls)
    return { ...sp, group: g, mesh: m, colliders: parts };
  });
  const modelled = hasProp('stoneBridge');
  for (const s of [-1, 1]) b.box(6, DECK - 30, 2 * BW, modelled ? hidden : stone, s * 37, 30, 0);         // the abutments
  for (const s of [-1, 1]) for (const z of [-BW + 0.2, BW - 0.2]) b.box(4, 1.0, 0.4, modelled ? hidden : stone, s * 38, DECK, z);
  // The piers: stone, wider than the deck (cutwaters), up to the deck. A ladder on each one's
  // south face from the bank to the top. Only a charge at the foot brings one down.
  const piers = [-1, 1].map(s => {
    const x = s * PIER_X, mesh = b.box(5.4, DECK - 7.5, 9, stone, x, 7.5, 0);
    const pierBox = b.boxes.at(-1);
    ladders.push(ladder(b, { x: x + s * 1.2, z: 4.5 + 0.35, y: 8, top: DECK, face: 's' }));     // (on the bank side, not over the water)
    hotspotDefs.push({ kind: 'pier', title: s < 0 ? 'WEST PIER' : 'EAST PIER', explosive: true, armored: true, heavyOnly: true, hitsToExplode: 1,
      meshes: [mesh], parts: [mesh], blast: { radius: 9, hurt: 16, size: 2.4, burn: false, heavy: true, label: `${s < 0 ? 'WEST' : 'EAST'} PIER DESTROYED` } });
    return { x, mesh, box: pierBox, def: hotspotDefs.at(-1) };
  });
  // The modelled bridge: one stone three-arch bridge, cut into its pieces so they can fall as the
  // blocks above do: each side span (with its share of the parapets) hangs in its span's group,
  // each pier's shaft rides on its pier block (which crumbles), the abutments stay. The blocks
  // stay for walking, bullets and the charges, undrawn.
  if (modelled) {
    const whole = propModel('stoneBridge', { x: 80, y: DECK + 1.0 - 4, z: 9 }, { stretch: true });
    whole.position.set(0, 4, 0);
    const pieces = splitProp(whole, (c) => {
      if (Math.abs(c.x) > 35) return 'abutments';
      for (const p of piers) if (Math.abs(c.x - p.x) < 3.2 && c.y < DECK - 9) return p.x < 0 ? 'pierW' : 'pierE';
      return c.x < -11 ? 'span0' : c.x > 11 ? 'span2' : 'span1';
    });
    for (const sp of spans) {
      sp.mesh.material = hidden;
      for (const o of sp.group.children) if (o !== sp.mesh) o.material = hidden;   // (its parapets: the model has them)
    }
    spans.forEach((sp, i) => { const m = pieces[`span${i}`]; if (m) { m.position.sub(sp.pivot); sp.group.add(m); } });
    piers.forEach((p) => {
      const m = pieces[p.x < 0 ? 'pierW' : 'pierE'];
      if (!m) return;
      p.mesh.material = hidden;
      m.position.copy(p.mesh.position).negate();                       // (baked in world space; the block is its parent)
      p.mesh.add(m);
      p.def.parts.push(m);
    });
    if (pieces.abutments) b.group.add(pieces.abutments);
  }

  // ---- the checkpoints at both ends: sandbags, a barrier, a hut ----
  for (const s of [-1, 1]) {
    const cx = s * 50;
    for (const z of [-6.5, 6.5]) b.box(1.2, 1.0, 4, M.sandbag, cx, roadH(cx), z);
    b.box(0.15, 1.1, 0.15, M.wood, cx - s * 0.6, roadH(cx), -3.8);
    b.box(0.12, 0.12, 6.5, new THREE.MeshStandardMaterial({ color: 0xc8c2b0 }), cx - s * 0.6, roadH(cx) + 1.05, -0.6, { solid: false });
    const sentry = propModel('sentryBox', { x: 1.8, y: 2.9, z: 1.8 }, { stretch: true });
    if (sentry) { sentry.position.set(cx + s * 4, roadH(cx), -9); sentry.rotation.y = Math.PI; b.group.add(sentry); b.box(1.7, 2.6, 1.7, hidden, cx + s * 4, roadH(cx), -9); }
    else { b.box(3, 2.6, 3, M.wood, cx + s * 4, roadH(cx), -9); b.gable(3, 0.9, 3, M.roof, cx + s * 4, roadH(cx) + 2.6, -9); }
  }
  // ---- the east side: an MG nest over the bridge, a watchtower ----
  const [nx, nz] = [60, -16], ny = heightAt(nx, nz);
  const nest = propModel('mgNest', { x: 7.0, y: 1.3, z: 7.0 }, { stretch: true });
  // (the modelled nest's sandbags are made solid with the others, mgnest.js; drawn ones otherwise)
  if (!nest) for (let a = 0; a < 10; a++) { const ang = a / 10 * Math.PI * 2; if (a === 2) continue; b.box(1.6, 0.9, 0.6, M.sandbag, nx + Math.cos(ang) * 3, ny, nz + Math.sin(ang) * 3, { rotY: -ang }); }
  if (nest) { nest.position.set(nx, ny, nz); nest.rotation.y = Math.PI / 2; b.group.add(nest); }
  else {
    b.box(0.3, 0.9, 0.3, steel, nx - 2.2, ny, nz);
    const mg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 6).rotateZ(Math.PI / 2), steel);
    mg.position.set(nx - 2.6, ny + 1.0, nz); b.group.add(mg);
  }
  const [tx, tz] = [80, 24], ty = heightAt(tx, tz), top = ty + 7;
  // (The modelled tower gives the legs, cut just under the platform: see compound.js.)
  const tower = propModel('watchtower', { x: 3.4, y: 7 / 0.6, z: 3.4 }, { stretch: true });
  if (tower) {
    tower.position.set(tx, ty, tz); b.group.add(tower); clipAbove(tower, top - 0.25);
    for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) b.box(0.18, 2.2, 0.18, M.wood, tx + dx, top - 0.1, tz + dz, { solid: false });
  }
  for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) b.box(0.25, 9.2, 0.25, tower ? hidden : M.wood, tx + dx, ty, tz + dz);
  b.box(3, 0.15, 3, M.wood, tx, top - 0.15, tz);
  for (const [w, d, dx, dz] of [[3, 0.08, 0, -1.46], [0.08, 3, -1.46, 0], [0.08, 3, 1.46, 0]]) b.box(w, 1.0, d, M.wood, tx + dx, top, tz + dz);
  b.box(3.4, 0.12, 3.4, M.roof, tx, top + 2.1, tz, { solid: false });
  ladders.push(ladder(b, { x: tx, z: tz + 1.5 + 0.35, y: ty, top, face: 's' }));
  towerTops.push(new THREE.Vector3(tx, top, tz));

  // ---- the footbridge downstream: planks on trestles low over the river ----
  const fz = 170, fx = gx(fz);
  b.box(28, 0.2, 1.6, M.wood, fx, 8.2, fz);                                 // (a step up from the bank)
  for (const dx of [-7, 0, 7]) for (const dz of [-0.7, 0.7]) b.box(0.2, 5, 0.2, M.wood, fx + dx, 3.6, fz + dz, { solid: false });
  for (const dz of [-0.8, 0.8]) b.box(28, 0.05, 0.05, M.darkWood, fx, 9.7, fz + dz, { solid: false });

  // ---- the engineers' camp on the west side ----
  const { x: cx, z: cz } = CAMP, cy = heightAt(cx, cz);
  const hut = building(b, { x: cx, z: cz - 12, y: heightAt(cx, cz - 12), w: 10, d: 6, floors: 1, h: 3, mat: M.wood, roof: 'gable',
    openings: [{ side: 's', at: -2.5, w: 1.1, door: true }, { side: 's', at: 2.5, w: 1.0, window: true }, { side: 'n', at: 0, w: 1.0, window: true }, { side: 'e', at: 0, w: 0.9, window: true }] });
  doors.push(...hut.doors);
  const hy = heightAt(cx, cz - 12);
  furniture.desk(b, cx + 2.5, hy, cz - 13.5);
  furniture.table(b, cx - 2.5, hy, cz - 12.5, 2.2, 1.2);                       // the plans table
  hut.safe = { at: new THREE.Vector3(cx + 4.2, hy, cz - 10.6), yaw: -Math.PI / 2 };
  hut.docs = { orders: new THREE.Vector3(cx + 2.4, hy + 0.79, cz - 13.6), survey: new THREE.Vector3(cx - 2.4, hy + 0.79, cz - 12.5) };
  const canvas = new THREE.MeshStandardMaterial({ color: 0x6c6b4f, roughness: 1, side: THREE.DoubleSide });
  const tents = [[-24, 18], [-14, 22], [-4, 20], [6, 24]].map(([dx, dz]) => {
    const x = cx + dx, z = cz + dz, y = heightAt(x, z);
    const tent = propModel('tent', { x: 3.6, y: 2.4, z: 4.6 }, { stretch: true });
    b.box(3.4, 0.9, 4.4, tent ? hidden : canvas, x, y, z);
    if (tent) { tent.position.set(x, y, z); tent.rotation.y = Math.PI; b.group.add(tent); }
    else b.gable(3.4, 1.4, 4.4, canvas, x, y + 0.9, z);
    return new THREE.Vector3(x, y, z);
  });
  // The bridging truck: pontoon boats on its bed.
  const [px, pz] = [cx + 30, cz + 4], py = heightAt(px, pz);
  const bt = vehicleModel('truck');
  bt.position.set(px, py, pz); b.group.add(bt);
  b.box(2.3, 2.4, 3.6, hidden, px, py + 0.35, pz - 1.2); b.box(2.1, 2.0, 1.2, hidden, px, py + 0.35, pz + 1.2);
  const btEngine = b.box(1.8, 1.25, 1.2, hidden, px, py + 0.5, pz + 2.4);
  const pontoon = new THREE.MeshStandardMaterial({ color: 0x4f5442, roughness: 0.7, metalness: 0.3 });
  const onBed = propModel('pontoons', { x: 2.0, y: 1.4, z: 4.2 }, { stretch: true, turn: 1 });
  if (onBed) { onBed.position.set(px, py + 1.5, pz - 1.0); b.group.add(onBed); }
  else for (let i = 0; i < 2; i++) b.box(2.0, 0.7, 4.2, pontoon, px, py + 1.5 + i * 0.75, pz - 1.0, { solid: false });
  for (let i = 0; i < 3; i++) {                                                   // more pontoons waiting on the ground
    const stack = propModel('pontoons', { x: 2.2, y: 1.5, z: 6 }, { stretch: true, turn: 1 });
    b.box(2.2, 0.8, 6, stack ? hidden : pontoon, px + 6 + i * 2.6, py, pz);
    if (stack) { stack.position.set(px + 6 + i * 2.6, py, pz); b.group.add(stack); }
  }
  // The camp's generator (it covers sound close by) and siren.
  const gen = b.box(1.6, 1.1, 1, M.metal, cx - 20, cy, cz - 2);
  const [sx, sz] = [cx - 8, cz - 2];
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

  // ---- the column: two Panzers and three trucks, waiting out of sight in the east ----
  const column = buildColumn(scene);
  b.boxes.push(...column.vehicles.map(v => v.box));
  b.solids.push(...column.vehicles.flatMap(v => v.solids));
  world.soundSources = [{ name: 'column', at: (pos) => {
    if (!column.visible || column.v < 1) return 0;
    const lead = column.vehicles.find(v => !v.fallen)?.pos;
    return lead ? Math.max(0, Math.min(1, 1.4 - lead.distanceTo(pos) / 160)) : 0;
  } }];

  // ---- the garrison ----
  add(-140, 58, Math.PI, { officer: true, name: 'Hahn', look: 'officerLieutenant' });
  add(-46, 0, -Math.PI / 2, { name: 'Bridge patrol', look: 'guardPionier' });
  add(-52, -5, -Math.PI / 2, { name: 'Checkpoint', stance: 'alert', look: 'guardSergeant' });
  add(-52, 5, -Math.PI / 2, { name: 'Checkpoint' });
  add(52, -5, Math.PI / 2, { name: 'Checkpoint', stance: 'alert' });
  add(52, 5, Math.PI / 2, { name: 'Checkpoint', look: 'guardCamo' });
  add(nx - 1.2, nz + 0.8, Math.PI / 2, { name: 'MG crew', stance: 'alert', look: 'guardSergeant' });
  add(nx + 0.6, nz - 1, Math.PI / 2, { name: 'MG crew' });
  add(tx, tz - 0.3, Math.PI * 0.75, { y: top, name: 'Tower guard', stance: 'alert', look: 'guardCamo' });
  add(-170, 50, Math.PI / 2, { name: 'Camp patrol', look: 'guardPionier' });
  add(px - 3, pz + 3, Math.PI, { name: 'Pontoon guard', stance: 'alert', look: 'guardPionier' });
  add(cx - 1, cz - 7.5, 0, { name: 'Hut guard', stance: 'alert', look: 'guardSergeant' });
  add(gx(-60) - 12, -60, 0, { name: 'Bank patrol', look: 'guardCamo' });
  add(60, 2, -Math.PI / 2, { name: 'East patrol' });

  const dressed = dressProps(scene, dressing(), heightAt, b.boxes, vehicleModel);
  b.solids.push(...dressed.solids); b.boxes.push(...dressed.boxes);

  return {
    solids: b.solids, boxes: b.boxes, soldiers, ladders, doors, siren, towerTops,
    generator: gen.position.clone(), generatorMesh: gen,
    spawn: new THREE.Vector3(START.x, heightAt(START.x, START.z), START.z),
    vehicles: [{ title: 'BRIDGING TRUCK ENGINE', engine: btEngine, parts: [bt.userData.mesh] }],
    hotspotDefs, spans, piers, hut, tents, column,
  };
}

// The column: lead Panzer, truck, Panzer, two trucks, driving west along the road. Each keeps a
// collision block that moves with it.
// A modelled column vehicle laid nose toward +z, like the others (the props lie front toward −x).
function columnProp(kind) {
  const g = new THREE.Group();
  if (kind === 'tiger') {                                  // the Tiger's turret turns, crewed
    const t = turretProp('tiger');
    t.group.rotation.y = Math.PI / 2;
    g.add(t.group);
    g.userData.mesh = t.hull;
    g.userData.crew = addTurret({ pivot: t.pivot, gun: t.gun, muzzle: t.muzzle, recoil: t.turret, own: [t.hull, t.turret], name: 'TIGER', traverse: 0.25, reload: 12, exhaust: t.exhaust });
    return g;
  }
  const m = propModel(kind, { x: 5.8, y: 2.0, z: 2.1 }, { stretch: true, own: true });
  m.rotation.y = Math.PI / 2;
  g.add(m);
  g.userData.mesh = m.userData.meshes[0];
  return g;
}

// Where each column vehicle's wheels or tracks meet the ground, and its exhaust (the tanks' own
// exhausts come with their turret crews), in its own space: nose toward +z, metres.
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const VEHICLE_MARKS = {
  tiger: { wheels: [{ at: V3(1.45, 0, -0.85), kind: 'tread' }, { at: V3(-1.45, 0, -0.85), kind: 'tread' }] },
  panzer: { wheels: [{ at: V3(1.3, 0, -0.5), kind: 'tread' }, { at: V3(-1.3, 0, -0.5), kind: 'tread' }] },
  halftrack: {
    wheels: [{ at: V3(0.8, 0, 1.9), kind: 'tyre' }, { at: V3(-0.8, 0, 1.9), kind: 'tyre' }, { at: V3(0.8, 0, -1.3), kind: 'tread' }, { at: V3(-0.8, 0, -1.3), kind: 'tread' }],
    exhaust: { points: [V3(0.95, 0.6, 0.9)], dir: V3(1, 0.4, 0) },
  },
  truck: {
    wheels: [{ at: V3(0.85, 0, -1.6), kind: 'tyre' }, { at: V3(-0.85, 0, -1.6), kind: 'tyre' }],
    exhaust: { points: [V3(0.7, 0.4, -3.0)], dir: V3(0, 0.3, -1) },
  },
};

// A vehicle at the bottom of the gorge: its burnt-out model in its place (nose toward +z, like the
// column's), or just blackened where there's none.
const GORGE_WRECKS = { tiger: ['wreckTiger', 6.6], panzer: ['wreckPanzer', 5.9], truck: ['wreckTruck', 6.0], halftrack: ['wreckHalftrack', 5.8] };
function wreckInGorge(v) {
  const [key, len] = GORGE_WRECKS[v.kind] ?? [];
  const w = key && propModel(key, { x: len }, { own: true });
  if (!w) { v.model.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color?.multiplyScalar(0.2); } }); return; }
  v.model.traverse(o => { if (o.isMesh) o.visible = false; });
  w.rotation.y = Math.PI / 2;
  v.model.add(w);
}

// A vehicle gone into the gorge: its crew is out of the fight.
function crewDown(v) { if (v.model.userData.crew) v.model.userData.crew.dead = true; }

function buildColumn(scene) {
  // A Tiger leads (a Panzer IV where its model is missing), then trucks, a Panzer IV and a halftrack.
  const kinds = [hasProp('tiger') ? 'tiger' : 'panzer', 'truck', 'panzer', hasProp('halftrack') ? 'halftrack' : 'truck', 'truck'];
  const c = {};
  const vehicles = kinds.map((kind, i) => {
    const model = kind === 'panzer' ? panzerModel() : kind === 'truck' ? vehicleModel('truck') : columnProp(kind);
    model.visible = false;
    scene.add(model);
    const half = { panzer: new THREE.Vector3(3.2, 1.4, 1.7), tiger: new THREE.Vector3(3.3, 1.5, 1.85), halftrack: new THREE.Vector3(2.9, 1.0, 1.1) }[kind] ?? new THREE.Vector3(3.1, 1.3, 1.2);
    const box = new THREE.Box3(new THREE.Vector3(1e6, -1e6, 1e6), new THREE.Vector3(1e6, -1e6, 1e6));
    const v = { kind, i, model, half, box, solids: [model.userData.mesh].filter(Boolean), pos: new THREE.Vector3(), fallen: false, fallT: 0 };
    // On the road its engine runs and its wheels or tracks print the ground (nose toward +z, metres).
    const onRoad = () => c.visible && !v.fallen;
    const marks = VEHICLE_MARKS[kind];
    addGroundMarks({ object: model, wheels: marks.wheels, active: onRoad });
    if (marks.exhaust) addExhaust({ space: model, ...marks.exhaust, running: onRoad, speed: () => c.v });
    return v;
  });
  Object.assign(c, { vehicles, lead: 520, v: 0, phase: 'due', visible: false, said: {} });
  // Where each vehicle stands at lead position `lead`: on the road, or on the deck while the bridge stands.
  c.place = (collapsed) => {
    for (const v of vehicles) {
      if (v.fallen) continue;
      const x = c.lead + v.i * GAP, z = roadZ(x);
      const y = !collapsed && Math.abs(x) < 38 ? DECK : heightAt(x, z);
      const dz = roadZ(x - 1) - roadZ(x + 1);
      v.pos.set(x, y, z);
      v.model.position.copy(v.pos);
      v.model.rotation.set(0, Math.atan2(-2, dz), 0);                         // nose (+z) along the road, westward
      v.box.min.set(x - v.half.x, y, z - v.half.z);
      v.box.max.set(x + v.half.x, y + 2 * v.half.y, z + v.half.z);
    }
  };
  return c;
}

// Set dressing: vehicles and a motorcycle at the west checkpoint, signposts at both ends, a gun
// covering the bridge from the east, sandbags, the camp's kitchen and stores, poles along the road.
function dressing() {
  const poles = [-120, -160, -200, -240, -280, 120, 160, 200, 240].map(x => ['pole', x, roadZ(x) + 7]);
  return [
    ...poles, ['signpost', -57, -11, 0.3], ['signpost', 57, 11, -0.3],
    ['truck', -72, 11, Math.PI / 2], ['car', -64, -12, 0], ['motorcycle', -58, 9, 0.4],
    ['pak40', 64, 13, 0], ['searchlight', 68, -7, 2.4], ['sandbags', -46, 10, Math.PI / 2], ['sandbags', 46, -10, Math.PI / 2],
    ['kitchen', -125, 86, 0.3], ['supplies', -128, 60], ['drums', -150, 86, 0.3], ['barrels', -110, 80, 0],
    ['wire', 72, 40, Math.PI / 2], ['wire', -72, -40, Math.PI / 2],
    ['pontoonSection', CAMP.x - 2, CAMP.z + 4, 0], ['assaultBoat', CAMP.x - 10, CAMP.z - 6, 0.2], ['assaultBoat', CAMP.x - 12, CAMP.z + 14, 0.4], ['rock', 120, 140, 1],
  ];
}

// ---- what's to be found ----
function layout({ world, on }) {
  const sp = world.spawn, { x: cx, z: cz } = CAMP;
  const boxes = [
    { kind: 'parts', where: 'the west checkpoint hut', at: on(-55, -7) },
    { kind: 'parts', where: 'the engineers\' plans table', at: on(cx - 4.5, cz - 11) },
    { kind: 'parts', where: 'the footbridge', at: on(gx(170) - 15, 170) },
    { kind: 'parts', where: 'under the watchtower', at: on(81, 22.6) },
    { kind: 'parts', where: 'the east bank under the bridge', at: on(gx(-12) + 12, -12) },
    { kind: 'weapon', weapon: 'panzerfaust', where: 'the MG nest', at: on(62, -12) },
    { kind: 'weapon', weapon: 'm1carbine', where: 'the west gully', at: on(gx(120) - 60, 118) },
  ];
  for (const [type, x, z] of [
    ['explosives', cx - 22, cz + 12], ['explosives', gx(100) - 12, 100], ['explosives', 120, -30], ['ammo', -80, 20], ['medical', -60, -20],
    ['ammo', cx + 10, cz + 30], ['heavy', 90, -40], ['medical', gx(150) + 12, 150], ['bottles', -100, -40], ['ammo', 160, 60],
    ['ammo', sp.x + 6, sp.z + 3], ['medical', sp.x + 4, sp.z - 6], ['explosives', sp.x - 5, sp.z + 4],
  ]) boxes.push({ kind: 'supply', type, where: type, at: on(x, z) });
  const benches = [{ where: 'start', at: on(sp.x + 2.5, sp.z - 4) }, { where: 'the engineers\' camp', at: on(cx - 26, cz + 4) }];
  return { boxes, benches };
}

// ---- documents, the safe, the objectives ----
const SAFE = { id: 'engineer-safe', name: "HAHN'S SAFE", combination: '04 – 19 – 33' };

function intel(it, world, { pickups, arsenal, mission }) {
  const { hut, tents } = world.site;
  it.addSafe({ ...SAFE, at: hut.safe.at, yaw: hut.safe.yaw, objective: 'safe', objectiveText: 'THE RIVER SURVEY TAKEN',
    docs: [{ id: 'bridge-survey', title: 'Survey of the river crossings',
      text: 'Pionier-Bataillon 52, Oblt. Hahn. Crossings of the Serchio between Ponte Alto and the sea: the stone bridge (40 t), a ford at Molino (summer only), ' +
        'three sites for a pontoon bridge, marked. A 16-tonne pontoon bridge can be built at site 2 in nine hours.' }],
    contents: () => { const got = []; const part = pickups?.givePart?.(); if (part) got.push(`part: ${part.name}`); if (arsenal) { arsenal.weapons.rifle.ammo.ap += 4; got.push('+4 AP rounds'); } return got; } });
  it.addDocument({ id: 'bridge-combination', title: "A Feldwebel's notebook", at: tents[1].clone().add(new THREE.Vector3(0.6, 0.95, 0.5)), reveals: SAFE.id,
    text: `Hahn's safe, for when he is up at the bridge and wants the survey brought: ${SAFE.combination}. Don't lose this.` });
  it.addDocument({ id: 'bridge-orders', title: 'Orders for the bridge', at: hut.docs.orders,
    text: 'The stone bridge at Ponte Alto is to be held open for Kampfgruppe Wendt (2 Panzer IV, 3 lorries) arriving from the east this afternoon. ' +
      'If it is damaged, Oblt. Hahn\'s company will repair or replace it within the night. The demolition chambers in the piers are NOT to be charged.' });
  it.addDocument({ id: 'bridge-letter', title: 'A note at the footbridge', at: new THREE.Vector3(gx(170) - 14.6, heightAt(gx(170) - 14.6, 170.3) + 0.02, 170.3),
    text: 'The Germans don\'t watch the old path down the west gully, or the footbridge. From the bank you can walk under the big bridge to the piers. ' +
      'The piers have iron ladders on their downstream side, all the way up to the road. — Nino' });
  it.addDocument({ id: 'bridge-column', title: 'Signal: Kampfgruppe Wendt', at: new THREE.Vector3(54, roadH(54) + 0.05, -10.6),
    text: 'To Ponte Alto bridge post: column of five vehicles passes your post at about 15:00, heading west. Barrier up, road clear, no stopping.' });
  mission.papersDoc = { id: 'bridge-papers', title: "Oberleutnant Hahn's papers", reveals: SAFE.id,
    text: `Soldbuch of Oblt. K. Hahn, Pioniere. An engineering diploma from Dresden, folded small. On it, in pencil: ${SAFE.combination}.` };
  mission.documentsTotal = 6;
}

// The bridge falls once both piers are down: the side spans swing down off their abutments,
// the middle drops, the piers crumble. Anyone on the deck goes down with it.
function collapse(m, instant) {
  const w = m.world, site = w.site;
  site.collapsing = true;
  // Its blocks go: the decks, parapets and piers (by the Box3 each mesh was built with).
  const meshes = [...site.spans.flatMap(s => s.colliders), ...site.piers.map(p => p.mesh)];
  for (const mesh of meshes) {
    const bb = new THREE.Box3().setFromObject(mesh);
    const i = w.boxes.findIndex(b2 => b2.equals(bb));
    if (i >= 0) w.boxes.splice(i, 1);
    if (mesh.material.visible === false) { const j = w.raycastTargets.indexOf(mesh); if (j >= 0) w.raycastTargets.splice(j, 1); }
  }
  // Nobody paths across any more.
  const nav = m.ai?.nav;
  if (nav) for (let x = -40; x <= 40; x += 0.5) for (let z = -BW; z <= BW; z += 0.5) { const i = nav.ix(x), j = nav.iz(z); if (nav.inside(i, j)) nav.blocked[j * nav.n + i] = 1; }
  for (const s of w.soldiers) {
    const p = s.root.position;
    if (onBridge(p.x, p.z) && p.y > DECK - 1) { if (s.alive) s.applyHit('torso', { damage: { torso: 999 } }, new THREE.Vector3(0, -1, 0)); s.root.visible = false; }
  }
  for (const v of site.column.vehicles) if (!v.fallen && Math.abs(v.pos.x) < 38 && v.pos.y > DECK - 1) { v.fallen = true; v.fallT = 0; crewDown(v); }
  if (instant) site.fallK = 1;
}

function runBridge(m, dt) {
  const w = m.world, site = w.site;
  const piersDown = w.hotspots.filter(h => h.kind === 'pier' && h.exploded).length;
  if (piersDown === 2 && !site.collapsing) {
    collapse(m, m.obj('bridge').done);
    if (!m.obj('bridge').done) { m.complete('bridge', 'THE BRIDGE IS DOWN'); m.audio.explosion(m.player.pos.distanceTo(new THREE.Vector3(0, 20, 0)), true); }
  }
  if (site.collapsing && (site.fallK ?? 0) < 1) site.fallK = Math.min(1, (site.fallK ?? 0) + dt / 3.5);
  if (site.collapsing) {
    const k = site.fallK, kk = k * k;
    site.spans[0].group.rotation.z = -1.2 * kk; site.spans[0].group.position.y = DECK - 6 * kk;
    site.spans[2].group.rotation.z = 1.2 * kk; site.spans[2].group.position.y = DECK - 6 * kk;
    site.spans[1].group.position.y = DECK - 34 * kk; site.spans[1].group.rotation.x = 0.15 * kk;
    for (const p of site.piers) { p.mesh.scale.y = 1 - 0.75 * k; p.mesh.position.y = 7.5 + (DECK - 7.5) * (1 - 0.75 * k) / 2; }
  }
  // Fallen in the river: you scramble out onto the nearest bank.
  const pp = m.player.pos;
  if (!m.player.dead && pp.y < WATER + 0.5 && Math.abs(pp.x - gx(pp.z)) < 9) pp.set(gx(pp.z) + Math.sign(pp.x - gx(pp.z) || 1) * 11.8, 8, pp.z);
}

function runColumn(m, dt) {
  const w = m.world, c = w.site.column, a = m.audio, collapsed = !!w.site.collapsing;
  const say = (key, text) => { if (!c.said[key]) { c.said[key] = true; m.hud.message(text, ''); } };
  if (c.phase === 'due') {
    if (m.time > T_DUE - 120) say('2min', 'THE ARMOURED COLUMN IS TWO MINUTES AWAY');
    if (m.time < T_DUE) return;
    c.phase = 'moving'; c.v = SPEED; c.visible = true;
    for (const v of c.vehicles) v.model.visible = true;
    say('here', 'THE ARMOURED COLUMN IS COMING DOWN THE ROAD');
  }
  if (c.phase === 'moving') {
    // With the bridge down, the first vehicle still on the east side stops at the rim.
    const first = c.vehicles.find(v => !v.fallen && v.pos.x > 0);
    if (collapsed && first) {
      const stopLead = LEAD_STOP - first.i * GAP, left = c.lead - stopLead;
      if (left <= 0.2) { c.v = 0; c.phase = 'stopped'; say('stopped', 'THE COLUMN HAS STOPPED AT THE GORGE'); }
      else if (c.v * c.v / (2 * left) > 0.5) c.v = Math.max(0.3, c.v - Math.min(4, c.v * c.v / (2 * left)) * dt);
    }
    c.lead -= c.v * dt;
    // Across: the mission is lost.
    const lead = c.vehicles.find(v => !v.fallen);
    if (lead && lead.pos.x < -60) m.fail('THE ARMOURED COLUMN CROSSED THE GORGE');
  }
  c.place(collapsed);
  // Vehicles that went down with the bridge.
  for (const v of c.vehicles) if (v.fallen && v.fallT < 1) {
    v.fallT = Math.min(1, v.fallT + dt / 2.2);
    v.model.position.y = lerp(DECK, 6, v.fallT * v.fallT);
    v.model.rotation.z = 0.9 * v.fallT;
    v.box.min.set(1e6, -1e6, 1e6); v.box.max.copy(v.box.min);
    if (v.fallT === 1 && !v.wrecked) {
      v.wrecked = true;
      wreckInGorge(v);
      m.complete('column', 'A VEHICLE OF THE COLUMN WENT INTO THE GORGE');
    }
  }
  // The rumble of engines and tracks.
  const lead = c.vehicles.find(v => !v.fallen);
  a.setTruck(c.visible && c.v > 0.5 && lead ? Math.max(0, 1 - lead.pos.distanceTo(m.player.pos) / 450) : 0);
}

const def = {
  target: 'Oberleutnant Hahn',
  targetArea: { x: CAMP.x, z: CAMP.z - 10 },
  extraction: START,
  killText: 'HAHN IS DEAD',
  extractText: 'THE BRIDGE IS DOWN AND NOBODY WILL REBUILD IT · GET BACK TO THE HILL',
  papersText: "HAHN'S PAPERS TAKEN",
  objectives: [
    { id: 'bridge', text: 'Blow the bridge before the column crosses (a satchel or TNT at the foot of each pier)' },
    { id: 'officer', text: 'Eliminate Oberleutnant Hahn, the engineer who could repair it' },
    { id: 'pontoons', text: "Destroy the bridging truck at the engineers' camp", optional: true },
    { id: 'column', text: 'Drop a vehicle of the column into the gorge', optional: true },
    { id: 'safe', text: "Take the river survey from Hahn's safe", optional: true },
    { id: 'papers', text: "Take Hahn's papers", optional: true },
    { id: 'extract', text: 'Get back to the hill you came from', hidden: true },
  ],
  tick(m, dt) {
    runBridge(m, dt);
    runColumn(m, dt);
    if (!m.obj('pontoons').done && m.world.hotspots.some(h => h.title === 'BRIDGING TRUCK ENGINE' && h.exploded)) m.complete('pontoons', 'THE BRIDGING EQUIPMENT IS DESTROYED');
  },
  markers(m) {
    const out = [];
    if (!m.obj('bridge').done) for (const h of m.world.hotspots) if (h.kind === 'pier' && !h.exploded) out.push({ pos: h.center().setY(10), kind: 'tank', label: h.title, height: 1 });
    const c = m.world.site.column, lead = c.vehicles.find(v => !v.fallen);
    if (c.visible && lead && c.phase === 'moving') out.push({ pos: lead.pos.clone().setY(lead.pos.y + 4), kind: 'tank', label: 'COLUMN', height: 1 });
    return out;
  },
  save(m) {
    const c = m.world.site.column;
    return { lead: c.lead, v: c.v, phase: c.phase, said: { ...c.said }, fallen: c.vehicles.map(v => v.fallen) };
  },
  load(m, d) {
    const c = m.world.site.column;
    Object.assign(c, { lead: d.lead, v: d.v, phase: d.phase, said: d.said ?? {} });
    c.visible = c.phase !== 'due';
    c.vehicles.forEach((v, i) => { v.model.visible = c.visible; if (d.fallen?.[i]) { v.fallen = true; v.fallT = 0.999; crewDown(v); } });
  },
};

const briefing = `
  <p class="brief">Ponte Alto, on the Serchio. An armoured column, two Panzers and three lorries, is coming from the east this
    afternoon to cross the gorge by the old stone bridge. It will be in sight in about seven minutes. The engineer who looks after the
    bridge, Oberleutnant Hahn, camps with his company on the west side.</p>
  <ul class="goals">
    <li><b>Blow the bridge before the column crosses.</b> It stands on two stone piers: put a satchel or TNT at the foot of each
      (bullets and rockets won't do it). The piers stand on the river banks, at the bottom of the gorge.</li>
    <li><b>Eliminate Oberleutnant Hahn</b>, or he will have the river bridged again by morning.</li>
    <li><b>Optional:</b> destroy his bridging truck and pontoons; drop a vehicle of the column into the gorge (blow the bridge under it);
      take the river survey from his safe (the combination is written down somewhere, and Hahn carries it); take his papers.</li>
    <li><b>Then</b> get back to the hill you started from, where green smoke marks the pick-up.</li>
  </ul>
  <p class="brief">You can't climb the gorge's cliffs or swim the river. Ways down: the ladders on the piers, from the bridge (guarded at both ends),
    or the gullies, one on each side, where the cliff eases. A footbridge crosses the river downstream. If the column's lead vehicle gets across,
    the mission is lost.</p>`;

export default { id: 'bridge', props: ['stoneBridge', 'tiger', 'halftrack', 'wreckTiger', 'wreckPanzer', 'wreckHalftrack', 'tent', 'pontoons', 'sentryBox', 'mgNest', 'watchtower', 'generator', 'motorcycle', 'pak40', 'searchlight', 'sandbags', 'kitchen', 'supplies', 'drums', 'barrels', 'wire', 'pole', 'signpost', 'pontoonSection', 'assaultBoat', 'rock'], subtitle: 'Operation Broken Span · Serchio valley, 1944', map, site, def, intel, briefing };
