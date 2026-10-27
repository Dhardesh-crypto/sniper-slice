// Walk-in buildings: outer walls with real doorways and windows (you can walk through the
// one and shoot through the other), upper floors on slabs with a stairwell, a straight stair
// flight between floors, interior walls with doorways, hinged doors, and simple furniture.
// Everything is axis-aligned boxes, like the rest of the map, so collision, bullets, the
// guards' paths and climbing all work inside as they do outside.
//
// building(b, opts): w along x, d along z, centred on (x, z), ground floor at y.
//   floors, h (storey height), wall (thickness), mat, floorMat, roof: 'gable' | 'flat'
//   openings: [{ side: 'n' | 's' | 'e' | 'w', at (m from the wall's centre), w, h, sill, floor,
//               door: true for a hinged door in a doorway, window: true for a window }]
//   stairs: { at: [dx, dz] (foot of the flight), dir: 'n' | 's' | 'e' | 'w' (way up), w }
//   walls: interior walls [{ axis: 'x' | 'z', at, from, to, floor, openings: [{ at, w, door }] }]
// Sides: n is -z, s is +z, w is -x, e is +x.
import * as THREE from 'three';
import { M, COTTO, plasterFor, isPlaster } from './kit.js';
import { heightAt } from './terrain.js';
import { registerInterior } from './interior.js';
import { worldUVs } from './textures.js';
import { propModel } from './props.js';
import { dressWindow, dressDoor, dressBlock, dressFlatRoof, houseLook } from './arch.js';


const RISE = 0.24, RUN = 0.3;

// Every upper floor built, for the guards' route maps (ai/nav.js; world.js takes the list).
export const storeys = [];
let buildingCount = 0;
const DOOR_MAT = M.darkWood;

export function building(b, o) {
  const { x, z, y, w, d, floors = 1, h = 3.2, wall = 0.25, floorMat = M.wood, roof = 'gable', roofMat = M.roof } = o;
  const mat = isPlaster(o.mat ?? M.plaster) ? plasterFor(x, z) : o.mat;     // a plastered house gets its own colour
  const doors = [];
  const out = { doors, floorY: (f) => y + f * h, top: y + floors * h, x, z, w, d };
  const openings = o.openings ?? [];
  // The outer walls, one per side, broken around their openings on each floor.
  const sides = {
    n: { cx: x, cz: z - d / 2 + wall / 2, len: w, alongX: true },
    s: { cx: x, cz: z + d / 2 - wall / 2, len: w, alongX: true },
    w: { cx: x - w / 2 + wall / 2, cz: z, len: d - 2 * wall, alongX: false },
    e: { cx: x + w / 2 - wall / 2, cz: z, len: d - 2 * wall, alongX: false },
  };
  for (const [side, sd] of Object.entries(sides)) {
    for (let f = 0; f < floors; f++) {
      const ops = openings.filter(op => op.side === side && (op.floor ?? 0) === f);
      wallRun(b, sd, y + f * h, h, wall, mat, ops, doors, side, true);
    }
  }
  // Floors: a slab on each storey above the ground, with the stairwell left open.
  const st = o.stairs;
  const well = st ? stairHole(x, z, st, h) : null;
  for (let f = 1; f <= floors; f++) {
    const sy = y + f * h - 0.18;
    const isRoof = f === floors;
    const hole = isRoof ? null : well;
    slab(b, x, z, w - 0.02, d - 0.02, sy, 0.18, isRoof && roof === 'flat' ? M.stone : floorMat, hole);
  }
  // A floor inside on the ground storey (just above the ground, so it's walked on): terracotta tiles
  // in a stone or plastered house, planks in a timber one.
  const timber = mat === M.wood || mat === M.darkWood;
  // On a slope the ground falls away under part of it: there it stands on a solid plinth down to the
  // lowest ground inside, so nobody walks below the boards.
  const fm = floorMat === M.wood && !timber ? COTTO : floorMat, fw = w - 2 * wall, fd = d - 2 * wall;
  let lo = y;
  for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) lo = Math.min(lo, heightAt(x - fw / 2 + fw * i / 5, z - fd / 2 + fd * j / 5));
  if (lo < y - 0.02) b.box(fw, y + 0.06 - lo, fd, fm, x, lo, z);
  else b.box(fw, 0.06, fd, fm, x, y, z, { solid: false });
  // Stairs: one flight per storey, all stacked in the same well.
  if (st) for (let f = 0; f < floors - 1; f++) stairs(b, x + st.at[0], z + st.at[1], y + f * h, h, st.dir, st.w ?? 1.0, floorMat);
  out.stairsFoot = st ? new THREE.Vector3(x + st.at[0], y, z + st.at[1]) : null;
  // Each upper floor's inside and height, the flight up to it (where you step on at its foot and off
  // at its head) and the stairwell in it.
  const id = buildingCount++;
  for (let f = 1; f < floors; f++) {
    const [dx, dz] = st ? { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[st.dir] : [0, 0], len = Math.round(h / RISE) * RUN;
    const fx = st ? x + st.at[0] : 0, fz = st ? z + st.at[1] : 0;
    storeys.push({
      building: id, f, y: y + f * h, x0: x - w / 2 + wall, x1: x + w / 2 - wall, z0: z - d / 2 + wall, z1: z + d / 2 - wall, well,
      foot: st ? new THREE.Vector3(fx - dx * 0.4, y + (f - 1) * h, fz - dz * 0.4) : null,
      head: st ? new THREE.Vector3(fx + dx * (len + 0.45), y + f * h, fz + dz * (len + 0.45)) : null,
    });
  }
  // Interior walls.
  for (const iw of o.walls ?? []) {
    const f = iw.floor ?? 0, len = iw.to - iw.from, mid = (iw.from + iw.to) / 2;
    const sd = iw.axis === 'x' ? { cx: x + mid, cz: z + iw.at, len, alongX: true } : { cx: x + iw.at, cz: z + mid, len, alongX: false };
    wallRun(b, sd, y + f * h, h - 0.18, 0.15, iw.mat ?? mat, (iw.openings ?? []).map(op => ({ ...op, at: op.at - mid, h: op.h ?? 2.1 })), doors, iw.axis === 'x' ? 'n' : 'w');
  }
  // The stone dressing from the architecture kit (if it's loaded): base course and quoins (not on a
  // timber building), the cornice.
  if (!timber) dressBlock(b, { x, z, w, d, y, height: floors * h, storey: floors > 1 ? h : 0 });
  // The roof.
  if (roof === 'gable') b.gable(w, Math.min(2.8, d * 0.28), d, roofMat, x, y + floors * h, z, 0, { wall: mat });
  else {
    dressFlatRoof(b, { x, z, w, d, y: y + floors * h });
    for (const [dx, dz, ww, dd] of [[0, -d / 2, w + 0.3, 0.3], [0, d / 2, w + 0.3, 0.3], [-w / 2, 0, 0.3, d], [w / 2, 0, 0.3, d]]) {
      b.box(ww, 0.9, dd, mat, x + dx, y + floors * h, z + dz);          // parapet around a flat roof
    }
  }
  // The rooms are furnished once the mission has put its own furniture in (interior.js).
  registerInterior(b, { x, z, y, w, d, floors, h, wall, mat, timber, openings, stairs: st, well, walls: o.walls ?? [], doors });
  return out;
}

// A run of wall from `sd` (centre, length, direction), split around openings.
function wallRun(b, sd, y0, h, t, mat, ops, doors, side, outer = false) {
  // Where an opening sits on the wall's outer face (for the kit's surrounds).
  const out = (side === 'n' || side === 'w' ? -1 : 1) * t / 2;
  const onFace = (at) => sd.alongX ? [sd.cx + at, sd.cz + out] : [sd.cx + out, sd.cz + at];
  const half = sd.len / 2;
  const cuts = ops.map(op => ({ ...op, a: op.at - op.w / 2, b: op.at + op.w / 2 })).sort((p, q) => p.a - q.a);
  const piece = (a, c, bottom, top) => {
    if (c - a < 0.02 || top - bottom < 0.02) return;
    const mid = (a + c) / 2, len = c - a;
    if (sd.alongX) b.box(len, top - bottom, t, mat, sd.cx + mid, y0 + bottom, sd.cz);
    else b.box(t, top - bottom, len, mat, sd.cx, y0 + bottom, sd.cz + mid);
  };
  let from = -half;
  for (const c of cuts) {
    piece(from, c.a, 0, h);
    const bottom = c.window ? c.sill ?? 1.0 : 0;
    const top = c.window ? bottom + (c.h ?? 1.2) : c.h ?? 2.2;
    piece(c.a, c.b, 0, bottom);                 // below a window
    piece(c.a, c.b, top, h);                    // above the opening
    if (c.door) doors.push(makeDoor(b, sd, y0, c, t, side));
    const [fx, fz] = onFace(c.at);
    if (outer && !c.window) dressDoor(b, { cx: fx, cz: fz, side, y0, w: c.w, h: top });
    if (c.window && !(outer && dressWindow(b, { cx: fx, cz: fz, side, y0: y0 + bottom, w: c.w, h: top - bottom, open: true, look: houseLook(sd.cx, sd.cz), k: Math.round(c.at * 10) })))
      shutters(b, sd, y0, c, t, side);
    from = c.b;
  }
  piece(from, half, 0, h);
}

// A hinged door filling an opening; `door.toggle(world)` swings it open or shut.
function makeDoor(b, sd, y0, c, t, side) {
  const dh = c.h ?? 2.2, dw = c.w - 0.04;
  const pivot = new THREE.Group();
  const hinge = c.a + 0.02;
  if (sd.alongX) pivot.position.set(sd.cx + hinge, y0, sd.cz);
  else pivot.position.set(sd.cx, y0, sd.cz + hinge);
  const geo = new THREE.BoxGeometry(sd.alongX ? dw : 0.06, dh, sd.alongX ? 0.06 : dw);
  geo.translate(sd.alongX ? dw / 2 : 0, dh / 2, sd.alongX ? 0 : dw / 2);
  worldUVs(geo, DOOR_MAT.userData.tile);
  const mesh = new THREE.Mesh(geo, DOOR_MAT);
  mesh.castShadow = mesh.receiveShadow = true;
  pivot.add(mesh);
  // A knob.
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M.metal);
  knob.position.set(sd.alongX ? dw - 0.1 : 0.05, 1.0, sd.alongX ? 0.05 : dw - 0.1);
  mesh.add(knob);
  b.group.add(pivot);
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  b.solids.push(mesh);
  b.boxes.push(box);
  const centre = box.getCenter(new THREE.Vector3()).setY(y0);
  const door = {
    mesh, pivot, box, open: false, centre, swing: 0, target: 0,
    toggle(world) { this.setOpen(world, !this.open); },
    setOpen(world, open) {
      if (open === this.open) return;
      this.open = open;
      this.target = open ? -Math.PI / 2 * 0.95 : 0;
      const bi = world.boxes.indexOf(this.box), ri = world.raycastTargets.indexOf(this.mesh);
      if (open) { if (bi >= 0) world.boxes.splice(bi, 1); if (ri >= 0) world.raycastTargets.splice(ri, 1); }
      else { if (bi < 0) world.boxes.push(this.box); if (ri < 0) world.raycastTargets.push(this.mesh); }
    },
    tick(dt) {
      if (Math.abs(this.swing - this.target) < 0.001) return;
      this.swing += (this.target - this.swing) * (1 - Math.exp(-9 * dt));
      this.pivot.rotation.y = this.swing;
    },
  };
  mesh.userData.door = door;
  return door;
}

function shutters(b, sd, y0, c, t, side) {
  const bottom = c.sill ?? 1.0, hh = c.h ?? 1.2, out = (side === 'n' || side === 'w' ? -1 : 1) * (t / 2 + 0.04);
  for (const s of [-1, 1]) {
    const at = c.at + s * (c.w / 2 + 0.24);
    if (sd.alongX) b.box(0.44, hh + 0.1, 0.05, M.shutter, sd.cx + at, y0 + bottom - 0.05, sd.cz + out, { solid: false, decor: true });
    else b.box(0.05, hh + 0.1, 0.44, M.shutter, sd.cx + out, y0 + bottom - 0.05, sd.cz + at, { solid: false, decor: true });
  }
}

// A floor slab with an optional rectangular hole [x0, z0, x1, z1] (world coordinates).
function slab(b, x, z, w, d, y, t, mat, hole) {
  if (!hole) { b.box(w, t, d, mat, x, y, z); return; }
  const [hx0, hz0, hx1, hz1] = hole, X0 = x - w / 2, X1 = x + w / 2, Z0 = z - d / 2, Z1 = z + d / 2;
  const part = (a, c, e, f) => { if (c - a > 0.05 && f - e > 0.05) b.box(c - a, t, f - e, mat, (a + c) / 2, y, (e + f) / 2); };
  part(X0, X1, Z0, hz0);            // in front of the hole
  part(X0, X1, hz1, Z1);            // behind it
  part(X0, hx0, hz0, hz1);          // beside it
  part(hx1, X1, hz0, hz1);
}

function stairs(b, x, z, y, h, dir, w, mat) {
  const n = Math.round(h / RISE), rise = h / n;
  const [dx, dz] = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[dir];
  for (let i = 1; i <= n; i++) {
    const cx = x + dx * (i - 0.5) * RUN, cz = z + dz * (i - 0.5) * RUN;
    // Solid steps (a block under each tread) so they're walked up like any ledge.
    b.box(dx ? RUN + 0.01 : w, i * rise, dz ? RUN + 0.01 : w, mat, cx, y, cz);
  }
}

// The hole a flight needs in the floor above it (world coordinates).
export function stairHole(x, z, st, h) {
  const n = Math.round(h / RISE), len = n * RUN, w = st.w ?? 1.0;
  const fx = x + st.at[0], fz = z + st.at[1];
  const pad = 0.15;
  switch (st.dir) {
    case 'n': return [fx - w / 2 - pad, fz - len - pad, fx + w / 2 + pad, fz + RUN * 2];
    case 's': return [fx - w / 2 - pad, fz - RUN * 2, fx + w / 2 + pad, fz + len + pad];
    case 'w': return [fx - len - pad, fz - w / 2 - pad, fx + RUN * 2, fz + w / 2 + pad];
    default: return [fx - RUN * 2, fz - w / 2 - pad, fx + len + pad, fz + w / 2 + pad];
  }
}

// ---- furniture (simple boxes; the solid ones block like walls) ----
// Where its model is loaded, a piece is drawn by the model and its boxes stay, undrawn, as what
// you bump into and what stops bullets. Which model: a mix by position, so rooms differ.
const pick = (x, z, n) => Math.abs(Math.floor(x * 7.3 + z * 3.1)) % n;
function furnish(b, key, size, x, y, z, rotY = 0) {
  const model = propModel(key, size, { stretch: true });
  if (!model) return false;
  model.position.set(x, y, z);
  model.rotation.y = rotY;
  b.group.add(model);
  return true;
}
export const furniture = {
  table(b, x, y, z, w = 1.6, d = 0.9) {
    const modelled = pick(x, z, 2) ? furnish(b, 'mapTable', { x: w + 0.5, y: 1.0, z: d + 0.7 }, x, y, z) : furnish(b, 'tableSet', { x: w + 0.4, y: 1.0, z: d + 0.9 }, x, y, z);
    const mat = modelled ? HIDDEN : M.darkWood;
    b.box(w, 0.06, d, mat, x, y + 0.72, z);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.07, 0.72, 0.07, mat, x + sx * (w / 2 - 0.08), y, z + sz * (d / 2 - 0.08), { solid: false });
    const blocker = b.box(w, 0.78, d, HIDDEN, x, y, z);   // one box to bump into
    return blocker;
  },
  desk(b, x, y, z, rotY = 0) {
    // An officer's desk, or (one in three) the radio set on its table.
    const modelled = pick(x, z, 3) === 0 ? furnish(b, 'radioSet', { x: 1.5, y: 1.25, z: 0.8 }, x, y, z, rotY) : furnish(b, 'desk', { x: 1.5, y: 1.05, z: 0.8 }, x, y, z, rotY);
    b.box(1.5, 0.75, 0.75, modelled ? HIDDEN : M.darkWood, x, y, z);
    b.box(1.5, 0.04, 0.78, modelled ? HIDDEN : M.wood, x, y + 0.75, z, { solid: false });
  },
  cabinet(b, x, y, z, w = 1.0, d = 0.45, h = 1.9) {
    const modelled = furnish(b, h > 1.6 ? 'locker' : 'filingCabinet', { x: w, y: h, z: d }, x, y, z);
    b.box(w, h, d, modelled ? HIDDEN : M.darkWood, x, y, z);
  },
  bed(b, x, y, z, alongX = true) {
    const [w, d] = alongX ? [2.0, 0.95] : [0.95, 2.0];
    const modelled = furnish(b, 'bunk', { x: 2.0, y: 1.7, z: 0.95 }, x, y, z, alongX ? 0 : Math.PI / 2);
    b.box(w, 0.45, d, modelled ? HIDDEN : M.wood, x, y, z);
    b.box(w - 0.1, 0.12, d - 0.1, modelled ? HIDDEN : BLANKET, x, y + 0.45, z, { solid: false });
  },
  crates(b, x, y, z, n = 3) {
    // The modelled crate stack over the blocks (which stay as cover), when it's loaded.
    const rows = Math.ceil(n / 2), model = propModel('crates', { x: n > 1 ? 1.7 : 0.9, y: rows * 0.82, z: 0.95 }, { stretch: true });
    for (let i = 0; i < n; i++) b.box(0.8, 0.8, 0.8, model ? HIDDEN : M.crate, x + (i % 2) * 0.85, y + Math.floor(i / 2) * 0.8, z + (i % 3) * 0.1);
    if (model) { model.position.set(x + (n > 1 ? 0.425 : 0), y, z + 0.1); model.rotation.y = (x * 7 + z * 3) % 2 < 1 ? 0 : Math.PI; b.group.add(model); }
  },
  shelf(b, x, y, z, alongX = true) { b.box(alongX ? 1.8 : 0.4, 2.0, alongX ? 0.4 : 1.8, M.wood, x, y, z); },
};
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const BLANKET = new THREE.MeshStandardMaterial({ color: 0x5b6b4a, roughness: 1 });

// The legs of a watchtower or a hunting stand: four squared posts from the ground (y) up to the
// roof, a girt round them halfway up the legs, and an X of braces on every face in each storey up
// to the deck: one frame, all joined. `half`: half the span between post centres.
export function timberFrame(b, { x, z, y, deck, roof, half, post = 0.25, brace = 0.12, mat = M.darkWood }) {
  for (const dx of [-half, half]) for (const dz of [-half, half]) b.box(post, roof - y, post, mat, x + dx, y, z + dz);
  const mid = (y + deck) / 2, levels = [[y + 0.3, mid], [mid, deck - 0.1]];
  const timber = (from, to) => {
    const geo = new THREE.BoxGeometry(brace, from.distanceTo(to), brace);
    worldUVs(geo, mat.userData.tile);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    m.castShadow = m.receiveShadow = true;
    b.group.add(m);
  };
  const out = post / 2 + brace / 2 - 0.015;     // (each face's braces sit on the posts' outer faces, not through them)
  for (const [ax, az, bx, bz, ox, oz] of [[-1, -1, 1, -1, 0, -1], [-1, 1, 1, 1, 0, 1], [-1, -1, -1, 1, -1, 0], [1, -1, 1, 1, 1, 0]]) {
    const P = (sx, sz, py) => new THREE.Vector3(x + sx * half + ox * out, py, z + sz * half + oz * out);
    b.box(Math.abs(bx - ax) * half + post + 0.05, brace + 0.04, Math.abs(bz - az) * half + post + 0.05, mat, x + (ax + bx) * half / 2 + ox * out, mid - 0.08, z + (az + bz) * half / 2 + oz * out, { solid: false });
    for (const [lo, hi] of levels) { timber(P(ax, az, lo), P(bx, bz, hi)); timber(P(bx, bz, lo), P(ax, az, hi)); }
  }
}

// A ladder up a wall face to a roof or platform at `top`. face 's': the ladder hangs on a south
// face (you stand south of it, facing north, and step off northward); 'n' the other way.
// Returns the climbing data the player uses (push it onto the map's `ladders`).
export function ladder(b, { x, z, y, top, face = 's' }) {
  const s = face === 's' ? 1 : -1;
  for (const dx of [-0.3, 0.3]) b.box(0.07, top - y + 1.0, 0.07, M.wood, x + dx, y, z, { solid: false });
  const n = Math.floor((top - y) / 0.4);
  for (let i = 0; i < n; i++) b.box(0.6, 0.05, 0.05, M.wood, x, y + 0.35 + i * 0.4, z, { solid: false });
  return {
    foot: new THREE.Vector3(x, y, z + s * 0.45),
    topSpot: new THREE.Vector3(x, top, z - s * 0.7),
    bottom: y, top,
    yaw: s > 0 ? 0 : Math.PI,
  };
}
