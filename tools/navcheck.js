// Dev tool: does the interior furniture (interior.js, its collision boxes) cut off any of the
// guards' walkable ground? Builds the nav grid with and without the furniture boxes and flood-fills
// from every guard; reports the cells that were reachable before and aren't now (other than those
// the furniture itself stands on), and whether each guard can still path to every walk-in room.
//   const c = await import('/tools/navcheck.js'); await c.check()
import * as THREE from 'three';
import { NavGrid } from '/src/ai/nav.js';

export async function check() {
  while (!window.game) await new Promise(r => setTimeout(r, 300));
  const w = window.game.world, all = w.boxes, furniture = all.filter(b => b.furniture);
  w.boxes = all.filter(b => !b.furniture);
  const before = new NavGrid(w);
  w.boxes = all;
  const after = new NavGrid(w);
  const n = after.n;
  const flood = (nav) => {
    const seen = new Uint8Array(n * n), stack = [];
    for (const s of w.soldiers) {
      const k = nav.nearestOpen(s.root.position.x, s.root.position.z);
      if (k != null && !seen[k]) { seen[k] = 1; stack.push(k); }
    }
    while (stack.length) {
      const k = stack.pop(), i = k % n, j = (k - i) / n;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, c = j + dj, q = c * n + a;
        if (a < 0 || c < 0 || a >= n || c >= n || seen[q] || nav.blocked[q]) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    return seen;
  };
  const r0 = flood(before), r1 = flood(after);
  let lost = 0, newlyBlocked = 0;
  const lostAt = [];
  for (let k = 0; k < n * n; k++) {
    if (after.blocked[k] && !before.blocked[k]) newlyBlocked++;
    if (r0[k] && !r1[k] && !after.blocked[k]) { lost++; if (lostAt.length < 10) lostAt.push(after.center(k).toArray().map(v => +v.toFixed(1))); }
  }
  // Paths from each guard into each walk-in building's middle.
  const walkIns = [...(w.site.walkIns ?? []), w.villa, w.site.hall, w.site.lodge, w.site.office].filter(Boolean)
    .map(x => x.hb ?? x).filter(h => h.x != null && h.floorY);
  let paths = 0, failed = 0, failedBefore = 0;
  const ok = (nav, a, b) => { const p = nav.path(a, b); return !!(p && p.length); };
  for (const s of w.soldiers.slice(0, 12)) for (const h of walkIns) {
    paths++;
    if (!ok(after, s.root.position, new THREE.Vector3(h.x, h.floorY(0), h.z))) failed++;
    if (!ok(before, s.root.position, new THREE.Vector3(h.x, h.floorY(0), h.z))) failedBefore++;
  }
  return { furniture: furniture.length, newlyBlocked, lost, lostAt, walkIns: walkIns.length, paths, failed, failedBefore };
}
