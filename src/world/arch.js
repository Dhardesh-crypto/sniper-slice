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
  // (The interior kit's: interior.js.)
  cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
  paper: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
  ceramic: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, side: THREE.DoubleSide }),
  pane: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
};
// Shutter paint: Tuscan greens, browns, a faded blue-grey, oxblood (linear multipliers on the
// kit's near-white).
const PAINT = [0x587a4e, 0x4f6b46, 0x6b4a32, 0x7d8b78, 0x6c8091, 0x76402f, 0x8a8f6a].map(h => new THREE.Color(h));

// The parts of both kits by name (the architecture kit's, and the interior kit's once it's loaded).
let kit = null;
function parts() {
  if (kit) return kit;
  if (!assets.models.archKit?.scene) return null;
  kit = {};
  for (const src of [assets.models.archKit.scene, assets.models.interiorKit?.scene]) if (src) addKit(src);
  return kit;
}
function addKit(src) {
  src.updateMatrixWorld(true);
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
}
export const hasArch = () => !!parts();

export const ROT = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _y = new THREE.Vector3(0, 1, 0);

// Bake part `name` into the scene: scaled by (sx, sy, sz) in its own axes, turned about its own
// vertical by `spin` (a shutter on its hinge), then laid on a wall face turned `rotY`, at (x, y, z).
export function put(b, name, x, y, z, rotY, { sx = 1, sy = 1, sz = 1, spin = 0, tint = null, shadow = true } = {}) {
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
  mesh.castShadow = shadow;                // (the small things indoors don't cast: the sun hardly reaches them)
  mesh.receiveShadow = true;
  mesh.userData.decor = true;
  b.group.add(mesh);
  return true;
}
export const hasPart = (name) => !!parts()?.[name];
function flip(g) {
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } return; }
  for (const k of Object.keys(g.attributes)) {
    const at = g.attributes[k], n = at.itemSize, a = at.array;
    for (let i = 0; i < a.length; i += 3 * n) for (let j = 0; j < n; j++) { const t = a[i + n + j]; a[i + n + j] = a[i + 2 * n + j]; a[i + 2 * n + j] = t; }
  }
}

// A point on a wall face: `u` along it (to the face's right as you look at it), `w` out of it.
export function onFace(cx, cz, rotY, u, w) {
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
export function dressWindow(b, { cx, cz, side, y0, w = 1, h = 1.4, open = false, look, k = 0, flowers = false }) {
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
  // Geraniums on the sill, now and then (upper floors).
  if (flowers && look.r(k + 5) < 0.3) { [x, z] = at(0, 0.03); put(b, 'planter', x, y0, z, rotY, { sx: w + 0.1 }); }
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
export function dressBlock(b, { x, z, w, d, y, height, plinth = true, storey = 0 }) {
  if (!parts()) return false;
  const look = houseLook(x, z);
  for (const [side, cx, cz, len] of faces(x, z, w, d)) {
    if (plinth) along(b, 'plinth', cx, cz, ROT[side], -len / 2, len / 2, y - 0.25, { step: 1 });
    // String courses between the storeys: what breaks a tall wall into floors.
    if (storey) for (let f = 1; f * storey < height - 1; f++) along(b, 'band', cx, cz, ROT[side], -len / 2, len / 2, y + f * storey - 0.08);
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

// Dressing for a hipped roof (Builder.hip): the ridge tiles along its short ridge (from −ridge to
// +ridge, [x, z] half-lengths), the cornice right round, and now and then a chimney.
export function dressHip(b, { w, d, rise, x, y, z, ridge }) {
  if (!parts()) return false;
  const [ax, az] = ridge, len = 2 * Math.max(ax, az), rotY = ax ? 0 : Math.PI / 2;
  const n = Math.max(1, Math.round(len)), each = len / n;
  for (let i = 0; i < n && len > 0.3; i++) {
    const t = -len / 2 + i * each;
    // (Turned a quarter, a piece runs toward −z from where it's put.)
    put(b, 'ridge', ax ? x + t : x, y + rise - 0.02, ax ? z : z - t, rotY, { sx: each });
  }
  for (const [side, cx, cz, l] of faces(x, z, w, d)) along(b, 'eave', cx, cz, ROT[side], -l / 2 - 0.4, l / 2 + 0.4, y - 0.3);
  const look = houseLook(x, z);
  if (look.r(11) < 0.55) put(b, 'chimney', x + (look.r(12) - 0.5) * w * 0.4, y + rise * 0.55, z + (look.r(13) < 0.5 ? -1 : 1) * d * 0.15, 0);
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

// ---- the street floor of a house: a door, or a shop under an arch with its awning and sign ----
const SHOPS = ['BAR', 'TABACCHI', 'FORNO', 'ALIMENTARI', 'FARMACIA', 'MACELLERIA', 'OSTERIA', 'BARBIERE', 'MERCERIA', 'VINI E OLII'];
const signs = new Map();
function signMaterial(text) {
  if (signs.has(text)) return signs.get(text);
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#2f3a2c'; g.fillRect(0, 0, 512, 96);                       // a painted board
  g.strokeStyle = '#b8a77a'; g.lineWidth = 5; g.strokeRect(8, 8, 496, 80);
  g.fillStyle = '#e6d9b4'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${text.length > 9 ? 44 : 56}px Georgia, "Times New Roman", serif`;
  g.fillText(text.split('').join(String.fromCharCode(8202)), 256, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  signs.set(text, m);
  return m;
}
function sign(b, x, y, z, rotY, text, w = 2.4) {
  const geo = new THREE.PlaneGeometry(w, w * 96 / 512);
  geo.rotateY(rotY); geo.translate(x, y, z);
  const mesh = new THREE.Mesh(geo, signMaterial(text));
  mesh.receiveShadow = true;
  mesh.userData.decor = true;
  b.group.add(mesh);
}

// The middle of a painted house's street floor (its face `side` at (cx, cz), the street at y0, the
// wall `room` wide there): a door, or a shop with an arch, an awning and a painted sign. Returns
// how wide a gap it took, so the windows either side keep clear of it (0: leave it a window).
export function dressStreetFloor(b, { cx, cz, side, y0, room, look }) {
  if (!parts()) return 0;
  const rotY = ROT[side], r = look.r(30);
  // (A painted house is a solid block: what's modelled set back in its opening is brought forward.)
  let [x, z] = onFace(cx, cz, rotY, 0, 0.12);
  if (r < 0.32 && room >= 3.3 && hasPart('shop')) {
    put(b, 'shop', x, y0, z, rotY, { sx: 0.88, sy: 0.88, sz: 0.88 });       // (its arch tops out under the first floor's band)
    if (look.r(31) < 0.6) { [x, z] = onFace(cx, cz, rotY, 0, 0.02); put(b, 'awning', x, y0 + 3.0, z, rotY); }
    [x, z] = onFace(cx, cz, rotY, 0, 0.03);
    sign(b, x, y0 + 3.55, z, rotY, SHOPS[Math.floor(look.r(32) * SHOPS.length)], 2.2);   // between the band and the windows above
    return 2.8;
  }
  if (r < 0.8 && hasPart('door_leaf')) {
    const w = 1.3, h = 2.4;
    put(b, 'door_leaf', x, y0, z, rotY, { sx: w, sy: h, tint: look.paint.clone().multiplyScalar(0.8) });
    dressDoor(b, { cx, cz, side, y0, w, h });
    if (look.r(33) < 0.55) { [x, z] = onFace(cx, cz, rotY, w / 2 + 0.45, 0); put(b, 'lantern', x, y0 + 2.5, z, rotY); }
    return 1.9;
  }
  return 0;
}

// A shrine on a house's corner, now and then.
export function dressShrine(b, { cx, cz, side, y0, look }) {
  if (!parts() || look.r(40) > 0.12) return;
  const [x, z] = onFace(cx, cz, ROT[side], 0, 0);
  put(b, 'shrine', x, y0 + 2.2, z, ROT[side]);
}

// Washing hung out on a line under a window: a few clothes in the sun.
const CLOTH = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
const LAUNDRY = [0xe8e4da, 0xdcd8cc, 0x8aa0b8, 0xb8b0a0, 0x9a3a2a, 0xe0d0a8, 0x6a7a5a].map(h => new THREE.Color(h));
export function dressLaundry(b, { cx, cz, side, y, w, look }) {
  if (!parts() || look.r(41) > 0.22) return;
  const rotY = ROT[side], pos = [], col = [];
  const quad = (pts, c) => { for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...pts[i]); col.push(c.r, c.g, c.b); } };
  const at = (u, v, w2) => { const [x, z] = onFace(cx, cz, rotY, u, w2); return [x, v, z]; };
  const L = w / 2;
  quad([at(-L, y, 0.62), at(L, y, 0.62), at(L, y - 0.012, 0.62), at(-L, y - 0.012, 0.62)], new THREE.Color(0x3a3a38));   // the line
  let u = -L + 0.15, k = 0;
  while (u < L - 0.4) {
    const cw = 0.35 + look.r(50 + k) * 0.45, ch = 0.4 + look.r(60 + k) * 0.5, c = LAUNDRY[Math.floor(look.r(70 + k) * LAUNDRY.length)];
    quad([at(u, y, 0.62), at(u + cw, y, 0.62), at(u + cw, y - ch, 0.6 + 0.04 * look.r(80 + k)), at(u, y - ch, 0.6)], c);
    u += cw + 0.1 + look.r(90 + k) * 0.3; k++;
  }
  for (const s of [-1, 1]) {                                                    // the brackets
    const p0 = at(s * L, y + 0.02, 0), p1 = at(s * L, y + 0.02, 0.64);
    quad([p0, p1, [p1[0], p1[1] - 0.03, p1[2]], [p0[0], p0[1] - 0.03, p0[2]]], new THREE.Color(0x262625));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, CLOTH);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.decor = true;
  b.group.add(mesh);
}
