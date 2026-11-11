// Several roads and tracks on one map. Until now a map had one road, a function `roadCenterZ(x)`
// (its z for each x: it could only run west to east). A map can now also declare
//   roads: [{ id: 'main', kind: 'road', width: 5, path: [[x, z], …] }, { id: 'mill', kind: 'track', … }]
// kind: 'road' (metalled or hard dirt, vehicles), 'track' (a cart track: two ruts), 'path' (a
// footpath); width in metres (defaults 5, 3 and 1.2); path a polyline, rounded into a curve unless
// `smooth: false`. The first road in the list is the main one: it answers the old roadCenterZ(x),
// so the truck, the staff-car patrol and the cypress avenue still find a road on a new map.
//
//   nearestRoad(x, z)   → { road, id, kind, width, d, on, x, z, t, dx, dz } or null (a map with none):
//                         the nearest point on any road, d metres away (on: you are on it), t metres
//                         along that road, (dx, dz) the way it runs there.
// Pure (no three.js: tests/roads.test.js); terrain.js paints the ground along each and keeps trees
// and grass off them.
import { makePath, locator } from './landforms.js';
import { smoothstep } from './noise.js';

const WIDTH = { road: 5, track: 3, path: 1.2 };
const NEAR = 60;      // m: roads within this are found through each one's grid; beyond it, the slow way

export function makeRoads(map) {
  const roads = (map.roads ?? []).map((r, i) => {
    const kind = r.kind ?? 'road', P = makePath(r.path, r);
    return { ...r, id: r.id ?? `road${i}`, kind, width: r.width ?? WIDTH[kind] ?? 4, path: P, near: locator(P, NEAR), far: locator(P, Infinity, { exact: true }) };
  });
  const hit = (r, n) => ({ road: r, id: r.id, kind: r.kind, width: r.width, d: n.d, on: n.d <= r.width / 2, x: n.x, z: n.z, t: n.t, dx: n.dx, dz: n.dz });

  function nearestRoad(x, z) {
    let best = null;
    for (const r of roads) { const n = r.near(x, z); if (n && (!best || n.d < best.d)) best = hit(r, n); }
    if (!best) for (const r of roads) { const n = r.far(x, z); if (n && (!best || n.d < best.d)) best = hit(r, n); }
    if (best || !map.roadCenterZ) return best;
    // An old map: one road, known only as z for each x. The point of it straight across from you
    // (north or south), which is the nearest but for the road's slant.
    const rz = map.roadCenterZ(x);
    if (!Number.isFinite(rz)) return null;
    const dz = map.roadCenterZ(x + 1) - rz, len = Math.hypot(1, Number.isFinite(dz) ? dz : 0);
    return { road: null, id: 'main', kind: 'road', width: 5, d: Math.abs(z - rz), on: Math.abs(z - rz) <= 2.5, x, z: rz, t: NaN, dx: 1 / len, dz: (Number.isFinite(dz) ? dz : 0) / len };
  }

  // The main road's z where it crosses this x (the old question), NaN where it doesn't reach.
  function centerZ(x) {
    const P = roads[0]?.path;
    if (!P) return NaN;
    for (let i = 0; i < P.pts.length - 1; i++) {
      const [x0, z0] = P.pts[i], [x1, z1] = P.pts[i + 1];
      if ((x0 <= x && x <= x1) || (x1 <= x && x <= x0)) return x1 === x0 ? z0 : z0 + (z1 - z0) * (x - x0) / (x1 - x0);
    }
    return NaN;
  }

  // How much of a road's colour the ground takes at (x, z), 0…1, and which kind: a road is worn
  // bare across its width, a track mostly in its two ruts, a path only faintly.
  function wear(x, z) {
    let w = 0, kind = null;
    for (const r of roads) {
      const n = r.near(x, z);
      if (!n || n.d > r.width / 2 + 2) continue;
      let k = 1 - smoothstep(r.width / 2 - 0.6, r.width / 2 + 1.2, n.d);
      if (r.kind === 'track') k *= Math.abs(n.d - r.width * 0.28) < 0.5 ? 1 : 0.55;      // (the ruts bare, grass between and beside)
      else if (r.kind === 'path') k *= 0.6;
      if (k > w) { w = k; kind = r.kind; }
    }
    return w ? { w, kind } : null;
  }

  // Is (x, z) on a road, or within `margin` m of one? (Trees, grass and stones keep off.)
  const clear = (x, z, margin = 0) => roads.some(r => { const n = r.near(x, z); return n && n.d < r.width / 2 + 0.5 + margin; });

  return { roads, any: roads.length > 0, nearestRoad, centerZ, wear, clear };
}
