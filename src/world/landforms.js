// The terrain kit: named pieces of land a mission puts together into its `heightAt(x, z)`, instead
// of raw noise and two bumps. A map is a base (rolling ground, or a constant) and a list of pieces
// laid over it in order; each piece is a pure function (x, z, h, below) → the new height, where h
// is the height so far and below(x, z) the height so far at any other point (a lane or a road bed
// asks it for the ground along its own centre line, so its floor comes out level across).
//
//   const river = riverBed({ path: [[-600, 40], [-200, 10], [300, -30]], width: 9, from: 38, to: 22 });
//   const heightAt = compose(rolling({ amp: 40, seed: 3 }), [
//     valley({ path: [[-700, 0], [700, 0]], depth: 30, floor: 120, width: 260 }),
//     river, lakeBasin({ x: 320, z: -30, r: 70, level: 22 }),
//   ]);
//   heightAt.steep({ x0: -700, x1: 700, z0: -350, z1: 350 }, { maxSlope: 0.9 })   // where you can't walk
//   heightAt.waters            // the water the pieces hold (river.water, the lake's): a map's `waters`
//
// Lines are polylines [[x, z], …], rounded into curves unless `smooth: false`; areas are a circle
// { x, z, r }, a box { x0, x1, z0, z1 }, a polygon { poly: [[x, z], …] } or a strip { path, width },
// each with `blend` (m over which it fades out past its edge) and `wobble` (m of noise on its edge,
// so no outline is a ruler's). Heights and lengths are metres; slopes are rise over run, the same
// number a map's `maxSlope` is (0.9: about 42°).
// Nothing here knows three.js or the game: it runs in Node for the tests (tests/landforms.test.js).
import { fbm, lerp, smoothstep, clamp } from './noise.js';

// ---- lines ----

// A polyline made ready for questions: its points (rounded into a curve, a point every `step` m),
// how far along each one is, its length and its box. ctrl: how far along each of the given points
// lies (a river's levels are given per point).
export function makePath(points, { smooth = true, step = 4 } = {}) {
  if (points?.pts) return points;                       // (already made)
  let pts = points.map(([x, z]) => [x, z]);
  const ctrlIdx = pts.map((_, i) => i);
  if (smooth && pts.length > 2) {
    // Catmull-Rom through the given points: the curve passes through every one of them.
    const out = [], P = (i) => pts[clamp(i, 0, pts.length - 1)];
    for (let i = 0; i < pts.length - 1; i++) {
      const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
      const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      ctrlIdx[i] = out.length;
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(a => 0.5 * (2 * p1[a] + (p2[a] - p0[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (3 * p1[a] - p0[a] - 3 * p2[a] + p3[a]) * t3)));
      }
    }
    ctrlIdx[pts.length - 1] = out.length;
    out.push(pts.at(-1).slice());
    pts = out;
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  return { pts, cum, length: cum.at(-1), ctrl: ctrlIdx.map(i => cum[i]),
    box: { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) } };
}

// The point `t` metres along a path, and the way the path runs there: { x, z, dx, dz }.
export function pointAt(path, t) {
  const P = makePath(path), { pts, cum } = P;
  t = clamp(t, 0, P.length);
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= t) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1, k = (t - cum[lo]) / seg;
  const dx = (pts[hi][0] - pts[lo][0]) / seg, dz = (pts[hi][1] - pts[lo][1]) / seg;
  return { x: lerp(pts[lo][0], pts[hi][0], k), z: lerp(pts[lo][1], pts[hi][1], k), dx, dz };
}

// The nearest point of segment i to (x, z), written into `o` if it beats o.d.
function nearSeg(P, i, x, z, o) {
  const a = P.pts[i], b = P.pts[i + 1], ex = b[0] - a[0], ez = b[1] - a[1], len2 = ex * ex + ez * ez || 1e-9;
  const k = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / len2, 0, 1);
  const px = a[0] + ex * k, pz = a[1] + ez * k, d = Math.hypot(x - px, z - pz);
  if (d >= o.d) return;
  const len = Math.sqrt(len2);
  o.d = d; o.x = px; o.z = pz; o.i = i; o.t = P.cum[i] + (P.cum[i + 1] - P.cum[i]) * k; o.dx = ex / len; o.dz = ez / len;
  // Which side: + on the path's right hand as the map is drawn (x right, z down): toward +z for a
  // path running toward +x.
  o.s = ((x - px) * -o.dz + (z - pz) * o.dx) >= 0 ? d : -d;
}

// A question asked of one path over and over (every vertex of the ground, every footstep): what is
// its nearest point to (x, z), if that is within `reach` metres? Its segments are sorted into a
// coarse grid once, so each question looks at the few segments near by, not the whole line.
// Returns (x, z) → { d, s, t, x, z, i, dx, dz } or null: d the distance, s the same with a sign
// (+ on its right hand on the map: toward +z for a path running toward +x), t metres along, (dx, dz) the path's direction there. The object
// is reused by the next call: copy what you keep.
export function locator(path, reach = 50, { exact = false } = {}) {
  const o = { d: 0, s: 0, t: 0, x: 0, z: 0, i: 0, dx: 1, dz: 0 };
  // A wide thing (a valley, a ridge, a coast: reach of 100 m and more) doesn't need its line every
  // 4 m: it is asked about a simpler line, with only the points needed to stay within a small
  // share of its reach of the real one (long where it runs straight, short on a bend), or every
  // question would try a hundred segments. Narrow things (roads, rivers, lanes) and anyone who
  // asks for `exact` get the line as it is.
  let P = makePath(path);
  if (!exact && reach >= 100 && P.pts.length > 3) {
    const tol = Math.min(reach, 400) / 150, far = Math.min(reach, 400) / 2, keep = [0];
    for (let i = 2; i < P.pts.length; i++) {
      const a = P.pts[keep.at(-1)], b = P.pts[i], ex = b[0] - a[0], ez = b[1] - a[1], len = Math.hypot(ex, ez) || 1e-9;
      let off = len > far;
      for (let j = keep.at(-1) + 1; j < i && !off; j++) off = Math.abs((P.pts[j][0] - a[0]) * ez - (P.pts[j][1] - a[1]) * ex) / len > tol;
      if (off) keep.push(i - 1);
    }
    keep.push(P.pts.length - 1);
    P = { ...P, pts: keep.map(i => P.pts[i]), cum: keep.map(i => P.cum[i]) };
  }
  const n = P.pts.length - 1;
  // A reach that takes in most of a map (a coast, a border): every segment, no grid.
  if (!(reach < 400) || n <= 6) {
    return (x, z) => { o.d = Infinity; for (let i = 0; i < n; i++) nearSeg(P, i, x, z, o); return o.d <= reach ? o : null; };
  }
  const C = Math.max(16, reach / 2), grid = new Map(), b = P.box;
  for (let i = 0; i < n; i++) {
    const a = P.pts[i], c = P.pts[i + 1];
    const i0 = Math.floor((Math.min(a[0], c[0]) - reach) / C), i1 = Math.floor((Math.max(a[0], c[0]) + reach) / C);
    const j0 = Math.floor((Math.min(a[1], c[1]) - reach) / C), j1 = Math.floor((Math.max(a[1], c[1]) + reach) / C);
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
      const k = ii * 73856093 ^ j * 19349663;
      let l = grid.get(k); if (!l) grid.set(k, l = []);
      l.push(i);
    }
  }
  return (x, z) => {
    if (x < b.x0 - reach || x > b.x1 + reach || z < b.z0 - reach || z > b.z1 + reach) return null;
    const l = grid.get(Math.floor(x / C) * 73856093 ^ Math.floor(z / C) * 19349663);
    if (!l) return null;
    o.d = Infinity;
    for (const i of l) nearSeg(P, i, x, z, o);
    return o.d <= reach ? o : null;
  };
}

// A value given along a path: one number per given point (`levels`), or its two ends (from, to).
// Returns t → the value there. down: each no higher than the one before (water doesn't run uphill).
function along(P, { levels, from, to }, down = false) {
  if (!levels) return (t) => lerp(from, to, clamp(t / (P.length || 1), 0, 1));
  const lv = levels.slice();
  if (lv.length !== P.ctrl.length) throw new Error(`levels: ${lv.length} given for ${P.ctrl.length} points`);
  if (down) for (let i = 1; i < lv.length; i++) lv[i] = Math.min(lv[i], lv[i - 1]);
  return (t) => {
    let i = 0;
    while (i < P.ctrl.length - 2 && P.ctrl[i + 1] < t) i++;
    return lerp(lv[i], lv[i + 1], smoothstep(P.ctrl[i], P.ctrl[i + 1], t));
  };
}

// A line's ends fade out over `taper` metres, so a ridge or a lane doesn't stop like a cut loaf.
const ends = (P, taper) => taper > 0 ? (t) => smoothstep(0, taper, t) * smoothstep(0, taper, P.length - t) : () => 1;

// ---- areas ----

// An area made ready for questions: area(x, z) → 0…1 (1 inside, fading to 0 over `blend` m past
// its edge), area.sd(x, z) → metres outside its edge (negative inside), area.box its reach.
export function region(spec) {
  if (typeof spec === 'function' && spec.sd) return spec;
  const blend = spec.blend ?? 0, wob = spec.wobble ?? 0, seed = spec.seed ?? 0;
  let sd, box;
  if (typeof spec === 'function') { sd = (x, z) => (spec(x, z) ? -1 : 1); box = null; }
  else if (spec.poly) {
    const pts = spec.poly, n = pts.length;
    sd = (x, z) => {
      let inside = false, d = Infinity;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [ax, az] = pts[j], [bx, bz] = pts[i], ex = bx - ax, ez = bz - az;
        const k = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1e-9), 0, 1);
        d = Math.min(d, Math.hypot(x - ax - ex * k, z - az - ez * k));
        if ((az > z) !== (bz > z) && x < ax + (z - az) / (bz - az) * ex) inside = !inside;
      }
      return inside ? -d : d;
    };
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  } else if (spec.path) {
    const P = makePath(spec.path, spec), w = (spec.width ?? 10) / 2, near = locator(P, w + blend + wob + 1);
    sd = (x, z) => { const n = near(x, z); return n ? n.d - w : blend + wob + 1; };
    box = { x0: P.box.x0 - w, x1: P.box.x1 + w, z0: P.box.z0 - w, z1: P.box.z1 + w };
  } else if (spec.r != null) {
    sd = (x, z) => Math.hypot(x - spec.x, z - spec.z) - spec.r;
    box = { x0: spec.x - spec.r, x1: spec.x + spec.r, z0: spec.z - spec.r, z1: spec.z + spec.r };
  } else {
    const { x0, x1, z0, z1 } = spec;
    sd = (x, z) => {
      const dx = Math.max(x0 - x, x - x1), dz = Math.max(z0 - z, z - z1);
      return dx > 0 && dz > 0 ? Math.hypot(dx, dz) : Math.max(dx, dz);
    };
    box = { x0, x1, z0, z1 };
  }
  const m = blend + wob, far = box && { x0: box.x0 - m, x1: box.x1 + m, z0: box.z0 - m, z1: box.z1 + m };
  const edge = wob ? (x, z) => sd(x, z) + (fbm(x * 0.02 + seed * 7.1, z * 0.02 - seed * 3.3, 2) - 0.5) * 2 * wob : sd;
  const f = (x, z) => {
    if (far && (x < far.x0 || x > far.x1 || z < far.z0 || z > far.z1)) return 0;
    const d = edge(x, z);
    return d <= 0 ? 1 : blend > 0 ? 1 - smoothstep(0, blend, d) : 0;
  };
  f.sd = edge; f.box = far; f.spec = spec;
  return f;
}

// ---- the base ----

// Rolling ground: broad swells (amp metres from trough to crest, one every 1/scale m or so) with
// a little fine unevenness on top, about `level`. What every map so far began with.
export function rolling({ amp = 40, scale = 0.0035, level = 0, detail = 2.5, seed = 0, octaves = 4 } = {}) {
  const ox = 3.1 + seed * 17.7, oz = -7.7 + seed * 5.3;
  return (x, z) => level + (fbm(x * scale + ox, z * scale + oz, octaves) - 0.5) * amp + (fbm(x * 0.03 + oz, z * 0.03 + ox, 2) - 0.5) * detail;
}

// ---- the pieces ----

// A ridge: high ground along a crest line, `height` m at the crest and falling away over `width` m
// to either side; rough: how uneven the crest runs (0…1), so it has saddles and tops; sharp > 1
// a narrower, steeper crest.
export function ridge({ path, height = 30, width = 90, rough = 0.3, sharp = 1, taper = 60, seed = 0, ...o }) {
  const P = makePath(path, o), near = locator(P, width), fade = ends(P, taper);
  return (x, z, h) => {
    const n = near(x, z);
    if (!n) return h;
    const crest = height * (1 + rough * (fbm(n.t * 0.012 + seed * 3.7, seed * 1.9, 2) - 0.5) * 2) * fade(n.t);
    return h + crest * Math.pow(1 - smoothstep(0, 1, n.d / width), sharp);
  };
}

// A valley: the ground lowered by `depth` along a line, with a flat floor `floor` m wide and sides
// that climb back to the land around over `width` m each.
export function valley({ path, depth = 25, floor = 60, width = 180, taper = 0, ...o }) {
  const P = makePath(path, o), near = locator(P, floor / 2 + width), fade = ends(P, taper);
  return (x, z, h) => {
    const n = near(x, z);
    return n ? h - depth * fade(n.t) * (1 - smoothstep(floor / 2, floor / 2 + width, n.d)) : h;
  };
}

// Terraces: inside an area, the slope is cut into level treads `step` m apart in height, joined by
// short steep risers (riser: the share of each step's run that the bank takes). Vineyard and olive
// terraces, rice steps, the benches of a hillside village.
export function terraces({ area, step = 3, riser = 0.2 }) {
  const A = region(area);
  return (x, z, h) => {
    const m = A(x, z);
    if (!m) return h;
    const k = h / step, f = k - Math.floor(k);
    return lerp(h, (Math.floor(k) + smoothstep(1 - riser, 1, f)) * step, m);
  };
}

// A cliff band: along a line, the ground on one side (side: 1 the line's right hand on the map, toward +z
// for a line running toward +x; −1 the other) stands `height` m above the other, the face only `run` m wide; behind the edge the high
// ground slopes gently back down over `reach` m (a scarp and its dip slope). rough: metres the foot
// of the face wanders, so it isn't a straight wall.
export function cliffBand({ path, height = 15, run = 5, reach = 140, side = 1, rough = 4, taper = 40, seed = 0, ...o }) {
  const P = makePath(path, o), near = locator(P, reach + rough), fade = ends(P, taper);
  return (x, z, h) => {
    const n = near(x, z);
    if (!n) return h;
    const s = n.s * side + (fbm(n.t * 0.03 + seed * 5.1, seed, 2) - 0.5) * 2 * rough;
    if (s <= -run / 2) return h;
    return h + height * fade(n.t) * smoothstep(-run / 2, run / 2, s) * (1 - smoothstep(run / 2, reach, s));
  };
}

// A ravine: a narrow V cut `depth` m deep and `width` m across from lip to lip, with a bed `bed` m
// wide at the bottom: sides too steep to walk unless it is wide for its depth. Put a river bed in it
// for a stream, and a ford or a sunken lane across it for a way through.
export function ravine({ path, depth = 12, width = 30, bed = 3, taper = 40, ...o }) {
  const P = makePath(path, o), near = locator(P, width / 2), fade = ends(P, taper);
  return (x, z, h) => {
    const n = near(x, z);
    if (!n) return h;
    const p = clamp((n.d - bed / 2) / Math.max(1e-3, width / 2 - bed / 2), 0, 1);
    return h - depth * fade(n.t) * (1 - 0.5 * p - 0.5 * smoothstep(0, 1, p));   // (a V, its lips rounded off)
  };
}

// A plateau: level ground over an area, at `level` (or `height` m above what was there), uneven by
// `rough` m. A small `blend` on the area gives it cliffs for edges, a large one gentle shoulders.
export function plateau({ area, level = null, height = 0, rough = 0.6, seed = 0 }) {
  const A = region(area);
  return (x, z, h) => {
    const m = A(x, z);
    if (!m) return h;
    const top = (level ?? h + height) + (fbm(x * 0.03 + seed, z * 0.03 - seed, 2) - 0.5) * 2 * rough;
    return lerp(h, top, m);
  };
}

// A river bed that falls along its length. The water's surface is given, not the bed: `from` and
// `to` are its height at the path's first and last point (or `levels`, one per point: a pool, then
// a weir's drop; it never runs uphill). The bed is cut `depth` m below the surface in the middle and
// comes up to it `width / 2` m out; from there the banks meet the land around over `banks` m. Where
// the land is lower than the water the banks are built up, so the river never hangs in the air.
// river.water is its water for the map's `waters`; river.levelAt(t) the surface t metres along.
export function riverBed({ path, width = 8, depth = 1.2, banks = 8, from = 0, to = from, levels = null, lip = 0.35, ...o }) {
  const P = makePath(path, o), near = locator(P, width / 2 + banks), levelAt = along(P, { levels, from, to }, true);
  const f = (x, z, h) => {
    const n = near(x, z);
    if (!n) return h;
    const lv = levelAt(n.t), k = n.d / (width / 2);
    if (k < 1) return lv - depth * (1 - k * k);
    // The bank: a lip just over the water, then the land around; land lower than the water gets a
    // levee (the lip held for the first part of the bank before it falls away).
    const e = n.d - width / 2, top = lv + lip * smoothstep(0, 1.5, e);
    return lerp(top, h, h < lv + lip ? smoothstep(banks * 0.4, banks, e) : smoothstep(0, banks, e));
  };
  f.levelAt = levelAt; f.path = P;
  f.water = { kind: 'river', path: P, width, levelAt, depth };
  return f;
}

// A lake basin: a bowl `depth` m deep under a water surface at `level`, about `r` m in radius (its
// shore line wanders by `wobble`, a share of r); round it, over `shore` m, the land is kept above
// the water so the lake can't spill. lake.water is its water for the map's `waters`.
export function lakeBasin({ x, z, r = 60, level = 0, depth = 4, shore = 30, wobble = 0.25, seed = 0 }) {
  const reach = r * (1 + wobble) + shore;
  const f = (px, pz, h) => {
    const dx = px - x, dz = pz - z, d = Math.hypot(dx, dz);
    if (d >= reach) return h;
    const a = Math.atan2(dz, dx);
    const R = r * (1 + wobble * (fbm(Math.cos(a) * 1.3 + seed * 4.1 + 9, Math.sin(a) * 1.3 - seed * 2.3 + 9, 2) - 0.5) * 2);
    if (d < R) return level - depth * (1 - (d / R) ** 2);
    return lerp(level, Math.max(h, level + 0.7), smoothstep(0, shore, d - R));
  };
  f.water = { kind: 'pond', level, area: { x, z, r: reach } };
  return f;
}

// A marsh flat: an area pressed nearly level at `level`, hummocks and hollows `hummock` m either
// way; the water (marsh.water) stands at the level, so the hollows are pools you wade (`pools`: how
// much of it is under water, 0…1) and the hummocks islands of reed and moss.
export function marshFlat({ area, level = 0, hummock = 0.35, pools = 0.45, seed = 0 }) {
  const A = region(area);
  const f = (x, z, h) => {
    const m = A(x, z);
    if (!m) return h;
    const n = fbm(x * 0.07 + seed * 3.3, z * 0.07 - seed * 1.7, 3) - pools;
    return lerp(h, level + n * 2 * hummock, m);
  };
  f.water = { kind: 'marsh', level, area: A, wade: 1 };
  return f;
}

// A quarry: a pit `depth` m deep and about `r` m in radius, worked in `benches` steps round a flat
// floor (floor: its share of the radius). ramp: the compass angle (radians, 0 = +x) of a haul road
// `rampWidth` m wide running straight up from the floor to the rim; without one the only ways in
// are a ladder or a fall. level: the rim's height (default: the ground at the centre).
export function quarry({ x, z, r = 45, depth = 18, benches = 3, floor = 0.4, ramp = null, rampWidth = 8, level = null, seed = 0 }) {
  let rim = level;
  return (px, pz, h, below) => {
    const dx = px - x, dz = pz - z, d = Math.hypot(dx, dz);
    if (d >= r * 1.15) return h;
    rim ??= below(x, z);
    const R = r * (1 + 0.12 * (fbm(dx * 0.05 + seed * 3, dz * 0.05 - seed, 2) - 0.5) * 2);
    const u = clamp((d / R - floor) / (1 - floor), 0, 1);                  // 0 on the floor, 1 at the rim
    const k = u * benches, su = (Math.floor(k) + smoothstep(0.7, 1, k - Math.floor(k))) / benches;
    let cut = depth * (1 - su);
    if (ramp != null) {
      // The haul road: across it (off its centre line) the benches give way to one even slope.
      const along_ = dx * Math.cos(ramp) + dz * Math.sin(ramp), off = Math.abs(-dx * Math.sin(ramp) + dz * Math.cos(ramp));
      if (along_ > 0) cut = lerp(depth * (1 - u), cut, smoothstep(rampWidth / 2, rampWidth / 2 + 2.5, off));
    }
    return Math.min(h, rim - cut);
  };
}

// A sunken lane: a track worn `depth` m into the ground along a line, its floor `width` m wide and
// level across (it takes the height of the ground along its own centre), with steep banks `banks`
// m wide: cover to move along, and a wall to anyone crossing it.
export function sunkenLane({ path, width = 3.5, depth = 2, banks = 2.5, taper = 15, ...o }) {
  const P = makePath(path, o), near = locator(P, width / 2 + banks), fade = ends(P, taper);
  return (x, z, h, below) => {
    const n = near(x, z);
    if (!n) return h;
    const d = n.d, floor = below(n.x, n.z) - depth * fade(n.t);
    return lerp(floor, h, smoothstep(width / 2, width / 2 + banks, d));
  };
}

// A ditch: a drainage cut with standing water (heath, marsh, polder), `width` m across at the top,
// its bed `depth` m under a water surface at `level`. ditch.water for the map's `waters`.
export function ditch({ path, width = 3, depth = 0.9, level = 0, banks = 1.5, ...o }) {
  const P = makePath(path, o), near = locator(P, width / 2 + banks);
  const f = (x, z, h) => {
    const n = near(x, z);
    if (!n) return h;
    const k = n.d / (width / 2);
    return k < 1 ? level - depth * (1 - k * k) : lerp(level, Math.max(h, level + 0.25), smoothstep(0, banks, n.d - width / 2));
  };
  f.water = { kind: 'river', path: P, width, levelAt: () => level, depth, wade: depth + 0.2 };
  return f;
}

// An embankment: a bank with a flat top `top` m wide along a line, its sides falling at `slope`
// (metres out per metre down). Its crest is `height` m above the ground along its centre, or at
// absolute heights (from/to, or `levels` per point: a railway's even grade). cut: where the land
// stands higher than the crest, dig through it at the same slope (a railway cutting).
export function embankment({ path, top = 5, height = 4, slope = 1.6, from = null, to = from, levels = null, cut = false, taper = 0, ...o }) {
  const P = makePath(path, o), abs = levels || from != null;
  const crestAt = abs ? along(P, { levels, from, to }) : null, fade = ends(P, taper);
  const near = locator(P, top / 2 + (abs ? 60 : height * slope + 1));
  return (x, z, h, below) => {
    const n = near(x, z);
    if (!n) return h;
    const out = Math.max(0, n.d - top / 2) / slope;
    const crest = abs ? crestAt(n.t) : below(n.x, n.z) + height * fade(n.t);
    let y = Math.max(h, crest - out);
    if (cut) y = Math.min(y, crest + out);
    return y;
  };
}

// A road bed: the ground levelled across a road or track (it takes the height along its centre
// line, evened out over `even` m of its length), blending back into the slope over `shoulder` m.
// On a hillside this is the cut and fill a real road has; on the flat it does nothing.
export function roadBed({ path, width = 5, shoulder = 5, even = 10, ...o }) {
  const P = makePath(path, o), near = locator(P, width / 2 + shoulder);
  return (x, z, h, below) => {
    const n = near(x, z);
    if (!n) return h;
    const d = n.d, t = n.t, a = pointAt(P, t - even), b = pointAt(P, t + even);
    const hc = (below(a.x, a.z) + 2 * below(n.x, n.z) + below(b.x, b.z)) / 4;
    return lerp(hc, h, smoothstep(width / 2, width / 2 + shoulder, d));
  };
}

// A coast: past a line, on one side of it (side: 1 its right hand on the map, −1 its left), the land goes
// down to `seabed` over `run` m: a shore to close a map with instead of hills. beach: metres of
// nearly level sand before it dips.
export function coast({ path, side = 1, seabed = -8, run = 70, beach = 0, ...o }) {
  const P = makePath(path, o), near = locator(P, Infinity);
  return (x, z, h) => {
    const s = near(x, z).s * side;
    return s <= beach ? h : lerp(h, seabed, smoothstep(0, run, s - beach));
  };
}

// Hills closing a map: outside an area (the playable land, any shape), the ground climbs over
// `run` m into rolling, uneven high ground, as the square maps' rims did.
export function rim({ area, height = 26, rough = 46, run = 110, seed = 0 }) {
  const A = region(area);
  return (x, z, h) => {
    const d = A.sd(x, z);
    if (d <= 0) return h;
    const t = Math.min(1.6, d / run);
    return h + t * t * (height + rough * fbm(x * 0.006 + 9.3 + seed, z * 0.006 - 2.1, 3)) + t * (fbm(x * 0.025, z * 0.025, 2) - 0.5) * 10;
  };
}

// ---- putting them together ----

// base: a function (x, z) → height, or a number; pieces: laid over it in the order given (a later
// one works on what the earlier ones made: cut the valley, then the river into its floor, then the
// road bed along the bank). Returns heightAt(x, z), with heightAt.waters (the water its pieces hold),
// heightAt.steep(bounds, opts) and heightAt.reach(from, opts) (below).
export function compose(base, pieces = []) {
  const f0 = typeof base === 'function' ? base : () => base;
  const upTo = pieces.map((_, i) => (x, z) => run(x, z, i));
  function run(x, z, n) {
    let h = f0(x, z);
    for (let i = 0; i < n; i++) h = pieces[i](x, z, h, upTo[i]);
    return h;
  }
  const heightAt = (x, z) => run(x, z, pieces.length);
  heightAt.pieces = pieces;
  heightAt.waters = pieces.filter(p => p.water).map(p => p.water);
  heightAt.steep = (bounds, opts) => steep(heightAt, bounds, opts);
  heightAt.reach = (from, opts) => reach(heightAt, from, opts);
  return heightAt;
}

// Levels for a river down a line over ground that already exists: at each of the line's points the
// ground there less `under` m, never higher than the point before (so it runs downhill whatever
// the ground does: it cuts through a rise). end: the last point's level (the lake it runs into).
//   riverBed({ path, levels: fall(compose(base, landBeforeTheRiver), path, { end: LAKE }) })
export function fall(heightAt, points, { under = 1, end = null } = {}) {
  const lv = points.map(([x, z]) => heightAt(x, z) - under);
  if (end != null) lv[lv.length - 1] = end;
  for (let i = 1; i < lv.length; i++) lv[i] = Math.min(lv[i], lv[i - 1]);
  if (end != null) for (let i = lv.length - 2; i >= 0; i--) lv[i] = Math.max(lv[i], lv[i + 1]);   // (and never under where it ends)
  return lv;
}

// The slope at a point (rise over run, the steepest way).
export function slopeAt(heightAt, x, z, e = 1) {
  return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
}

// Where the ground is too steep to walk up: sampled every `cell` m over bounds { x0, x1, z0, z1 }
// (inside(x, z): only there). Returns { share (of the samples), worst: { x, z, slope }, patches:
// the steep places gathered by 32 m square, largest first: { x, z, slope (its steepest), area m² } }.
// Some of it is meant (a cliff, a ravine's sides); the list is for checking that what isn't meant
// to be a wall isn't one.
export function steep(heightAt, { x0, x1, z0, z1 }, { maxSlope = 0.9, cell = 4, inside = null, top = 12 } = {}) {
  let n = 0, bad = 0, worst = { x: 0, z: 0, slope: 0 };
  const B = 32, byPatch = new Map();
  for (let z = z0 + cell / 2; z < z1; z += cell) for (let x = x0 + cell / 2; x < x1; x += cell) {
    if (inside && !inside(x, z)) continue;
    n++;
    const s = slopeAt(heightAt, x, z);
    if (s <= maxSlope) continue;
    bad++;
    if (s > worst.slope) worst = { x, z, slope: s };
    const k = `${Math.floor(x / B)},${Math.floor(z / B)}`;
    const p = byPatch.get(k) ?? { x: (Math.floor(x / B) + 0.5) * B, z: (Math.floor(z / B) + 0.5) * B, slope: 0, area: 0 };
    p.slope = Math.max(p.slope, s); p.area += cell * cell;
    byPatch.set(k, p);
  }
  return { share: n ? bad / n : 0, worst, patches: [...byPatch.values()].sort((a, b) => b.area - a.area).slice(0, top) };
}

// Can you walk there? From `from` ({ x, z }), over a `cell` m grid: a step is allowed if it climbs
// no more than maxSlope (going down, twice that: you slide), stays `inside`, and isn't through water
// deeper than `wade` (waterAt(x, z) → the surface or null). Returns { area (m² reached),
// can(x, z) → whether that spot was reached }: the check that every zone can be reached on foot.
export function reach(heightAt, from, { bounds, maxSlope = 0.9, cell = 4, inside = null, waterAt = null, wade = 0.9 } = {}) {
  const { x0, x1, z0, z1 } = bounds, W = Math.ceil((x1 - x0) / cell), H = Math.ceil((z1 - z0) / cell);
  const hs = new Float32Array(W * H), ok = new Uint8Array(W * H), seen = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell, h = heightAt(x, z), w = waterAt?.(x, z);
    hs[j * W + i] = h;
    ok[j * W + i] = (!inside || inside(x, z)) && !(w != null && w - h > wade) ? 1 : 0;
  }
  const at = (x, z) => { const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell); return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i; };
  const start = at(from.x, from.z), queue = start >= 0 && ok[start] ? [start] : [];
  if (queue.length) seen[start] = 1;
  let count = 0;
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], i = k % W, j = (k - i) / W;
    count++;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const m = jj * W + ii, rise = hs[m] - hs[k];
      if (seen[m] || !ok[m] || rise > maxSlope * cell || rise < -2 * maxSlope * cell) continue;
      seen[m] = 1; queue.push(m);
    }
  }
  return { area: count * cell * cell, can: (x, z) => { const k = at(x, z); return k >= 0 && !!seen[k]; } };
}
