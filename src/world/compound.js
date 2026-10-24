// The walled farm compound (target area) and the shooting range by the start hill.
// Every solid mesh goes into `solids` (bullet raycasts) and `boxes` (player collision).
import * as THREE from 'three';
import { COMPOUND, H_COMPOUND, FIRING_LINE, H_LANE, heightAt } from './terrain.js';
import { Soldier } from './soldier.js';
import { textures, worldUVs } from './textures.js';

const T = textures();
// `tile` = metres per texture repeat (see worldUVs).
const textured = (tex, opts, tile) => Object.assign(new THREE.MeshStandardMaterial({ ...tex, ...opts }), { userData: { tile } });
const M = {
  stone: textured(T.stone, { roughness: 0.95 }, 2.5),
  plaster: textured(T.plaster, { roughness: 0.92 }, 3.5),
  plaster2: textured(T.plaster2, { roughness: 0.92 }, 3.5),
  roof: textured(T.roof, { roughness: 0.8 }, 2.2),
  wood: textured(T.wood, { roughness: 0.85 }, 1.6),
  darkWood: textured(T.darkWood, { roughness: 0.85 }, 1.6),
  window: new THREE.MeshStandardMaterial({ color: 0x1d2226, roughness: 0.15, metalness: 0.4 }),
  shutter: textured(T.wood, { color: 0x6f9a6a, roughness: 0.8 }, 1.2),
  metal: new THREE.MeshStandardMaterial({ color: 0x4b5045, roughness: 0.55, metalness: 0.5 }),
  truck: new THREE.MeshStandardMaterial({ color: 0x55593f, roughness: 0.7, metalness: 0.2 }),
  canvas: new THREE.MeshStandardMaterial({ color: 0x6c6b4f, roughness: 1 }),
  sandbag: new THREE.MeshStandardMaterial({ color: 0x9c8c66, roughness: 1 }),
  crate: textured(T.wood, { color: 0xc9a46c, roughness: 0.9 }, 1.0),
  vine: new THREE.MeshStandardMaterial({ color: 0x4f6b2c, roughness: 0.95 }),
  earth: textured(T.ground, { color: 0x8a7552, roughness: 1 }, 2),
};

class Builder {
  constructor(scene) {
    this.scene = scene;
    this.solids = [];
    this.boxes = [];
    this.group = new THREE.Group();
    scene.add(this.group);
  }
  // Axis-aligned box at world position (x, z), bottom at y.
  box(w, h, d, mat, x, y, z, { solid = true, rotY = 0 } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (mat.map) worldUVs(geo, mat.userData.tile);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    if (solid) this.addSolid(mesh);
    return mesh;
  }
  addSolid(mesh) {
    mesh.updateMatrixWorld(true);
    this.solids.push(mesh);
    this.boxes.push(new THREE.Box3().setFromObject(mesh));
  }
  // Gable roof as a triangular prism, ridge along x.
  gable(w, rise, d, mat, x, y, z, rotY = 0) {
    const shape = new THREE.Shape();
    shape.moveTo(-d / 2 - 0.4, 0);
    shape.lineTo(d / 2 + 0.4, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: w + 0.8, bevelEnabled: false });
    geo.translate(0, 0, -(w + 0.8) / 2);
    geo.rotateY(Math.PI / 2);
    geo.computeVertexNormals();
    if (mat.map) worldUVs(geo, mat.userData.tile);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    this.addSolid(mesh);
    return mesh;
  }
  // Windows with shutters on the long faces of a building (decoration only).
  windows(cx, cz, w, d, y0, floors) {
    for (let f = 0; f < floors; f++) {
      const y = y0 + 1.2 + f * 3;
      for (let i = -1; i <= 1; i++) {
        for (const side of [-1, 1]) {
          const x = cx + i * (w / 3.5), z = cz + side * (d / 2 + 0.03);
          this.box(1.0, 1.4, 0.06, M.window, x, y, z, { solid: false });
          this.box(0.45, 1.5, 0.08, M.shutter, x - 0.75, y - 0.05, z, { solid: false });
          this.box(0.45, 1.5, 0.08, M.shutter, x + 0.75, y - 0.05, z, { solid: false });
        }
      }
    }
  }
}

// A watchtower. Its way up is a ladder on one face (`ladder`: +1 or -1, the side it hangs
// on along z) or a straight stair flight running west from the platform (`stairs`).
// Returns the platform top and, for a ladder, the climbing data the player uses.
function tower(b, x, z, y, { ladder = 0, stairs = false } = {}) {
  const H = 8, S = 3.2, GAP = 0.9;
  for (const dx of [-S / 2, S / 2]) for (const dz of [-S / 2, S / 2]) {
    b.box(0.25, H + 2.6, 0.25, M.wood, x + dx, y, z + dz);
  }
  b.box(S + 0.4, 0.2, S + 0.4, M.wood, x, y + H, z);                   // platform
  const top = y + H + 0.2;
  // Railing, with an opening where the ladder or stair arrives.
  const rail = (dx, dz, w, d) => b.box(w, 1.0, d, M.darkWood, x + dx, top, z + dz);
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
    const lz = z + ladder * (S / 2 + 0.25);
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

  // Villa (target lives here): two floors, terrace on the south side.
  b.box(18, 6.4, 11, M.plaster, cx + 8, y, cz - 8);
  b.gable(18, 2.6, 11, M.roof, cx + 8, y + 6.4, cz - 8);
  b.windows(cx + 8, cz - 8, 18, 11, y, 2);
  b.box(18, 0.5, 6, M.stone, cx + 8, y, cz - 0.5);                      // terrace floor
  for (const s of [-1, 1]) b.box(7.4, 1.0, 0.3, M.stone, cx + 8 + s * 5.3, y + 0.5, cz + 2.4); // terrace balustrade, open in the middle
  b.box(3.2, 0.25, 0.4, M.stone, cx + 8, y, cz + 2.75);                // steps up to the terrace
  b.box(2.2, 2.6, 0.08, M.darkWood, cx + 8, y + 0.5, cz - 2.48, { solid: false }); // door

  // Barn
  b.box(14, 5.2, 9, M.plaster2, cx - 15, y, cz - 13);
  b.gable(14, 2.2, 9, M.roof, cx - 15, y + 5.2, cz - 13);
  b.box(4, 3.6, 0.08, M.darkWood, cx - 15, y, cz - 8.46, { solid: false });

  // Generator shed (open front) with the generator inside: the sound-masking source.
  b.box(5, 3, 0.2, M.wood, cx + 24, y, cz + 12);
  b.box(0.2, 3, 4, M.wood, cx + 21.6, y, cz + 10);
  b.box(0.2, 3, 4, M.wood, cx + 26.4, y, cz + 10);
  b.box(5.4, 0.15, 4.6, M.roof, cx + 24, y + 3, cz + 10);
  const generator = b.box(1.8, 1.1, 1.0, M.metal, cx + 24, y, cz + 10.6);

  // Radio truck. Its engine sits under the bonnet in front of the cab: a weak spot.
  const truckMat = M.truck.clone(), canvasMat = M.canvas.clone(), chassisMat = M.metal.clone();
  const truckParts = [
    b.box(2.3, 1.9, 2.0, truckMat, cx - 6, y + 0.5, cz + 17),           // cab
    b.box(2.4, 2.4, 4.4, canvasMat, cx - 6, y + 0.5, cz + 13.8),        // cargo box
    b.box(2.4, 0.5, 6.6, chassisMat, cx - 6, y, cz + 15),               // chassis
  ];
  const bonnet = b.box(2.0, 0.85, 1.15, truckMat, cx - 6, y + 0.5, cz + 18.55);
  b.box(1.6, 0.55, 0.05, M.metal, cx - 6, y + 0.65, cz + 19.14, { solid: false }); // radiator grille
  truckParts.push(bonnet);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 6, 5), M.metal);
  antenna.position.set(cx - 5.2, y + 5.9, cz + 12.4);
  b.group.add(antenna);
  // The field radio sits at the back of the cargo box: wreck it from behind the truck.
  const radioSet = b.box(0.7, 0.5, 0.35, M.metal, cx - 6, y + 0.9, cz + 11.45, { solid: false });
  const radio = { pos: radioSet.position.clone().setY(y), standAt: new THREE.Vector3(cx - 6, y, cz + 10.6), antenna, engine: bonnet, truckParts };

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

  // Vineyard rows south of the compound
  for (let r = 0; r < 9; r++) {
    for (let s = 0; s < 3; s++) {
      const x = cx - 30 + s * 22, z = cz + D / 2 + 22 + r * 3.2;
      b.box(18, 1.35, 0.6, M.vine, x, heightAt(x, z) - 0.1, z, { solid: false });
    }
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
  add(towerTops[1].x - cx, towerTops[1].z - cz, Math.PI * 0.25, { y: towerTops[1].y, name: 'Tower guard', stance: 'alert' });
  add(20, 6, 0.4, { name: 'Yard guard' });
  add(10, 0.5, Math.PI * 0.1, { officer: true, name: 'Officer', y: y + 0.5 });
  add(-15, -6, 2.6, { name: 'Barn guard' });

  return { solids: b.solids, boxes: b.boxes, soldiers, generator: generator.position.clone(), generatorMesh: generator, towerTops, ladders, siren, radio };
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
