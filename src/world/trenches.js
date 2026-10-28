// Trench lines for the maps that have them: cut into the ground (the map's heightAt asks
// `carve`), walled with planks and posts, duckboards along the bottom, sandbags heaped on the
// parapet with gaps to climb out, and dugouts let into the wall: a timber-framed room below
// ground, a log-and-earth roof mounded over it, a doorway from the trench. Dug-outs and their
// furniture are the mission's to fill.
import * as THREE from 'three';
import { M } from './kit.js';
import { furniture } from './buildings.js';
import { smoothstep, lerp } from './noise.js';

function segDist(x, z, [x0, z0], [x1, z1]) {
  const dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz));
}

// Where a dugout goes `along` metres down a trench line, let into its wall on `side` (+1 / −1,
// left / right of the way the line runs), its doorway facing the trench: { x, z, yaw, w, d }.
export function besideTrench(line, along, side = 1, { w = 4, d = 3, half = 0.85 } = {}) {
  let left = along;
  for (let i = 1; i < line.length; i++) {
    const [x0, z0] = line[i - 1], [x1, z1] = line[i], len = Math.hypot(x1 - x0, z1 - z0);
    if (left > len && i < line.length - 1) { left -= len; continue; }
    const ux = (x1 - x0) / len, uz = (z1 - z0) / len, nx = -uz * side, nz = ux * side;
    const k = Math.min(left, len), off = half + d / 2 + 0.15;
    return { x: x0 + ux * k + nx * off, z: z0 + uz * k + nz * off, yaw: Math.atan2(-nx, -nz), w, d };
  }
  return null;
}

// lines: [[x, z], ...] per trench; dugouts: [{ x, z, yaw, w, d }] (yaw: the doorway faces +z turned by it).
export function trenchSystem(lines, { depth = 1.9, half = 0.9, bank = 0.9, dugouts = [] } = {}) {
  const dist = (x, z) => {
    let d = Infinity;
    for (const t of lines) for (let i = 1; i < t.length; i++) d = Math.min(d, segDist(x, z, t[i - 1], t[i]));
    return d;
  };
  // Inside a dugout's footprint (its local frame), with a margin: 0 outside.
  const inDugout = (x, z, m = 0) => dugouts.some(g => {
    const c = Math.cos(g.yaw ?? 0), s = Math.sin(g.yaw ?? 0), dx = x - g.x, dz = z - g.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.abs(lx) < g.w / 2 + m && Math.abs(lz) < g.d / 2 + m;
  });
  // Ways out: every so often the wall slopes gently enough to walk up (a cut step in the bank).
  const exits = [];
  for (const t of lines) {
    let run = 16;
    for (let i = 1; i < t.length; i++) {
      const [x0, z0] = t[i - 1], [x1, z1] = t[i], len = Math.hypot(x1 - x0, z1 - z0);
      for (let k = 0; k < len; k += 1) if ((run += 1) >= 32) { run = 0; exits.push([x0 + (x1 - x0) * k / len, z0 + (z1 - z0) * k / len, (x1 - x0) / len, (z1 - z0) / len]); }
    }
  }
  // How far along the trench from the nearest way out (measured along the trench, so walking up
  // its ramp, out of the trench, keeps you on it); Infinity when no way out is within 8 m.
  const alongExit = (x, z) => {
    let best = Infinity;
    for (const [ex, ez, ux, uz] of exits) {
      const dx = x - ex, dz = z - ez;
      if (Math.abs(dx * uz - dz * ux) > 8) continue;                   // (across: too far out)
      best = Math.min(best, Math.abs(dx * ux + dz * uz));
    }
    return best;
  };
  const nearExit = (x, z, r = 2.2) => alongExit(x, z) < r;
  return {
    lines, depth, half, dugouts, dist, inDugout, exits, nearExit,
    // How much lower the ground is at (x, z): the trench floor flat across `half`, the walls steep
    // over `bank` (steep enough to need a jump, not a ladder: you climb out where you like).
    carve(x, z) {
      const t = dist(x, z);
      // (at a way out the bank runs out over 4.6 m instead: gentle enough to walk up)
      const e = alongExit(x, z);
      const b2 = e < 4 ? lerp(4.6, bank, smoothstep(1.8, 4, e)) : bank;
      let cut = t < half + b2 ? depth * (1 - smoothstep(half, half + b2, t)) : 0;
      if (inDugout(x, z, 0.2)) cut = depth;
      return cut;
    },
  };
}

// The timber and sandbags along a trench system. `b` is the mission's Builder.
export function dressTrenches(b, sys, heightAt, { parapet = true } = {}) {
  const plank = M.darkWood, post = M.wood;
  for (const t of sys.lines) for (let i = 1; i < t.length; i++) {
    const [x0, z0] = t[i - 1], [x1, z1] = t[i], len = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / len, uz = (z1 - z0) / len, nx = -uz, nz = ux, ang = Math.atan2(-uz, ux);
    for (let k = 0.5; k < len; k += 1.0) {
      const x = x0 + ux * k, z = z0 + uz * k;
      if (sys.inDugout(x, z, 0.4)) continue;
      const floor = heightAt(x, z);
      // Duckboards: slats across the bottom.
      b.box(0.9, 0.05, 0.16, plank, x, floor + 0.02, z, { rotY: ang + Math.PI / 2, solid: false });
      // The walls: planks stood on edge, a post every 2 m.
      for (const s of [-1, 1]) {
        const wx = x + nx * s * (sys.half - 0.02), wz = z + nz * s * (sys.half - 0.02);   // (at the floor's edge, stood up in front of the bank)
        if (sys.inDugout(wx, wz, 0.3) || sys.nearExit(wx, wz, 1.6)) continue;   // (no wall where the way out is)
        b.box(1.02, sys.depth * 0.85, 0.05, plank, wx, floor + 0.05, wz, { rotY: ang, solid: false });
        if (Math.round(k) % 2 === 0) b.box(0.12, sys.depth + 0.2, 0.12, post, wx - nx * s * 0.07, floor, wz - nz * s * 0.07, { solid: false });
      }
    }
    // Sandbags on both lips, with a gap every so often to climb out by.
    if (!parapet) continue;
    for (let k = 1.5; k < len - 1; k += 1.7) {
      if (Math.floor(k / 1.7) % 7 === 3) continue;                  // (a gap)
      const x = x0 + ux * k, z = z0 + uz * k;
      for (const s of [-1, 1]) {
        const px = x + nx * s * (sys.half + sys.bank + 0.5), pz = z + nz * s * (sys.half + sys.bank + 0.5);
        if (sys.inDugout(px, pz, 0.5)) continue;
        b.box(1.6, 0.42, 0.6, M.sandbag, px, heightAt(px, pz) - 0.05, pz, { rotY: ang, solid: false });
      }
    }
  }
  return sys.dugouts.map(g => dugout(b, sys, g, heightAt));
}

// A dugout: a room below ground (floor at the trench bottom), plank walls on posts, a ceiling of
// logs with earth heaped over it (a mound you can see from the parapet), the doorway at its front
// (local +z). Returns where things go inside, in world space.
function dugout(b, sys, g, heightAt) {
  const { x, z, w = 4, d = 3, yaw = 0 } = g, h = 2.1;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const W = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];      // local → world
  const floor = heightAt(x, z), plank = M.darkWood;
  const box = (bw, bh, bd, mat, lx, y, lz, opts = {}) => { const [wx, wz] = W(lx, lz); return b.box(bw, bh, bd, mat, wx, y, wz, { rotY: yaw, ...opts }); };
  // Floor, back and side walls (solid), the front wall either side of the doorway.
  box(w, 0.06, d, plank, 0, floor, 0, { solid: false });
  box(w + 0.2, h, 0.15, plank, 0, floor, -d / 2);
  for (const sd of [-1, 1]) box(0.15, h, d, plank, sd * w / 2, floor, 0);
  const door = 1.0, side = (w - door) / 2;
  for (const sd of [-1, 1]) box(side, h, 0.15, plank, sd * (door / 2 + side / 2), floor, d / 2);
  box(door, h - 1.85, 0.15, plank, 0, floor + 1.85, d / 2);              // over the doorway
  // The roof: logs across, then earth heaped over, higher in the middle.
  for (let lz = -d / 2; lz <= d / 2 + 0.01; lz += 0.24) box(w + 0.6, 0.2, 0.22, M.wood, 0, floor + h, lz);
  box(w + 1.2, 0.45, d + 1.0, M.earth, 0, floor + h + 0.2, 0);
  box(w * 0.7, 0.3, d * 0.6, M.earth, 0, floor + h + 0.65, 0, { solid: false });
  // Inside: a bunk along the back, a table, a crate.
  const [bx, bz] = W(-w / 2 + 0.6, -d / 2 + 0.55), [tx, tz] = W(w / 4, 0), [kx, kz] = W(w / 2 - 0.5, d / 2 - 0.7);
  furniture.bed?.(b, bx, floor, bz);
  furniture.table?.(b, tx, floor, tz, 1.2, 0.8);
  b.box(0.7, 0.55, 0.5, M.crate, kx, floor, kz, { rotY: yaw });
  const [ix, iz] = W(0, 0), [ex, ez] = W(0, d / 2 + 0.7);
  return { inside: new THREE.Vector3(ix, floor, iz), table: new THREE.Vector3(tx, floor + 0.79, tz), entrance: new THREE.Vector3(ex, floor, ez), floor, yaw };
}
