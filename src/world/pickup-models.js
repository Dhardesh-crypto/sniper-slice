// The models of the things you can open and use (world/pickups.js): toolboxes, weapon crates,
// the supply caches (ammo cans, medical boxes, explosives crates, bottle crates, heavy ammunition)
// and the workbenches. Each is built from boards, steel and fittings: planks cut from the wood
// photo one board at a time, worn paint with chips and rust, stencilled markings, hinges, hasps
// and rope handles, and what's inside (seen once the lid is up).
// Each kind is built once and copied; its parts are merged per material (a few draw calls each).
// `userData.lid` swings open about the back edge (to `userData.openAngle`); `userData.taken`, if
// there is one, is what you take out (hidden once it's opened).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { textures } from './textures.js';
import { makeRng } from './noise.js';

// ---- textures drawn once ----

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Paint on steel or wood that has seen a war: mottled, scratched, chipped to bare metal, rusty.
function wornPaint(base, seed, { chips = 30, rust = 12 } = {}) {
  const rng = makeRng(seed), c = canvas(256), g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    g.globalAlpha = 0.03 + rng() * 0.05;
    g.fillStyle = rng() < 0.5 ? '#000' : '#fff';
    g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2, 1 + rng() * 2);
  }
  g.globalAlpha = 0.06;
  g.fillStyle = '#000';
  g.fillRect(0, 230, 256, 26);                 // grime settles low
  g.globalAlpha = 0.22;
  g.strokeStyle = '#9d9a90';
  for (let i = 0; i < 40; i++) {
    const x = rng() * 256, y = rng() * 256, a = rng() * Math.PI, l = 4 + rng() * 18;
    g.lineWidth = 0.6 + rng();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const blot = (color, n, size, alpha) => {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = alpha * (0.5 + rng() * 0.5);
      g.fillStyle = color;
      const x = rng() * 256, y = rng() * 256, r = size * (0.4 + rng());
      g.beginPath();
      for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2, rr = r * (0.5 + rng() * 0.7); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.fill();
    }
  };
  blot('#5e3a22', rust, 4, 0.4);        // rust
  blot('#7d7b73', chips, 1.6, 0.8);     // chips to bare steel
  g.globalAlpha = 1;
  return tex(c);
}

// Wood wool, the packing in a crate.
function woodWool(seed) {
  const rng = makeRng(seed), c = canvas(256), g = c.getContext('2d');
  g.fillStyle = '#5c4426'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 150 + rng() * 80;
    g.strokeStyle = `rgba(${v},${v * 0.82},${v * 0.5},${0.5 + rng() * 0.5})`;
    g.lineWidth = 0.8 + rng() * 1.2;
    const x = rng() * 256, y = rng() * 256, a = rng() * Math.PI * 2, l = 10 + rng() * 30;
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 1) * l * 0.5, y + Math.sin(a + 1) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Stencilled lettering, sprayed: soft-edged, with gaps where the stencil's bridges were and wear.
function stencil(lines, { color = '#e9e4d2', w = 512, h = 128, seed = 1, font = 'bold' } = {}) {
  const rng = makeRng(seed), c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = color;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((line, i) => {
    const size = Math.floor((h / n) * (i === 0 ? 0.78 : 0.62));
    g.font = `${font} ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    const y = (h / n) * (i + 0.5);
    g.shadowColor = color; g.shadowBlur = 2;
    g.fillText(line, w / 2, y, w * 0.94);
    // The stencil's bridges: thin vertical gaps through the letters.
    g.save(); g.globalCompositeOperation = 'destination-out'; g.shadowBlur = 0;
    const tw = Math.min(g.measureText(line).width, w * 0.94);
    for (let x = w / 2 - tw / 2 + size * 0.28; x < w / 2 + tw / 2; x += size * 0.55) g.fillRect(x, y - size * 0.06, size * 0.05, size * 0.12);
    g.restore();
  });
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) {
    g.globalAlpha = 0.3 + rng() * 0.7;
    g.beginPath(); g.arc(rng() * w, rng() * h, 0.6 + rng() * 2.4, 0, Math.PI * 2); g.fill();
  }
  return tex(c);
}

// The red cross on a white disc, painted.
function redCross() {
  const c = canvas(128), g = c.getContext('2d');
  g.fillStyle = '#ece8dc'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#b3241c'; g.fillRect(50, 20, 28, 88); g.fillRect(20, 50, 88, 28);
  return tex(c);
}

// ---- materials ----

let MAT = null;
function materials() {
  if (MAT) return MAT;
  const T = textures();
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, ...o });
  const decal = (map) => std({ map, alphaTest: 0.45, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
  MAT = {
    pine: std({ ...T.wood, color: 0xe8c896, roughness: 0.9 }),          // raw crate boards
    greyWood: std({ ...T.wood, color: 0xa7ab92, roughness: 0.88 }),     // field-grey painted boards
    oliveWood: std({ ...T.wood, color: 0x8e9468, roughness: 0.85 }),    // olive painted boards
    yellowWood: std({ ...T.wood, color: 0xf0c060, roughness: 0.85 }),   // dark-yellow painted band
    benchWood: std({ ...T.darkWood, color: 0xd9b48a, roughness: 0.8 }), // oiled beech, the bench top
    oldWood: std({ ...T.wood, color: 0xc9a77c, roughness: 0.92 }),
    inside: std({ ...T.wood, color: 0x8a7458, roughness: 0.95 }),       // the boards' unpainted insides
    steelOlive: std({ map: wornPaint('#4b5034', 3), metalness: 0.55, roughness: 0.62 }),
    steelGrey: std({ map: wornPaint('#545a57', 4), metalness: 0.55, roughness: 0.6 }),
    steelBlueGrey: std({ map: wornPaint('#3f4c4c', 5, { chips: 90, rust: 10 }), metalness: 0.6, roughness: 0.5 }),
    iron: std({ map: wornPaint('#2e2e2b', 6, { chips: 30, rust: 70 }), metalness: 0.7, roughness: 0.55 }),
    bright: std({ color: 0xa9aaa6, metalness: 0.9, roughness: 0.32 }),    // worn steel: tools, jaws
    brass: std({ color: 0xb08d47, metalness: 0.9, roughness: 0.35 }),
    copper: std({ color: 0xa8603a, metalness: 0.9, roughness: 0.4 }),
    black: std({ color: 0x1b1b1a, metalness: 0.4, roughness: 0.5 }),
    rope: std({ color: 0x9c8559, roughness: 1 }),
    leather: std({ color: 0x4a3020, roughness: 0.7 }),
    cloth: std({ color: 0xe6e1d2, roughness: 1 }),
    khaki: std({ color: 0xa69a74, roughness: 1 }),
    rag: std({ color: 0x8c7d62, roughness: 1 }),
    handleWood: std({ color: 0x8a5a32, roughness: 0.6 }),
    redHandle: std({ color: 0x7a2a1c, roughness: 0.5 }),
    glass: std({ color: 0x1f3a1c, roughness: 0.12, metalness: 0.2 }),
    brownGlass: std({ color: 0x3a2210, roughness: 0.12, metalness: 0.2 }),
    cork: std({ color: 0xa07a4a, roughness: 0.9 }),
    lampGlass: std({ color: 0xf2e2b8, emissive: 0x6a4a18, roughness: 0.15, transparent: true, opacity: 0.75 }),
    woodWool: std({ map: woodWool(7), roughness: 1 }),
    redPaint: std({ map: wornPaint('#7a2519', 8, { chips: 40, rust: 0 }), roughness: 0.85 }),
  };
  Object.assign(MAT, {
    sWaffen: decal(stencil(['WAFFEN', 'NICHT STÜRZEN'], { seed: 11 })),
    sWerkzeug: decal(stencil(['WERKZEUG'], { seed: 12, h: 96 })),
    sSpreng: decal(stencil(['SPRENGMUNITION', 'VORSICHT · NICHT WERFEN'], { color: '#1c1a17', seed: 13 })),
    sMunition: decal(stencil(['MUNITION', 'GEGEN FEUER SCHÜTZEN'], { color: '#e3cf8a', seed: 14 })),
    sPatronen: decal(stencil(['7,9 mm', '300 Patr. S.m.K.'], { seed: 15 })),
    sBottles: decal(stencil(['WEIN · LEER ZURÜCK'], { color: '#2a2018', seed: 16, h: 96 })),
    redCross: decal(redCross()),
  });
  return MAT;
}

// ---- building ----

// Board UVs: the face along the board's grain shows one plank strip of the wood photo (picked
// at random), running the length of the board; end grain gets a small patch.
const STRIPS = [[0, 128], [128, 257], [257, 385], [385, 513], [513, 673], [673, 863], [863, 1024]];
function boardUV(geo, w, h, d, rng) {
  const ext = [w, h, d], grain = ext.indexOf(Math.max(...ext));
  const [s0, s1] = STRIPS[Math.floor(rng() * STRIPS.length)], u0 = s0 / 1024 + 0.004, u1 = s1 / 1024 - 0.004;
  const v0 = rng();
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const n = [Math.abs(nrm.getX(i)), Math.abs(nrm.getY(i)), Math.abs(nrm.getZ(i))];
    const face = n.indexOf(Math.max(...n)), axes = [0, 1, 2].filter(a => a !== face);
    if (face === grain) { uv.setXY(i, u0 + (p[axes[0]] / ext[axes[0]] + 0.5) * (u1 - u0) * 0.3, v0 + p[axes[1]] * 0.3); continue; }
    const across = axes.find(a => a !== grain);
    uv.setXY(i, u0 + (p[across] / ext[across] + 0.5) * (u1 - u0), v0 + p[grain] * 0.9);
  }
  uv.needsUpdate = true;
}

class Parts {
  constructor(seed) {
    this.rng = makeRng(seed);
    this.sets = { body: new Map(), lid: new Map(), taken: new Map() };
  }
  // A geometry placed in the model (rotated, then moved to `at`), in one of its parts.
  put(geo, mat, at = [0, 0, 0], { rot = null, part = 'body' } = {}) {
    // Turned about z first (to lay it down), then x, then y (where it points).
    if (rot) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')));
    geo.translate(at[0], at[1], at[2]);
    const m = this.sets[part];
    if (!m.has(mat)) m.set(mat, []);
    m.get(mat).push(geo);
    return geo;
  }
  // A box centred at `at`; wooden materials get board UVs.
  box(w, h, d, mat, at, opts) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const W = textures();
    if (mat.map && (mat.map === W.wood.map || mat.map === W.darkWood.map)) boardUV(geo, w, h, d, this.rng);
    return this.put(geo, mat, at, opts);
  }
  cyl(r0, r1, len, mat, at, opts, seg = 12) { return this.put(new THREE.CylinderGeometry(r0, r1, len, seg), mat, at, opts); }
  // A flat decal facing +z (or turned by rot), w × h.
  decal(w, h, mat, at, opts) { return this.put(new THREE.PlaneGeometry(w, h), mat, at, opts); }
  // A crate's side made of horizontal boards with hairline gaps (w along x, facing ±z).
  boards(w, h, t, n, mat, at, opts = {}) {
    const bh = h / n;
    for (let i = 0; i < n; i++) this.box(w, bh - 0.004, t, mat, [at[0], at[1] - h / 2 + bh * (i + 0.5), at[2]], opts);
  }

  // The model: one mesh per material and part; the lid pivots about `pivot` (its hinge line).
  build(pivot = [0, 0, 0]) {
    const root = new THREE.Group();
    const meshes = (part, into, shift) => {
      for (const [mat, geos] of this.sets[part]) {
        const flat = geos.map(g => {
          const f = g.index ? g.toNonIndexed() : g;
          for (const k of Object.keys(f.attributes)) if (!['position', 'normal', 'uv'].includes(k)) f.deleteAttribute(k);
          if (shift) f.translate(-shift[0], -shift[1], -shift[2]);
          return f;
        });
        const mesh = new THREE.Mesh(mergeGeometries(flat), mat);
        mesh.castShadow = !mat.alphaTest;
        mesh.receiveShadow = true;
        mesh.userData.detail = !mainMaterials().has(mat);
        into.add(mesh);
      }
    };
    meshes('body', root);
    const lid = new THREE.Group();
    lid.name = 'lid';
    lid.position.fromArray(pivot);
    meshes('lid', lid, pivot);
    root.add(lid);
    if (this.sets.taken.size) {
      const taken = new THREE.Group();
      taken.name = 'taken';
      meshes('taken', taken);
      root.add(taken);
    }
    return root;
  }
}

// What a model is mostly made of (boards, painted steel); the rest (fittings, lettering, the
// contents) is detail, left out from afar.
let MAIN = null;
function mainMaterials() {
  const M = materials();
  return MAIN ??= new Set([M.pine, M.greyWood, M.oliveWood, M.oldWood, M.benchWood, M.steelOlive]);
}

// Fittings shared by the crates.
function ropeHandle(P, x, y, side, part) {
  // A loop of rope through two holes in the end cleat, hanging a little.
  const g = new THREE.TorusGeometry(0.055, 0.009, 6, 14, Math.PI);
  P.put(g, materials().rope, [x, y, 0], { rot: [0, side * Math.PI / 2, Math.PI], part });
  for (const z of [-0.055, 0.055]) P.put(new THREE.SphereGeometry(0.014, 8, 6), materials().rope, [x - side * 0.004, y, z], { part });
}
function hasp(P, x, y, z, part = 'body') {
  const M = materials();
  P.box(0.035, 0.06, 0.006, M.iron, [x, y - 0.02, z], { part: 'body' });             // staple plate on the body
  P.box(0.03, 0.055, 0.005, M.iron, [x, y + 0.02, z + 0.004], { part });             // the hasp on the lid
  P.cyl(0.006, 0.006, 0.012, M.bright, [x, y - 0.01, z + 0.01], { rot: [Math.PI / 2, 0, 0], part: 'body' });
}
function strapHinge(P, x, y, z, depth) {
  const M = materials();
  P.box(0.03, 0.004, depth, M.iron, [x, y + 0.002, z + depth / 2], { part: 'lid' });
  P.box(0.03, 0.05, 0.004, M.iron, [x, y - 0.025, z - 0.002]);
  P.cyl(0.006, 0.006, 0.034, M.iron, [x, y, z - 0.002], { rot: [0, 0, Math.PI / 2] });
}
// Iron corner caps, on a crate whose outside (end cleats included) is L × H × D.
function cornerIrons(P, L, H, D) {
  const M = materials();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const top of [0, 1]) {
    const y = top ? H - 0.03 : 0.03;
    P.box(0.06, 0.06, 0.008, M.iron, [sx * (L / 2 - 0.028), y, sz * (D / 2 - 0.002)]);
    P.box(0.003, 0.06, 0.06, M.iron, [sx * (L / 2 + 0.0015), y, sz * (D / 2 - 0.028)]);
  }
}

// A wooden crate: boarded sides, end cleats, a boarded lid with battens, hinges, hasps and rope
// handles. Returns the Parts with the hinge line, for the contents to be added.
function woodenCrate(P, { L, H, D, wood, lidWood = wood, boards = 2, t = 0.02, bands = true }) {
  const M = materials();
  P.box(L - 2 * t, t, D - 2 * t, M.inside, [0, t / 2, 0]);                            // bottom
  for (const s of [-1, 1]) P.boards(L, H, t, boards, wood, [0, H / 2, s * (D / 2 - t / 2)]);
  for (const s of [-1, 1]) {
    P.box(t, H, D - 2 * t, wood, [s * (L / 2 - t / 2), H / 2, 0]);                    // end board
    P.box(0.035, H, D + 0.01, wood, [s * (L / 2 + 0.0175), H / 2, 0]);               // end cleat
    ropeHandle(P, s * (L / 2 + 0.036), H * 0.6, s);
  }
  // Lid: boards along the length, two battens across underneath, steel bands over the top.
  const nLid = Math.max(2, Math.round(D / 0.14)), bw = (D + 0.01) / nLid;
  for (let i = 0; i < nLid; i++) P.box(L + 0.08, t, bw - 0.004, lidWood, [0, H + t / 2, -D / 2 - 0.005 + bw * (i + 0.5)], { part: 'lid' });
  for (const x of [-L * 0.3, L * 0.3]) {
    P.box(0.06, 0.02, D - 2 * t - 0.01, lidWood, [x, H - 0.01, 0], { part: 'lid' });
    if (!bands) continue;
    P.box(0.035, 0.003, D + 0.012, M.iron, [x, H + t + 0.0015, 0], { part: 'lid' });
    P.box(0.035, H - 0.02, 0.003, M.iron, [x, H / 2, D / 2 + 0.0015]);
    P.box(0.035, H - 0.02, 0.003, M.iron, [x, H / 2, -D / 2 - 0.0015]);
  }
  cornerIrons(P, L + 0.07, H, D + 0.01);
  for (const x of [-L * 0.36, L * 0.36]) strapHinge(P, x, H + t, -D / 2, D * 0.45);
  for (const x of [-L * 0.36, L * 0.36]) hasp(P, x, H, D / 2 + 0.006, 'lid');
  return [0, H, -D / 2];
}

// ---- the models ----

function toolbox() {
  const M = materials(), P = new Parts(21), paint = M.steelOlive;
  const L = 0.52, H = 0.2, D = 0.22, t = 0.005;
  // A pressed-steel box (hollow, so you see into it), with a rolled rim.
  P.box(L, t, D, paint, [0, t / 2, 0]);
  for (const s of [-1, 1]) P.box(L, H, t, paint, [0, H / 2, s * (D / 2 - t / 2)]);
  for (const s of [-1, 1]) P.box(t, H, D - 2 * t, paint, [s * (L / 2 - t / 2), H / 2, 0]);
  for (const s of [-1, 1]) P.cyl(0.006, 0.006, L, paint, [0, H - 0.004, s * (D / 2 + 0.002)], { rot: [0, 0, Math.PI / 2] }, 8);
  for (const s of [-1, 1]) P.box(L - 0.04, 0.004, 0.012, paint, [0, 0.07, s * (D / 2 + 0.002)]); // a pressed rib
  // Feet runners.
  for (const s of [-1, 1]) P.box(L - 0.02, 0.008, 0.02, M.iron, [0, 0.004, s * (D / 2 - 0.03)]);
  // Lid with a folding handle, a piano hinge at the back, two catches at the front.
  P.box(L + 0.008, 0.03, D + 0.008, paint, [0, H + 0.015, 0], { part: 'lid' });
  P.box(L - 0.04, 0.004, D - 0.06, paint, [0, H + 0.032, 0], { part: 'lid' });     // pressed panel
  for (const x of [-0.085, 0.085]) {
    P.box(0.025, 0.012, 0.03, M.iron, [x, H + 0.036, 0], { part: 'lid' });
    P.cyl(0.005, 0.005, 0.03, M.iron, [x, H + 0.05, 0], { part: 'lid' }, 8);
  }
  P.cyl(0.009, 0.009, 0.15, M.black, [0, H + 0.066, 0], { rot: [0, 0, Math.PI / 2], part: 'lid' });
  P.cyl(0.006, 0.006, L - 0.04, M.iron, [0, H, -D / 2 - 0.004], { rot: [0, 0, Math.PI / 2] }, 8);
  for (const x of [-0.17, 0.17]) {
    P.box(0.04, 0.05, 0.006, M.bright, [x, H - 0.035, D / 2 + 0.003]);
    P.box(0.03, 0.035, 0.005, M.bright, [x, H + 0.005, D / 2 + 0.008], { part: 'lid' });
    P.cyl(0.005, 0.005, 0.03, M.bright, [x, H - 0.05, D / 2 + 0.008], { rot: [0, 0, Math.PI / 2] }, 8);
  }
  P.decal(0.2, 0.05, M.sWerkzeug, [0, 0.11, D / 2 + 0.002]);
  // Inside: a lift-out tray of spanners, a screwdriver and pliers, and a hammer underneath.
  P.box(L - 0.02, 0.004, D - 0.02, paint, [0, H - 0.05, 0]);
  for (let i = 0; i < 3; i++) {
    const x = -0.16 + i * 0.07;
    P.box(0.012, 0.004, 0.13, M.bright, [x, H - 0.045, 0]);
    P.put(new THREE.TorusGeometry(0.014, 0.005, 6, 12), M.bright, [x, H - 0.045, 0.07], { rot: [Math.PI / 2, 0, 0] });
    P.box(0.03, 0.004, 0.02, M.bright, [x, H - 0.045, -0.07]);
  }
  P.cyl(0.011, 0.011, 0.08, M.redHandle, [0.08, H - 0.035, -0.02], { rot: [0, 0, Math.PI / 2] });
  P.cyl(0.003, 0.003, 0.09, M.bright, [0.165, H - 0.035, -0.02], { rot: [0, 0, Math.PI / 2] }, 6);
  for (const a of [-0.12, 0.12]) P.box(0.11, 0.006, 0.012, M.bright, [0.11, H - 0.04, 0.05], { rot: [0, a, 0] });
  return P.build([0, H, -D / 2]);
}

function weaponCrate() {
  const M = materials(), P = new Parts(22), L = 1.25, H = 0.3, D = 0.42;
  const pivot = woodenCrate(P, { L, H, D, wood: M.greyWood });
  P.decal(0.5, 0.125, M.sWaffen, [0, H * 0.55, D / 2 + 0.003]);
  // Inside: a bed of wood wool and the notched rests the rifle lay in (taken).
  P.box(L - 0.06, 0.05, D - 0.06, M.woodWool, [0, 0.045, 0]);
  for (const x of [-0.38, 0.38]) {
    P.box(0.04, 0.1, D - 0.05, M.inside, [x, 0.07, 0]);
    P.box(0.042, 0.04, 0.06, M.black, [x, 0.115, 0.06]);    // the notch's shadow
  }
  return P.build(pivot);
}

function ammoCans() {
  const M = materials(), P = new Parts(23), paint = M.steelOlive;
  // Two belt cans (Patronenkasten): tall and narrow, ribbed sides, a wire bail and a latch. The
  // near one's lid opens on a belt of brass rounds.
  const L = 0.28, H = 0.19, W = 0.11, t = 0.004;
  const can = (z, part, open) => {
    P.box(L, t, W, paint, [0, t / 2, z]);
    for (const s of [-1, 1]) P.box(L, H, t, paint, [0, H / 2, z + s * (W / 2 - t / 2)]);
    for (const s of [-1, 1]) P.box(t, H, W - 2 * t, paint, [s * (L / 2 - t / 2), H / 2, z]);
    for (const s of [-1, 1]) for (const y of [0.05, 0.1, 0.15]) P.box(L - 0.05, 0.008, 0.003, paint, [0, y, z + s * (W / 2 + 0.0015)]);
    P.box(L + 0.006, 0.022, W + 0.006, paint, [0, H + 0.011, z], { part });
    P.put(new THREE.TorusGeometry(0.06, 0.004, 6, 14, Math.PI), M.iron, [0, H + 0.022, z], { part });
    P.box(0.02, 0.05, 0.012, M.iron, [L / 2 + 0.006, H - 0.01, z], { part });       // latch lever
    P.decal(0.13, 0.034, M.sPatronen, [0, 0.12, z + W / 2 + 0.004]);
    if (open) {
      // A belt of 7.9 mm rounds folded in: brass cases, copper-jacketed points, dark links.
      for (let row = 0; row < 2; row++) for (let i = 0; i < 18; i++) {
        const x = -L / 2 + 0.02 + i * 0.0135, zz = z - 0.022 + row * 0.044;
        P.cyl(0.0048, 0.0048, 0.055, M.brass, [x, H - 0.045, zz], {}, 6);
        P.cyl(0.0001, 0.0042, 0.018, M.copper, [x, H - 0.008, zz], {}, 6);
      }
      for (let row = 0; row < 2; row++) P.box(L - 0.03, 0.012, 0.012, M.black, [0, H - 0.06, z - 0.022 + row * 0.044]);
    }
  };
  can(0, 'lid', true);
  can(0.14, 'body', false);
  return P.build([0, H, -W / 2]);
}

function medicalBox() {
  const M = materials(), P = new Parts(24), L = 0.5, H = 0.26, D = 0.3;
  const pivot = woodenCrate(P, { L, H, D, wood: M.oliveWood, boards: 2, t: 0.016, bands: false });
  P.decal(0.13, 0.13, M.redCross, [0, H * 0.5, D / 2 + 0.003]);
  P.decal(0.11, 0.11, M.redCross, [0, H + 0.0165, 0], { rot: [-Math.PI / 2, 0, 0], part: 'lid' });
  // A leather strap handle on the lid.
  P.put(new THREE.TorusGeometry(0.055, 0.008, 6, 12, Math.PI), M.leather, [0, H + 0.016, 0.07], { part: 'lid' });
  for (const x of [-0.055, 0.055]) P.box(0.03, 0.006, 0.03, M.brass, [x, H + 0.018, 0.07], { part: 'lid' });
  // Inside: rolls of bandage, field dressings, a brown bottle.
  for (let i = 0; i < 5; i++) P.cyl(0.032, 0.032, 0.09, M.cloth, [-0.17 + i * 0.07, 0.065, -0.07], { rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 4; i++) P.box(0.08, 0.035, 0.1, M.khaki, [-0.16 + i * 0.09, 0.04, 0.07], { rot: [0, (i % 2) * 0.1, 0] });
  P.cyl(0.025, 0.025, 0.11, M.brownGlass, [0.19, 0.075, 0.08]);
  P.cyl(0.012, 0.012, 0.02, M.cork, [0.19, 0.14, 0.08]);
  return P.build(pivot);
}

function explosivesCrate() {
  const M = materials(), P = new Parts(25), L = 0.75, H = 0.34, D = 0.45;
  const pivot = woodenCrate(P, { L, H, D, wood: M.pine });
  P.box(L + 0.002, 0.03, 0.002, M.redPaint, [0, H * 0.22, D / 2 + 0.001]);         // red danger band
  P.decal(0.4, 0.1, M.sSpreng, [0, H * 0.58, D / 2 + 0.003]);
  // Inside: stick grenades in four lines, two to a line end to end, heads to the ends of the
  // crate, on a wooden divider.
  P.box(0.012, 0.08, D - 0.05, M.inside, [0, 0.06, 0]);
  for (let line = 0; line < 4; line++) for (const s of [-1, 1]) {
    const z = -0.15 + line * 0.1;
    P.cyl(0.012, 0.012, 0.25, M.handleWood, [s * 0.15, 0.052, z], { rot: [0, 0, Math.PI / 2] }, 8);
    P.cyl(0.031, 0.031, 0.075, M.steelOlive, [s * 0.312, 0.052, z], { rot: [0, 0, Math.PI / 2] });
    P.cyl(0.014, 0.014, 0.01, M.bright, [s * 0.02, 0.052, z], { rot: [0, 0, Math.PI / 2] }, 8);
  }
  return P.build(pivot);
}

function bottleCrate() {
  const M = materials(), P = new Parts(26), L = 0.56, H = 0.26, D = 0.38, t = 0.016;
  // An open slatted crate: corner posts, gapped slats, a grid of dividers, hand-holds in the ends.
  P.box(L, t, D, M.oldWood, [0, t / 2, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(0.03, H, 0.03, M.oldWood, [sx * (L / 2 - 0.015), H / 2, sz * (D / 2 - 0.015)]);
  for (const s of [-1, 1]) for (const y of [0.05, 0.19]) P.box(L, 0.07, t, M.oldWood, [0, y, s * (D / 2 - t / 2)]);
  for (const s of [-1, 1]) {
    P.box(t, 0.12, D - 0.06, M.oldWood, [s * (L / 2 - t / 2), 0.07, 0]);
    P.box(t, 0.07, D - 0.06, M.oldWood, [s * (L / 2 - t / 2), H - 0.035, 0]);
  }
  for (const x of [-L / 6, L / 6]) P.box(0.008, H * 0.7, D - 0.04, M.oldWood, [x, H * 0.35, 0]);
  P.box(L - 0.04, H * 0.7, 0.008, M.oldWood, [0, H * 0.35, 0]);
  P.decal(0.28, 0.048, M.sBottles, [0, 0.19, D / 2 + 0.002]);
  // Six wine bottles; three of them, with rags stuffed in their necks, are what you take.
  for (let i = 0; i < 6; i++) {
    const x = -L / 3 + (i % 3) * (L / 3), z = i < 3 ? -D / 4 : D / 4, part = i % 2 ? 'body' : 'taken';
    const glass = i === 4 ? M.brownGlass : M.glass;
    P.cyl(0.036, 0.036, 0.2, glass, [x, 0.116, z], { part });
    P.cyl(0.013, 0.036, 0.05, glass, [x, 0.241, z], { part });
    P.cyl(0.013, 0.013, 0.07, glass, [x, 0.3, z], { part });
    if (part === 'taken') P.put(new THREE.ConeGeometry(0.02, 0.07, 6), M.rag, [x + 0.01, 0.35, z], { rot: [0, 0, 0.4], part });
    else P.cyl(0.012, 0.012, 0.025, M.cork, [x, 0.34, z], { part });
  }
  return P.build();
}

function heavyCrate() {
  const M = materials(), P = new Parts(27), L = 0.95, H = 0.32, D = 0.42;
  const pivot = woodenCrate(P, { L, H, D, wood: M.oliveWood });
  for (const x of [-0.13, 0.13]) P.box(0.035, H - 0.02, 0.003, M.yellowWood, [x, H / 2, D / 2 + 0.002]); // painted bands
  P.decal(0.21, 0.07, M.sMunition, [0, H * 0.55, D / 2 + 0.004]);
  // Inside: rocket and shell containers lying in wooden cradles.
  for (const x of [-0.35, 0.35]) P.box(0.03, 0.08, D - 0.05, M.inside, [x, 0.06, 0]);
  for (let i = 0; i < 3; i++) {
    const z = -0.12 + i * 0.12;
    P.cyl(0.045, 0.045, 0.82, M.steelOlive, [0, 0.09, z], { rot: [0, 0, Math.PI / 2] });
    P.cyl(0.046, 0.046, 0.03, M.yellowWood, [0.3, 0.09, z], { rot: [0, 0, Math.PI / 2] });
  }
  return P.build(pivot);
}

function workbench() {
  const M = materials(), P = new Parts(28);
  const L = 1.7, D = 0.7, TOP = 0.92, T = 0.07;
  // The top: four thick beech boards side by side.
  for (let i = 0; i < 4; i++) P.box(L, T, D / 4 - 0.003, M.benchWood, [0, TOP - T / 2, -D / 2 + D / 8 + i * D / 4]);
  // Legs, aprons, stretchers and a slatted shelf underneath.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(0.08, TOP - T, 0.08, M.oldWood, [sx * 0.72, (TOP - T) / 2, sz * 0.27]);
  for (const s of [-1, 1]) P.box(1.52, 0.12, 0.03, M.oldWood, [0, TOP - T - 0.06, s * 0.3]);
  for (const sx of [-1, 1]) for (const y of [0.18, TOP - T - 0.06]) P.box(0.05, 0.07, 0.5, M.oldWood, [sx * 0.72, y, 0]);
  for (let i = 0; i < 4; i++) P.box(1.38, 0.02, 0.11, M.oldWood, [0, 0.225, -0.21 + i * 0.14]);
  // Under the bench: a small crate and a jerrycan.
  P.box(0.4, 0.22, 0.3, M.pine, [-0.4, 0.345, -0.05]);
  P.box(0.16, 0.34, 0.3, M.steelOlive, [0.42, 0.405, 0]);
  for (const z of [-0.06, 0, 0.06]) P.cyl(0.006, 0.006, 0.05, M.steelOlive, [0.42, 0.59, z], { rot: [0, 0, Math.PI / 2] }, 6);
  // The back board and its shelf.
  for (let i = 0; i < 8; i++) P.box(L / 8 - 0.004, 0.72, 0.022, M.oldWood, [-L / 2 + L / 16 + i * L / 8, TOP + 0.36, -D / 2 + 0.011]);
  P.box(L, 0.022, 0.15, M.oldWood, [0, TOP + 0.6, -D / 2 + 0.085]);
  for (const x of [-0.7, 0.7]) P.box(0.02, 0.1, 0.12, M.oldWood, [x, TOP + 0.54, -D / 2 + 0.08], { rot: [0.6, 0, 0] });
  // On the shelf: tins and jars.
  for (let i = 0; i < 5; i++) {
    const x = -0.6 + i * 0.2 + (i % 2) * 0.03;
    P.cyl(0.04, 0.04, 0.09 + (i % 3) * 0.02, i % 2 ? M.steelGrey : M.brownGlass, [x, TOP + 0.656 + (i % 3) * 0.01, -D / 2 + 0.08]);
  }
  // Tools hanging on the back board: a saw, a hammer, spanners, pliers, files, a brace.
  const wall = -D / 2 + 0.03, hang = (x, y) => P.cyl(0.004, 0.004, 0.04, M.iron, [x, y, wall], { rot: [Math.PI / 2, 0, 0] }, 6);
  const saw = new THREE.Shape([new THREE.Vector2(0, 0.04), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.5, 0.14), new THREE.Vector2(0, 0.1)]);
  P.put(new THREE.ExtrudeGeometry(saw, { depth: 0.002, bevelEnabled: false }), M.bright, [-0.75, TOP + 0.3, wall - 0.004]);
  P.box(0.12, 0.13, 0.025, M.handleWood, [-0.21, TOP + 0.39, wall]);
  hang(-0.25, TOP + 0.43);
  P.cyl(0.014, 0.014, 0.32, M.handleWood, [-0.02, TOP + 0.25, wall + 0.01]);
  P.box(0.12, 0.035, 0.035, M.iron, [-0.02, TOP + 0.43, wall + 0.01]);
  hang(-0.02, TOP + 0.47);
  for (let i = 0; i < 4; i++) {
    const x = 0.12 + i * 0.07, len = 0.16 + i * 0.03;
    P.box(0.016, len, 0.005, M.bright, [x, TOP + 0.45 - len / 2, wall]);
    P.put(new THREE.TorusGeometry(0.017 + i * 0.002, 0.006, 6, 12), M.bright, [x, TOP + 0.47, wall]);
    P.box(0.04, 0.025, 0.006, M.bright, [x, TOP + 0.44 - len, wall]);
  }
  for (const a of [-0.12, 0.12]) P.box(0.012, 0.2, 0.006, M.bright, [0.45, TOP + 0.32, wall], { rot: [0, 0, a] });
  for (const a of [-0.12, 0.12]) P.box(0.022, 0.07, 0.012, M.redHandle, [0.45 + a * 0.18, TOP + 0.2, wall + 0.006], { rot: [0, 0, a] });
  hang(0.45, TOP + 0.45);
  for (let i = 0; i < 3; i++) {
    P.box(0.018, 0.2, 0.004, M.iron, [0.58 + i * 0.04, TOP + 0.3, wall]);
    P.cyl(0.012, 0.01, 0.09, M.handleWood, [0.58 + i * 0.04, TOP + 0.45, wall + 0.004]);
  }
  // A cast-iron vice on the front corner: base, body, jaws, the screw and its tommy bar.
  const vx = 0.6, vz = D / 2 - 0.06, vy = TOP;
  P.box(0.16, 0.025, 0.14, M.steelBlueGrey, [vx, vy + 0.0125, vz - 0.03]);
  P.box(0.1, 0.075, 0.18, M.steelBlueGrey, [vx, vy + 0.06, vz - 0.01]);
  P.box(0.17, 0.07, 0.035, M.steelBlueGrey, [vx, vy + 0.115, vz - 0.07]);
  P.box(0.17, 0.07, 0.035, M.steelBlueGrey, [vx, vy + 0.115, vz + 0.03]);
  for (const z of [-0.05, 0.012]) P.box(0.16, 0.05, 0.004, M.bright, [vx, vy + 0.125, vz + z]);
  P.cyl(0.011, 0.011, 0.14, M.bright, [vx, vy + 0.085, vz + 0.1], { rot: [Math.PI / 2, 0, 0] });
  P.cyl(0.007, 0.007, 0.2, M.bright, [vx, vy + 0.085, vz + 0.17], { rot: [0, 0, Math.PI / 2] }, 8);
  for (const x of [-0.1, 0.1]) P.put(new THREE.SphereGeometry(0.012, 8, 6), M.bright, [vx + x, vy + 0.085, vz + 0.17]);
  // On the top: a hurricane lamp, an oil can, a rag, a rifle scope and a bolt being worked on,
  // a stripper clip of rounds, a cleaning rod.
  const lx = -0.68, lz = -0.14;
  P.cyl(0.055, 0.06, 0.05, M.steelOlive, [lx, TOP + 0.025, lz]);
  P.cyl(0.04, 0.042, 0.11, M.lampGlass, [lx, TOP + 0.105, lz]);
  P.cyl(0.03, 0.05, 0.035, M.steelOlive, [lx, TOP + 0.178, lz]);
  for (const s of [-1, 1]) P.cyl(0.004, 0.004, 0.16, M.iron, [lx + s * 0.05, TOP + 0.11, lz], {}, 6);
  P.put(new THREE.TorusGeometry(0.05, 0.003, 6, 14, Math.PI), M.iron, [lx, TOP + 0.21, lz]);
  P.cyl(0.04, 0.045, 0.07, M.steelGrey, [-0.45, TOP + 0.035, -0.18]);
  P.cyl(0.012, 0.035, 0.04, M.steelGrey, [-0.45, TOP + 0.09, -0.18]);
  P.cyl(0.003, 0.005, 0.16, M.steelGrey, [-0.39, TOP + 0.14, -0.18], { rot: [0, 0, -0.9] }, 6);
  P.box(0.24, 0.012, 0.18, M.rag, [-0.12, TOP + 0.006, 0.08], { rot: [0, 0.4, 0] });
  P.box(0.15, 0.02, 0.1, M.rag, [-0.08, TOP + 0.015, 0.1], { rot: [0.2, 0.9, 0.1] });
  P.cyl(0.013, 0.013, 0.2, M.black, [0.15, TOP + 0.02, 0.05], { rot: [0, 0.3, Math.PI / 2] });
  for (const dx of [-0.12, 0.12]) P.cyl(0.02, 0.014, 0.05, M.black, [0.15 + dx * Math.cos(0.3), TOP + 0.022, 0.05 - dx * Math.sin(0.3)], { rot: [0, 0.3, -Math.PI / 2 * Math.sign(dx)] });
  P.cyl(0.009, 0.009, 0.16, M.bright, [0.3, TOP + 0.01, -0.12], { rot: [0, -0.5, Math.PI / 2] }, 8);
  P.box(0.012, 0.012, 0.05, M.bright, [0.36, TOP + 0.015, -0.1]);
  P.box(0.06, 0.01, 0.014, M.brass, [-0.3, TOP + 0.005, 0.15]);
  for (let i = 0; i < 5; i++) P.cyl(0.0048, 0.0048, 0.057, M.brass, [-0.324 + i * 0.012, TOP + 0.04, 0.15], {}, 6);
  P.cyl(0.004, 0.004, 0.7, M.bright, [0.05, TOP + 0.004, 0.25], { rot: [0, 0.05, Math.PI / 2] }, 6);
  return P.build();
}

const BUILD = { toolbox, weapon: weaponCrate, ammo: ammoCans, medical: medicalBox, explosives: explosivesCrate, bottles: bottleCrate, heavy: heavyCrate, bench: workbench };
const OPEN = { toolbox: -1.75, weapon: -1.9, ammo: -1.9, medical: -1.8, explosives: -1.9, heavy: -1.9, bottles: 0, bench: 0 };
const made = {};

// Show or leave out a model's small parts (fittings, lettering, contents): from afar they're
// under a pixel, and a few dozen pickups' worth are hundreds of draw calls.
export function showDetail(model, on) {
  if (model.userData.detailOn === on) return;
  model.userData.detailOn = on;
  model.traverse(o => { if (o.isMesh && o.userData.detail) o.visible = on; });
}

// A copy of the model for `kind` (toolbox, weapon, ammo, medical, explosives, bottles, heavy, bench).
export function pickupModel(kind) {
  made[kind] ??= BUILD[kind]();
  const g = made[kind].clone();
  g.userData.lid = g.getObjectByName('lid');
  g.userData.taken = g.getObjectByName('taken') ?? null;
  g.userData.openAngle = OPEN[kind];
  return g;
}
