// Shelled houses, after the photographs of Ortona and Cassino: the outline is what gives a ruin away,
// so a broken wall is really broken. What you see is one extruded shape with a ragged top, window
// holes and blast holes; what stops you and your bullets is a row of plain boxes under it, as
// everywhere else (collision, bullets, the guards' grid all work on boxes), cut to the same gaps.
//
// The surface is the map's own photographs: plaster over stone, mixed in the shader by a field
// worked out for each wall. The plaster has come off near every break, along the foot of the wall
// and round each shell strike; soot rises over the windows of a burnt house. Inside faces show what
// the floors left behind: a colour for each room, the line of the floor, the holes the joists sat
// in, the flue, the ghost of the stairs. Party walls outlive the houses either side of them.
//
// A ruin takes none of the kit's dressing: its windows and doors are holes, so no frame, shutter or
// door can be left hanging when the wall round it goes. Taking a house out of a row uncovers its
// neighbours' side walls, and their dressing with them: a party wall has to bury that (town.js).
//
// ruinWall(b, opts): one run of wall, from (x0, z0) to (x1, z1), along x or along z.
// rubble(b, opts):   a walkable heap: a mound, stepped boxes under it, debris (tools/blender/ruin_kit.py) over it.
// charred(b, a, c):  a burnt beam from a to c.
// shellHouse(b, o):  a whole free-standing ruin from a few numbers, out of the three above.
import * as THREE from 'three';
import { textures } from './textures.js';
import { fbm, makeRng } from './noise.js';
import { modelParts } from './props.js';
import { proceduralHooks } from './procedural.js';
import { rockMaterial } from './stone.js';
import { activeMap, heightAt, craterList, CRATER_EDGE } from './terrain.js';
import { asset } from '../core/version.js';

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const PLASTER_TILE = 3.5, STONE_TILE = 1.5;   // metres per repeat of the photographs
const STRIDE = 0.45;                          // the most one metre of rubble may rise (world.js STEP is 0.55)
const MASK_W = 512, MASK_H = 256;             // the field, both faces side by side (the shader adds the fine edge)
const PAINT_W = 1024, PAINT_H = 512;          // the colours of both faces

const HEAD = /* glsl */ `
uniform sampler2D uMask;      // r: plaster left (0.5 is its edge), g: soot, b: dust
uniform sampler2D uPaint;     // the plaster's colour
uniform sampler2D uStone;
uniform sampler2D uStoneN;
varying vec2 vRuin;
float ruinBare;
`;
const COLOR = /* glsl */ `
vec4 m = texture2D(uMask, vRuin);
vec2 q = vMapUv * ${PLASTER_TILE.toFixed(1)};                       // metres on the wall
float f = m.r + (cgVnoise2(q * 5.0) - 0.5) * 0.17 + (cgVnoise2(q * 19.0) - 0.5) * 0.07;
float pl = smoothstep(0.485, 0.515, f);
ruinBare = 1.0 - pl;
vec3 stone = texture2D(uStone, q / ${STONE_TILE.toFixed(1)}).rgb * vec3(0.74, 0.66, 0.56);
vec3 col = mix(stone, diffuseColor.rgb * texture2D(uPaint, vRuin).rgb, pl);
col *= 1.0 - 0.5 * smoothstep(0.42, 0.5, f) * (1.0 - pl);          // the shadow under the broken edge of the plaster
col = mix(col, vec3(0.8, 0.76, 0.68), 0.16 * (1.0 - smoothstep(0.515, 0.55, f)) * pl);   // and its fresh lip
col = mix(col, vec3(0.74, 0.70, 0.63), m.b * 0.55);
col *= mix(vec3(1.0), vec3(0.2, 0.17, 0.15), m.g * (0.75 + 0.5 * cgVnoise2(q * 2.3)));
diffuseColor.rgb = col;
`;
const NORMAL = /* glsl */ `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 sN = texture2D(uStoneN, vMapUv * ${PLASTER_TILE.toFixed(1)} / ${STONE_TILE.toFixed(1)}).xyz * 2.0 - 1.0;
  normal = normalize(mix(normal, normalize(tbn * sN) * (gl_FrontFacing ? 1.0 : -1.0), ruinBare));
#endif
`;

function wallMaterial(mask, paint) {
  const T = textures();
  const mat = new THREE.MeshStandardMaterial({ map: T.plaster2.map, normalMap: T.plaster2.normalMap, roughness: 0.96, envMapIntensity: 0.25 });
  mat.color.setScalar(Math.min(1, dust() + 0.33));
  return proceduralHooks(mat, {
    key: 'ruinwall',
    uniforms: { uMask: { value: mask }, uPaint: { value: paint }, uStone: { value: T.stone.map }, uStoneN: { value: T.stone.normalMap } },
    vertexHead: 'attribute vec2 aRuin; varying vec2 vRuin;',
    vertexPre: 'vRuin = aRuin;',
    head: HEAD, color: COLOR, normal: NORMAL,
  });
}

let edge = null;
const edgeMaterial = () => {
  const T = textures();
  return edge ??= new THREE.MeshStandardMaterial({ ...T.stone, color: 0xc4b6a0, roughness: 1, envMapIntensity: 0.2 });
};

const lerpAt = (pts, u) => {
  for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) {
    const [u0, h0] = pts[i - 1], [u1, h1] = pts[i];
    return h0 + (h1 - h0) * (u - u0) / Math.max(1e-6, u1 - u0);
  }
  return pts[pts.length - 1][1];
};

// The top edge: runs of courses at one height with a step between, as masonry breaks, and rougher
// the further the wall has come down from `full`.
function raggedTop(pts, L, full, rng) {
  const out = [];
  let u = 0;
  while (u < L) {
    const un = Math.min(L, u + 0.12 + rng() * 0.5), h0 = lerpAt(pts, (u + un) / 2);
    const rough = 0.04 + 0.36 * Math.min(1, Math.max(0, (full - h0) / 1.2));
    const h = Math.max(0.08, h0 + (rng() - 0.5) * 2 * rough);
    out.push([u, h]);
    if (rng() < 0.65) out.push([un, h]);
    u = un;
  }
  out.push([L, Math.max(0.08, lerpAt(pts, L))]);
  return out;
}

const blastOutline = (o, rng) => {
  const n = 18, pts = [], rx = o.w / 2, ry = o.h / 2, cy = o.v + ry;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, k = 0.72 + rng() * 0.42;
    pts.push([o.u + Math.cos(a) * rx * k, Math.max(0.03, cy + Math.sin(a) * ry * k)]);
  }
  return pts;
};

// The plaster field and the soot, for one face. `at(u)`: wall u of a column of pixels on this face.
function paintField(px, face, { L, H, top, holes, pocks, burnt, seed }, at, x0, x1) {
  const inside = face.kind === 'in';
  for (let j = 0; j < MASK_H; j++) {
    const v = (1 - (j + 0.5) / MASK_H) * H;
    for (let i = x0; i < x1; i++) {
      const u = at((i - x0 + 0.5) / (x1 - x0) * L);
      let f = (inside ? 0.84 : 0.88) + 0.62 * (fbm(u * 0.33 + seed, v * 0.33, 3) - 0.5) + 0.4 * (fbm(u * 1.2, v * 1.2 + seed, 2) - 0.5);
      f -= 0.7 * Math.exp(-Math.max(0, top(u) - v) / 0.42);          // off along the break
      f -= 0.42 * Math.exp(-v / 0.5);                                // and along the foot of the wall
      let soot = 0;
      for (const o of holes) {
        const dx = Math.max(0, Math.abs(u - o.u) - o.w / 2), dy = Math.max(0, o.v - v, v - o.v - o.h), d = Math.hypot(dx, dy);
        if (o.kind === 'blast') f -= 0.8 * Math.exp(-d / 0.5);
        else if (o.kind !== 'shell') f -= 0.2 * Math.exp(-d / 0.18);
        if (burnt && o.kind !== 'shell' && v > o.v + o.h * 0.6) {     // smoke out of the window and up the wall
          const up = v - o.v - o.h, half = o.w * (0.55 + Math.max(0, up) * 0.14);
          soot = Math.max(soot, Math.exp(-(((u - o.u) / half) ** 2)) * Math.exp(-Math.max(0, up) / 1.7));
        }
      }
      for (const p of pocks) { const d = Math.hypot(u - p[0], v - p[1]); if (d < p[2] * 3) f -= 0.8 * Math.exp(-((d / p[2]) ** 2)); }
      if (burnt) soot = Math.max(soot, 0.3 * Math.exp(-Math.max(0, top(u) - v) / 0.9));
      const k = (j * MASK_W + i) * 4;
      px[k] = Math.max(0, Math.min(1, f)) * 255;
      px[k + 1] = Math.min(1, soot * (inside ? 0.65 : 1)) * 255;
      px[k + 2] = Math.min(1, Math.exp(-v / 1.1) * 0.7 + 0.16) * 255;
      px[k + 3] = 255;
    }
  }
}

// The colours of one face, in a canvas box (x, w): `flip` for the back of the wall, so its text reads.
function paintFace(g, face, { L, H, holes, pocks, rng }, x, w, flip) {
  const PX = (u) => x + (flip ? 1 - u / L : u / L) * w, PY = (v) => (1 - v / H) * PAINT_H, sx = w / L, sy = PAINT_H / H;
  const rect = (u, v, uw, vh, c) => { g.fillStyle = c; g.fillRect(Math.min(PX(u), PX(u + uw)), PY(v + vh), uw * sx, vh * sy); };
  if (face.kind === 'out') {
    rect(0, 0, L, H, face.tint ?? '#e8d6b0');
    for (let i = 0; i < 60; i++) {                                     // old patches and repairs
      g.globalAlpha = 0.05 + rng() * 0.08;
      rect(rng() * L, rng() * H, 0.5 + rng() * 2.6, 0.3 + rng() * 1.6, rng() < 0.5 ? '#ffffff' : '#7a6a50');
    }
    g.globalAlpha = 0.5; rect(0, 0, L, 0.95, face.base ?? '#8d8474'); // the painted dado along the street
    g.globalAlpha = 0.16;                                              // rain stains under the sills
    for (const o of holes) if (o.kind === 'win') for (let i = 0; i < 4; i++) rect(o.u - o.w / 2 + rng() * o.w, Math.max(0, o.v - 1.6), 0.06 + rng() * 0.12, 1.6, '#3c3226');
    g.globalAlpha = 1;
    if (face.slogan) {                                                 // the regime's words on the wall, faded
      const [u, v, size] = face.at;
      g.save();
      g.translate(PX(u), PY(v));
      g.scale(sx / sy, 1);
      g.font = `bold ${size * sy}px "Arial Narrow", Arial, sans-serif`;
      g.fillStyle = '#1e1a16'; g.globalAlpha = 0.72;
      g.fillText(face.slogan, 0, 0);
      g.restore(); g.globalAlpha = 1;
    }
  } else {
    (face.rooms ?? ['#cfd6c4', '#d9b9a8']).forEach((c, i, all) => {    // a colour for each storey it once closed
      const v0 = i * 3.2, v1 = i === all.length - 1 ? H : v0 + 3.2;
      rect(0, v0, L, v1 - v0, c);
      if (i && face.paper === i) {                                     // this room was papered
        g.globalAlpha = 0.14;
        for (let u = 0.06; u < L; u += 0.14) rect(u, v0, 0.045, v1 - v0, '#5a3f34');
        g.globalAlpha = 1;
      }
    });
    for (let i = 1; i * 3.2 < H && i < (face.rooms?.length ?? 2); i++) {
      const v = i * 3.2;
      g.globalAlpha = 0.85; rect(0, v - 0.2, L, 0.2, '#6d5f4e');       // where the floor met the wall
      g.globalAlpha = 1;
      for (let u = 0.25; u < L - 0.1; u += 0.48) rect(u, v - 0.2, 0.16, 0.2, '#1a1612');   // the joists' pockets
      g.globalAlpha = 0.5; rect(0, v - 3.1 + 0.02, L, 0.16, '#3b352c'); g.globalAlpha = 1; // the skirting's shadow
    }
    if (face.flue) { g.globalAlpha = 0.5; rect(face.flue - 0.25, 1.0, 0.5, H, '#1c1814'); g.globalAlpha = 1; }
    if (face.stairs) {                                                 // the ghost of the flight: its line up the wall
      const [u0, dir] = face.stairs;
      g.globalAlpha = 0.45;
      for (let i = 0; i < 13; i++) rect(u0 + dir * i * 0.27, i * 0.245, 0.27 * dir, 0.5, '#74695a');
      g.globalAlpha = 1;
    }
  }
  g.globalAlpha = 0.8;                                                 // shell splinters: a dark bite, a pale ring
  for (const p of pocks) {
    g.fillStyle = '#d8ccb6'; g.beginPath(); g.arc(PX(p[0]), PY(p[1]), p[2] * 1.7 * sx, 0, 7); g.fill();
    g.fillStyle = '#2c2620'; g.beginPath(); g.arc(PX(p[0]), PY(p[1]), p[2] * 0.8 * sx, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}

// opts: x0, z0, x1, z1, y; t (thickness); full (the wall's height when whole);
//   top: [[u, h], …] the broken top from u = 0 to the wall's length;
//   holes: [{ u (centre), v (bottom), w, h, kind: 'win' | 'door' | 'blast' | 'shell' }];
//   front, back: { kind: 'out', tint, slogan, at } or { kind: 'in', rooms, paper, flue, stairs }
//     (front faces left of the way the wall runs: −x for one along +z, +z for one along +x);
//   burnt; solid: false for a face against something already solid; seed.
export function ruinWall(b, o) {
  const { x0, z0, x1, z1, y, t = 0.45, full = 6.4, burnt = false, solid = true, seed = 1 } = o;
  const rng = makeRng(seed * 7919 + 13), L = Math.hypot(x1 - x0, z1 - z0);
  const top = (u) => lerpAt(o.top, u), H = Math.max(...o.top.map(p => p[1])) + 0.6;
  const holes = (o.holes ?? []).filter(h => h.v + h.h < top(h.u) - 0.1);
  const pocks = (n) => Array.from({ length: n }, () => [rng() * L, 0.3 + rng() * (H - 1), 0.04 + rng() ** 3 * 0.17]).filter(p => p[1] < top(p[0]));

  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(L, 0);
  for (const [u, h] of raggedTop(o.top, L, full, rng).reverse()) shape.lineTo(u, h);
  shape.closePath();
  for (const h of holes) {
    const pts = h.kind === 'blast' || h.kind === 'shell' ? blastOutline(h, rng)
      : [[h.u - h.w / 2, Math.max(0.03, h.v)], [h.u + h.w / 2, Math.max(0.03, h.v)], [h.u + h.w / 2, h.v + h.h], [h.u - h.w / 2, h.v + h.h]];
    shape.holes.push(new THREE.Path(pts.map(([u, v]) => new THREE.Vector2(u, v))));
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -t / 2);
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv, ruin = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i), v = pos.getY(i), nz = nrm.getZ(i);
    if (Math.abs(nz) > 0.5) {
      uv.setXY(i, u / PLASTER_TILE, v / PLASTER_TILE);
      ruin[i * 2] = nz > 0 ? u / L * 0.5 : 0.5 + (1 - u / L) * 0.5;
      ruin[i * 2 + 1] = v / H;
    } else uv.setXY(i, uv.getX(i) / STONE_TILE, uv.getY(i) / STONE_TILE);
  }
  geo.setAttribute('aRuin', new THREE.BufferAttribute(ruin, 2));

  // The field and the colours, both faces side by side (the back mirrored, as you see it from there).
  const shared = { L, H, top, holes, burnt, seed };
  const pocksFront = pocks(o.pocks ?? 40), pocksBack = pocks(o.pocks ?? 40);
  const maskCv = document.createElement('canvas'); maskCv.width = MASK_W; maskCv.height = MASK_H;
  const mg = maskCv.getContext('2d'), img = mg.createImageData(MASK_W, MASK_H);
  paintField(img.data, o.front, { ...shared, pocks: pocksFront }, (u) => u, 0, MASK_W / 2);
  paintField(img.data, o.back, { ...shared, pocks: pocksBack, seed: seed + 31 }, (u) => L - u, MASK_W / 2, MASK_W);
  mg.putImageData(img, 0, 0);
  const paintCv = document.createElement('canvas'); paintCv.width = PAINT_W; paintCv.height = PAINT_H;
  const pg = paintCv.getContext('2d');
  paintFace(pg, o.front, { L, H, holes, pocks: pocksFront, rng }, 0, PAINT_W / 2, false);
  paintFace(pg, o.back, { L, H, holes, pocks: pocksBack, rng }, PAINT_W / 2, PAINT_W / 2, true);
  const mask = new THREE.CanvasTexture(maskCv), paint = new THREE.CanvasTexture(paintCv);
  paint.colorSpace = THREE.SRGBColorSpace;
  for (const tx of [mask, paint]) tx.anisotropy = 4;

  const mesh = new THREE.Mesh(geo, [wallMaterial(mask, paint), edgeMaterial()]);
  mesh.position.set(x0, y, z0);
  mesh.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
  mesh.castShadow = mesh.receiveShadow = true;
  b.group.add(mesh);

  // What it is to bullets and boots: strips up to a metre wide, cut at the openings' edges.
  if (!solid) return mesh;
  const cuts = new Set([0, L]);
  const gaps = holes.filter(h => h.kind !== 'shell').map(h => ({ a: h.u - h.w * (h.kind === 'blast' ? 0.36 : 0.5), c: h.u + h.w * (h.kind === 'blast' ? 0.36 : 0.5), lo: h.v < 0.1 ? 0 : h.v + (h.kind === 'blast' ? h.h * 0.14 : 0), hi: h.v + h.h * (h.kind === 'blast' ? 0.86 : 1) }));
  for (const g of gaps) { cuts.add(Math.max(0, g.a)); cuts.add(Math.min(L, g.c)); }
  for (let u = 1; u < L; u += 1) cuts.add(u);
  const at = [...cuts].sort((p, q) => p - q), dx = (x1 - x0) / L, dz = (z1 - z0) / L;
  for (let i = 1; i < at.length; i++) {
    const a = at[i - 1], c = at[i], len = c - a, um = (a + c) / 2;
    if (len < 0.05) continue;
    let spans = [[0, (top(a) + top(um) + top(c)) / 3]];
    for (const g of gaps) if (um > g.a && um < g.c) spans = spans.flatMap(([lo, hi]) => [[lo, Math.min(hi, g.lo)], [Math.max(lo, g.hi), hi]]);
    for (const [lo, hi] of spans) {
      if (hi - lo < 0.12) continue;
      const cx = x0 + dx * um, cz = z0 + dz * um;
      if (dx) b.box(len, hi - lo, t, HIDDEN, cx, y + lo, cz);
      else b.box(t, hi - lo, len, HIDDEN, cx, y + lo, cz);
    }
  }
  return mesh;
}

// How pale the dust is: tuned in the town's low sun; a map under a high one (the default) burns it white.
const dust = () => activeMap().ruinDust ?? 0.42;

// The debris, once per map: the kit's meshes on the map's stone photograph, tinted by their vertex colours.
let kit = null, moundMat = null;
// A scanned ground in full colour with its own normal map (public/textures/CREDITS.md). `normalScale`
// is stronger than the terrain's: from a metre or two its stones are most of what you see.
function scanned(file, opts) {
  const L = new THREE.TextureLoader(), at = `textures/${file}`;
  const map = L.load(asset(`${at}.jpg`)), normalMap = L.load(asset(`${at}_n.jpg`));
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1.5, 1.5), roughness: 1, envMapIntensity: 0.15, vertexColors: true, ...opts });
}
function debris() {
  if (kit) return kit;
  const parts = modelParts('ruinKit');
  if (!parts) return null;
  // Masonry is the rock shader (crust, pits, fracture), pale and dusty; the rest is its vertex colours under the dust.
  const masonry = rockMaterial({ tint: new THREE.Color(1.75, 1.66, 1.5).multiplyScalar(dust()), scale: 2.2, moss: 0, lichen: 0.06, streaks: 0, strata: 0, ochre: 0, variation: 0.3 });
  Object.assign(masonry, { vertexColors: true, flatShading: true });
  for (const k of ['lump1', 'lump2', 'lump3', 'slab']) parts[k].material = masonry;
  for (const [k, c] of [['bricks', 0xc9bcae], ['tile', 0xb7a999], ['beam', 0xffffff], ['girder', 0xffffff]])
    Object.assign(parts[k].material, { vertexColors: true, map: null, normalMap: null, roughness: 1, envMapIntensity: 0.2 }).color.set(c).multiplyScalar(Math.min(1, dust() + 0.15));
  return kit = parts;
}

// opts: y; lobes: [{ x, z, r, h }] (the heap is the highest of them, a little lumpy);
//   keepOff: [[x0, z0, x1, z1]] where it stops (a lane cleared through it, a doorway);
//   scatter: [[x, z, r, n]] loose debris lying round about; seed; burnt: more charred timber.
export function rubble(b, o) {
  const { y, lobes, keepOff = [], seed = 1 } = o;
  const rng = makeRng(seed * 104729 + 7);
  const inKeepOff = (x, z, pad = 0) => keepOff.some(([a, c, e, f]) => x > a - pad && x < e + pad && z > c - pad && z < f + pad);
  const height = (x, z) => {
    let h = 0;
    for (const l of lobes) {
      const d = Math.hypot(x - l.x, z - l.z) / l.r;
      if (d < 1) h = Math.max(h, l.h * (1 - d) ** 0.85 * (1 + 0.4 * d));
    }
    if (h <= 0) return 0;
    h *= 0.56 + 0.88 * fbm(x * 0.45 + seed, z * 0.45, 3);
    for (const [a, c, e, f] of keepOff) {                                // falls away at a cleared edge
      const d = Math.max(a - x, x - e, c - z, z - f);
      if (d < 0) return 0;
      h = Math.min(h, d * 0.9);
    }
    return h;
  };
  // The mound.
  let X0 = Infinity, X1 = -Infinity, Z0 = Infinity, Z1 = -Infinity;
  for (const l of lobes) { X0 = Math.min(X0, l.x - l.r); X1 = Math.max(X1, l.x + l.r); Z0 = Math.min(Z0, l.z - l.r); Z1 = Math.max(Z1, l.z + l.r); }
  const nx = Math.ceil((X1 - X0) / 0.3), nz = Math.ceil((Z1 - Z0) / 0.3);
  const geo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, nx, nz).rotateX(-Math.PI / 2).translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = height(x, z);
    pos.setY(i, h > 0.02 ? h + (fbm(x * 1.7, z * 1.7 + seed, 3) - 0.5) * 0.6 * Math.min(1, h * 1.6) : -0.12);
    const v = 0.62 + fbm(x * 0.9 + 3, z * 0.9, 2) * 0.55;
    col[i * 3] = v * 1.02; col[i * 3 + 1] = v * 0.96; col[i * 3 + 2] = v * 0.87;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // Only the heap itself: on falling ground the flat sheet round it would stand clear of the grass.
  const idx = geo.index.array, keep = [];
  for (let i = 0; i < idx.length; i += 3) if ([idx[i], idx[i + 1], idx[i + 2]].some(k => pos.getY(k) > -0.1)) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  geo.setIndex(keep);
  geo.computeVertexNormals();
  // The scan lies flat over the heap, one tile every 3 m (the heaps are too low for it to stretch).
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 3, pos.getZ(i) / 3);
  moundMat ??= scanned('rubble');
  const mound = new THREE.Mesh(geo, moundMat);
  mound.position.y = y;
  mound.castShadow = mound.receiveShadow = true;
  b.group.add(mound);
  // Under it: metre cells of plain blocks, runs of equal height joined. No cell stands more than a
  // stride above its neighbours, so all of it can be walked up (the steep faces lie a little under the mound).
  const cx0 = Math.floor(X0), cz0 = Math.floor(Z0), cw = Math.ceil(X1) - cx0 + 1, cd = Math.ceil(Z1) - cz0 + 1, cells = new Float32Array(cw * cd);
  for (let j = 0; j < cd; j++) for (let i = 0; i < cw; i++) cells[j * cw + i] = height(cx0 + i + 0.5, cz0 + j + 0.5);
  for (let pass = 0; pass < 8; pass++) for (let j = 0; j < cd; j++) for (let i = 0; i < cw; i++) {
    let low = Infinity;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, c = j + dj; low = Math.min(low, a < 0 || c < 0 || a >= cw || c >= cd ? 0 : cells[c * cw + a]); }
    cells[j * cw + i] = Math.min(cells[j * cw + i], low + STRIDE);
  }
  for (let j = 0; j < cd; j++) {
    let run = null;
    const end = (i) => { if (run) b.box(i - run.i, run.h, 1, HIDDEN, cx0 + (i + run.i) / 2, y, cz0 + j + 0.5); run = null; };
    for (let i = 0; i <= cw; i++) {
      const h = i < cw ? Math.floor(cells[j * cw + i] / 0.15) * 0.15 : 0;
      if (run && run.h !== h) end(i);
      if (!run && h >= 0.15) run = { i, h };
    }
  }
  // Over it: the debris, the big pieces first down the slopes, the small everywhere.
  const parts = debris();
  if (!parts) return mound;
  const onHeap = (n) => {
    const out = [];
    for (let i = 0; i < n * 12 && out.length < n; i++) {
      const l = lobes[Math.floor(rng() * lobes.length)], a = rng() * 7, d = Math.sqrt(rng()) * l.r, x = l.x + Math.cos(a) * d, z = l.z + Math.sin(a) * d, h = height(x, z);
      if (h > 0.03) out.push([x, h, z]);
    }
    return out;
  };
  const around = (n) => {
    const out = [];
    for (const [cx, cz, r, m] of o.scatter ?? []) for (let i = 0; i < m * n && out.length < 4000; i++) {
      const a = rng() * 7, d = r * Math.pow(rng(), 0.7), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!inKeepOff(x, z) || rng() < 0.2) out.push([x, height(x, z), z]);
    }
    return out;
  };
  const drop = (key, spots, s0, s1, { shadow = true, sink = 0.3, lie = false } = {}) => {
    if (!spots.length) return;
    const p = parts[key], im = new THREE.InstancedMesh(p.geometry, p.material, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), at = new THREE.Vector3();
    spots.forEach(([x, h, z], i) => {
      const k = s0 + rng() * (s1 - s0);
      e.set(lie ? (rng() - 0.5) * 0.5 : rng() * 6.3, rng() * 6.3, lie ? (rng() - 0.5) * 0.5 : rng() * 6.3);
      m.compose(at.set(x, y + h - sink * k * 0.3, z), q.setFromEuler(e), s.setScalar(k));
      im.setMatrixAt(i, m);
    });
    im.castShadow = shadow; im.receiveShadow = true;
    im.computeBoundingSphere();
    b.group.add(im);
  };
  const size = lobes.reduce((s, l) => s + l.r * l.r * l.h, 0);           // (more on a bigger heap)
  drop('lump1', onHeap(size * 0.16), 0.4, 0.95);
  drop('lump2', onHeap(size * 1.1), 0.4, 1.0);
  drop('slab', onHeap(size * 0.7), 0.35, 1.0);
  drop('lump3', onHeap(size * 7).concat(around(0.7)), 0.35, 1.2, { shadow: false });
  drop('bricks', onHeap(size * 0.5).concat(around(0.12)), 0.8, 1.1, { shadow: false });
  drop('tile', onHeap(size * 0.8).concat(around(0.22)), 0.55, 0.85, { shadow: false, sink: 0, lie: true });
  drop('beam', onHeap(o.burnt ? size * 0.12 : size * 0.05), 0.6, 1.1, { sink: -0.2, lie: true });
  return mound;
}

// A charred timber from a to c ([x, y, z]): a joist still in its pocket, a rafter left over a room.
export function charred(b, a, c, thick = 0.2) {
  const A = new THREE.Vector3(...a), C = new THREE.Vector3(...c);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thick * 0.85, A.distanceTo(C), thick), BURNT);
  mesh.position.copy(A).add(C).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), C.clone().sub(A).normalize());
  mesh.castShadow = mesh.receiveShadow = true;
  b.group.add(mesh);
  return mesh;
}
const BURNT = new THREE.MeshStandardMaterial({ color: 0x17130f, roughness: 1, envMapIntensity: 0.1 });

// One piece of the kit, placed by hand (a girder across a heap).
export function ruinPiece(b, key, x, y, z, rot = [0, 0, 0], scale = 1) {
  const parts = debris();
  if (!parts) return null;
  const mesh = new THREE.Mesh(parts[key].geometry, parts[key].material);
  mesh.position.set(x, y, z); mesh.rotation.set(...rot); mesh.scale.setScalar(scale);
  mesh.castShadow = mesh.receiveShadow = true;
  b.group.add(mesh);
  return mesh;
}

// A free-standing ruin, for the maps that have no block to knock about by hand: four walls that fall
// away toward one corner, the heap that made, openings as holes, and joists leaning from the wall
// that kept them. Nothing of the kit, so nothing can be left hanging.
// opts: x, z (centre), y, w (along x), d (along z), h (the eaves when whole), seed; tint, base (outside
//   colours); burnt; rooms (inside colours); t (thickness); fallen: the corner that went, 0 NW 1 NE 2 SE 3 SW;
//   doors: sides with a door ('n', 'e', 's', 'w'); breach: a side blown open at the foot, or null;
//   windows: their spacing along a wall, 0 for none; keepOff: more lanes the rubble must leave clear.
export function shellHouse(b, o) {
  const { x, z, y, w, d, h = 6.4, seed = 1, tint = '#dcc8a0', base, burnt = false, t = 0.45, fallen = 0,
    doors = ['s'], breach = 'n', windows = 3.1, rooms = ['#cfd6c4', '#d9b9a8'], keepOff = [] } = o;
  const rng = makeRng(seed * 6151 + 3), hx = w / 2, hz = d / 2, two = h > 4.5, sideOf = { n: 0, e: 1, s: 2, w: 3 };
  // The corners, NW NE SE SW: low where it fell, whole opposite.
  const corner = [0, 1, 2, 3].map(i => {
    const away = Math.min((i - fallen + 4) % 4, (fallen - i + 4) % 4);
    return h * [0.1 + rng() * 0.1, 0.5 + rng() * 0.25, 0.92 + rng() * 0.08][away];
  });
  const profile = (hA, hB, L) => {
    const n = Math.max(2, Math.ceil(L / 2.3)), pts = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n, s = k * k * (3 - 2 * k), ends = i === 0 || i === n;
      pts.push([k * L, Math.min(h, Math.max(0.25, (hA + (hB - hA) * s) * (ends ? 1 : 0.76 + rng() * 0.32)))]);
    }
    return pts;
  };
  // Runs of up to 18 m (the wall's field and paint are per run, and stretch over a longer one), an odd
  // number of them, so the opening in the middle of the wall falls inside a run.
  const side = (name, x0, z0, x1, z1, hA, hB, outFront) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 18) | 1;
    let top = profile(hA, hB, L);
    const opening = [];
    if (doors.includes(name)) opening.push({ u: L / 2, v: 0, w: 1.3, h: 2.2, kind: 'door' });
    if (breach === name) opening.push({ u: L / 2, v: 0, w: 3.2, h: Math.min(2.8, h - 0.8), kind: 'blast' });
    for (const q of opening) {                                          // the wall stands over its ways in
      const a = q.u - q.w / 2 - 0.6, c = q.u + q.w / 2 + 0.6, need = q.h + 0.7, stand = (u) => Math.max(need, lerpAt(top, u));
      top = [...top.filter(p => p[0] < a || p[0] > c), [a, stand(a)], [c, stand(c)]].sort((p, q2) => p[0] - q2[0]);
    }
    const at = (u) => lerpAt(top, u), under = (p) => Math.min(at(p.u - p.w / 2), at(p.u), at(p.u + p.w / 2)) > p.v + p.h + 0.55;   // (the ragged edge mustn't reach it)
    const holes = [];
    if (windows) for (let u = windows * 0.6; u < L - 0.9; u += windows) {
      holes.push({ u, v: 1, w: 1.1, h: 1.4, kind: 'win' });
      if (two) holes.push({ u, v: 4.1, w: 1.1, h: 1.3, kind: 'win' });
    }
    const clear = holes.filter(p => !opening.some(q => Math.abs(p.u - q.u) < (p.w + q.w) / 2 + 0.4 && p.v < q.v + q.h));
    const all = [...clear, { u: L * (0.3 + rng() * 0.4), v: h * 0.45, w: 0.7, h: 0.7, kind: 'shell' }].filter(under).concat(opening);
    const out = { kind: 'out', tint, base }, inn = { kind: 'in', rooms: two ? rooms : rooms.slice(0, 1), paper: burnt ? 1 : 0, flue: rng() < 0.5 ? L * 0.4 : 0 };
    for (let i = 0; i < n; i++) {
      const a = L * i / n, c = L * (i + 1) / n, k0 = a / L, k1 = c / L;
      const part = [[0, at(a)], ...top.filter(p => p[0] > a + 0.05 && p[0] < c - 0.05).map(p => [p[0] - a, p[1]]), [c - a, at(c)]];
      ruinWall(b, {
        x0: x0 + (x1 - x0) * k0, z0: z0 + (z1 - z0) * k0, x1: x0 + (x1 - x0) * k1, z1: z0 + (z1 - z0) * k1,
        y, t, full: h, burnt, seed: seed * 17 + sideOf[name] * 5 + i, top: part,
        holes: all.filter(p => p.u - p.w / 2 > a + 0.2 && p.u + p.w / 2 < c - 0.2).map(p => ({ ...p, u: p.u - a })),
        front: outFront ? out : inn, back: outFront ? inn : out,
      });
    }
  };
  const e = t / 2;
  side('n', x - hx, z - hz, x + hx, z - hz, corner[0], corner[1], false);
  side('s', x - hx, z + hz, x + hx, z + hz, corner[3], corner[2], true);
  side('w', x - hx, z - hz + e, x - hx, z + hz - e, corner[0], corner[3], true);
  side('e', x + hx, z - hz + e, x + hx, z + hz - e, corner[1], corner[2], false);

  // The heap: in the fallen corner and out over the low walls; the ways in stay clear to the middle.
  const fx = fallen === 1 || fallen === 2 ? 1 : -1, fz = fallen >= 2 ? 1 : -1, cx = x + fx * hx, cz = z + fz * hz;
  const r = Math.min(Math.max(Math.min(w, d) * 0.62, 3), 6.5), hh = Math.min(2.4, 0.9 + h * 0.2);
  const lane = { n: [x - 1.1, z - hz - 3, x + 1.1, z], s: [x - 1.1, z, x + 1.1, z + hz + 3], w: [x - hx - 3, z - 1.1, x, z + 1.1], e: [x, z - 1.1, x + hx + 3, z + 1.1] };
  const ways = [...doors, ...(breach ? [breach] : [])].map(k => lane[k]);
  rubble(b, {
    y, seed: seed + 40, burnt,
    lobes: [{ x: cx - fx * r * 0.45, z: cz - fz * r * 0.45, r, h: hh }, { x: cx + fx * r * 0.25, z: cz + fz * r * 0.25, r: r * 0.7, h: hh * 0.5 },
      { x: x - fx * hx * 0.4, z: z - fz * hz * 0.3, r: r * 0.55, h: hh * 0.3 }],
    keepOff: [...ways, ...keepOff],
    scatter: [[x, z, Math.max(w, d) * 0.85, Math.round(w + d)]],
  });
  // Joists still in the pockets of the wall that stood, their far ends down on the floor.
  if (two) {
    const wx = x - fx * hx + fx * 0.2, zs = z - fz * hz + fz * 1.2;
    for (const k of [0, 1, 3]) { const zz = zs + fz * k * (0.5 + rng() * 0.25); charred(b, [wx, y + 3.05, zz], [wx + fx * (1.7 + rng() * 1.9), y + 0.1, zz + (rng() - 0.5) * 1.3], 0.17); }
  }
}

// The map's craters (terrain.js digs them): finer ground over each, broken by the blast, burnt in the
// middle and fading out at the edge, and clods of it thrown round about. Its height follows the
// ground that boots walk on, with lumps of a few centimetres, so nobody sinks or floats.
export function craters(scene) {
  const list = craterList();
  if (!list.length) return;
  const T = textures().ground, winter = activeMap().winter;
  // Summer: scanned earth, its own colour, so the colours below only light and darken it. Winter: the
  // pale ground detail under the same colours, snowed in (a map's dark photo would turn the snow black).
  const over = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const mat = winter ? new THREE.MeshStandardMaterial({ map: T.map.clone(), normalMap: T.normalMap.clone(), roughness: 1, envMapIntensity: 0.15, vertexColors: true, ...over }) : scanned('crater', over);
  if (winter) for (const t of [mat.map, mat.normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1); t.needsUpdate = true; }
  const dark = new THREE.Color(0x2a2219), earth = new THREE.Color(0x5e4a35), pale = new THREE.Color(0x8d7a60), snow = new THREE.Color(0xd9dde4), c = new THREE.Color();
  const clods = [];
  list.forEach((k, n) => {
    const R = k.r * CRATER_EDGE, seg = Math.ceil(R * 2 / 0.3);
    const geo = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg).rotateX(-Math.PI / 2).translate(k.x, 0, k.z);
    const pos = geo.attributes.position, uv = geo.attributes.uv, col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), ang = Math.atan2(z - k.z, x - k.x);
      const wob = 1 + 0.2 * (fbm(Math.cos(ang) * 1.6 + n * 3, Math.sin(ang) * 1.6, 3) - 0.5);     // no blast is a circle
      const d = Math.hypot(x - k.x, z - k.z) / k.r / wob;
      const lump = fbm(x * 1.5 + n, z * 1.5, 3) - 0.5, fine = fbm(x * 4.5, z * 4.5 + n, 2) - 0.5;
      pos.setY(i, heightAt(x, z) + 0.05 + (lump * 0.34 + fine * 0.1) * Math.max(0, 1 - Math.abs(d - 1) * 0.9));
      uv.setXY(i, x / 4, z / 4);
      c.copy(dark).lerp(earth, Math.min(1, Math.max(0, (d - 0.25) / 0.65)) * (0.7 + lump)).lerp(pale, Math.max(0, 1 - Math.abs(d - 1.12) / 0.22) * 0.55);
      if (winter) c.lerp(snow, Math.min(0.92, 0.5 + 0.35 * d + lump * 2.2));                       // snowed in since, the earth showing through
      c.multiplyScalar(0.85 + fine * 0.9);
      if (!winter) { c.r /= earth.r; c.g /= earth.g; c.b /= earth.b; c.multiplyScalar(0.78); }       // (as a share of plain earth: the scan has the colour)
      col[i * 4] = c.r; col[i * 4 + 1] = c.g; col[i * 4 + 2] = c.b;
      col[i * 4 + 3] = 1 - Math.min(1, Math.max(0, (d + lump * 0.7 - 1.15) / 0.42));                 // ragged at the edge
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true; mesh.renderOrder = 1;
    scene.add(mesh);
    const rng = makeRng(n * 977 + 5), m = Math.round(k.r * 16);
    for (let i = 0; i < m; i++) { const a = rng() * 6.3, d = k.r * (0.82 + rng() ** 2 * 0.95), x = k.x + Math.cos(a) * d, z = k.z + Math.sin(a) * d; clods.push([x, heightAt(x, z), z, 0.3 + rng() * rng() * 0.75, rng]); }
  });
  const parts = debris();
  if (!parts) return;
  const clod = new THREE.MeshStandardMaterial({ color: winter ? 0x8b8580 : 0x54432f, roughness: 1, envMapIntensity: 0.1, flatShading: true });
  const im = new THREE.InstancedMesh(parts.lump3.geometry, clod, clods.length);
  const M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), at = new THREE.Vector3();
  clods.forEach(([x, y, z, k, rng], i) => { M4.compose(at.set(x, y + 0.02, z), q.setFromEuler(e.set(rng() * 6, rng() * 6, rng() * 6)), s.setScalar(k)); im.setMatrixAt(i, M4); });
  im.castShadow = false; im.receiveShadow = true;
  im.computeBoundingSphere();
  scene.add(im);
}
