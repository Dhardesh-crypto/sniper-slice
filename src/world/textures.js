// Textures for plaster, stone blocks, roof tiles, wood planks and ground detail, each with a
// matching normal map. They're drawn on canvases at load time, then replaced by photographs
// (public/textures, generated with Higgsfield: seamless) once those have loaded; the drawn ones
// stay if a photo is missing.
// Also `worldUVs`, which re-maps box/roof UVs so textures tile at a fixed real-world size.
import * as THREE from 'three';
import { makeRng } from './noise.js';

const SIZE = 512;

function canvas(size = SIZE) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Normal map from a grayscale height canvas (Sobel), so surfaces catch the light.
function normalFromHeight(src, strength = 2) {
  const s = src.width, g = src.getContext('2d'), d = g.getImageData(0, 0, s, s).data;
  const out = canvas(s), og = out.getContext('2d'), img = og.createImageData(s, s);
  const h = (x, y) => d[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * s + x) * 4;
      img.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}

function speckle(g, rng, n, size, colors, alpha = 0.25) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * rng();
    g.fillStyle = colors[Math.floor(rng() * colors.length)];
    const r = size * (0.3 + rng());
    g.beginPath();
    g.arc(rng() * SIZE, rng() * SIZE, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function toTextures(color, height, { repeat = 1, normalStrength = 2 } = {}) {
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normalFromHeight(height, normalStrength));
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
  }
  return { map, normalMap };
}

function plaster(seed, base) {
  const rng = makeRng(seed);
  const c = canvas(), g = c.getContext('2d');
  const h = canvas(), hg = h.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, SIZE, SIZE);
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, SIZE, SIZE);
  speckle(g, rng, 900, 14, ['#ffffff', '#b8a07a', '#8d7a5c'], 0.12);
  speckle(hg, rng, 1600, 6, ['#a0a0a0', '#606060'], 0.35);
  // Weather stains running down from the top.
  for (let i = 0; i < 14; i++) {
    const x = rng() * SIZE, w = 10 + rng() * 40;
    const grd = g.createLinearGradient(0, 0, 0, SIZE * (0.3 + rng() * 0.6));
    grd.addColorStop(0, 'rgba(70,60,45,0.18)');
    grd.addColorStop(1, 'rgba(70,60,45,0)');
    g.fillStyle = grd;
    g.fillRect(x, 0, w, SIZE);
  }
  // Patches where the plaster fell off and the bricks show.
  for (let i = 0; i < 3; i++) {
    const x = rng() * SIZE, y = rng() * SIZE, w = 30 + rng() * 60, hh = 20 + rng() * 40;
    g.fillStyle = 'rgba(150,85,60,0.55)';
    g.fillRect(x, y, w, hh);
    hg.fillStyle = '#505050';
    hg.fillRect(x, y, w, hh);
  }
  return toTextures(c, h, { normalStrength: 1.5 });
}

function stone(seed) {
  const rng = makeRng(seed);
  const c = canvas(), g = c.getContext('2d');
  const h = canvas(), hg = h.getContext('2d');
  g.fillStyle = '#8f8573'; g.fillRect(0, 0, SIZE, SIZE);
  hg.fillStyle = '#202020'; hg.fillRect(0, 0, SIZE, SIZE); // mortar is low
  const rows = 8, rh = SIZE / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rng() * 60;
    while (x < SIZE) {
      const w = 40 + rng() * 70;
      const shade = 150 + rng() * 50;
      g.fillStyle = `rgb(${shade + 15},${shade + 5},${shade - 15})`;
      g.fillRect(x + 3, r * rh + 3, w - 6, rh - 6);
      hg.fillStyle = `rgb(${170 + rng() * 60},${170},${170})`;
      hg.fillRect(x + 3, r * rh + 3, w - 6, rh - 6);
      x += w;
    }
  }
  speckle(g, rng, 1200, 5, ['#5a5040', '#c9bea6'], 0.25);
  speckle(hg, rng, 1500, 4, ['#909090', '#d0d0d0'], 0.3);
  return toTextures(c, h, { normalStrength: 3 });
}

function roofTiles(seed) {
  const rng = makeRng(seed);
  const c = canvas(), g = c.getContext('2d');
  const h = canvas(), hg = h.getContext('2d');
  const rows = 10, cols = 8, rh = SIZE / rows, cw = SIZE / cols;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = k * cw + (r % 2) * cw / 2, y = r * rh;
      const hue = 12 + rng() * 10, light = 36 + rng() * 14;
      for (const xx of [x, x - SIZE]) {
        const grd = g.createLinearGradient(xx, 0, xx + cw, 0);
        grd.addColorStop(0, `hsl(${hue},55%,${light - 12}%)`);
        grd.addColorStop(0.5, `hsl(${hue},55%,${light}%)`);
        grd.addColorStop(1, `hsl(${hue},55%,${light - 14}%)`);
        g.fillStyle = grd;
        g.fillRect(xx, y, cw, rh);
        const hgrd = hg.createLinearGradient(xx, 0, xx + cw, 0);
        hgrd.addColorStop(0, '#303030'); hgrd.addColorStop(0.5, '#e0e0e0'); hgrd.addColorStop(1, '#303030');
        hg.fillStyle = hgrd;
        hg.fillRect(xx, y, cw, rh);
      }
      g.fillStyle = 'rgba(30,15,10,0.35)';
      g.fillRect(x, y + rh - 4, cw, 4);
    }
  }
  speckle(g, rng, 400, 8, ['#4d5a3a', '#2c2a20'], 0.15); // lichen and grime
  return toTextures(c, h, { normalStrength: 3 });
}

function wood(seed, base = '#6b4b2e') {
  const rng = makeRng(seed);
  const c = canvas(), g = c.getContext('2d');
  const h = canvas(), hg = h.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, SIZE, SIZE);
  hg.fillStyle = '#909090'; hg.fillRect(0, 0, SIZE, SIZE);
  const planks = 6, pw = SIZE / planks;
  for (let p = 0; p < planks; p++) {
    g.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.15})`;
    g.fillRect(p * pw, 0, pw, SIZE);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(40,25,10,${0.1 + rng() * 0.2})`;
      g.lineWidth = 1 + rng() * 2;
      const x = p * pw + rng() * pw;
      g.beginPath(); g.moveTo(x, 0);
      g.bezierCurveTo(x + rng() * 8 - 4, SIZE * 0.3, x + rng() * 8 - 4, SIZE * 0.7, x, SIZE);
      g.stroke();
    }
    g.fillStyle = 'rgba(20,12,5,0.7)'; g.fillRect(p * pw, 0, 3, SIZE);
    hg.fillStyle = '#202020'; hg.fillRect(p * pw, 0, 3, SIZE);
  }
  return toTextures(c, h, { normalStrength: 2 });
}

// Grass/soil detail, mostly neutral so the terrain's vertex colours still lead.
function groundDetail(seed) {
  const rng = makeRng(seed);
  const c = canvas(), g = c.getContext('2d');
  const h = canvas(), hg = h.getContext('2d');
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, SIZE, SIZE);
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 9000; i++) {
    const x = rng() * SIZE, y = rng() * SIZE, len = 3 + rng() * 9, a = rng() * Math.PI;
    const v = 150 + rng() * 105;
    g.strokeStyle = `rgba(${v},${v},${v * 0.85},0.5)`;
    g.lineWidth = 1 + rng();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    hg.strokeStyle = `rgba(255,255,255,${0.2 + rng() * 0.3})`;
    hg.beginPath(); hg.moveTo(x, y); hg.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); hg.stroke();
  }
  speckle(g, rng, 500, 10, ['#9a8f74', '#e0e0d0'], 0.3);
  return toTextures(c, h, { normalStrength: 1.2 });
}

let cache = null;
export function textures() {
  if (cache) return cache;
  cache = {
    plaster: plaster(11, '#ddc9a2'),
    plaster2: plaster(12, '#cfa97c'),
    stone: stone(21),
    roof: roofTiles(31),
    wood: wood(41),
    darkWood: wood(42, '#3f2c1c'),
    ground: groundDetail(51),
  };
  return cache;
}

// Re-map UVs from world-space position so a texture repeats every `metres`, whatever
// the size of the box or roof it is on. Works on any non-indexed or indexed geometry.
export function worldUVs(geometry, metres = 2) {
  const pos = geometry.attributes.position, nrm = geometry.attributes.normal;
  const uv = geometry.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    let u, v;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
    uv.setXY(i, u / metres, v / metres);
  }
  geometry.setAttribute('uv', uv);
  uv.needsUpdate = true;
  return geometry;
}

// Swap the drawn textures for the photographs, with normal maps built from the photos' light and
// dark. Copies of a texture (the terrain's ground, the trees' bark) share its image and are
// refreshed too.
const PHOTO_NORMALS = { plaster: 1.2, plaster2: 1.2, stone: 2.5, roof: 2.5, wood: 1.6, darkWood: 1.6, ground: 1.0 };
export async function usePhotoTextures(scene) {
  const T = textures(), loader = new THREE.ImageLoader(), sources = new Set();
  await Promise.all(Object.keys(T).map(async (key) => {
    const img = await loader.loadAsync(`${import.meta.env.BASE_URL}textures/${key}.jpg`).catch(() => null);
    if (!img) return;
    const height = canvas(SIZE);
    const hg = height.getContext('2d');
    hg.filter = 'grayscale(1)';
    hg.drawImage(img, 0, 0, SIZE, SIZE);
    const { map, normalMap } = T[key];
    map.image = img;
    normalMap.image = normalFromHeight(height, PHOTO_NORMALS[key] ?? 1.5);
    for (const t of [map, normalMap]) { t.needsUpdate = true; sources.add(t.source); }
  }));
  scene.traverse((o) => {
    for (const m of [o.material].flat()) for (const k of ['map', 'normalMap']) if (m?.[k] && sources.has(m[k].source)) m[k].needsUpdate = true;
  });
}
