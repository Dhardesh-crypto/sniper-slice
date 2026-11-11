// One material step for every loaded model, so things from different sources light alike.
// The game's models come from Meshy (characters, weapons), Tripo (props, vehicles, trees), SAM 3D
// (the trucks and the plane), Blender (the kits, trees and debris) and StableGen (the building
// skins), and each source has its own idea of shine: Meshy weapons arrive fully metal with no map
// (wood stocks drawn as chrome), Tripo's metalness maps speckle leaves and canvas, some textures
// came out dark. Every loader passes its materials through normalize(material, kind, key) once,
// at load (the copies the game makes later inherit the result):
//   - metalness: only where a kind can really be metal, and then only as much as the kind allows
//     (a map is kept but scaled so its average fits; a flat value is set to the kind's own);
//   - roughness: the average (map × factor) pulled into the kind's range;
//   - brightness: the asset's colour multiplied by its fix in materials.json (measured by
//     tools/look-audit.js: the average albedo pulled into about 0.04–0.8);
//   - sky reflection: the kind's share of the mission's environment light. (In three.js a
//     material's own envMapIntensity only counts when it has its own envMap: with only
//     scene.environment set, every material got scene.environmentIntensity and all the per-loader
//     values the code had, 0.15 here and 0.6 there, did nothing. So normalize() gives each material
//     the scene's environment map itself, once world.js has made it: setEnvironment().)
import * as THREE from 'three';
import FIX from './materials.json';
import { toLin } from './foliage-mips.js';


// Per kind: env, a multiplier on the mission's environment strength (1 = what everything had
// before this step); rough, the range the average roughness is pulled into; metal, the most
// average metalness allowed (with a map) and flat, the value used when there's no map.
export const KINDS = {
  character: { env: 1.0, rough: [0.62, 1], metal: 0.08, flat: 0 },       // wool, leather, webbing
  weapon: { env: 1.3, rough: [0.38, 0.85], metal: 0.45, flat: 0.15 },   // oiled wood and blued steel
  vehicle: { env: 1.0, rough: [0.6, 0.92], metal: 0.2, flat: 0.12 },    // painted steel: the paint is what shows
  prop: { env: 0.9, rough: [0.65, 1], metal: 0.15, flat: 0 },           // crates, sacks, stone, wood
  animal: { env: 0.8, rough: [0.75, 1], metal: 0, flat: 0 },
  foliage: { env: 0.6, rough: [0.92, 1], metal: 0, flat: 0 },           // (a sheen of sky turned needles minty)
  kit: { env: 0.85, rough: [0.8, 1], metal: 0.1, flat: 0 },             // the Blender stone, plaster and furniture kits
  skin: { env: 0.85, rough: [0.85, 1], metal: 0, flat: 0 },             // a building's baked outside
  pickup: { env: 1.0, rough: [0.3, 1], metal: 1, flat: null },          // drawn by code with its own values: env only
};

// Which kind each loaded asset is (by the key the loaders use; skins are 'skin_*').
const BY_KEY = {
  character: ['player', 'guard', 'guardCamo', 'guardSergeant', 'officerColonel', 'officerLieutenant', 'guardLuftwaffe', 'guardSailor', 'guardPionier', 'guardTanker', 'guardAlpine', 'guardMP', 'guardPara', 'guardItalian', 'guardWinter', 'guardSniper', 'guardFlamer'],
  weapon: ['rifle', 'enfield', 'g43', 'p38', 'luger', 'm1carbine', 'delisle', 'trenchgun', 'mg42', 'panzerschreck', 'panzerfaust', 'piat'],
  vehicle: ['tank', 'opel', 'kubel', 'plane', 'locomotive', 'railgun', 'boxcar', 'boxcarGrey', 'coach', 'flakWagon', 'ship', 'crane', 'flak', 'flak88',
    'p47', 'b25', 'eboat', 'fuelTank', 'generator', 'siren', 'tiger', 'halftrack', 'bf110', 'ju88', 'radar', 'bowser', 'searchlight', 'freya', 'motorcycle',
    'pak40', 'kitchen', 'fiat', 'handcar', 'waterCrane', 'bombTrolley', 'kettenkrad', 'fuelTrailer', 'wurzburg', 'assaultBoat', 'waterTower',
    'wreckPanzer', 'wreckTiger', 'wreckTruck', 'wreckCar', 'wreckHalftrack', 'wreckPlane', 'safe', 'locker', 'filingCabinet', 'stove', 'radioSet'],
  animal: ['cow', 'horse', 'goat', 'deer', 'dog'],
  foliage: ['treeFir', 'treeBeech', 'treeOlive', 'treePine', 'treeCypress', 'treeLarch', 'treeBirch', 'vineRow', 'haystack', 'felledTree', 'logs'],
  kit: ['groundDetail', 'groundBiome', 'archKit', 'interiorKit', 'ruinKit'],
};
const KIND_OF = new Map(Object.entries(BY_KEY).flatMap(([k, keys]) => keys.map(key => [key, k])));
export const kindOf = (key) => key?.startsWith('skin_') ? 'skin' : KIND_OF.get(key) ?? 'prop';

// A texture's texels, drawn down to 128 × 128 on a canvas (cached per image, so a map shared by
// several materials is read once). null when the image can't be read.
const texels = new WeakMap();
const N = 128;
function pixels(tex) {
  const im = tex?.image;
  if (!im?.width) return null;
  if (texels.has(im)) return texels.get(im);
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d', { willReadFrequently: true });
  let d = null;
  try { x.drawImage(im, 0, 0, N, N); d = x.getImageData(0, 0, N, N).data; } catch { /* unreadable */ }
  texels.set(im, d);
  return d;
}
const LUM = [0.2126, 0.7152, 0.0722];

// What a material looks like over the surface it covers: its maps read at points on the meshes'
// triangles (four per triangle, up to ~3000 triangles a mesh), each weighed by the triangle's area
// in the world. A plain average of the texture would count the black gutters between a UV
// atlas's islands (a building skin's 4096 atlas read as 0.01) and miss vertex colours (the
// Blender kits are painted that way). Returns linear albedo (colour × map × vertex colour) and
// its luminance, roughness (factor × map green) and metalness (factor × map blue), as glTF lays
// them out. Without meshes it falls back to the material's own factors.
const P = [[1 / 3, 1 / 3], [0.6, 0.2], [0.2, 0.6], [0.2, 0.2]];
export function surfaceStats(m, meshes = []) {
  const maps = { map: pixels(m.map), r: pixels(m.roughnessMap), mt: pixels(m.metalnessMap) };
  const acc = { w: 0, rgb: [0, 0, 0], r: 0, mt: 0, solid: 0, all: 0 };
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), sc = new THREE.Vector3(), q = new THREE.Quaternion();
  const read = (d, tex, u, v, ch) => {
    const tu = u * tex.repeat.x + tex.offset.x, tv = v * tex.repeat.y + tex.offset.y;
    const x = Math.min(N - 1, Math.floor((tu - Math.floor(tu)) * N));
    const fv = tv - Math.floor(tv), y = Math.min(N - 1, Math.floor((tex.flipY ? 1 - fv : fv) * N));
    return d[(y * N + x) * 4 + ch];
  };
  for (const o of meshes) {
    const g = o.geometry, pos = g.attributes.position, uv = g.attributes.uv, col = m.vertexColors ? g.attributes.color : null, idx = g.index;
    o.updateWorldMatrix(true, false);
    o.matrixWorld.decompose(va, q, sc);
    const n = (idx ? idx.count : pos.count) / 3, step = Math.max(1, Math.floor(n / 3000));
    for (let t = 0; t < n; t += step) {
      const I = [0, 1, 2].map(k => idx ? idx.getX(t * 3 + k) : t * 3 + k);
      va.fromBufferAttribute(pos, I[0]).multiply(sc); vb.fromBufferAttribute(pos, I[1]).multiply(sc); vc.fromBufferAttribute(pos, I[2]).multiply(sc);
      const area = vb.sub(va).cross(vc.sub(va)).length() / 2;
      if (!(area > 0)) continue;
      const vcol = [1, 1, 1];
      if (col) for (let c = 0; c < 3; c++) vcol[c] = I.reduce((s, i) => s + col.getComponent(i, c), 0) / 3;
      for (const [b1, b2] of P) {
        const w = area / P.length;
        let u = 0.5, v = 0.5;
        if (uv) {
          const b0 = 1 - b1 - b2;
          u = uv.getX(I[0]) * b0 + uv.getX(I[1]) * b1 + uv.getX(I[2]) * b2;
          v = uv.getY(I[0]) * b0 + uv.getY(I[1]) * b1 + uv.getY(I[2]) * b2;
        }
        acc.all += w;
        if (maps.map && read(maps.map, m.map, u, v, 3) < 128) continue;    // (a cut-out card's clear part)
        acc.w += w; acc.solid += w;
        for (let c = 0; c < 3; c++) acc.rgb[c] += w * vcol[c] * (maps.map ? toLin[read(maps.map, m.map, u, v, c)] : 1);
        acc.r += w * (maps.r ? read(maps.r, m.roughnessMap, u, v, 1) / 255 : 1);
        acc.mt += w * (maps.mt ? read(maps.mt, m.metalnessMap, u, v, 2) / 255 : 1);
      }
    }
  }
  const k = acc.w || 1, has = acc.w > 0;
  const col = m.color ? [m.color.r, m.color.g, m.color.b] : [1, 1, 1];
  const rgb = col.map((c, i) => c * (has ? acc.rgb[i] / k : 1));
  return {
    rgb, albedo: rgb.reduce((s, v, i) => s + v * LUM[i], 0),
    roughness: (m.roughness ?? 1) * (has ? acc.r / k : 1),
    metalness: (m.metalness ?? 0) * (has ? acc.mt / k : 1),
    solid: acc.all ? acc.solid / acc.all : 1,
    area: acc.all,
    env: m.envMap ? m.envMapIntensity : ENV.intensity,
    mapSize: m.map?.image?.width ?? 0,
  };
}

// The scene's environment map and strength (world.js sets them once the sky is made), and every
// material normalized so far, which gets the map then.
const ENV = { texture: null, intensity: 0.22 };
const waiting = new Set();
export function setEnvironment(texture, intensity) {
  ENV.texture = texture; ENV.intensity = intensity;
  for (const m of waiting) applyEnv(m);
  waiting.clear();
}
function applyEnv(m) {
  if (!('envMapIntensity' in m)) return;
  m.envMap = ENV.texture;
  m.envMapIntensity = (m.userData.look?.env ?? 1) * ENV.intensity;
  m.needsUpdate = true;
}

// The one step. kind: a key of KINDS; key: the asset's name (its brightness fix in
// materials.json); meshes: the meshes that wear it (to measure its maps over their surface).
// Safe to call twice on one material (the second does nothing).
export function normalize(m, kind, key, meshes = []) {
  if (!m || m.userData.look || !('roughness' in m)) return m;
  const K = KINDS[kind] ?? KINDS.prop;
  m.userData.look = { kind, key, env: K.env, fix: FIX[key] ?? 1 };
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  if (K.flat !== null) {
    const st = surfaceStats(m, meshes);
    // Metalness: scale a map so its average is at most the kind's; no map, the kind's flat value.
    if (m.metalnessMap) {
      const avg = st.metalness;
      if (avg > K.metal) m.metalness *= avg > 0 ? K.metal / avg : 0;
      if (K.metal === 0) { m.metalnessMap = null; m.metalness = 0; }
    } else m.metalness = Math.min(m.metalness ?? 0, K.flat);
    // Roughness: the average into the range (a map keeps its pattern, the factor moves it).
    const rAvg = st.roughness;
    const want = THREE.MathUtils.clamp(rAvg, ...K.rough);
    if (rAvg > 0 && Math.abs(want - rAvg) > 1e-3) {
      if (m.roughnessMap) m.roughness = Math.min(4, m.roughness * want / rAvg);
      else m.roughness = want;
    }
  }
  if (m.color) m.color.multiplyScalar(m.userData.look.fix);
  if ((kind === 'prop' || kind === 'vehicle') && m.map?.image?.width <= 768) addDetail(m);   // (a low-resolution prop: the shared detail)
  if (ENV.texture) applyEnv(m); else waiting.add(m);
  return m;
}

// A shared detail texture for the low-resolution props. Tripo's props carry 512–768 px textures
// over several metres (a truck: about 85 texels a metre), next to 4096 px skins and photo walls at
// 200 and more, so up close they looked blurred beside them. A fine grain of light and dark is laid
// over their colour from the world's own position (three planar projections blended by the surface's
// facing, so it never stretches or shows a UV seam), 1.6 tiles a metre, ±14% at most, fading out by
// 30 m where the texture is sharp enough on its own. One small canvas texture shared by all of them,
// three extra texture reads per pixel on those props only.
const DETAIL = { value: null };
function detailTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d'), im = x.createImageData(S, S);
  // Value noise that wraps (two octaves of blotches) plus per-texel grain, centred on mid-grey.
  const grid = (n, seed) => { const g = new Float32Array(n * n); let s = seed; for (let i = 0; i < g.length; i++) { s = (s * 16807) % 2147483647; g[i] = s / 2147483647; } return g; };
  const smooth = (g, n, u, v) => {
    const fx = u * n, fy = v * n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const at = (i, j) => g[((j % n + n) % n) * n + ((i % n + n) % n)];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
  const g1 = grid(8, 7), g2 = grid(32, 11), g3 = grid(S, 13);
  for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) {
    const u = xx / S, v = y / S;
    const n = 0.45 * smooth(g1, 8, u, v) + 0.35 * smooth(g2, 32, u, v) + 0.2 * g3[y * S + xx];
    const val = Math.round(255 * Math.min(1, Math.max(0, 0.5 + (n - 0.5) * 1.6)));
    const i = (y * S + xx) * 4;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = val; im.data[i + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;          // (a multiplier, not a colour)
  t.anisotropy = 4;
  return t;
}
function addDetail(m) {
  DETAIL.value ??= detailTexture();
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uDetail = DETAIL;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailPos; varying vec3 vDetailN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 dw = vec4(transformed, 1.0); vec3 dn = objectNormal;
          #ifdef USE_INSTANCING
            dw = instanceMatrix * dw; dn = mat3(instanceMatrix) * dn;
          #endif
          vDetailPos = (modelMatrix * dw).xyz; vDetailN = mat3(modelMatrix) * dn; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail; varying vec3 vDetailPos; varying vec3 vDetailN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 bw = abs(normalize(vDetailN)); bw /= bw.x + bw.y + bw.z + 1e-4;
          vec3 p = vDetailPos * 1.6;
          float d = texture2D(uDetail, p.yz).r * bw.x + texture2D(uDetail, p.xz).r * bw.y + texture2D(uDetail, p.xy).r * bw.z;
          float near = 1.0 - smoothstep(10.0, 30.0, distance(vDetailPos, cameraPosition));
          diffuseColor.rgb *= 1.0 + (d - 0.5) * 0.56 * near; }`);
  };
  m.customProgramCacheKey = () => (prevKey?.() ?? '') + '|detail';
}

// A copy of a material that keeps its shader patches (the detail above, winter.js's snow). three's
// clone() copies userData but not onBeforeCompile or customProgramCacheKey, so a plain clone still
// says it has them (userData.look, userData.snowed) and draws without, and nothing patches it again.
export function cloneMat(m) {
  const c = m.clone();
  c.onBeforeCompile = m.onBeforeCompile;
  c.customProgramCacheKey = m.customProgramCacheKey;
  return c;
}

// Every mesh's material in a loaded model (a material shared by several meshes is done once).
export function normalizeModel(root, key, kind = kindOf(key)) {
  const users = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!users.has(m)) users.set(m, []);
      users.get(m).push(o);
    }
  });
  for (const [m, meshes] of users) normalize(m, kind, key, meshes);
  return root;
}
