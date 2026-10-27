// The architecture kit (tools/blender/architecture.py → arch_kit.glb): stone window surrounds and
// sills, louvred shutters, door jambs with a keystone, a cornice with rafter tails under the eaves,
// ridge tiles, a stone base course, quoins, chimneys, balconies and downpipes, snapped onto the
// box-built houses. All of it is decoration: nothing here is solid, so collision, bullets and the
// guards' paths are exactly what the boxes make them. Each piece is baked into world space as a
// decor mesh and merged with the rest of its material (mergeDecor), so a whole town is a handful
// of draw calls. If the kit hasn't loaded, nothing is added and the houses stay as they were.
//
// Faces: 'n' (−z), 's' (+z), 'w' (−x), 'e' (+x), as in buildings.js. A kit part is modelled with
// x along the wall, y up and +z out of the wall's face.
import * as THREE from 'three';
import { assets } from './characters.js';

const MATS = {
  stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
  tile: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
  // (Shutters, casements and railings are single sheets, seen from either side.)
  wood: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
  frame: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }),
  glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.2, envMapIntensity: 0.5 }),
  iron: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }),
};
// Shutter paint: Tuscan greens, browns, a faded blue-grey, oxblood (linear multipliers on the
// kit's near-white).
const PAINT = [0x587a4e, 0x4f6b46, 0x6b4a32, 0x7d8b78, 0x6c8091, 0x76402f, 0x8a8f6a].map(h => new THREE.Color(h));

let kit = null;
function parts() {
  if (kit) return kit;
  const src = assets.models.archKit?.scene;
  if (!src) return null;
  src.updateMatrixWorld(true);
  kit = {};
  src.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    if (g.attributes.color.itemSize === 4 || g.attributes.color.normalized) {   // one colour layout for merging
      const c = g.attributes.color, a = new Float32Array(c.count * 3);
      for (let i = 0; i < c.count; i++) { a[i * 3] = c.getX(i); a[i * 3 + 1] = c.getY(i); a[i * 3 + 2] = c.getZ(i); }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    kit[o.name] = { g, mat: MATS[o.material.name] ?? MATS.stone };
  });
  return kit;
}
export const hasArch = () => !!parts();

const ROT = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _y = new THREE.Vector3(0, 1, 0);

// Bake part `name` into the scene: scaled by (sx, sy, sz) in its own axes, turned about its own
// vertical by `spin` (a shutter on its hinge), then laid on a wall face turned `rotY`, at (x, y, z).
function put(b, name, x, y, z, rotY, { sx = 1, sy = 1, sz = 1, spin = 0, tint = null } = {}) {
  const p = parts()?.[name];
  if (!p) return;
  const g = p.g.clone();
  const m = new THREE.Matrix4().makeScale(sx, sy, sz);
  if (spin) m.premultiply(_m.makeRotationY(spin));
  m.premultiply(_m.compose(new THREE.Vector3(x, y, z), _q.setFromAxisAngle(_y, rotY), new THREE.Vector3(1, 1, 1)));
  g.applyMatrix4(m);
  if (m.determinant() < 0) flip(g);
  if (tint) {
    const c = g.attributes.color;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * tint.r, c.getY(i) * tint.g, c.getZ(i) * tint.b);
  }
  const mesh = new THREE.Mesh(g, p.mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.decor = true;
  b.group.add(mesh);
}
function flip(g) {
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } return; }
  for (const k of Object.keys(g.attributes)) {
    const at = g.attributes[k], n = at.itemSize, a = at.array;
    for (let i = 0; i < a.length; i += 3 * n) for (let j = 0; j < n; j++) { const t = a[i + n + j]; a[i + n + j] = a[i + 2 * n + j]; a[i + 2 * n + j] = t; }
  }
}

// A point on a wall face: `u` along it (to the face's right as you look at it), `w` out of it.
function onFace(cx, cz, rotY, u, w) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return [cx + u * c + w * s, cz - u * s + w * c];
}

// A house's paint and its luck (stable per position).
export function houseLook(x, z) {
  const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
  return { paint: PAINT[Math.floor(h * PAINT.length)], r: (k) => Math.abs(Math.sin((x + k * 3.7) * 12.9898 + (z - k) * 78.233) * 43758.5453) % 1 };
}

// A window in the face `side` at (cx, cz) (the opening's centre on the face), bottom y0, w × h.
// open: a real hole in the wall (no glass, the shutters folded back); otherwise the window is
// painted on a solid block, so it gets a casement and dark glass, just proud of the face.
export function dressWindow(b, { cx, cz, side, y0, w = 1, h = 1.4, open = false, look, k = 0 }) {
  if (!parts()) return false;
  const rotY = ROT[side], at = (u, wo) => onFace(cx, cz, rotY, u, wo);
  look ??= houseLook(cx, cz);
  let [x, z] = at(0, 0);
  put(b, 'win_sill', x, y0, z, rotY, { sx: w + 0.34 });
  put(b, 'win_lintel', x, y0 + h, z, rotY, { sx: w + 0.3 });
  for (const s of [-1, 1]) { [x, z] = at(s * (w / 2 + 0.06), 0); put(b, 'win_jamb', x, y0, z, rotY, { sy: h }); }
  if (!open) {
    [x, z] = at(0, 0.035);
    put(b, 'win_glass', x, y0, z, rotY, { sx: w, sy: h });
    put(b, 'win_casement', x, y0, z, rotY, { sx: w, sy: h });
  }
  // The shutters: mostly folded back flat, some ajar; on a painted window now and then shut.
  const r = look.r(k + 1), state = !open && r < 0.18 ? 'shut' : r < 0.32 ? 'ajar' : 'open';
  const ang = { open: Math.PI * 0.98, ajar: Math.PI * (0.45 + look.r(k + 2) * 0.25), shut: 0 }[state];
  for (const s of [-1, 1]) {
    [x, z] = at(s * w / 2, 0.06);
    // Left (s = −1) swings out to the left; the right one is the left mirrored.
    put(b, 'shutter', x, y0 + 0.02, z, rotY, { sx: -s * w / 2, sy: h - 0.04, spin: s * ang, tint: look.paint });
  }
  return true;
}

// A doorway's stone jambs and keystone lintel, in face `side` at (cx, cz), bottom y0, w × h.
export function dressDoor(b, { cx, cz, side, y0, w = 1.2, h = 2.2 }) {
  if (!parts()) return false;
  const rotY = ROT[side];
  for (const s of [-1, 1]) { const [x, z] = onFace(cx, cz, rotY, s * (w / 2 + 0.1), 0); put(b, 'door_jamb', x, y0, z, rotY, { sy: h }); }
  const [x, z] = onFace(cx, cz, rotY, 0, 0);
  put(b, 'door_lintel', x, y0 + h, z, rotY, { sx: w + 0.44 });
  return true;
}

// Part `name` repeated along a face from u0 to u1 (whole pieces, stretched to fit).
function along(b, name, cx, cz, rotY, u0, u1, y, opts = {}) {
  const len = u1 - u0, n = Math.max(1, Math.round(len / (opts.step ?? 1))), each = len / n;
  for (let i = 0; i < n; i++) {
    const [x, z] = onFace(cx, cz, rotY, u0 + i * each + (opts.centred ? each / 2 : 0), 0);
    put(b, name, x, y, z, rotY, { sx: each / (opts.step ?? 1) * (opts.step ?? 1), ...opts });
  }
}

// The four faces of a w × d block centred on (x, z): [side, centre x, centre z, length].
const faces = (x, z, w, d) => [['s', x, z + d / 2, w], ['n', x, z - d / 2, w], ['e', x + w / 2, z, d], ['w', x - w / 2, z, d]];

// The shell of a house block: a stone base course, quoins up the corners, a downpipe.
export function dressBlock(b, { x, z, w, d, y, height, plinth = true }) {
  if (!parts()) return false;
  const look = houseLook(x, z);
  for (const [side, cx, cz, len] of faces(x, z, w, d)) {
    if (plinth) along(b, 'plinth', cx, cz, ROT[side], -len / 2, len / 2, y - 0.25, { step: 1 });
  }
  // Quoins on two or four corners (the corner at the face's right end looks +z and +x locally).
  const corners = [[x + w / 2, z + d / 2, 0], [x + w / 2, z - d / 2, Math.PI / 2], [x - w / 2, z - d / 2, Math.PI], [x - w / 2, z + d / 2, -Math.PI / 2]];
  if (look.r(9) < 0.6) {
    const storey = 1.6, n = Math.max(1, Math.round((height - 0.6) / storey));
    for (const [qx, qz, rotY] of corners) for (let i = 0; i < n; i++) put(b, 'quoin', qx, y + 0.45 + i * (height - 0.6) / n, qz, rotY, { sy: (height - 0.6) / n / storey });
  }
  // A downpipe down one corner of the street face.
  const [px, pz] = onFace(x, z + d / 2, 0, (look.r(10) < 0.5 ? -1 : 1) * (w / 2 - 0.25), 0);
  put(b, 'pipe', px, y, pz, 0, { sy: height - 0.1 });
  return true;
}

// Dressing for a gable roof (Builder.gable): ridge tiles, the cornice under both eaves, and now and
// then a chimney. Ridge along the roof's local x; w, d, rise and (x, y, z) as Builder.gable takes them.
export function dressGable(b, { w, d, rise, x, y, z, rotY = 0 }) {
  if (!parts()) return false;
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const local = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const L = w / 2 + 0.4;
  // Ridge: along local x at the apex.
  const n = Math.max(1, Math.round(2 * L)), each = 2 * L / n;
  for (let i = 0; i < n; i++) { const [px, pz] = local(-L + i * each, 0); put(b, 'ridge', px, y + rise - 0.02, pz, rotY, { sx: each }); }
  // Eaves: the cornice along both long walls, just under the roof's edge.
  for (const side of [1, -1]) {
    const [fx, fz] = local(0, side * d / 2);
    const faceRot = rotY + (side > 0 ? 0 : Math.PI);
    along(b, 'eave', fx, fz, faceRot, -w / 2 - 0.4, w / 2 + 0.4, y - 0.3);
  }
  const look = houseLook(x, z);
  if (look.r(11) < 0.55 && w > 4) {
    const lx = (look.r(12) - 0.5) * w * 0.6, lz = (look.r(13) < 0.5 ? -1 : 1) * d * 0.18;
    const D = d / 2 + 0.4, at = rise * (1 - Math.abs(lz) / D);
    const [px, pz] = local(lx, lz);
    put(b, 'chimney', px, y + at - 0.25, pz, rotY);
  }
  return true;
}

// A flat roof's cornice: the eave moulding (without its rafters reading as much) under the parapet.
export function dressFlatRoof(b, { x, z, w, d, y }) {
  if (!parts()) return false;
  for (const [side, cx, cz, len] of faces(x, z, w, d)) along(b, 'eave', cx, cz, ROT[side], -len / 2, len / 2, y - 0.34);
  return true;
}

// A balcony under an upper-floor French window in face `side` at (cx, cz), its floor at y.
export function dressBalcony(b, { cx, cz, side, y }) {
  if (!parts()) return false;
  const [x, z] = onFace(cx, cz, ROT[side], 0, 0);
  put(b, 'balcony', x, y, z, ROT[side]);
  put(b, 'railing', x, y, z, ROT[side]);
  return true;
}
