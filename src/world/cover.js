// Built cover: the things a sniper lies up behind and guards walk round, declared on the map and
// set down by one call from the mission's site (`buildCover(b)`, b its Builder):
//   cover: {
//     walls: [[[x, z], …], …],            dry-stone field walls along these lines, chest high: you
//                                         crouch behind them, bullets and eyes stop on them; a gap
//                                         is left wherever a road or track crosses
//     crates: [[x, z, n], …],             a stack of n supply crates (default 3)
//     ruins: [{ x, z, w, d, h, seed, … }],   a roofless shell of a house (ruins.js shellHouse: its
//                                         options pass straight through) with a ladder up to the
//                                         boards left in its standing corner; the ground is levelled under it
//     windmills: [{ x, z, face }],        a round stone tower mill (red cone cap, six lattice sails):
//                                         a doorway, a ladder inside, a loft 5.8 m up with a window to
//                                         each quarter: high ground to scope and shoot from
//     grass: [{ x, z, r }, …],            tall-grass patches where you want them (vegetation.js adds
//                                         them to the scattered ones, as `coverPatches` always did)
//   }
// Land gives cover too (a sunken lane, a ditch, a ravine, a bank: landforms.js), and so does what
// grows (trunks, boulders, hedges; reeds, gorse and juniper hide you: ground.js). This is the part
// that is built. tools/landforms-sample.js measures how much of a map has some within reach.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M } from './kit.js';
import { worldUVs } from './textures.js';
import { heightAt, activeMap, nearestRoad } from './terrain.js';
import { makePath, pointAt } from './landforms.js';
import { makeRng } from './noise.js';
import { furniture, ladder } from './buildings.js';
import { shellHouse } from './ruins.js';

const SEG = 2.4;          // m: one length of wall (short, so its collision box hugs it on a slant too)

// A dry-stone wall along a line, following the ground: one mesh for the eye and for bullets, a
// collision box per length. height: 1.15 m is chest high (crouch cover); 1.8 hides a man standing.
export function stoneWall(b, line, { height = 1.15, thick = 0.55, seed = 1 } = {}) {
  const P = makePath(line), n = Math.max(1, Math.round(P.length / SEG)), rng = makeRng(seed * 911 + 7), geos = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const c = pointAt(P, (i + 0.5) / n * P.length), road = nearestRoad(c.x, c.z);
    if (road && road.d < road.width / 2 + 1.6) continue;                       // (a gateway where a road goes through)
    if (rng() < 0.04) continue;                                               // (and here and there a length has fallen)
    const len = P.length / n + 0.06, h = height * (0.88 + rng() * 0.2), y = Math.min(heightAt(c.x - c.dx * len / 2, c.z - c.dz * len / 2), heightAt(c.x + c.dx * len / 2, c.z + c.dz * len / 2)) - 0.15;
    const g = new THREE.BoxGeometry(len, h + 0.15, thick);
    m4.compose(p.set(c.x, y + (h + 0.15) / 2, c.z), q.setFromAxisAngle(up, Math.atan2(-c.dz, c.dx)), one);
    g.applyMatrix4(m4);
    geos.push(g);
    b.boxes.push(new THREE.Box3().setFromBufferAttribute(g.attributes.position));
  }
  if (!geos.length) return null;
  const geo = mergeGeometries(geos);
  worldUVs(geo, M.stone.userData.tile);
  const mesh = new THREE.Mesh(geo, M.stone);
  mesh.castShadow = mesh.receiveShadow = true;
  b.group.add(mesh);
  mesh.updateMatrixWorld(true);
  b.solids.push(mesh);
  return mesh;
}

// A tower windmill you can go up, after the stone mills of the Sicilian salt pans: a round rubble
// tower that tapers, a tall doorway, a low red cone for a cap with a tail pole, and six lattice
// sails on a spoked wheel, stayed from a pole through the hub. Inside, a ladder to a loft 5.8 m up
// with a small window to each quarter (chest high standing, so crouched you are out of sight).
// The door is in the south side; the sails look the way `face` says (radians, 0 = +x; default west).
// Returns { ladder, perch }: push the ladder onto the site's `ladders`; perch is where a man stands
// in the loft (a look-out for you, or a post for one of theirs).
// The tower is drawn as one smooth shell with its openings cut out; what you walk against is a
// ring of unseen blocks, one per 11° of wall and per band of height, left out at the openings.
const MILL = { r0: 3.3, r1: 2.5, t: 0.5, loft: 5.8, wall: 2.5, sill: 0.95, slit: 0.8, doorH: 2.4, segs: 32 };
const CAP = new THREE.MeshStandardMaterial({ color: 0xb4553d, roughness: 0.9 });
const SPAR = new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.9 });
let millStone = null;
export function windmill(b, { x, z, face = Math.PI }) {
  const K = MILL, y = heightAt(x, z) - 0.05, top = y + K.loft, H = K.loft + K.wall, N = K.segs, da = Math.PI * 2 / N;
  const ro = (h) => K.r0 + (K.r1 - K.r0) * h / H;                   // the wall's outer radius h metres up
  const levels = [-0.4, K.doorH, K.loft, K.loft + K.sill, K.loft + K.sill + K.slit, H];
  const near = (a, c) => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c))) < da * 1.01;
  // Is the wall open at segment k in band n? The doorway (south, two segments wide, the lowest
  // band) and the four windows (one to each quarter, in the fourth).
  const open = (n, k) => {
    const a = (((k % N) + N) % N + 0.5) * da;
    return n === 0 ? near(a, Math.PI / 2) : n === 3 ? [0, 1, 2, 3].some(q => near(a, q * Math.PI / 2)) : n < 0 || n > 4;
  };
  const pos = [], nrm = [], uv = [], idx = [], tile = M.stone.userData.tile;
  const quad = (pts, n) => {
    const at = pos.length / 3;
    for (const [px, py, pz, u, v] of pts) { pos.push(x + px, y + py, z + pz); nrm.push(...n); uv.push(u / tile, v / tile); }
    idx.push(at, at + 1, at + 2, at, at + 2, at + 3);
  };
  const P = (a, r, h, u, v) => [Math.cos(a) * r, h, Math.sin(a) * r, u, v];
  for (let n = 0; n < 5; n++) for (let k = 0; k < N; k++) {
    const h0 = levels[n], h1 = levels[n + 1], a0 = k * da, a1 = a0 + da, am = a0 + da / 2, out = [Math.cos(am), 0, Math.sin(am)];
    const u0 = a0 * K.r0, u1 = a1 * K.r0;
    if (open(n, k)) {
      // The sides of an opening, and its sill and head: the thickness of the wall shown.
      for (const [a, kk] of [[a0, k - 1], [a1, k + 1]]) if (!open(n, kk)) quad([P(a, ro(h0), h0, 0, h0), P(a, ro(h0) - K.t, h0, K.t, h0), P(a, ro(h1) - K.t, h1, K.t, h1), P(a, ro(h1), h1, 0, h1)], [-Math.sin(a), 0, Math.cos(a)]);
      for (const [h, nn] of [[h0, n - 1], [h1, n + 1]]) if (!open(nn, k)) quad([P(a0, ro(h), h, u0, 0), P(a1, ro(h), h, u1, 0), P(a1, ro(h) - K.t, h, u1, K.t), P(a0, ro(h) - K.t, h, u0, K.t)], [0, 1, 0]);
      continue;
    }
    quad([P(a0, ro(h0), h0, u0, h0), P(a1, ro(h0), h0, u1, h0), P(a1, ro(h1), h1, u1, h1), P(a0, ro(h1), h1, u0, h1)], out);
    quad([P(a0, ro(h0) - K.t, h0, u0, h0), P(a1, ro(h0) - K.t, h0, u1, h0), P(a1, ro(h1) - K.t, h1, u1, h1), P(a0, ro(h1) - K.t, h1, u0, h1)], out.map(v => -v));
    // What you walk against: this piece of wall as a block (to its thickest, at its foot).
    const box = new THREE.Box3();
    for (const a of [a0, a1]) for (const r of [ro(Math.max(0, h0)), ro(h1) - K.t]) for (const h of [h0, h1]) box.expandByPoint(new THREE.Vector3(x + Math.cos(a) * r, y + h, z + Math.sin(a) * r));
    b.boxes.push(box);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  // (the wall's stone, warmed toward the ochre rubble of those mills, and seen from inside too)
  millStone ??= Object.assign(M.stone.clone(), { side: THREE.DoubleSide, color: new THREE.Color(0xc9b08a), userData: { ...M.stone.userData } });
  const tower = new THREE.Mesh(geo, millStone);
  // The cap: a low cone of red tiles with a knob, its eaves just over the wall, and the tail pole
  // the miller turned it by, out the back and down.
  const fx = Math.cos(face), fz = Math.sin(face), yaw = Math.atan2(fx, fz);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(K.r1 + 0.3, 2.3, 28), CAP);
  cap.position.set(x, y + H + 1.15, z);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.5, 6), SPAR);
  knob.position.set(x, y + H + 2.5, z);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 3.6), SPAR);
  tail.position.set(x - fx * 3.4, y + H + 0.15, z - fz * 3.4); tail.rotation.set(0.12, yaw, 0, 'YXZ');
  for (const m of [tower, cap, knob, tail]) { m.castShadow = m.receiveShadow = true; b.group.add(m); m.updateMatrixWorld(true); }
  b.solids.push(tower, cap);
  // The loft floor: boards across the round, in strips, all but a hatch along the south side where
  // the ladder comes up.
  const edge = 0.4, ri = ro(K.loft) - K.t + 0.15;
  for (let z0 = -ri; z0 < edge - 0.01; z0 += 0.45) {
    const z1 = Math.min(edge, z0 + 0.45), half = Math.sqrt(Math.max(0.01, ri * ri - Math.min(z0 * z0, z1 * z1)));
    b.box(2 * half, 0.2, z1 - z0 + 0.02, M.darkWood, x, top - 0.2, z + (z0 + z1) / 2);
  }
  const lad = ladder(b, { x, z: z + edge + 0.06, y, top, face: 's' });
  // The wheel: six sails, each a spar with a lattice to one side of it, round a hub out from the
  // cap; a pole through the hub with a stay to every spar's tip. For the eye only (bullets and
  // men pass: it is lattice), one mesh.
  const wheel = new THREE.Group(), parts = [], m4 = new THREE.Matrix4();
  const bar = (w, h, d, px, py, pz, rz) => { const g = new THREE.BoxGeometry(w, h, d); g.applyMatrix4(m4.makeRotationZ(rz).multiply(new THREE.Matrix4().makeTranslation(px, py, pz))); parts.push(g); };
  const LEN = 6.6, W = 1.5, FROM = 1.3;
  for (let k = 0; k < 6; k++) {
    const rz = k * Math.PI / 3 + 0.52;
    bar(0.11, LEN, 0.11, 0, LEN / 2, 0, rz);                                       // the spar
    for (const off of [W / 2, W]) bar(0.045, LEN - FROM, 0.045, off, FROM + (LEN - FROM) / 2, 0, rz);   // the lattice's long rails
    for (let h = FROM; h <= LEN + 0.01; h += 0.44) bar(W, 0.04, 0.04, W / 2, h, 0, rz);                 // and its rungs
  }
  const POLE = 3.2;
  { const g = new THREE.CylinderGeometry(0.06, 0.09, POLE + 0.8, 6).rotateX(Math.PI / 2).translate(0, 0, (POLE - 0.8) / 2); parts.push(g); }
  const lattice = new THREE.Mesh(mergeGeometries(parts.map(g => g.toNonIndexed())), SPAR);
  lattice.castShadow = true;
  const stays = [];
  for (let k = 0; k < 6; k++) { const rz = k * Math.PI / 3 + 0.52; stays.push(0, 0, POLE, -Math.sin(rz) * LEN, Math.cos(rz) * LEN, 0); }
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(stays, 3)), new THREE.LineBasicMaterial({ color: 0x2c2a26 }));
  wheel.add(lattice, lines);
  wheel.position.set(x + fx * (K.r1 + 0.75), y + H + 0.75, z + fz * (K.r1 + 0.75));
  wheel.rotation.set(-0.12, yaw, 0, 'YXZ');                                        // (the axle leans back a little, as they do)
  b.group.add(wheel);
  return { ladder: lad, perch: new THREE.Vector3(x, top, z - 0.6), sails: wheel };
}

// A ruin with a place to shoot from: the shell of a house (ruins.js) and, in the corner that still
// stands, what is left of the upper floor: a few boards on two posts with a ladder up to them. In a
// two-storey shell they are at the upper windows; in a low one, just under the wall top, so you
// look over it. perch: false leaves it a plain shell.
export function ruin(b, r) {
  const o = { y: heightAt(r.x, r.z), w: 8, d: 6, h: 5.4, t: 0.45, fallen: 0, seed: Math.round(r.x * 7 + r.z), ...r };
  shellHouse(b, o);
  if (r.perch === false) return {};
  const whole = (o.fallen + 2) % 4, sx = whole === 1 || whole === 2 ? 1 : -1, sz = whole >= 2 ? 1 : -1;   // (corners NW NE SE SW; north is −z)
  const P = 2.3, px = o.x + sx * (o.w / 2 - o.t - P / 2), pz = o.z + sz * (o.d / 2 - o.t - P / 2);
  const top = o.y + (o.h > 4.5 ? 3.0 : o.h - 1.25);
  b.box(P, 0.14, P, M.darkWood, px, top - 0.14, pz);
  for (const k of [-1, 1]) b.box(0.16, top - o.y - 0.14, 0.16, M.darkWood, px + k * (P / 2 - 0.1), o.y, pz - sz * (P / 2 - 0.1), { solid: false });
  // The ladder on the boards' inner edge: stood south of it and climbed northward where the corner
  // is a north one, the other way for a south one.
  // (wherever along that edge its foot is clear of the fallen stone, tried at the middle first)
  const lz = pz - sz * (P / 2 + 0.06), fz = lz - sz * 0.45;
  const clear = (x) => !b.boxes.some(q => q.max.y > o.y + 0.6 && q.min.y < o.y + 1.7 && x > q.min.x - 0.3 && x < q.max.x + 0.3 && fz > q.min.z - 0.3 && fz < q.max.z + 0.3);
  const lx = [0, -0.6, 0.6, -0.95, 0.95].map(k => px + k).find(clear) ?? px;
  const lad = ladder(b, { x: lx, z: lz, y: o.y, top, face: sz < 0 ? 's' : 'n' });
  return { ladder: lad, perch: new THREE.Vector3(px, top, pz) };
}

// Everything the map's `cover` declares. Call it from the site, after the Builder is made:
//   const { ladders, perches } = buildCover(b);   …   return { solids: b.solids, boxes: b.boxes, ladders, … }
// ladders: for the site's `ladders` (or nothing climbs); perches: the high places it made (the
// mill's loft, each ruin's boards), { x, y, z, kind }: where to scope from, or to post a look-out.
export function buildCover(b, map = activeMap()) {
  const c = map.cover, ladders = [], perches = [];
  if (!c) return { ladders, perches };
  const high = (kind, made) => { if (made.ladder) { ladders.push(made.ladder); perches.push(Object.assign(made.perch, { kind })); } };
  (c.walls ?? []).forEach((line, i) => stoneWall(b, line, { seed: i + 1, height: c.wallHeight ?? 1.15 }));
  for (const [x, z, n = 3] of c.crates ?? []) furniture.crates(b, x, heightAt(x, z), z, n);
  for (const r of c.ruins ?? []) high('ruin', ruin(b, r));
  for (const w of c.windmills ?? []) high('windmill', windmill(b, w));
  return { ladders, perches };
}
