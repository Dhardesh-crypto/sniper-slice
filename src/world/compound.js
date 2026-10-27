// The walled farm compound (target area) and the shooting range by the start hill.
// Every solid mesh goes into `solids` (bullet raycasts) and `boxes` (player collision).
import * as THREE from 'three';
import { COMPOUND, H_COMPOUND, FIRING_LINE, H_LANE, heightAt } from './terrain.js';
import { Soldier } from './soldier.js';
import { textures, worldUVs } from './textures.js';
import { vehicleModel } from './vehicle-models.js';

import { dressBlock } from './arch.js';
import { M, Builder } from './kit.js';
import { building, furniture } from './buildings.js';
import { propGeometry } from './props.js';

// A watchtower. Its way up is a ladder on one face (`ladder`: +1 or -1, the side it hangs
// on along z) or a straight stair flight running west from the platform (`stairs`).
// Returns the platform top and, for a ladder, the climbing data the player uses.
function tower(b, x, z, y, { ladder = 0, stairs = false } = {}) {
  const H = 8, S = 3.2, GAP = 0.9;
  // Four squared posts from the ground through the platform to the roof, a girt halfway up and
  // under the deck, and an X of braces on every face in each storey: one frame, all joined.
  const dark = M.darkWood;
  for (const dx of [-S / 2, S / 2]) for (const dz of [-S / 2, S / 2]) b.box(0.25, H + 2.6, 0.25, dark, x + dx, y, z + dz);
  const mid = y + H / 2, levels = [[y + 0.3, mid], [mid, y + H - 0.1]];
  const timber = (from, to, t = 0.12) => {
    const len = from.distanceTo(to), geo = new THREE.BoxGeometry(t, len, t);
    worldUVs(geo, dark.userData.tile);
    const m = new THREE.Mesh(geo, dark);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    m.castShadow = m.receiveShadow = true;
    b.group.add(m);
  };
  for (const [ax, az, bx, bz, ox, oz] of [[-1, -1, 1, -1, 0, -1], [-1, 1, 1, 1, 0, 1], [-1, -1, -1, 1, -1, 0], [1, -1, 1, 1, 1, 0]]) {
    // (each face's braces sit just outside the posts' faces, so they don't cut through them)
    const off = new THREE.Vector3(ox * 0.17, 0, oz * 0.17);
    const P = (sx, sz, py) => new THREE.Vector3(x + sx * S / 2, py, z + sz * S / 2).add(off);
    b.box(Math.abs(bx - ax) * S / 2 + 0.3 + 0.05, 0.16, Math.abs(bz - az) * S / 2 + 0.3 + 0.05, dark, x + (ax + bx) * S / 4 + off.x, mid - 0.08, z + (az + bz) * S / 4 + off.z, { solid: false });
    for (const [lo, hi] of levels) { timber(P(ax, az, lo), P(bx, bz, hi)); timber(P(bx, bz, lo), P(ax, az, hi)); }
  }
  b.box(S + 0.4, 0.2, S + 0.4, M.wood, x, y + H, z);                   // platform
  const top = y + H + 0.2;
  // Railing, with an opening where the ladder or stair arrives.
  const rail = (dx, dz, w, d) => b.box(w, 1.0, d, dark, x + dx, top, z + dz);
  const half = (S + 0.4 - GAP) / 2;
  for (const side of [-1, 1]) {
    if (side === ladder) for (const s of [-1, 1]) rail(s * (GAP + half) / 2, side * S / 2, half, 0.1);
    else rail(0, side * S / 2, S + 0.4, 0.1);
  }
  if (stairs) for (const s of [-1, 1]) rail(-S / 2, s * (GAP + half) / 2, 0.1, half);
  else rail(-S / 2, 0, 0.1, S + 0.4);
  rail(S / 2, 0, 0.1, S + 0.4);
  b.box(S + 1.0, 0.15, S + 1.0, M.roof, x, y + H + 2.6, z);            // roof
  const out = { top: new THREE.Vector3(x, top, z) };

  if (ladder) {
    const lz = z + ladder * (S / 2 + 0.35);                    // (clear of the braces)
    for (const dx of [-0.3, 0.3]) b.box(0.07, H + 1.1, 0.07, M.wood, x + dx, y, lz, { solid: false }); // rails
    for (let i = 0; i < 10; i++) b.box(0.6, 0.05, 0.05, M.wood, x, y + 0.4 + i * 0.8, lz, { solid: false }); // rungs
    out.ladder = {
      foot: new THREE.Vector3(x, y, lz + ladder * 0.45),        // where you stand to climb
      topSpot: new THREE.Vector3(x, top, z + ladder * (S / 2 - 0.55)), // where you step off on the platform
      bottom: y, top,
      yaw: ladder > 0 ? 0 : Math.PI,                             // player yaw that faces the ladder
    };
  }
  if (stairs) {
    // One straight flight of open treads down to the yard, on two stringers.
    const RISE = 0.25, RUN = 0.32, W = 1.2, n = Math.round((top - y) / RISE);
    const x0 = x - S / 2 - 0.2;                                  // the platform's west edge
    for (let i = 1; i < n; i++) {
      b.box(RUN + 0.02, 0.06, W, M.wood, x0 - (i - 0.5) * RUN, top - i * RISE - 0.06, z);
    }
    const len = Math.hypot(n * RUN, n * RISE), ang = Math.atan2(n * RISE, n * RUN);
    for (const s of [-1, 1]) {
      const geo = new THREE.BoxGeometry(len, 0.22, 0.07);
      worldUVs(geo, M.wood.userData.tile);
      const beam = new THREE.Mesh(geo, M.wood);
      beam.position.set(x0 - n * RUN / 2, y + (top - y) / 2 - 0.12, z + s * (W / 2 + 0.04));
      beam.rotation.z = ang; // rises toward +x, up to the platform
      beam.castShadow = beam.receiveShadow = true;
      b.group.add(beam);
      // Hand rail
      const hr = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), M.darkWood);
      hr.position.copy(beam.position).add(new THREE.Vector3(0, 0.95, 0));
      hr.rotation.z = ang;
      hr.castShadow = true;
      b.group.add(hr);
    }
    // A post under the middle of the flight.
    for (const s of [-1, 1]) b.box(0.15, (top - y) / 2 - 0.1, 0.15, M.wood, x0 - n * RUN / 2, y, z + s * (W / 2 + 0.04), { solid: false });
  }
  return out;
}

function sandbags(b, x, z, len, rotY, y = heightAt(x, z)) {
  const g = new THREE.Group();
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < len; i++) {
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.4, 4, 10), M.sandbag);
      bag.rotation.z = Math.PI / 2;
      bag.scale.set(1, 1, 0.7);
      bag.position.set((i - (len - 1) / 2) * 0.62 + (row % 2) * 0.3, 0.16 + row * 0.24, 0);
      bag.castShadow = bag.receiveShadow = true;
      g.add(bag);
    }
  }
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  b.group.add(g);
  // Collision/raycast proxy (invisible box).
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(len * 0.62 + 0.3, 0.75, 0.4), new THREE.MeshBasicMaterial({ visible: false }));
  proxy.position.set(x, y + 0.37, z);
  proxy.rotation.y = rotY;
  b.group.add(proxy);
  b.addSolid(proxy);
}

export function buildCompound(scene) {
  const b = new Builder(scene);
  const cx = COMPOUND.x, cz = COMPOUND.z, y = H_COMPOUND;
  const W = 64, D = 52, T = 0.6, WH = 2.6;

  // Perimeter wall with a west gate (facing the road) and a narrow east gap.
  b.box(W, WH, T, M.stone, cx, y, cz - D / 2);
  b.box(W, WH, T, M.stone, cx, y, cz + D / 2);
  b.box(T, WH, D / 2 - 4, M.stone, cx - W / 2, y, cz - D / 4 - 2);
  b.box(T, WH, D / 2 - 4, M.stone, cx - W / 2, y, cz + D / 4 + 2);
  b.box(T, WH, D / 2 - 1.2, M.stone, cx + W / 2, y, cz - D / 4 - 0.6);
  b.box(T, WH, D / 2 - 1.2, M.stone, cx + W / 2, y, cz + D / 4 + 0.6);
  for (const s of [-1, 1]) b.box(0.9, 3.2, 0.9, M.stone, cx - W / 2, y, cz + s * 4.2); // gate posts

  // Villa (the Oberst lives here): two floors you can walk through, terrace on the south side.
  // Ground floor: dining room (west), hall with the stairs, radio room (east). Upstairs: the
  // Oberst's office with his safe (west) and his bedroom (east). Local x −9…9, z −5.5…5.5.
  const vx = cx + 8, vz = cz - 8;
  const villa = building(b, {
    x: vx, z: vz, y, w: 18, d: 11, floors: 2, h: 3.2, mat: M.plaster, roof: 'gable',
    openings: [
      { side: 's', at: 0, w: 1.4, h: 2.3, door: true },
      { side: 'n', at: -5, w: 1.1, door: true },
      ...[-6, 6].map(at => ({ side: 's', at, w: 1.1, window: true })),
      ...[2, 6].map(at => ({ side: 'n', at, w: 1.1, window: true })),
      { side: 'e', at: 0, w: 1.1, window: true }, { side: 'w', at: 0, w: 1.1, window: true },
      ...[-6, 0, 6].map(at => ({ side: 's', at, w: 1.1, window: true, floor: 1 })),
      ...[-6, 6].map(at => ({ side: 'n', at, w: 1.1, window: true, floor: 1 })),
      { side: 'e', at: 0, w: 1.1, window: true, floor: 1 }, { side: 'w', at: 0, w: 1.1, window: true, floor: 1 },
    ],
    stairs: { at: [2.6, 1.0], dir: 'n', w: 1.0 },
    walls: [
      { axis: 'z', at: -3, from: -5.4, to: 5.4, openings: [{ at: 1.5, w: 1.0, door: true }] },
      { axis: 'z', at: 3.5, from: -5.4, to: 5.4, openings: [{ at: 1.5, w: 1.0, door: true }] },
      { axis: 'z', at: -3, from: -5.4, to: 5.4, floor: 1, openings: [{ at: 2.5, w: 1.0, door: true }] },
      { axis: 'z', at: 3.5, from: -5.4, to: 5.4, floor: 1, openings: [{ at: 2.5, w: 1.0, door: true }] },
    ],
  });
  const up = y + 3.2;
  furniture.table(b, vx - 6, y, vz - 1, 2.4, 1.0);                     // dining room
  furniture.cabinet(b, vx - 8.4, y, vz + 3.5, 0.45, 1.2);
  furniture.table(b, vx + 6.3, y, vz - 3.5, 1.8, 0.9);                 // radio room
  furniture.crates(b, vx + 7.5, y, vz + 2.5, 3);
  furniture.desk(b, vx - 6, up, vz + 0.5);                             // the Oberst's office
  furniture.shelf(b, vx - 6, up, vz + 5.0);
  furniture.bed(b, vx + 6.5, up, vz - 3.6);                            // his bedroom
  furniture.cabinet(b, vx + 8.4, up, vz + 2.5, 0.45, 1.0, 1.4);
  villa.safe = { at: new THREE.Vector3(vx - 7.6, up, vz - 4.7), yaw: 0 };
  villa.docs = {
    desk: new THREE.Vector3(vx - 6.2, up + 0.79, vz + 0.4),
    bedside: new THREE.Vector3(vx + 8.4, up + 1.42, vz + 2.6),
    dining: new THREE.Vector3(vx - 6.3, y + 0.79, vz - 1.1),
    radio: new THREE.Vector3(vx + 6.0, y + 0.79, vz - 3.4),
  };
  b.box(18, 0.5, 5, M.stone, cx + 8, y, cz);                           // terrace floor (from the villa wall out)
  for (const s of [-1, 1]) b.box(7.4, 1.0, 0.3, M.stone, cx + 8 + s * 5.3, y + 0.5, cz + 2.4); // terrace balustrade, open in the middle
  b.box(3.2, 0.25, 0.4, M.stone, cx + 8, y, cz + 2.75);                // steps up to the terrace

  // Barn
  b.box(14, 5.2, 9, M.plaster2, cx - 15, y, cz - 13);
  b.gable(14, 2.2, 9, M.roof, cx - 15, y + 5.2, cz - 13, 0, { wall: M.plaster2 });
  dressBlock(b, { x: cx - 15, z: cz - 13, w: 14, d: 9, y, height: 5.2 });
  b.box(4, 3.6, 0.08, M.darkWood, cx - 15, y, cz - 8.46, { solid: false });

  // Generator shed (open front) with the generator inside: the sound-masking source.
  b.box(5, 3, 0.2, M.wood, cx + 24, y, cz + 12);
  b.box(0.2, 3, 4, M.wood, cx + 21.6, y, cz + 10);
  b.box(0.2, 3, 4, M.wood, cx + 26.4, y, cz + 10);
  b.box(5.4, 0.15, 4.6, M.roof, cx + 24, y + 3, cz + 10);
  const generator = b.box(1.8, 1.1, 1.0, M.metal, cx + 24, y, cz + 10.6);

  // Radio truck: an Opel Blitz (Higgsfield model), cab toward +z, 6 m long, centred at z +15.6.
  // Invisible blocks fitted to it do the physical work: collision, bullets, the guards' paths;
  // the one over the engine (under the bonnet) is the weak spot.
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const tx = cx - 6, tz = cz + 15.6;
  const blitz = vehicleModel('truck');
  blitz.position.set(tx, y, tz);
  b.group.add(blitz);
  b.box(2.3, 2.4, 3.6, hidden, tx, y + 0.35, tz - 1.2);                // covered bed
  b.box(2.1, 2.0, 1.2, hidden, tx, y + 0.35, tz + 1.2);                // cab
  const bonnet = b.box(1.8, 1.25, 1.2, hidden, tx, y + 0.5, tz + 2.4); // engine
  const truckParts = [blitz.userData.mesh];
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 6, 5), M.metal);
  antenna.position.set(tx + 0.8, y + 5.9, tz - 2.6);
  b.group.add(antenna);
  // The field radio is strapped to the tailgate: wreck it from behind the truck.
  const radioSet = b.box(0.7, 0.5, 0.35, M.metal, tx, y + 0.9, tz - 3.2, { solid: false });
  const radio = { pos: radioSet.position.clone().setY(y), standAt: new THREE.Vector3(tx, y, tz - 4.0), antenna, engine: bonnet, truckParts };

  // Alarm siren on a pole in the yard. A guard who sees you runs here to sound it; cut the
  // wire at the junction box (hold E) and it stays silent.
  const sx = cx - 1, sz = cz + 7;
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

  // A Panzer IV parked in the yard, gun toward the gate. The model is added by vehicles.js;
  // this invisible box is its body for collision, bullets and the guards' paths.
  const tank = { pos: new THREE.Vector3(cx - 20, y, cz + 17), yaw: -Math.PI / 2, length: 5.7, width: 3.7, height: 2.0 };
  const tankBox = new THREE.Mesh(new THREE.BoxGeometry(tank.length, tank.height, tank.width), new THREE.MeshBasicMaterial({ visible: false }));
  tankBox.position.set(tank.pos.x + 0.6, y + tank.height / 2, tank.pos.z);
  b.group.add(tankBox);
  b.addSolid(tankBox);
  tank.proxy = tankBox;

  // The Oberst's staff car, a Kübelwagen (Higgsfield model), nose toward -z, by the villa.
  // Its engine is at the back: an invisible block there is the weak spot.
  const kx = cx + 21.5, kz = cz - 6;
  const kubel = vehicleModel('car');
  kubel.position.set(kx, y, kz);
  kubel.rotation.y = Math.PI;
  b.group.add(kubel);
  b.box(1.6, 0.9, 2.6, hidden, kx, y + 0.3, kz - 0.4);                 // body
  const carEngine = b.box(1.5, 0.75, 0.9, hidden, kx, y + 0.45, kz + 1.3); // rear engine
  const staffCar = { engine: carEngine, parts: [kubel.userData.mesh] };

  // Crates and sandbag nests for cover
  for (const [dx, dz, s] of [[-24, 6, 1.1], [-23, 7.4, 0.9], [-4, -20, 1.2], [14, 18, 1], [15.2, 18.3, 0.8]]) {
    b.box(s, s, s, M.crate, cx + dx, y, cz + dz);
  }
  sandbags(b, cx - 36, cz + 10, 5, 0.2, y);
  sandbags(b, cx - 36, cz - 10, 5, -0.2, y);

  // Watchtowers at two corners
  // The south-west one is climbed by its ladder (facing the yard), the north-east one by stairs.
  const towers = [tower(b, cx - W / 2 + 2.5, cz + D / 2 - 2.5, y, { ladder: -1 }), tower(b, cx + W / 2 - 2.5, cz - D / 2 + 2.5, y, { stairs: true })];
  const towerTops = towers.map(t => t.top);
  const ladders = towers.filter(t => t.ladder).map(t => t.ladder);

  // Vineyard rows south of the compound: modelled vines on posts and wires where the model is
  // loaded (two 9 m lengths to each 18 m row, drawn as instances), green hedges if not.
  const vine = propGeometry('vineRow', { x: 9, y: 1.7, z: 1.1 }, true);
  const rows = [];
  for (let r = 0; r < 9; r++) {
    for (let s = 0; s < 3; s++) {
      const x = cx - 30 + s * 22, z = cz + D / 2 + 22 + r * 3.2;
      if (!vine) { b.box(18, 1.35, 0.6, M.vine, x, heightAt(x, z) - 0.1, z, { solid: false }); continue; }
      for (const dx of [-4.5, 4.5]) rows.push(new THREE.Vector3(x + dx, heightAt(x + dx, z) - 0.05, z + (r % 2 ? 0.08 : -0.08)));
    }
  }
  if (vine) {
    const im = new THREE.InstancedMesh(vine.geometry, vine.material, rows.length), m = new THREE.Matrix4(), q = new THREE.Quaternion();
    rows.forEach((p, i) => im.setMatrixAt(i, m.compose(p, q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i % 2 ? Math.PI : 0), new THREE.Vector3(1, 1, 1))));
    im.castShadow = im.receiveShadow = true;
    im.computeBoundingSphere();
    scene.add(im);
  }

  // Practice guards (static until the AI phase).
  const soldiers = [];
  const add = (dx, dz, yaw, opts = {}) => {
    const p = new THREE.Vector3(cx + dx, opts.y ?? y, cz + dz);
    const s = new Soldier({ position: p, yaw, ...opts });
    scene.add(s.root);
    soldiers.push(s);
    return s;
  };
  add(-W / 2 - 1.5, 6.2, -Math.PI / 2, { name: 'Gate guard', stance: 'alert' });
  add(-W / 2 - 1.5, -6.2, -Math.PI / 2, { name: 'Gate guard', stance: 'alert' });
  add(towerTops[0].x - cx, towerTops[0].z - cz, -Math.PI * 0.75, { y: towerTops[0].y, name: 'Tower guard', stance: 'alert' });
  add(towerTops[1].x - cx, towerTops[1].z - cz, Math.PI * 0.25, { y: towerTops[1].y, name: 'Tower guard', stance: 'alert', look: 'guardCamo' });
  add(20, 6, 0.4, { name: 'Yard guard' });
  add(10, 0.5, Math.PI * 0.1, { officer: true, name: 'Officer', y: y + 0.5 });
  add(-15, -6, 2.6, { name: 'Barn guard', look: 'guardCamo' });
  // More of them: a sergeant walking the north-west yard, a lieutenant keeping near the Oberst,
  // and a sentry in a camouflage smock along the south side.
  add(-20, 10, 0, { name: 'Sergeant', stance: 'alert', look: 'guardSergeant' });
  add(16, -3, Math.PI, { name: 'Lieutenant', look: 'officerLieutenant' });
  add(0, -21, Math.PI / 2, { name: 'Sentry', stance: 'alert', look: 'guardCamo' });

  return { solids: b.solids, boxes: b.boxes, soldiers, generator: generator.position.clone(), generatorMesh: generator, towerTops, ladders, siren, radio, tank, staffCar, villa, doors: villa.doors };
}

function distanceSign(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#efe6cc'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#3a3226'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 120);
  g.fillStyle = '#2a241b'; g.font = 'bold 72px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildRange(scene) {
  const b = new Builder(scene);
  const y = H_LANE;
  sandbags(b, FIRING_LINE.x + 1.2, FIRING_LINE.z - 2.5, 4, Math.PI / 2, y);
  sandbags(b, FIRING_LINE.x + 1.2, FIRING_LINE.z + 2.5, 4, Math.PI / 2, y);
  const targets = [];
  // Staggered sideways so no target or berm blocks the line of sight to a farther one.
  for (const [d, off] of [[100, -7], [200, -3.5], [300, 0], [400, 3.5], [500, 7]]) {
    const x = FIRING_LINE.x + d, z = FIRING_LINE.z + off;
    const s = new Soldier({ position: new THREE.Vector3(x, y, z), yaw: -Math.PI / 2, name: `Range ${d} m` });
    s.range = true;
    s.rangeDistance = d;
    scene.add(s.root);
    targets.push(s);
    // Sign beside the target, readable through the scope.
    b.box(0.12, 2.2, 0.12, M.wood, x, y, z + 2.2, { solid: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: distanceSign(`${d}`) }));
    sign.position.set(x - 0.08, y + 2.4, z + 2.2);
    sign.rotation.y = -Math.PI / 2;
    b.group.add(sign);
    // Earth berm behind the target stops bullets and shows impacts.
    b.box(1.5, 3, 3, M.earth, x + 6, y - 0.3, z);
  }
  return { solids: b.solids, boxes: b.boxes, targets, spawn: new THREE.Vector3(FIRING_LINE.x - 1.5, y, FIRING_LINE.z) };
}
