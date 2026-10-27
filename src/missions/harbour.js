// Operation Low Tide: a harbour on the Ligurian coast. A supply ship is taking on fuel for the
// U-boats at the quay. Sink it, blow up the fuel depot, and (if you can) take the convoy
// schedule from the harbourmaster's safe; the port's naval commander walks the quay.
//
// 1 km map: the sea to the north (the water stops at the quay wall: no swimming), the fenced
// docks along the shore (quay, cranes, warehouses, the harbourmaster's office, the fuel depot,
// a railway siding), a breakwater (the mole) enclosing the basin with a flak gun and a light at
// its end, and hills to the south where you start.
import * as THREE from 'three';
import { fbm, lerp, smoothstep, makeRng } from '../world/noise.js';
import { M, Builder } from '../world/kit.js';
import { building, furniture, ladder } from '../world/buildings.js';
import { Soldier } from '../world/soldier.js';
import { vehicleModel } from '../world/vehicle-models.js';
import { hasProp, propModel, dressProps, shootableMeshes } from '../world/props.js';

const Q = 2.5;                                 // the quay's height above the water (water at 0)
const START = { x: 330, z: 320 };              // the hill you start from
const DX = 238, DZ0 = -40, DZ1 = 78;           // the docks: x −238…238, z from the quay edge to the fence
const SHIP = { x: -60, z: -46.5, len: 72, beam: 11, deck: Q + 1.5 };

const shoreZ = (x) => {
  const ax = Math.abs(x);
  return -40 - 40 * smoothstep(240, 450, ax) + (fbm(x * 0.01 + 5, 1.3, 2) - 0.5) * 14 * smoothstep(240, 300, ax);
};
const inMole = (x, z) => (Math.abs(x - 225) < 5 && z > -238 && z < -38) || (Math.abs(z + 233) < 5 && x > 88 && x < 230);
function land(x, z) {
  let h = Q + Math.max(0, z - 80) * 0.11 + (fbm(x * 0.004 + 7, z * 0.004 - 3, 4) - 0.5) * 30 * smoothstep(60, 220, z);
  h += 24 * Math.exp(-((x - START.x) ** 2 + (z - START.z) ** 2) / (2 * 70 * 70));
  const r = Math.max(Math.abs(x), z);
  if (r > 390) { const t = (r - 390) / 110; h += t * t * (30 + 40 * fbm(x * 0.006 + 1.1, z * 0.006, 3)); }
  return h;
}
function heightAt(x, z) {
  if (inMole(x, z)) return Q;
  const sz = shoreZ(x), seabed = -7 - Math.min(9, Math.max(0, sz - z) * 0.03);
  if (Math.abs(x) <= DX) {
    if (z < DZ0) return seabed;
    return lerp(Q, land(x, z), smoothstep(0, 30, z - DZ1));
  }
  const l = lerp(Q, land(x, z), smoothstep(0, 30, Math.abs(x) - DX));
  return lerp(seabed, Math.max(l, 0.8), smoothstep(sz - 18, sz + 8, z));   // a beach beyond the docks
}
const roadZ = (x) => 40 + Math.sin(x * 0.012) * 14 * smoothstep(-260, -330, x);

const map = {
  // Evening over the sea: the sun low in the west, orange light on the quay.
  light: { zenith: 76, azimuth: 285, sun: 0xffa868, sunIntensity: 2.4, turbidity: 8, rayleigh: 2.4, clouds: 0.45, hemiSky: 0xc8b8b0, hemiGround: 0x5a4a3a, exposure: 0.95 },
  fog: { color: 0xd3c0b6 },   // the haze takes the colour of this sky low on the horizon (and so does the far country's)
  half: 500, playHalf: 470, focus: { x: 0, z: 0, r: 160 }, start: START, navHalf: 262, waterLevel: 0,
  heightAt,
  roadCenterZ: (x) => (x < -DX ? roadZ(x) : NaN),
  keepClear(x, z, margin = 0) {
    if (Math.abs(x) < DX + 6 + margin && z < DZ1 + 6 + margin) return true;
    if (inMole(x, z) || heightAt(x, z) < 1.5) return true;
    if (x < -DX && Math.abs(z - roadZ(x)) < 5 + margin) return true;
    return Math.hypot(x - START.x, z - START.z) < 12 + margin;
  },
  paint(c, x, z, { road, rock, dirt }) {
    const docks = Math.abs(x) <= DX && z >= DZ0 - 1 && z <= DZ1;
    if (docks || inMole(x, z)) c.lerp(rock, 0.85);                         // concrete and stone
    else if (heightAt(x, z) < 1.6) c.lerp(dirt, 0.7).lerp(new THREE.Color(0xc8b48a), 0.5);   // sand
    if (x < -DX) c.lerp(road, 1 - smoothstep(2, 3.5, Math.abs(z - roadZ(x))));
  },
  truck: { from: -600, stop: -252 },
  reinforceHome: [-200, 30],
  flee: [0, 60],
  routes: {
    Kapitän: [[-3, 24, 18], [0, 17], [-50, -34, 15], [60, -34, 10], [0, -34], [0, 17]],
    'Quay patrol': [[-200, -34], [200, -34, 8], [-200, -34, 8]],
    'Dock patrol': [[-200, 9], [100, 9, 6], [-200, 9, 6]],
    'Depot patrol': [[112, -6], [168, -6], [168, 46, 5], [112, 46], [112, -6, 5]],
    'Back patrol': [[-210, 52], [80, 52, 8], [-210, 52, 8]],
  },
  pickups: layout,
};

// ---- the harbour ----
function site(scene) {
  const b = new Builder(scene);
  const y = Q;
  const ladders = [], doors = [], soldiers = [], hotspotDefs = [];
  const rng = makeRng(1944);
  const add = (x, z, yaw, opts) => {
    const s = new Soldier({ position: new THREE.Vector3(x, opts.y ?? y, z), yaw, ...opts });
    scene.add(s.root);
    soldiers.push(s);
    return s;
  };
  const steel = new THREE.MeshStandardMaterial({ color: 0x5a5f5c, roughness: 0.6, metalness: 0.5 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x6e4a33, roughness: 0.85, metalness: 0.2 });
  const hidden = new THREE.MeshBasicMaterial({ visible: false });

  // The quay wall and the mole's sides (stone down into the water).
  b.box(DX * 2, Q + 8, 0.8, M.stone, 0, -8, DZ0 - 0.4);
  b.box(10.4, Q + 8, 0.6, M.stone, 225, -8, -238.3);                               // the mole's end
  for (const s of [-1, 1]) b.box(0.6, Q + 8, 196, M.stone, 225 + s * 5.2, -8, -140);
  for (const s of [-1, 1]) b.box(140, Q + 8, 0.6, M.stone, 159, -8, -233 + s * 5.2);
  // Bollards along the quay edge.
  for (let x = -230; x <= 230; x += 12) b.box(0.45, 0.6, 0.45, steel, x, y, DZ0 + 0.8, { solid: false });
  // Railway along the quay, with two goods wagons.
  for (const z of [DZ0 + 5.3, DZ0 + 6.7]) b.box(DX * 2 - 6, 0.12, 0.08, steel, 0, y, z, { solid: false });
  for (const wx of [-170, 110]) { b.box(10, 2.6, 2.8, rust, wx, y + 0.8, DZ0 + 6); b.box(10, 0.8, 2.2, steel, wx, y, DZ0 + 6, { solid: false }); }

  // The fence round the docks: a gate on the road (west), two cut holes on the south side.
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x2c2f2c, roughness: 0.8, metalness: 0.4, transparent: true, opacity: 0.55 });
  const fence = (x0, z0, x1, z1) => {
    const w = Math.max(0.08, Math.abs(x1 - x0)), d = Math.max(0.08, Math.abs(z1 - z0)), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const m = b.box(w, 2.6, d, fenceMat, cx, y, cz, { solid: false });
    m.updateMatrixWorld(true);
    b.boxes.push(new THREE.Box3().setFromObject(m));               // it stops you, not bullets
    for (let t = 0; t <= 1.0001; t += 3 / Math.max(w, d)) b.box(0.1, 2.8, 0.1, steel, lerp(x0, x1, t), y, lerp(z0, z1, t), { solid: false });
  };
  fence(-DX, DZ0, -DX, 34); fence(-DX, 46, -DX, DZ1);               // west, the gate at z 34…46
  fence(-DX, DZ1, -152, DZ1); fence(-148, DZ1, 98, DZ1); fence(102, DZ1, DX, DZ1);   // south, holes at x −152 and 98
  fence(DX, DZ0, DX, DZ1);
  b.box(3, 2.6, 3, M.wood, -228, y, 52);                            // the gate hut
  b.box(0.15, 1.1, 11, M.shutter, -DX, y, 40, { solid: false });   // the barrier (raised)

  // Warehouses: two you can walk into (crates inside), three shut.
  const walkIns = [];
  for (const [wx, open] of [[-190, false], [-140, true], [-90, false], [-40, true], [50, false]]) {
    const wz = 30;
    if (open) {
      const wh = building(b, { x: wx, z: wz, y, w: 34, d: 16, floors: 1, h: 7, mat: M.plaster2, roof: 'gable',
        openings: [{ side: 'n', at: -6, w: 4, h: 4.5 }, { side: 's', at: 10, w: 1.2, door: true },
          ...[-12, 12].map(at => ({ side: 'n', at, w: 1.4, h: 1.0, sill: 4.8, window: true })),
          ...[-12, 0].map(at => ({ side: 's', at, w: 1.4, h: 1.0, sill: 4.8, window: true }))] });
      doors.push(...wh.doors);
      for (let i = 0; i < 6; i++) furniture.crates(b, wx - 13 + i * 5, y, wz - 2 + (i % 2) * 5, 3 + (i % 2));
      walkIns.push({ x: wx, z: wz });
    } else {
      b.box(34, 7, 16, M.plaster2, wx, y, wz);
      b.gable(34, 3, 16, M.roof, wx, y + 7, wz);
      b.box(4, 4.5, 0.1, M.darkWood, wx - 6, y, wz - 8.06, { solid: false });
    }
  }
  // Crates and drums on the quay for cover.
  for (let i = 0; i < 18; i++) {
    const x = -220 + rng() * 440, z = DZ0 + 10 + rng() * 6;
    if (Math.abs(x - 110) < 8 || Math.abs(x + 170) < 8) continue;
    if (rng() < 0.5) b.box(1.2, 1.2, 1.2, M.crate, x, y, z);
    else for (let k = 0; k < 3; k++) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12), rust); d.position.set(x + k * 0.65, y + 0.45, z); d.castShadow = true; b.group.add(d); b.addSolid(d); }
  }

  // The harbourmaster's office: ground floor office and a hall with the stairs; upstairs his
  // office (the safe) and the map room.
  const [ox, oz] = [0, 25];
  const office = building(b, { x: ox, z: oz, y, w: 16, d: 10, floors: 2, h: 3.2, mat: M.plaster, roof: 'flat',
    openings: [
      { side: 'n', at: 0, w: 1.4, door: true }, { side: 's', at: -5, w: 1.1, door: true },
      ...[-5, 5].map(at => ({ side: 'n', at, w: 1.1, window: true })),
      ...[-5, 0, 5].map(at => ({ side: 'n', at, w: 1.1, window: true, floor: 1 })),
      ...[0, 5].map(at => ({ side: 's', at, w: 1.1, window: true })),
      ...[-5, 5].map(at => ({ side: 's', at, w: 1.1, window: true, floor: 1 })),
      { side: 'w', at: 0, w: 1.1, window: true, floor: 1 }, { side: 'e', at: 0, w: 1.1, window: true, floor: 1 },
    ],
    stairs: { at: [5.5, 3.2], dir: 'n', w: 0.9 },
    walls: [0, 1].map(f => ({ axis: 'z', at: -1.5, from: -4.85, to: 4.85, floor: f, openings: [{ at: 2.5, w: 1.0, door: true }] })),
  });
  doors.push(...office.doors);
  const up = y + 3.2;
  furniture.desk(b, ox - 5, y, oz + 1);
  furniture.cabinet(b, ox - 7.4, y, oz - 3, 0.45, 1.4);
  furniture.desk(b, ox - 4.5, up, oz + 1.5);
  furniture.table(b, ox + 3.5, up, oz + 1, 2.4, 1.4);               // the map table
  office.safe = { at: new THREE.Vector3(ox - 7.3, up, oz - 3.9), yaw: Math.PI / 2 };
  office.docs = {
    ledger: new THREE.Vector3(ox - 5.1, y + 0.79, oz + 0.9),
    desk: new THREE.Vector3(ox - 4.6, up + 0.79, oz + 1.4),
    maps: new THREE.Vector3(ox + 3.2, up + 0.79, oz + 1.2),
  };

  // Three gantry cranes on the quay; you can climb the one at x −20 (a sniper sits on another).
  // (With the modelled crane, a portal crane with its cab ~14 m up and the jib out over the water,
  // the blocks below stay for climbing and standing on, undrawn.)
  const modelled = hasProp('crane');
  const crane = (cx, climb) => {
    const [cr, cs] = modelled ? [hidden, hidden] : [rust, steel];
    for (const lx of [-3, 3]) for (const lz of [DZ0 + 2, DZ0 + 10]) b.box(0.6, 14, 0.6, cr, cx + lx, y, lz);
    const top = y + 14;
    b.box(8, 0.4, 20, cr, cx, top, DZ0 + 2);                       // the bridge, out over the water
    b.box(3, 2.6, 3, cs, cx, top + 0.4, DZ0 + 4);                  // the cab
    if (modelled) {
      const H = 26.5, m = propModel('crane', { y: H });          // its portal top at ~0.53 H; the legs sit 5.9/24 H toward +z
      m.position.set(cx, y, DZ0 + 6 - 5.88 * H / 24);
      b.group.add(m);
      b.solids.push(...shootableMeshes(m));                      // its deck, cab and girders stop sight and bullets
    } else {
      b.box(0.3, 0.9, 20, steel, cx - 3.9, top + 0.4, DZ0 + 2, { solid: false });
      b.box(0.3, 0.9, 20, steel, cx + 3.9, top + 0.4, DZ0 + 2, { solid: false });
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 9, 4), steel); hook.position.set(cx, top - 4.5, DZ0 - 6); b.group.add(hook);
    }
    if (climb) ladders.push(ladder(b, { x: cx + 3, z: DZ0 + 10 + 0.35, y, top: top + 0.4, face: 's' }));
    return new THREE.Vector3(cx, top + 0.4, DZ0 + 6);
  };
  crane(-140, false);
  const climbable = crane(-20, true);
  const sniperCrane = crane(100, false);

  // The fuel depot: four tanks behind a fence and sandbags. Shoot a tank enough and it goes up,
  // and takes the others with it.
  const fuelTanks = [];
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x8b8f86, roughness: 0.55, metalness: 0.4 });
  for (const [tx, tz] of [[130, 8], [150, 8], [130, 30], [150, 30]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 9, 28), tankMat);
    t.position.set(tx, y + 4.5, tz);
    t.castShadow = t.receiveShadow = true;
    b.group.add(t);
    b.addSolid(t);
    const parts = [t];
    const model = propModel('fuelTank', { x: 11.2, y: 9.6, z: 11.2 }, { stretch: true, own: true });
    if (model) {                                                     // the modelled tank over the shooting cylinder
      t.material = hidden;
      model.position.set(tx, y, tz); model.rotation.y = (tx + tz) * 0.7; b.group.add(model);
      parts.push(...model.userData.meshes);
    } else {
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x6f736b, roughness: 0.6, metalness: 0.5 });
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.3, 0.25, 28), ringMat); ring.position.set(tx, y + 9, tz); b.group.add(ring);
    }
    fuelTanks.push(t);
    hotspotDefs.push({ kind: 'fuel', title: 'FUEL TANK', explosive: true, hitsToExplode: 3, meshes: [t], parts,
      blast: { radius: 11, hurt: 18, size: 2.6, burn: true, chain: 24, label: 'FUEL TANK' } });
  }
  for (const [x0, z0, x1, z1] of [[118, -4, 162, -4], [118, 42, 162, 42], [118, -4, 118, 16], [118, 22, 118, 42], [162, -4, 162, 42]]) fence(x0, z0, x1, z1);
  b.box(4, 2.8, 3.5, M.plaster, 140, y, 19);                       // the pump house

  // The flak gun on the mole, in a ring of sandbags; a light at the end.
  const fg = { x: 225, z: -150 };
  for (let a = 0; a < 8; a++) { const ang = a / 8 * Math.PI * 2; if (a === 6) continue; b.box(1.6, 0.9, 0.6, M.sandbag, fg.x + Math.cos(ang) * 3.2, y, fg.z + Math.sin(ang) * 3.2, { rotY: -ang }); }
  const flakModel = propModel('flak', { y: 2.9 }, { own: true });
  b.box(1.4, 1.0, 1.4, flakModel ? hidden : steel, fg.x, y, fg.z);
  const breech = b.box(0.8, 0.7, 1.2, flakModel ? hidden : steel, fg.x, y + 1.0, fg.z);
  const flakParts = [];
  if (flakModel) { flakModel.position.set(fg.x, y, fg.z); flakModel.rotation.y = Math.PI / 2; b.group.add(flakModel); flakParts.push(...flakModel.userData.meshes); }
  else {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.2, 8), steel);
    barrel.position.set(fg.x, y + 2.3, fg.z - 1.1); barrel.rotation.x = -0.9; b.group.add(barrel);
    flakParts.push(barrel);
  }
  hotspotDefs.push({ kind: 'engine', title: 'FLAK GUN', explosive: true, hitsToExplode: 2, meshes: [breech], parts: flakParts });
  b.box(2.4, 9, 2.4, M.plaster, 225, y, -232);                      // the harbour light
  b.box(2.8, 1.6, 2.8, M.window, 225, y + 9, -232);

  // An E-boat tied up inside the mole (it rides on the water: nobody walks on it).
  const eboat = propModel('eboat', { x: 32.7, z: 5.1 }, { stretch: true });
  if (eboat) { eboat.position.set(214, -0.9, -120); eboat.rotation.y = Math.PI / 2; b.group.add(eboat); }
  else { const e = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 30), steel); e.position.set(215, 0.6, -120); e.castShadow = true; b.group.add(e);
    const br = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 5), steel); br.position.set(215, 2.4, -116); b.group.add(br); }

  // ---- the supply ship ----
  const ship = buildShip(scene, steel, rust, hidden);
  b.solids.push(...ship.solids); b.boxes.push(...ship.boxes);
  // The gangway from the quay up to the deck.
  for (const [i, top] of [[0, y + 0.5], [1, y + 1.0]]) b.box(1.4, top - y + 0.6, 0.6, M.wood, SHIP.x + 18, y - 0.6, DZ0 - 0.3 - i * 0.6);
  hotspotDefs.push({ kind: 'ship', title: 'SUPPLY SHIP', explosive: true, armored: true, hitsToExplode: 2, meshes: [ship.hatch], parts: ship.parts,
    blast: { radius: 9, size: 2.4, burn: true, label: 'SUPPLY SHIP HIT' } });

  // A truck by the warehouses.
  const tr = vehicleModel('truck');
  tr.position.set(-110, y, 12); tr.rotation.y = Math.PI / 2; b.group.add(tr);
  b.box(3.6, 2.4, 2.3, hidden, -111.2, y + 0.35, 12); b.box(1.2, 2.0, 2.1, hidden, -108.8, y + 0.35, 12);
  const truckEngine = b.box(1.2, 1.25, 1.8, hidden, -107.6, y + 0.5, 12);

  // The alarm siren by the office.
  const [sx, sz] = [12, 14];
  b.box(0.2, 5.2, 0.2, M.wood, sx, y, sz);
  const junction = b.box(0.36, 0.46, 0.2, M.metal, sx, y + 1.0, sz + 0.2, { solid: false });
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.12, 0.55, 14, 1, true).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a8d84, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
  horn.position.set(sx + 0.25, y + 5.0, sz);
  const hornBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.35, 12).rotateZ(Math.PI / 2), M.metal);
  hornBody.position.set(sx - 0.05, y + 5.0, sz);
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.8, 5), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }));
  wire.position.set(sx + 0.12, y + 3.1, sz + 0.12);
  for (const m of [horn, hornBody, wire]) { m.castShadow = true; b.group.add(m); }
  const siren = { pos: new THREE.Vector3(sx, y, sz), junction: junction.position.clone(), horn: horn.position.clone(), hornMeshes: [horn, hornBody], wire, standAt: new THREE.Vector3(sx, y, sz + 0.9) };

  // The garrison.
  add(-3, 24, Math.PI, { officer: true, name: 'Kapitän', look: 'officerColonel' });
  add(1, 18, Math.PI, { name: 'Office guard', stance: 'alert', look: 'guardSergeant' });
  add(-200, -34, Math.PI / 2, { name: 'Quay patrol', look: 'guardSailor' });
  add(-200, 9, Math.PI / 2, { name: 'Dock patrol', look: 'guardCamo' });
  add(112, -6, 0, { name: 'Depot patrol', stance: 'alert' });
  add(140, -7, Math.PI, { name: 'Depot guard', stance: 'alert', look: 'guardSergeant' });
  add(-210, 52, Math.PI / 2, { name: 'Back patrol', look: 'guardSailor' });
  add(-231, 37, -Math.PI / 2, { name: 'Gate guard', stance: 'alert' });
  add(-231, 43, -Math.PI / 2, { name: 'Gate guard', stance: 'alert' });
  add(SHIP.x + 10, SHIP.z + 2, Math.PI / 2, { y: SHIP.deck, name: 'Deck watch', stance: 'alert', look: 'guardSailor' });
  add(SHIP.x - 22, SHIP.z - 2, -Math.PI / 2, { y: SHIP.deck, name: 'Deck watch', look: 'guardCamo' });
  add(sniperCrane.x + 1, sniperCrane.z + 2, Math.PI * 0.8, { y: sniperCrane.y, name: 'Crane sniper', stance: 'alert', look: 'guardCamo' });
  add(fg.x - 1.5, fg.z + 1.5, 0, { name: 'Flak crew', look: 'guardSergeant' });
  add(fg.x + 1.5, fg.z - 1, Math.PI, { name: 'Flak crew', look: 'guardSailor' });
  add(225, -226, 0, { name: 'Mole sentry', stance: 'alert', look: 'guardSailor' });

  const dressed = dressProps(scene, dressing(), heightAt, b.boxes, vehicleModel);
  b.solids.push(...dressed.solids); b.boxes.push(...dressed.boxes);

  return {
    solids: b.solids, boxes: b.boxes, soldiers, ladders, doors, siren,
    spawn: new THREE.Vector3(START.x, heightAt(START.x, START.z), START.z),
    vehicles: [{ title: 'TRUCK ENGINE', engine: truckEngine, parts: [tr.userData.mesh] }],
    hotspotDefs, office, walkIns, ship, fuelTanks, climbable, towerTops: [climbable],
  };
}

// A cargo ship moored along the quay, bow east: hull, deck, bridge, funnel, masts and hatches.
// Its collision blocks are kept so they can go when it sinks. `hatch`: the engine-room skylight
// aft of the bridge (plant a satchel there; or two anti-tank hits anywhere on the hull).
function buildShip(scene, steel, rust, hidden) {
  const sb = new Builder(scene);
  const { x, z, len, beam, deck } = SHIP, hullMat = new THREE.MeshStandardMaterial({ color: 0x3b4144, roughness: 0.7, metalness: 0.3 });
  const shape = new THREE.Shape();
  const L = len / 2, B = beam / 2;
  shape.moveTo(-L, -B + 1); shape.quadraticCurveTo(-L, -B, -L + 2, -B);
  shape.lineTo(L - 10, -B); shape.quadraticCurveTo(L - 2, -B + 0.5, L, 0); shape.quadraticCurveTo(L - 2, B - 0.5, L - 10, B);
  shape.lineTo(-L + 2, B); shape.quadraticCurveTo(-L, B, -L, B - 1); shape.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: deck + 4, bevelEnabled: false });
  hullGeo.rotateX(-Math.PI / 2);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.set(x, -4, z);
  hull.castShadow = hull.receiveShadow = true;
  sb.group.add(hull);
  // A red band at the waterline and the deck planking.
  const band = new THREE.Mesh(hullGeo.clone(), new THREE.MeshStandardMaterial({ color: 0x7a2a22, roughness: 0.8 }));
  band.scale.set(1.002, 0.55, 1.002); band.position.set(x, -4.1, z); sb.group.add(band);
  const solidBox = (w, h, d, mat, bx, by, bz) => sb.box(w, h, d, mat, bx, by, bz);
  const decks = [
    solidBox(len - 12, deck + 4, beam - 0.2, hidden, x - 4, -4, z),                  // the deck you walk on
    solidBox(9, deck + 4, beam - 4, hidden, x + L - 7.5, -4, z),                    // toward the bow
  ];
  sb.box(len - 12, 0.06, beam - 0.6, M.wood, x - 4, deck, z, { solid: false });
  // The bridge and funnel, aft of midships.
  const bridge = sb.box(10, 6, 8, new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8 }), x - 18, deck, z);
  sb.box(10.2, 0.9, 8.2, M.window, x - 18, deck + 4.4, z, { solid: false });
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 6, 16), rust);
  funnel.position.set(x - 24, deck + 6 + 3, z); funnel.castShadow = true; sb.group.add(funnel);
  // Masts with derricks, cargo hatches, a lifeboat each side.
  for (const mx of [x + 2, x + 22]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 14, 8), steel); mast.position.set(mx, deck + 7, z); mast.castShadow = true; sb.group.add(mast);
    sb.box(0.2, 0.2, 7, steel, mx, deck + 11, z, { solid: false });
  }
  for (const hx of [x - 4, x + 12, x + 26]) sb.box(6, 1.0, 6, steel, hx, deck, z);
  for (const s of [-1, 1]) sb.box(6, 1.0, 1.6, new THREE.MeshStandardMaterial({ color: 0xe5e1d6 }), x - 18, deck + 3.2, z + s * (B - 0.3), { solid: false });
  // The engine-room skylight aft of the funnel.
  const hatch = sb.box(2.2, 0.7, 2.2, steel, x - 29, deck, z);
  const parts = sb.group.children.filter(o => o.isMesh);
  // The modelled steamer, bow east, over the blocks (which stay for the deck you walk on and the
  // shots); the engine-room skylight stays as it is, the satchel's mark.
  const model = propModel('ship', { x: len + 2, z: beam }, { stretch: true, own: true, turn: 2 });
  if (model) {
    for (const o of parts) if (o !== hatch) o.material = hidden;
    model.position.set(x, -3.2, z);
    sb.group.add(model);
    parts.push(...model.userData.meshes);
    // The blocks for the bridge, hatches, funnel and masts don't sit where the model has them (its
    // bridge is ~9 m further forward, it has no raised hatches): a guard there stood inside an
    // unseen wall, bullet-proof. So the model's own meshes take the shots; of the blocks only the
    // decks and the skylight stay, and you walk into its superstructure, funnel and masts.
    const keep = sb.solids.map((o, i) => (decks.includes(o) || o === hatch ? i : -1)).filter(i => i >= 0);
    const boxes = keep.map(i => sb.boxes[i]);
    sb.solids.splice(0, sb.solids.length, ...keep.map(i => sb.solids[i]), ...shootableMeshes(model));
    const block = (x0, x1, z0, z1, h) => boxes.push(new THREE.Box3(new THREE.Vector3(x + x0, deck, z + z0), new THREE.Vector3(x + x1, deck + h, z + z1)));
    block(-13, -3, -B + 0.5, B - 0.5, 3.5);                                         // the bridge house
    block(-25, -23, -2, 2, 9);                                                       // the funnel
    block(19, 21, -1.5, 1.5, 9);                                                     // the foremast
    sb.boxes.splice(0, sb.boxes.length, ...boxes);
  }
  return { group: sb.group, solids: sb.solids, boxes: sb.boxes, hatch, parts, bridge, sinking: false, sunk: 0 };
}

// Set dressing: fishing boats and beach obstacles beyond the docks, sentry boxes and sandbags at
// the gate, the coast road's poles, a bowser at the depot, stores along the quay, the mole's guns.
function dressing() {
  const poles = [-280, -320, -360, -400, -440].map(x => ['pole', x, roadZ(x) + 6]);
  return [
    ...poles, ['signpost', -256, 49, 0.3],
    ['fishingBoat', -290, shoreZ(-290) + 9, 0.3], ['fishingBoat', -312, shoreZ(-312) + 10, -0.2], ['fishingBoat', 300, shoreZ(300) + 9, 2.8],
    ['hedgehog', -340, shoreZ(-340) + 3, 0.5], ['hedgehog', -370, shoreZ(-370) + 2, 1.2], ['hedgehog', 330, shoreZ(330) + 3, 0.2], ['hedgehog', 360, shoreZ(360) + 2, 2],
    ['sentryBox', -244, 31, Math.PI / 2], ['sentryBox', -244, 50, Math.PI / 2], ['sandbags', -232, 30, 0], ['sandbags', -232, 50, 0],
    ['bowser', 140, -0.5, 0], ['truck', -60, 47, Math.PI / 2], ['car', -12, 38, 0], ['motorcycle', 14, 36, 0.4], ['kitchen', -120, 50, 0],
    ['supplies', 60, -26], ['supplies', -80, -26, 0.4], ['supplies', 180, -27], ['drums', -20, -27], ['barrels', -150, 50, Math.PI / 2],
    ['tobruk', 225, -190], ['searchlight', 222, -205], ['mgNest', 225, -215],
    ['rowboat', -330, shoreZ(-330) + 4, 0.3], ['rowboat', -352, shoreZ(-352) + 5, -0.4], ['cargoPallet', 40, -26], ['cargoPallet', -100, -26, 0.5],
    ['cargoPallet', 150, -27, 1], ['fiat', -30, 42, 0.3],
  ];
}

// ---- what's to be found ----
function layout({ world, on }) {
  const sp = world.spawn;
  const boxes = [
    { kind: 'parts', where: 'by the gate hut', at: on(-224, 56) },
    { kind: 'parts', where: 'behind the office', at: on(-4, 33) },
    { kind: 'parts', where: 'the pump house', at: on(140, 15.5) },
    { kind: 'parts', where: 'the mole', at: on(225, -100) },
    { kind: 'weapon', weapon: 'panzerschreck', where: 'a warehouse', at: on(-140, 33) },
  ];
  for (const [type, x, z] of [
    ['ammo', -150, -28], ['medical', 30, -28], ['explosives', -40, 34], ['ammo', 80, 12], ['heavy', -135, 36],
    ['bottles', -60, 12], ['explosives', 170, 60], ['ammo', -200, 60], ['medical', 220, -60], ['heavy', 60, 60],
    ['ammo', sp.x + 6, sp.z + 3], ['medical', sp.x + 4, sp.z - 6], ['explosives', 200, 180], ['ammo', 60, 160],
  ]) boxes.push({ kind: 'supply', type, where: type, at: on(x, z) });
  const benches = [{ where: 'start', at: on(sp.x + 2.5, sp.z - 4) }, { where: 'a warehouse', at: on(-44, 33) }];
  return { boxes, benches };
}

// ---- documents, the safe, the objectives ----
const SAFE = { id: 'harbour-safe', name: "THE HARBOURMASTER'S SAFE", combination: '05 – 21 – 44' };

function intel(it, world, { pickups, arsenal, mission, hotspots }) {
  const o = world.site.office;
  it.addSafe({ ...SAFE, at: o.safe.at, yaw: o.safe.yaw, objective: 'safe', objectiveText: 'THE CONVOY SCHEDULE TAKEN',
    docs: [{ id: 'harbour-schedule', title: 'Convoy schedule, U-boat supply',
      text: 'Kriegsmarine, Hafenkommandant.\n\nSupply ship "Elbe" to sail on the 14th, 02:00, escorted by two E-boats, for the U-boat pens at La Spezia. ' +
        'Cargo: 1,400 tonnes of diesel, torpedoes, provisions.\nNext sailings: the 21st, the 28th. Route and call signs attached.' }],
    contents: () => { const got = []; const part = pickups?.givePart?.(); if (part) got.push(`part: ${part.name}`); if (arsenal) { arsenal.weapons.rifle.ammo.ap += 4; got.push('+4 AP rounds'); } return got; } });
  it.addDocument({ id: 'harbour-combination', title: 'A note on the map table', at: o.docs.maps, reveals: SAFE.id,
    text: `Kapitän — the new safe combination, as you asked: ${SAFE.combination}.\nI have told no one else. — Obermaat Kühn` });
  it.addDocument({ id: 'harbour-ledger', title: 'Fuel ledger', at: o.docs.ledger,
    text: 'Depot stock: 4 tanks, 2,100 tonnes. Transfer to the "Elbe" through the night pipe: 1,400 tonnes.\nThe pump crew asks again for a fire watch: one spark and the whole quay goes.' });
  it.addDocument({ id: 'harbour-orders', title: 'Orders from La Spezia', at: o.docs.desk,
    text: 'The "Elbe" is not to sail until fully loaded. Double the watch on deck. The flak gun on the mole is to be manned day and night: enemy aircraft were over the coast twice this week.' });
  it.addDocument({ id: 'harbour-letter', title: 'A docker\'s letter', at: (() => { const w = world.site.walkIns[0], x = w.x + 9, z = w.z + 5; return new THREE.Vector3(x, world.floorAt(x, z, Q + 0.5), z); })(),   // by the back door
    text: 'They make us load the ship at night now, Giulia. The Germans have a sniper up on the far crane, the one by the fuel tanks: he watches the gate road and the south fence. ' +
      'Kühn says the hole in the fence by the tanks was cut by the boys from the hills. I said nothing.' });
  it.addDocument({ id: 'harbour-manifest', title: "The ship's manifest", at: new THREE.Vector3(SHIP.x - 4, SHIP.deck + 1.05, SHIP.z),
    text: 'SS "Elbe", 3,200 tons. Engine room aft, beneath the skylight behind the funnel. Fuel: loading.\n\nCrew 31, deck guard of 4 (2 on watch).' });
  mission.papersDoc = { id: 'harbour-papers', title: "Kapitän Lenz's papers", reveals: SAFE.id,
    text: `Soldbuch of Korvettenkapitän H. Lenz. A photograph of a U-boat crew. On the back, in his hand: ${SAFE.combination}.` };
  mission.documentsTotal = 7;
}

const def = {
  target: 'Korvettenkapitän Lenz',
  targetArea: { x: 0, z: 20 },
  extraction: START,
  killText: 'LENZ IS DEAD',
  extractText: 'THE SHIP IS GOING DOWN AND THE DEPOT IS BURNING · GET BACK TO THE HILL',
  papersText: "LENZ'S PAPERS TAKEN",
  objectives: [
    { id: 'ship', text: 'Sink the supply ship (a satchel on its engine-room skylight, or two anti-tank hits)' },
    { id: 'depot', text: 'Blow up the fuel depot' },
    { id: 'officer', text: 'Eliminate Korvettenkapitän Lenz', optional: true },
    { id: 'safe', text: "Take the convoy schedule from the harbourmaster's safe", optional: true },
    { id: 'flak', text: 'Destroy the flak gun on the mole', optional: true },
    { id: 'papers', text: "Take Lenz's papers", optional: true },
    { id: 'extract', text: 'Get back to the hill you came from', hidden: true },
  ],
  tick(m, dt) {
    const w = m.world, ship = w.site.ship;
    // (Checked on the hotspot rather than in its onExplode, so a loaded save sinks it too.)
    if (!ship.sinking && w.hotspots.some(h => h.kind === 'ship' && h.exploded)) {
      ship.sinking = true;
      if (m.obj('ship').done) ship.sunk = 1;
      // The deck goes from under you: its blocks go, and anyone aboard goes down with it.
      for (const bx of ship.boxes) { const i = w.boxes.indexOf(bx); if (i >= 0) w.boxes.splice(i, 1); }
      for (const s of ship.solids) { const i = w.raycastTargets.indexOf(s); if (i >= 0) w.raycastTargets.splice(i, 1); }
      for (const s of w.soldiers) if (s.name === 'Deck watch') { if (s.alive) s.applyHit('torso', { damage: { torso: 999 } }, new THREE.Vector3(0, -1, 0)); s.root.visible = false; }
      m.complete('ship', 'THE SUPPLY SHIP IS SINKING');
    }
    if (ship.sinking && !ship.settled) {
      ship.sunk = Math.min(1, ship.sunk + dt / 40);
      ship.settled = ship.sunk >= 1;
      // It settles and rolls toward the sea about its own keel.
      const pivot = new THREE.Vector3(SHIP.x, 0, SHIP.z);
      ship.group.rotation.x = -0.14 * ship.sunk;
      ship.group.position.copy(pivot).sub(pivot.clone().applyEuler(ship.group.rotation)).setY(-9 * ship.sunk * ship.sunk);
    }
    // In the water (off the sinking deck, off the crane): you scramble out onto the nearest quay.
    const pp = m.player.pos;
    if (!m.player.dead && pp.y < 1 && heightAt(pp.x, pp.z) < 0) {
      if (Math.abs(pp.x) <= DX && pp.z < DZ0) pp.set(pp.x, Q, DZ0 + 1.5);
      else if (pp.x > 80 && pp.x < 220 && Math.abs(pp.z + 233) < 20) pp.set(pp.x, Q, pp.z < -233 ? -236 : -230);
      else if (Math.abs(pp.x - 225) < 20 && pp.z > -250) pp.set(pp.x < 225 ? 221.5 : 228.5, Q, Math.max(-236, pp.z));
    }
    if (!m.obj('depot').done && w.site.fuelTanks.every(t => w.hotspots.find(h => h.meshes[0] === t)?.exploded)) m.complete('depot', 'THE FUEL DEPOT IS BURNING');
    if (!m.obj('flak').done && w.hotspots.some(h => h.title === 'FLAK GUN' && h.exploded)) m.complete('flak', 'FLAK GUN DESTROYED');
  },
  markers(m) {
    const out = [];
    const w = m.world;
    if (!m.obj('ship').done) out.push({ pos: new THREE.Vector3(SHIP.x - 29, SHIP.deck + 1, SHIP.z), kind: 'tank', label: 'SUPPLY SHIP', height: 1.5 });
    if (!m.obj('depot').done) out.push({ pos: new THREE.Vector3(140, Q + 9, 19), kind: 'tank', label: 'FUEL DEPOT', height: 1 });
    return out;
  },
};

const briefing = `
  <p class="brief">A supply ship, the "Elbe", is taking on diesel at the quay for the U-boats at La Spezia.
    The docks are fenced and guarded; a sniper sits on one of the cranes, a flak gun on the mole, and the port's
    naval commander, Korvettenkapitän Lenz, walks the quay.</p>
  <ul class="goals">
    <li><b>Sink the supply ship.</b> Plant a satchel charge on the engine-room skylight behind the funnel (up the gangway),
      or put two anti-tank rounds into its hull (a Panzerschreck is hidden in one of the warehouses).</li>
    <li><b>Blow up the fuel depot.</b> Shoot a tank enough times and it goes up, and it takes the others with it.
      Or use explosives. Don't stand close.</li>
    <li><b>Optional:</b> eliminate Lenz; take the convoy schedule from the harbourmaster's safe (upstairs in his office;
      the combination is written down somewhere and Lenz carries it); destroy the flak gun on the mole; take his papers.</li>
    <li><b>Then</b> get back to the hill you started from, where green smoke marks the pick-up.</li>
  </ul>
  <p class="brief">The road comes in at the west gate. The south fence has been cut in two places. You can't swim with your kit:
    the water stops you at the quay. A truck of reinforcements comes down the coast road if the siren sounds.</p>`;

export default { id: 'harbour', props: ['ship', 'crane', 'flak', 'eboat', 'fuelTank', 'crates', 'fishingBoat', 'hedgehog', 'sentryBox', 'sandbags', 'motorcycle', 'kitchen', 'supplies', 'drums', 'barrels', 'tobruk', 'searchlight', 'mgNest', 'pole', 'signpost', 'rowboat', 'cargoPallet', 'fiat'], subtitle: 'Operation Low Tide · Liguria, 1944', map, site, def, intel, briefing };
