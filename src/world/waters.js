// Water at more than one height. Until now a map had one flat sheet (`waterLevel`: the sea, or the
// river in the gorge). A map can now also declare `waters`: a list of bodies, each at its own
// height, on top of (or instead of) that sheet:
//   { kind: 'pond', level, area }                  a lake or mill pond: flat, inside an area
//                                                  (landforms.js region: circle, box, polygon, strip)
//   { kind: 'marsh', level, area, wade }           the same, shallow: standing water among hummocks
//   { kind: 'river', path, width, levelAt | from, to | levels, depth }
//                                                  a strip along a line whose surface falls with it
// Each may set `wade` (how deep you can walk through it; default: the map's `wade`) and `calm`
// (0…1: how much its waves are damped). The pieces in landforms.js that hold water (riverBed,
// lakeBasin, marshFlat, ditch) make these for you: `waters: heightAt.waters`.
//
// Two questions, both pure (no three.js: tests/waters.test.js):
//   surfaceAt(x, z)  the surface of the body whose outline covers (x, z), whether or not the
//                    ground there is under it (a lake's level on its shore), or null;
//   waterAt(x, z)    that surface only where there is water over the ground, else null.
// Where bodies overlap (a river running into a lake, the sea under a harbour basin) the highest
// surface that is over the ground wins.
import { makePath, locator, region } from './landforms.js';
import { lerp, clamp, smoothstep } from './noise.js';

const MARGIN = 1.5;   // m a river's water reaches past its nominal width (the bed's edge is soft)

function prepare(b, map) {
  const body = { ...b, wade: b.wade ?? map.wade ?? null };
  if (b.kind === 'river') {
    const P = makePath(b.path), near = locator(P, b.width / 2 + MARGIN);
    let levelAt = b.levelAt;
    if (!levelAt) {
      const lv = b.levels, from = b.from ?? 0, to = b.to ?? from;
      levelAt = lv ? (t) => { let i = 0; while (i < P.ctrl.length - 2 && P.ctrl[i + 1] < t) i++; return lerp(lv[i], lv[i + 1], smoothstep(P.ctrl[i], P.ctrl[i + 1], t)); }
        : (t) => lerp(from, to, clamp(t / (P.length || 1), 0, 1));
    }
    body.path = P; body.levelAt = levelAt;
    body.surface = (x, z) => { const n = near(x, z); return n ? levelAt(n.t) : null; };
    // The surface nearest a point however far off (for baking its depth picture: water.js).
    const any = locator(P, Infinity, { exact: true });
    body.surfaceNear = (x, z) => levelAt(any(x, z).t);
    const w = b.width / 2 + MARGIN;
    body.box = { x0: P.box.x0 - w, x1: P.box.x1 + w, z0: P.box.z0 - w, z1: P.box.z1 + w };
  } else {
    const A = b.area ? region(b.area) : null;
    body.surface = A ? (x, z) => (A.sd(x, z) <= 0 ? b.level : null) : () => b.level;
    body.surfaceNear = () => b.level;
    body.box = A?.box ?? null;        // (no area: everywhere, as the old sheet is)
    body.area = A;
  }
  return body;
}

// The water of one map: { bodies, any, surfaceAt, bodyAt, waterAt }. heightAt: the map's ground
// (with its craters and pads, as the game walks on it).
export function makeWaters(map, heightAt) {
  const bodies = (map.waters ?? []).map(b => prepare(b, map));
  // The old sheet counts as a body too, so waterAt answers for every map; it is drawn and waded
  // the old way (world.js), which is why it is marked.
  if (map.waterLevel != null) bodies.push({ ...prepare({ kind: 'sea', level: map.waterLevel }, map), sheet: true });
  // The body whose outline covers (x, z) with the highest surface over the ground there; failing
  // one over the ground, the highest all the same (you are on its shore).
  const bodyAt = (x, z) => {
    let best = null, bl = -Infinity, wet = false;
    const g = bodies.length > 1 ? heightAt(x, z) : 0;
    for (const b of bodies) {
      if (b.box && (x < b.box.x0 || x > b.box.x1 || z < b.box.z0 || z > b.box.z1)) continue;
      const l = b.surface(x, z);
      if (l == null) continue;
      const w = bodies.length > 1 && l > g;
      if ((w && !wet) || (w === wet && l > bl)) { best = b; bl = l; wet = w; }
    }
    if (best) best.at = bl;
    return best;
  };
  const surfaceAt = (x, z) => { const b = bodyAt(x, z); return b ? b.at : null; };
  const waterAt = (x, z) => { const b = bodyAt(x, z); return b && b.at > heightAt(x, z) ? b.at : null; };
  return { bodies, any: bodies.length > 0, declared: (map.waters ?? []).length > 0, bodyAt, surfaceAt, waterAt };
}
