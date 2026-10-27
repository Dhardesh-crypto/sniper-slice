// Where guards can walk: a 1 m grid over the compound and its surroundings, built from the
// world's collision boxes (walls, buildings, crates), with A* for paths and string-pulling
// to straighten them. Outside the grid the land is open: guards walk straight there.
// Each upper floor of a walk-in building (buildings.js `storeys`) has its own finer grid, built
// from the walls and furniture at that height, joined to the ground's by its flight of stairs: a
// route between floors goes to the foot of the stairs, up the flight, and on across the floor.
import * as THREE from 'three';
import { COMPOUND, activeMap } from '../world/terrain.js';

const CELL = 1;
const HALF_DEFAULT = 110;   // the grid covers 220 × 220 m around the target area (a map can ask for more)
const CLEARANCE = 0.45;     // a guard's radius plus a little
const STOREY_CELL = 0.5, STOREY_CLEAR = 0.3;   // indoors: rooms and doorways need a finer grid

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n, f) {
    const a = this.a;
    a.push([f, n]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
}

// A rectangle of cells (the ground's, or one upper floor's), and A* over it.
class Grid {
  init(x0, z0, nx, nz, cell) {
    Object.assign(this, { x0, z0, nx, nz, cell });
    this.blocked = new Uint8Array(nx * nz);
    this.g = new Float32Array(nx * nz);
    this.from = new Int32Array(nx * nz);
    this.stamp = new Uint32Array(nx * nz);
    this.search = 0;
  }

  // Block every cell within `clear` of the box's footprint.
  blockBox(b, clear) {
    const i0 = Math.max(0, this.ix(b.min.x - clear)), i1 = Math.min(this.nx - 1, this.ix(b.max.x + clear));
    const j0 = Math.max(0, this.iz(b.min.z - clear)), j1 = Math.min(this.nz - 1, this.iz(b.max.z + clear));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = this.x0 + (i + 0.5) * this.cell, cz = this.z0 + (j + 0.5) * this.cell;
      if (cx > b.min.x - clear && cx < b.max.x + clear && cz > b.min.z - clear && cz < b.max.z + clear) this.blocked[j * this.nx + i] = 1;
    }
  }

  // Keep the cells along a → b open (a doorway's lane, the way into a nest).
  openLine(a, b) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.cell / 2)));
    for (let k = 0; k <= steps; k++) {
      const i = this.ix(a.x + (b.x - a.x) * k / steps), j = this.iz(a.z + (b.z - a.z) * k / steps);
      if (this.inside(i, j)) this.blocked[j * this.nx + i] = 0;
    }
  }

  ix(x) { return Math.floor((x - this.x0) / this.cell); }
  iz(z) { return Math.floor((z - this.z0) / this.cell); }
  inside(i, j) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz; }
  center(k, y = 0) { return new THREE.Vector3(this.x0 + ((k % this.nx) + 0.5) * this.cell, y, this.z0 + (Math.floor(k / this.nx) + 0.5) * this.cell); }
  walkable(x, z) {
    const i = this.ix(x), j = this.iz(z);
    return !this.inside(i, j) || !this.blocked[j * this.nx + i];
  }

  // The nearest open cell to (x, z), clamped onto the grid.
  nearestOpen(x, z) {
    const ci = THREE.MathUtils.clamp(this.ix(x), 0, this.nx - 1), cj = THREE.MathUtils.clamp(this.iz(z), 0, this.nz - 1);
    for (let r = 0; r < 12; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (this.inside(i, j) && !this.blocked[j * this.nx + i]) return j * this.nx + i;
      }
    }
    return -1;
  }

  // Straight walk from a to b without crossing a blocked cell?
  clearLine(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.ceil(d / (this.cell * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  // Waypoints from `a` to `b` (both world positions) on this grid, or null when there's no way.
  pathOn(a, b) {
    if (this.clearLine(a, b)) return [b.clone()];
    const start = this.nearestOpen(a.x, a.z), goal = this.nearestOpen(b.x, b.z);
    if (start < 0 || goal < 0) return null;
    const n = this.nx, gi = goal % n, gj = Math.floor(goal / n);
    const h = (k) => { const dx = Math.abs(k % n - gi), dz = Math.abs(Math.floor(k / n) - gj); return dx + dz - 0.586 * Math.min(dx, dz); };
    const stamp = ++this.search;
    const open = new Heap();
    this.stamp[start] = stamp; this.g[start] = 0; this.from[start] = -1;
    open.push(start, h(start));
    let found = false, expanded = 0;
    while (open.size && expanded < 40000) {
      const k = open.pop();
      if (k === goal) { found = true; break; }
      expanded++;
      const i = k % n, j = Math.floor(k / n), gk = this.g[k];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (!this.inside(ni, nj)) continue;
        const nk = nj * n + ni;
        if (this.blocked[nk]) continue;
        if (di && dj && (this.blocked[j * n + ni] || this.blocked[nj * n + i])) continue; // no corner cutting
        const ng = gk + (di && dj ? 1.414 : 1);
        if (this.stamp[nk] === stamp && ng >= this.g[nk]) continue;
        this.stamp[nk] = stamp; this.g[nk] = ng; this.from[nk] = k;
        open.push(nk, ng + h(nk));
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = this.from[k]) cells.push(k);
    cells.reverse();
    // String-pull: keep only the corners needed to stay off blocked cells.
    const pts = cells.map(k => this.center(k));
    const out = [];
    let anchor = a.clone();
    for (let i = 1; i < pts.length; i++) {
      if (!this.clearLine(anchor, pts[i])) { out.push(pts[i - 1]); anchor = pts[i - 1]; }
    }
    // Finish at the real target if it's reachable from the last cell (it may be off the grid).
    out.push(this.clearLine(pts.at(-1), b) ? b.clone() : pts.at(-1));
    return out;
  }
}

export class NavGrid extends Grid {
  constructor(world) {
    super();
    this.world = world;
    const HALF = activeMap().navHalf ?? HALF_DEFAULT;
    this.n = Math.round((2 * HALF) / CELL);
    this.x0 = COMPOUND.x - HALF;
    this.z0 = COMPOUND.z - HALF;
    this.init(this.x0, this.z0, this.n, this.n, CELL);
    // A box blocks if it stands between ankle and head height off the ground under it.
    for (const b of world.boxes) {
      if (world.doorBoxes?.has(b)) continue;      // doors: guards open them as they pass
      const ground = world.groundAt((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
      if (b.max.y < ground + 0.55 || b.min.y > ground + 1.8) continue;
      const i0 = this.ix(b.min.x - CLEARANCE), i1 = this.ix(b.max.x + CLEARANCE);
      const j0 = this.iz(b.min.z - CLEARANCE), j1 = this.iz(b.max.z + CLEARANCE);
      for (let j = Math.max(0, j0); j <= Math.min(this.n - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(this.n - 1, i1); i++) {
          const cx = this.x0 + (i + 0.5) * CELL, cz = this.z0 + (j + 0.5) * CELL;
          if (cx > b.min.x - CLEARANCE && cx < b.max.x + CLEARANCE && cz > b.min.z - CLEARANCE && cz < b.max.z + CLEARANCE) this.blocked[j * this.n + i] = 1;
        }
      }
    }
    for (const t of world.trees) {
      const i = this.ix(t.x), j = this.iz(t.z);
      if (this.inside(i, j)) this.blocked[j * this.n + i] = 1;
    }
    // Ground the map rules out (a gorge's cliffs).
    const navBlocked = activeMap().navBlocked;
    if (navBlocked) for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      if (navBlocked(this.x0 + (i + 0.5) * CELL, this.z0 + (j + 0.5) * CELL)) this.blocked[j * this.n + i] = 1;
    }
    // Water (a harbour, the sea): nobody walks there.
    if (world.waterLevel != null) {
      for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
        if (world.groundAt(this.x0 + (i + 0.5) * CELL, this.z0 + (j + 0.5) * CELL) < world.waterLevel - 0.3) this.blocked[j * this.n + i] = 1;
      }
    }
    // Ground the map opens whatever is under it (a bridge deck over the river).
    const navOpen = activeMap().navOpen;
    if (navOpen) for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      if (navOpen(this.x0 + (i + 0.5) * CELL, this.z0 + (j + 0.5) * CELL)) this.blocked[j * this.n + i] = 0;
    }
    // Doorways: the clearance closes a 1 m opening on a 1 m grid, so keep a lane of cells open
    // straight through each door (and a cell either side of the wall).
    for (const b of world.doorBoxes ?? []) {
      const mx = (b.min.x + b.max.x) / 2, mz = (b.min.z + b.max.z) / 2, alongX = b.max.x - b.min.x > b.max.z - b.min.z;
      for (let k = -1; k <= 1; k++) {
        const x = alongX ? mx : mx + k * CELL, z = alongX ? mz + k * CELL : mz;
        const i = this.ix(x), j = this.iz(z);
        if (this.inside(i, j)) this.blocked[j * this.n + i] = 0;
      }
    }
    // Lanes kept open on purpose (the way into a machine-gun nest, mgnest.js): [from, to] pairs.
    for (const [a, b] of world.navLanes ?? []) {
      const steps = Math.ceil(a.distanceTo(b) / (CELL / 2));
      for (let k = 0; k <= steps; k++) {
        const i = this.ix(a.x + (b.x - a.x) * k / steps), j = this.iz(a.z + (b.z - a.z) * k / steps);
        if (this.inside(i, j)) this.blocked[j * this.n + i] = 0;
      }
    }
    // The upper floors, each joined to the floor below it (the ground, for a first floor).
    this.storeys = (world.storeys ?? []).map(st => new Storey(world, st));
    for (const s of this.storeys) s.below = s.f > 1 ? this.storeys.find(o => o.building === s.building && o.f === s.f - 1) ?? this : this;
  }

  // Which grid a point is on: an upper floor it stands on (or is nearly up to), or the ground.
  levelOf(p) { return this.storeys.find(s => s.holds(p)) ?? this; }
  onStorey(p) { return this.levelOf(p) !== this; }

  // Waypoints from `a` to `b` (world positions, on any floors), or null when there's no way.
  path(a, b) {
    const la = this.levelOf(a), lb = this.levelOf(b);
    if (la === lb) return la.pathOn(a, b);
    // Down from a's floor and up to b's, through the lowest floor both are over.
    const down = (l) => { const c = []; for (let x = l; x !== this; x = x.below) c.push(x); return c; };
    const ca = down(la), cb = down(lb);
    while (ca.length && cb.length && ca.at(-1) === cb.at(-1)) { ca.pop(); cb.pop(); }
    const out = [];
    let at = a, on = la;
    const leg = (to) => { const p = on.pathOn(at, to); if (!p) return false; out.push(...p); at = to; return true; };
    for (const s of ca) {                      // to the head of the flight, down it to the foot
      if (!s.head || !leg(s.head)) return null;
      out.push(s.foot.clone()); at = s.foot; on = s.below;
    }
    for (const s of cb.reverse()) {            // to the foot of the flight, up it to the head
      if (!s.foot || !leg(s.foot)) return null;
      out.push(s.head.clone()); at = s.head; on = s;
    }
    return leg(b) ? out : null;
  }

}

// One upper floor: its inside on a 0.5 m grid, blocked by whatever stands at its height (walls,
// furniture, the flight up to the next floor) and by the stairwell; doorways kept open.
class Storey extends Grid {
  constructor(world, st) {
    super();
    Object.assign(this, st);         // x0, z0, x1, z1, y, f, building, foot, head, well
    this.init(st.x0, st.z0, Math.ceil((st.x1 - st.x0) / STOREY_CELL), Math.ceil((st.z1 - st.z0) / STOREY_CELL), STOREY_CELL);
    const here = (b) => b.max.y > st.y + 0.55 && b.min.y < st.y + 1.8 && b.max.x > st.x0 && b.min.x < st.x1 && b.max.z > st.z0 && b.min.z < st.z1;
    for (const b of world.boxes) if (!world.doorBoxes?.has(b) && here(b)) this.blockBox(b, STOREY_CLEAR);
    if (st.well) this.blockBox({ min: { x: st.well[0], z: st.well[1] }, max: { x: st.well[2], z: st.well[3] } }, 0.05);
    for (const b of world.doorBoxes ?? []) {
      if (!here(b)) continue;
      const mx = (b.min.x + b.max.x) / 2, mz = (b.min.z + b.max.z) / 2, alongX = b.max.x - b.min.x > b.max.z - b.min.z;
      for (const k of [-0.25, 0, 0.25]) {
        if (alongX) this.openLine({ x: mx + k, z: mz - 0.7 }, { x: mx + k, z: mz + 0.7 });
        else this.openLine({ x: mx - 0.7, z: mz + k }, { x: mx + 0.7, z: mz + k });
      }
    }
    if (st.head) this.openLine(st.head, st.head);
  }

  // Standing on this floor (or high enough up its stairs to be counted on it)?
  holds(p) {
    return p.y > this.y - 0.9 && p.y < this.y + 2.4 && p.x > this.x0 - 0.3 && p.x < this.x1 + 0.3 && p.z > this.z0 - 0.3 && p.z < this.z1 + 0.3;
  }
}
