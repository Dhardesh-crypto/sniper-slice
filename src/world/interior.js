// Rooms that look lived in: the walk-in buildings' interiors, dressed from the interior kit
// (tools/blender/interior.py → interior_kit.glb) and the architecture kit's materials. Each storey
// gets a plastered ceiling on rough-hewn beams, skirting and (in a plastered house) a painted dado,
// casements opened into the room and, in a home, curtains. Each room (the storey split by its
// interior walls) is then furnished by what it is: a family's kitchen table and bedrooms (a bed,
// a wardrobe, a washstand), or the occupiers' offices, with maps, notices, coats and helmets,
// ammunition boxes, a map table, papers, telephones and radios.
// buildings.js registers each building; world.js calls dressInteriors() once the mission has put
// in its own furniture, so nothing is put where a table, a cabinet or the stairs already stand,
// in front of a door, or over a stairwell. All of it is decoration (nothing solid), merged per
// material with the rest (mergeDecor).
import * as THREE from 'three';
import { put, hasPart, onFace, ROT } from './arch.js';
import { M } from './kit.js';
import { worldUVs } from './textures.js';

const registered = [];
export function registerInterior(b, info) { registered.push({ b, ...info }); }

// The faces looking into a room from each wall: the inside of the south wall looks north, and so on.
const INSIDE = { s: 'n', n: 's', e: 'w', w: 'e' };
const CEILING = new THREE.MeshStandardMaterial({ color: 0xe8e0cf, roughness: 0.95 });   // whitewash
const dadoCache = new Map();
function dadoFor(mat) {                          // the wall's own plaster, painted darker below the rail
  if (!dadoCache.has(mat)) dadoCache.set(mat, Object.assign(mat.clone(), { color: mat.color.clone().multiplyScalar(0.74) }));
  return dadoCache.get(mat);
}
const CURTAINS = [0xe8e2d2, 0xc9b88a, 0x9aa8b8, 0xb86a5a, 0xd8c8a8].map(h => new THREE.Color(h));

function rngFor(x, z) {
  let s = (Math.floor(x * 73.13) ^ Math.floor(z * 31.71) * 2654435761) >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function dressInteriors() {
  if (!hasPart('beam')) { registered.length = 0; return; }
  for (const e of registered) dressBuilding(e);
  registered.length = 0;
}

function dressBuilding(e) {
  const { b, x, z, y, w, d, floors, h, wall, mat, timber, openings, well, walls } = e;
  const rnd = rngFor(x, z);
  const inner = { x0: x - w / 2 + wall, x1: x + w / 2 - wall, z0: z - d / 2 + wall, z1: z + d / 2 - wall };
  const office = w * d >= 120;                   // the big buildings are the occupiers' (a hall, a lodge, an HQ)
  for (let f = 0; f < floors; f++) {
    const floorY = f ? y + f * h : y + 0.06, ceilY = y + (f + 1) * h - 0.18, tall = ceilY - floorY;
    const holeBelow = f > 0 ? well : null, holeAbove = f < floors - 1 ? well : null;
    ceiling(b, inner, ceilY, holeAbove);
    beams(b, inner, ceilY, holeAbove);
    const doorsHere = e.doors.filter(dr => Math.abs(dr.centre.y - floorY) < 1.2);
    // Round the outside walls: skirting, the dado, the windows' inner casements and curtains.
    for (const side of ['s', 'n', 'e', 'w']) {
      const face = innerFace(inner, side), ops = openings.filter(op => op.side === side && (op.floor ?? 0) === f);
      const u = (op) => (side === 's' || side === 'w' ? -op.at : op.at);   // an opening's place along the inner face
      const cuts = ops.filter(op => !op.window).map(op => [u(op) - op.w / 2 - 0.05, u(op) + op.w / 2 + 0.05]);
      for (const [a, c] of free(-face.len / 2, face.len / 2, cuts)) {
        alongFace(b, 'skirting', face, a, c, floorY);
        if (!timber && tall < 5) dado(b, face, a, c, floorY, mat);
      }
      if (tall > 5) continue;                    // (a church's nave keeps its bare walls)
      for (const op of ops.filter(o => o.window)) casements(b, face, u(op), floorY + (op.sill ?? 1.0), op.w, op.h ?? 1.2, rnd, !office && rnd() < 0.6);
    }
    if (tall > 5) continue;
    // The rooms on this floor, and what goes in each.
    for (const room of rooms(inner, walls.filter(iw => (iw.floor ?? 0) === f), x, z)) {
      furnish(b, e, room, { floorY, ceilY, f, office, rnd, holeBelow, holeAbove, doorsHere, openings: openings.filter(op => (op.floor ?? 0) === f) });
    }
  }
}

// ---- the shell ----
function innerFace(inner, side) {
  const cx = (inner.x0 + inner.x1) / 2, cz = (inner.z0 + inner.z1) / 2;
  const at = { s: [cx, inner.z1], n: [cx, inner.z0], e: [inner.x1, cz], w: [inner.x0, cz] }[side];
  return { cx: at[0], cz: at[1], rot: ROT[INSIDE[side]], len: side === 's' || side === 'n' ? inner.x1 - inner.x0 : inner.z1 - inner.z0, alongX: side === 's' || side === 'n' };
}
// [a, c] minus the cuts, as the pieces left of at least 0.2 m.
function free(a, c, cuts) {
  let out = [[a, c]];
  for (const [p, q] of cuts) out = out.flatMap(([s, t]) => [[s, Math.min(t, p)], [Math.max(s, q), t]]).filter(([s, t]) => t - s > 0.2);
  return out;
}
function alongFace(b, name, face, a, c, y) {
  const [px, pz] = onFace(face.cx, face.cz, face.rot, a, 0);
  put(b, name, px, y, pz, face.rot, { sx: c - a, shadow: false });
}
function dado(b, face, a, c, floorY, mat) {
  const [px, pz] = onFace(face.cx, face.cz, face.rot, (a + c) / 2, 0.004), len = c - a, m = dadoFor(mat);
  if (face.alongX) b.box(len, 0.95, 0.006, m, px, floorY, pz, { solid: false, decor: true });
  else b.box(0.006, 0.95, len, m, px, floorY, pz, { solid: false, decor: true });
}
function ceiling(b, inner, y, hole) {
  const part = (x0, x1, z0, z1) => {
    if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
    b.box(x1 - x0, 0.01, z1 - z0, CEILING, (x0 + x1) / 2, y - 0.012, (z0 + z1) / 2, { solid: false, decor: true });
  };
  if (!hole) return part(inner.x0, inner.x1, inner.z0, inner.z1);
  const [hx0, hz0, hx1, hz1] = hole;
  part(inner.x0, inner.x1, inner.z0, Math.max(inner.z0, hz0)); part(inner.x0, inner.x1, Math.min(inner.z1, hz1), inner.z1);
  part(inner.x0, Math.max(inner.x0, hx0), hz0, hz1); part(Math.min(inner.x1, hx1), inner.x1, hz0, hz1);
}
// Beams across the shorter span every 85 cm (a girder down the middle of a wide room); none over the stairwell.
function beams(b, inner, ceilY, hole) {
  const wx = inner.x1 - inner.x0, wz = inner.z1 - inner.z0, acrossZ = wz <= wx;   // beams run the short way
  const span = acrossZ ? wz : wx, len = acrossZ ? wx : wz, n = Math.floor(len / 0.85);
  for (let i = 0; i < n; i++) {
    const t = (acrossZ ? inner.x0 : inner.z0) + (i + 0.5) * len / n;
    if (hole && t > (acrossZ ? hole[0] : hole[1]) - 0.1 && t < (acrossZ ? hole[2] : hole[3]) + 0.1) continue;
    if (acrossZ) put(b, 'beam', t, ceilY - 0.012, inner.z0, -Math.PI / 2, { sx: span, shadow: false });
    else put(b, 'beam', inner.x0, ceilY - 0.012, t, 0, { sx: span, shadow: false });
  }
  if (span > 5.5 && !hole) {
    if (acrossZ) put(b, 'beam', inner.x0, ceilY - 0.2, (inner.z0 + inner.z1) / 2, 0, { sx: wx, sy: 1.5, sz: 1.8, shadow: false });
    else put(b, 'beam', (inner.x0 + inner.x1) / 2, ceilY - 0.2, inner.z0, -Math.PI / 2, { sx: wz, sy: 1.5, sz: 1.8, shadow: false });
  }
}
// A window's casements opened into the room, and (in a home) curtains drawn back either side.
function casements(b, face, u, y0, w, h, rnd, curtains) {
  const ang = Math.PI * (0.52 + rnd() * 0.12);
  for (const s of [-1, 1]) {
    const [px, pz] = onFace(face.cx, face.cz, face.rot, u + s * w / 2, 0.02);
    for (const part of ['leaf', 'leaf_glass']) put(b, part, px, y0, pz, face.rot, { sx: -s * w / 2, sy: h, spin: s * ang, shadow: false });
  }
  if (!curtains) return;
  const tint = CURTAINS[Math.floor(rnd() * CURTAINS.length)];
  for (const s of [-1, 1]) {
    const [px, pz] = onFace(face.cx, face.cz, face.rot, u + s * (w / 2 + 0.42), 0.03);
    put(b, 'curtain', px, y0 - 0.15, pz, face.rot, { sx: 0.75, sy: h + 0.55, tint, shadow: false });
  }
}

// ---- rooms ----
// The storey's inside cut by its interior walls (each wall spans the building; it's 0.15 thick).
function rooms(inner, walls, x, z) {
  const xs = [inner.x0, ...walls.filter(iw => iw.axis === 'z').map(iw => x + iw.at).sort((a, c) => a - c), inner.x1];
  const zs = [inner.z0, ...walls.filter(iw => iw.axis === 'x').map(iw => z + iw.at).sort((a, c) => a - c), inner.z1];
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const r = { x0: xs[i] + (i ? 0.075 : 0), x1: xs[i + 1] - (i < xs.length - 2 ? 0.075 : 0), z0: zs[j] + (j ? 0.075 : 0), z1: zs[j + 1] - (j < zs.length - 2 ? 0.075 : 0) };
    if (r.x1 - r.x0 > 1.5 && r.z1 - r.z0 > 1.5) out.push(r);
  }
  return out;
}

function furnish(b, e, room, ctx) {
  const { floorY, ceilY, f, office, rnd, holeBelow, holeAbove, doorsHere } = ctx;
  const cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2, rw = room.x1 - room.x0, rd = room.z1 - room.z0;
  // What's already standing in the room (the mission's furniture, the stairs), the doors' swing, the stairwells.
  const blocks = b.boxes.filter(bx => bx.max.y > floorY + 0.05 && bx.min.y < floorY + 2.2
    && bx.max.x > room.x0 + 0.02 && bx.min.x < room.x1 - 0.02 && bx.max.z > room.z0 + 0.02 && bx.min.z < room.z1 - 0.02
    && (bx.max.x - bx.min.x) < rw * 0.95 && (bx.max.z - bx.min.z) < rd * 0.95).map(bx => [bx.min.x, bx.min.z, bx.max.x, bx.max.z]);
  for (const dr of doorsHere) blocks.push([dr.centre.x - 1.1, dr.centre.z - 1.1, dr.centre.x + 1.1, dr.centre.z + 1.1]);
  for (const hole of [holeBelow, holeAbove]) if (hole) blocks.push([hole[0] - 0.3, hole[1] - 0.3, hole[2] + 0.3, hole[3] + 0.3]);
  const clear = (x0, z0, x1, z1) => blocks.every(([a, c, p, q]) => x1 <= a || x0 >= p || z1 <= c || z0 >= q);
  const tables = b.boxes.filter(bx => bx.min.y < floorY + 0.1 && bx.max.y > floorY + 0.65 && bx.max.y < floorY + 0.9
    && bx.min.x >= room.x0 - 0.1 && bx.max.x <= room.x1 + 0.1 && bx.min.z >= room.z0 - 0.1 && bx.max.z <= room.z1 + 0.1
    && (bx.max.x - bx.min.x) > 0.6 && (bx.max.z - bx.min.z) > 0.5);

  // The walls of the room, as faces looking in, with their openings cut out.
  const faces = [
    { side: 's', cx, cz: room.z1, rot: ROT.n, len: rw, alongX: true },
    { side: 'n', cx, cz: room.z0, rot: ROT.s, len: rw, alongX: true },
    { side: 'e', cx: room.x1, cz, rot: ROT.w, len: rd, alongX: false },
    { side: 'w', cx: room.x0, cz, rot: ROT.e, len: rd, alongX: false },
  ];
  for (const fc of faces) {
    fc.used = [];
    fc.gaps = [];
    // An opening in the outside wall here, or a doorway in an interior wall: blocked along the wall.
    const outer = { s: Math.abs(room.z1 - (e.z + e.d / 2 - e.wall)) < 0.1, n: Math.abs(room.z0 - (e.z - e.d / 2 + e.wall)) < 0.1,
      e: Math.abs(room.x1 - (e.x + e.w / 2 - e.wall)) < 0.1, w: Math.abs(room.x0 - (e.x - e.w / 2 + e.wall)) < 0.1 }[fc.side];
    const toU = (wx, wz) => {          // a world point's place along this face (its right as you look at it)
      const c = Math.cos(fc.rot), s = Math.sin(fc.rot);
      return (wx - fc.cx) * c - (wz - fc.cz) * s;
    };
    if (outer) for (const op of ctx.openings.filter(o => o.side === fc.side)) {
      const along = fc.alongX ? e.x + op.at : e.z + op.at;
      const uu = fc.alongX ? toU(along, fc.cz) : toU(fc.cx, along);
      fc.gaps.push([uu - op.w / 2 - 0.25, uu + op.w / 2 + 0.25, op.window ? (op.sill ?? 1.0) : 0, op.window ? (op.sill ?? 1.0) + (op.h ?? 1.2) : 2.4]);
    }
    for (const dr of doorsHere) {      // doors in interior walls along this face
      const onLine = fc.alongX ? Math.abs(dr.centre.z - fc.cz) < 0.3 : Math.abs(dr.centre.x - fc.cx) < 0.3;
      if (onLine) { const uu = toU(dr.centre.x, dr.centre.z); fc.gaps.push([uu - 0.8, uu + 0.8, 0, 2.4]); }
    }
  }
  // Find a free stretch of `width` on some wall for a piece from height y0 to y1 above the floor
  // (and, if it stands on the floor, `depth` deep into the room clear of everything there).
  const slot = (width, y0, y1, depth = 0, prefer = null) => {
    const order = [...faces].sort(() => rnd() - 0.5);
    if (prefer) order.sort((a, c) => (c.len - a.len) * prefer);
    for (const fc of order) {
      for (let tries = 0; tries < 6; tries++) {
        const half = fc.len / 2 - width / 2 - 0.15;
        if (half < 0) break;
        const uu = (rnd() * 2 - 1) * half;
        const a = uu - width / 2, c = uu + width / 2;
        if (fc.gaps.some(([p, q, lo, hi]) => c > p && a < q && y1 > lo && y0 < hi)) continue;
        if (fc.used.some(([p, q, lo, hi]) => c > p - 0.15 && a < q + 0.15 && y1 > lo && y0 < hi)) continue;
        if (depth) {
          const p0 = onFace(fc.cx, fc.cz, fc.rot, a, 0), p1 = onFace(fc.cx, fc.cz, fc.rot, c, depth);
          if (!clear(Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1]))) continue;
          blocks.push([Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])]);
        }
        fc.used.push([a, c, y0, y1]);
        const [px, pz] = onFace(fc.cx, fc.cz, fc.rot, uu, 0);
        return { x: px, z: pz, rot: fc.rot, fc, u: uu };
      }
    }
    return null;
  };
  const onWall = (name, width, y0, y1, depth = 0, opts = {}) => {
    const s = slot(width, y0, y1, depth, opts.prefer);
    if (s) put(b, name, s.x, floorY + (opts.at ?? 0), s.z, s.rot, { shadow: false, ...opts.put });
    return s;
  };

  if (office) {
    onWall('map_board', 1.3, 1.0, 1.9, 0, { at: 1.0 });
    for (let i = 0; i < 1 + Math.floor(rnd() * 3); i++) onWall('notice', 0.5, 1.35, 1.95, 0, { at: 1.35 });
    if (rnd() < 0.7) onWall('coat_rack', 1.05, 0, 1.75, 0.35);
    if (rnd() < 0.6) onWall('shelf', 1.1, 1.45, 1.8, 0, { at: 1.5 });
    if (rnd() < 0.5) onWall('clock', 0.4, 2.0, 2.4, 0, { at: 2.15 });
    if (rnd() < 0.35) onWall('sacks', 1.0, 0, 0.9, 0.7);
    if (rnd() < 0.65) onWall('crates', 1.2, 0, 0.65, 0.5);            // the occupiers' stores
    if (rnd() < 0.5) onWall('jerrycans', 0.7, 0, 0.55, 0.3);
  } else if (f === 0) {
    onWall('fireplace', 1.7, 0, 2.3, 0.6, { prefer: 1 });
    onWall('credenza', 1.5, 0, 1.25, 0.55);
    if (rnd() < 0.7) onWall('shelf', 1.1, 1.45, 1.8, 0, { at: 1.5 });
    for (let i = 0; i < 1 + Math.floor(rnd() * 2); i++) onWall(`picture_${Math.floor(rnd() * 3)}`, 0.85, 1.45, 2.0, 0, { at: 1.5 });
    if (rnd() < 0.6) onWall('clock', 0.4, 1.95, 2.4, 0, { at: 2.15 });
    if (rnd() < 0.6) onWall('demijohn', 0.5, 0, 0.6, 0.5);
    if (rnd() < 0.5) onWall('sacks', 1.0, 0, 0.9, 0.7);
    if (rnd() < 0.3) onWall('jerrycans', 0.7, 0, 0.55, 0.3);          // (requisitioned, or hoarded)
  } else {
    // A bedroom: the bed's head to a wall, a chest at its foot; a wardrobe, a washstand.
    const big = rw * rd > 40;                    // (a big room's a billet: two beds)
    let bed = null;
    for (let i = 0; i < (big ? 2 : 1); i++) {
      const s2 = slot(1.05, 0, 1.1, 2.0);
      if (!s2) break;
      bed = s2;
      put(b, 'bed', bed.x, floorY, bed.z, bed.rot, { shadow: false });
      const [px, pz] = onFace(bed.fc.cx, bed.fc.cz, bed.fc.rot, bed.u, 2.02);
      if (rnd() < 0.6 && clear(px - 0.6, pz - 0.3, px + 0.6, pz + 0.3)) {
        put(b, 'chest', px, floorY, pz, bed.rot, { shadow: false });
        blocks.push([px - 0.6, pz - 0.3, px + 0.6, pz + 0.3]);
      }
    }
    if (rnd() < 0.8) onWall('wardrobe', 1.1, 0, 2.2, 0.6);
    if (rnd() < 0.7) onWall('washstand', 0.75, 0, 1.6, 0.45);
    for (let i = 0; i < 1 + Math.floor(rnd() * 2); i++) onWall(`picture_${Math.floor(rnd() * 3)}`, 0.85, 1.45, 2.0, 0, { at: 1.5 });
    if (!bed && rnd() < 0.6) onWall('credenza', 1.5, 0, 1.25, 0.55);
    if (rnd() < 0.55) onWall('coat_rack', 1.05, 0, 1.75, 0.35);   // a soldier billeted here
    if (rnd() < 0.4) onWall('clock', 0.4, 1.95, 2.4, 0, { at: 2.15 });
  }
  // A table in the middle where the mission didn't put one: the family's, with chairs and a bench,
  // or the occupiers' map table. Along the room's long way, nudged off centre if it has to be.
  if (!tables.length && (office || f === 0 || rw * rd > 40) && rw > 3.0 && rd > 2.6) {
    const turn = rw >= rd ? 0 : Math.PI / 2, c = Math.cos(turn), s = Math.sin(turn);
    const at = (ox, oz, lx, lz) => [ox + lx * c + lz * s, oz - lx * s + lz * c];
    const hx = 0.8 + 0.55, hz = 0.425 + 0.55;                            // its footprint, chairs and all
    const ext = (ox, oz) => { const ex = turn ? hz : hx, ez = turn ? hx : hz; return [ox - ex, oz - ez, ox + ex, oz + ez]; };
    const spot = [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].map(([dx, dz]) => [cx + dx, cz + dz])
      .find(([ox, oz]) => { const [a, q, p2, r] = ext(ox, oz); return a > room.x0 + 0.1 && p2 < room.x1 - 0.1 && q > room.z0 + 0.1 && r < room.z1 - 0.1 && clear(a, q, p2, r); });
    if (spot) {
      const [ox, oz] = spot;
      put(b, 'table', ox, floorY, oz, turn, { shadow: false });
      blocks.push(ext(ox, oz));
      const top = floorY + 0.762;
      if (office) {
        const [mx, mz] = at(ox, oz, -0.15, 0);
        put(b, 'map_table', mx, top, mz, turn + (rnd() - 0.5) * 0.2, { shadow: false });
        const [ax, az] = at(ox, oz, 0, -0.25);
        put(b, rnd() < 0.5 ? 'radio' : 'phone', ax, top, az, turn + Math.PI, { shadow: false });
      } else {
        const [bx, bz] = at(ox, oz, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.2);
        put(b, 'bottles', bx, top, bz, rnd() * 6, { shadow: false });
      }
      // Chairs on the long sides (a bench on one of them, in a home), one at an end.
      const bench = !office && rnd() < 0.5;
      for (const side of [1, -1]) {
        if (bench && side < 0) { const [px, pz] = at(ox, oz, 0, side * 0.62); put(b, 'bench', px, floorY, pz, turn, { shadow: false }); continue; }
        for (const lx of [-0.4, 0.4]) {
          if (rnd() < 0.25) continue;
          const [px, pz] = at(ox, oz, lx + (rnd() - 0.5) * 0.1, side * 0.68);
          put(b, 'chair', px, floorY, pz, turn + (side > 0 ? Math.PI : 0) + (rnd() - 0.5) * 0.35, { shadow: false });
        }
      }
      if (rnd() < 0.5) { const [px, pz] = at(ox, oz, 1.1, 0); put(b, office ? 'stool' : 'chair', px, floorY, pz, turn - Math.PI / 2, { shadow: false }); }
    }
  }
  // A chair or two against the walls.
  for (let i = 0; i < (office ? 2 : 1); i++) {
    const s = slot(0.5, 0, 0.95, 0.5);
    if (s) { const [px, pz] = onFace(s.fc.cx, s.fc.cz, s.fc.rot, s.u, 0.28); put(b, 'chair', px, floorY, pz, s.rot, { shadow: false }); }
  }
  // On the tables: papers, and a telephone or a typewriter (the occupiers'), or the wine and bread (a home's).
  for (const t of tables) {
    const tx = (t.min.x + t.max.x) / 2, tz = (t.min.z + t.max.z) / 2, top = t.max.y + 0.002, turn = rnd() * Math.PI * 2;
    if (office) {
      put(b, 'papers', tx + (rnd() - 0.5) * 0.4, top, tz + (rnd() - 0.5) * 0.2, turn, { shadow: false });
      if (rnd() < 0.7) put(b, ['phone', 'typewriter', 'radio'][Math.floor(rnd() * 3)], tx + (rnd() < 0.5 ? -1 : 1) * Math.min(0.45, (t.max.x - t.min.x) / 2 - 0.2), top, tz, turn, { shadow: false });
    } else put(b, 'bottles', tx, top, tz, turn, { shadow: false });
    // A chair drawn up to it, where there's floor.
    for (const [dx, dz, rot] of [[0, 1, Math.PI], [0, -1, 0], [1, 0, -Math.PI / 2], [-1, 0, Math.PI / 2]]) {
      const px = dx ? (dx > 0 ? t.max.x + 0.35 : t.min.x - 0.35) : tx, pz = dz ? (dz > 0 ? t.max.z + 0.35 : t.min.z - 0.35) : tz;
      if (px < room.x0 + 0.3 || px > room.x1 - 0.3 || pz < room.z0 + 0.3 || pz > room.z1 - 0.3 || !clear(px - 0.25, pz - 0.25, px + 0.25, pz + 0.25)) continue;
      put(b, 'chair', px, floorY, pz, rot, { shadow: false });
      blocks.push([px - 0.25, pz - 0.25, px + 0.25, pz + 0.25]);
      if (rnd() < 0.5) break;
    }
  }
  // A rug in the middle (under the table is fine), papers dropped on an office floor, the lamp.
  if (rw * rd > 9) {
    const along = rw >= rd, k = Math.min(1.7, Math.min(rw, rd) / 2.2), hx = (along ? 1.15 : 0.65) * k, hz = (along ? 0.65 : 1.15) * k;
    const off = (h) => !h || cx + hx < h[0] - 0.1 || cx - hx > h[2] + 0.1 || cz + hz < h[1] - 0.1 || cz - hz > h[3] + 0.1;
    if (off(holeBelow)) put(b, 'rug', cx, floorY, cz, along ? 0 : Math.PI / 2, { sx: k * 1.15, sz: k, shadow: false });
  }
  if (office && rnd() < 0.5 && clear(cx + 0.6, cz - 0.3, cx + 1.2, cz + 0.3)) put(b, 'papers', cx + 0.9, floorY, cz, rnd() * 6, { shadow: false });
  if (!holeAbove || cx < holeAbove[0] || cx > holeAbove[2] || cz < holeAbove[1] || cz > holeAbove[3]) put(b, 'pendant', cx, ceilY - 0.2, cz, 0, { shadow: false });
}
