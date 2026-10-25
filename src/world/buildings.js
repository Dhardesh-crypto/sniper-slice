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
import { M } from './kit.js';
import { worldUVs } from './textures.js';

const RISE = 0.24, RUN = 0.3;
const DOOR_MAT = M.darkWood;

export function building(b, o) {
  const { x, z, y, w, d, floors = 1, h = 3.2, wall = 0.25, mat = M.plaster, floorMat = M.wood, roof = 'gable', roofMat = M.roof } = o;
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
      wallRun(b, sd, y + f * h, h, wall, mat, ops, doors, side);
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
  // A plank floor inside on the ground storey (just above the ground, so it's walked on).
  b.box(w - 2 * wall, 0.06, d - 2 * wall, floorMat, x, y, z, { solid: false });
  // Stairs: one flight per storey, all stacked in the same well.
  if (st) for (let f = 0; f < floors - 1; f++) stairs(b, x + st.at[0], z + st.at[1], y + f * h, h, st.dir, st.w ?? 1.0, floorMat);
  out.stairsFoot = st ? new THREE.Vector3(x + st.at[0], y, z + st.at[1]) : null;
  // Interior walls.
  for (const iw of o.walls ?? []) {
    const f = iw.floor ?? 0, len = iw.to - iw.from, mid = (iw.from + iw.to) / 2;
    const sd = iw.axis === 'x' ? { cx: x + mid, cz: z + iw.at, len, alongX: true } : { cx: x + iw.at, cz: z + mid, len, alongX: false };
    wallRun(b, sd, y + f * h, h - 0.18, 0.15, iw.mat ?? mat, (iw.openings ?? []).map(op => ({ ...op, at: op.at - mid, h: op.h ?? 2.1 })), doors, iw.axis === 'x' ? 'n' : 'w');
  }
  // The roof.
  if (roof === 'gable') b.gable(w, Math.min(2.8, d * 0.28), d, roofMat, x, y + floors * h, z);
  else for (const [dx, dz, ww, dd] of [[0, -d / 2, w + 0.3, 0.3], [0, d / 2, w + 0.3, 0.3], [-w / 2, 0, 0.3, d], [w / 2, 0, 0.3, d]]) {
    b.box(ww, 0.9, dd, mat, x + dx, y + floors * h, z + dz);            // parapet around a flat roof
  }
  return out;
}

// A run of wall from `sd` (centre, length, direction), split around openings.
function wallRun(b, sd, y0, h, t, mat, ops, doors, side) {
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
    if (c.window) shutters(b, sd, y0, c, t, side);
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
    if (sd.alongX) b.box(0.44, hh + 0.1, 0.05, M.shutter, sd.cx + at, y0 + bottom - 0.05, sd.cz + out, { solid: false });
    else b.box(0.05, hh + 0.1, 0.44, M.shutter, sd.cx + out, y0 + bottom - 0.05, sd.cz + at, { solid: false });
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
export const furniture = {
  table(b, x, y, z, w = 1.6, d = 0.9) {
    b.box(w, 0.06, d, M.darkWood, x, y + 0.72, z);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.07, 0.72, 0.07, M.darkWood, x + sx * (w / 2 - 0.08), y, z + sz * (d / 2 - 0.08), { solid: false });
    const blocker = b.box(w, 0.78, d, HIDDEN, x, y, z);   // one box to bump into
    return blocker;
  },
  desk(b, x, y, z, rotY = 0) {
    b.box(1.5, 0.75, 0.75, M.darkWood, x, y, z);
    b.box(1.5, 0.04, 0.78, M.wood, x, y + 0.75, z, { solid: false });
  },
  cabinet(b, x, y, z, w = 1.0, d = 0.45, h = 1.9) { b.box(w, h, d, M.darkWood, x, y, z); },
  bed(b, x, y, z, alongX = true) {
    const [w, d] = alongX ? [2.0, 0.95] : [0.95, 2.0];
    b.box(w, 0.45, d, M.wood, x, y, z);
    b.box(w - 0.1, 0.12, d - 0.1, BLANKET, x, y + 0.45, z, { solid: false });
  },
  crates(b, x, y, z, n = 3) {
    for (let i = 0; i < n; i++) b.box(0.8, 0.8, 0.8, M.crate, x + (i % 2) * 0.85, y + Math.floor(i / 2) * 0.8, z + (i % 3) * 0.1);
  },
  shelf(b, x, y, z, alongX = true) { b.box(alongX ? 1.8 : 0.4, 2.0, alongX ? 0.4 : 1.8, M.wood, x, y, z); },
};
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const BLANKET = new THREE.MeshStandardMaterial({ color: 0x5b6b4a, roughness: 1 });
