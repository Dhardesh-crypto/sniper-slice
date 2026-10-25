// Where guards can walk: a 1 m grid over the compound and its surroundings, built from the
// world's collision boxes (walls, buildings, crates), with A* for paths and string-pulling
// to straighten them. Outside the grid the land is open: guards walk straight there.
import * as THREE from 'three';
import { COMPOUND, activeMap } from '../world/terrain.js';

const CELL = 1;
const HALF_DEFAULT = 110;   // the grid covers 220 × 220 m around the target area (a map can ask for more)
const CLEARANCE = 0.45;     // a guard's radius plus a little

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

export class NavGrid {
  constructor(world) {
    this.world = world;
    const HALF = activeMap().navHalf ?? HALF_DEFAULT;
    this.n = Math.round((2 * HALF) / CELL);
    this.x0 = COMPOUND.x - HALF;
    this.z0 = COMPOUND.z - HALF;
    this.blocked = new Uint8Array(this.n * this.n);
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
    // Water (a harbour, the sea): nobody walks there.
    if (world.waterLevel != null) {
      for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
        if (world.groundAt(this.x0 + (i + 0.5) * CELL, this.z0 + (j + 0.5) * CELL) < world.waterLevel - 0.3) this.blocked[j * this.n + i] = 1;
      }
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
    this.g = new Float32Array(this.n * this.n);
    this.from = new Int32Array(this.n * this.n);
    this.stamp = new Uint32Array(this.n * this.n);
    this.search = 0;
  }

  ix(x) { return Math.floor((x - this.x0) / CELL); }
  iz(z) { return Math.floor((z - this.z0) / CELL); }
  inside(i, j) { return i >= 0 && j >= 0 && i < this.n && j < this.n; }
  center(k, y = 0) { return new THREE.Vector3(this.x0 + ((k % this.n) + 0.5) * CELL, y, this.z0 + (Math.floor(k / this.n) + 0.5) * CELL); }
  walkable(x, z) {
    const i = this.ix(x), j = this.iz(z);
    return !this.inside(i, j) || !this.blocked[j * this.n + i];
  }

  // The nearest open cell to (x, z), clamped onto the grid.
  nearestOpen(x, z) {
    const ci = THREE.MathUtils.clamp(this.ix(x), 0, this.n - 1), cj = THREE.MathUtils.clamp(this.iz(z), 0, this.n - 1);
    for (let r = 0; r < 12; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (this.inside(i, j) && !this.blocked[j * this.n + i]) return j * this.n + i;
      }
    }
    return -1;
  }

  // Straight walk from a to b without crossing a blocked cell?
  clearLine(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.ceil(d / (CELL * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  // Waypoints from `a` to `b` (both world positions), or null when there's no way.
  path(a, b) {
    if (this.clearLine(a, b)) return [b.clone()];
    const start = this.nearestOpen(a.x, a.z), goal = this.nearestOpen(b.x, b.z);
    if (start < 0 || goal < 0) return null;
    const n = this.n, gi = goal % n, gj = Math.floor(goal / n);
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
