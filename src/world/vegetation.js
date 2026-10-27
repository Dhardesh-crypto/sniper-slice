// Trees (instanced, trunks block bullets and the player) and wind-swayed grass,
// including tall-grass patches that will hide a crouched or prone player.
import * as THREE from 'three';
import { heightAt, normalAt, COMPOUND, START_HILL, roadCenterZ, inPlayArea, MAP_HALF, keepClear as mapKeepClear, activeMap } from './terrain.js';
import { fbm, makeRng, valueNoise } from './noise.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { textures } from './textures.js';
import { propGeometry, treeParts } from './props.js';

export const windUniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(2, 0) } };

const keepClear = (x, z, margin = 0) => mapKeepClear(x, z, margin);
// A map can thin the grass (a forest floor is mostly needles): 0…1, read when the grass is built.
let grassDensity = null;

// A smooth, lumpy blob of leaves: a subdivided sphere pushed in and out by noise,
// shaded darker underneath and lighter on top (vertex colours).
// Detail 1–2 is plenty: the leaf cards cover the core (detail 3 cost ~2.8M triangles).
function blob(radius, sx, sy, sz, seed, bump = 0.22, detail = 1) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(radius, detail).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = valueNoise(v.x * 1.3 + seed, v.z * 1.3 + v.y * 0.7 - seed) * 0.7 + valueNoise(v.x * 3.1, v.y * 3.1 + v.z) * 0.3;
    v.multiplyScalar(1 + (n - 0.5) * 2 * bump);
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  return g;
}

// Shade a geometry from `base` at the bottom to `top` at the top (vertex colours).
function heightShade(g, base, top) {
  const p = g.attributes.position, cols = new Float32Array(p.count * 3);
  g.computeBoundingBox();
  const { min, max } = g.boundingBox, c = new THREE.Color(), lo = new THREE.Color(base), hi = new THREE.Color(top);
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - min.y) / Math.max(1e-3, max.y - min.y);
    c.copy(lo).lerp(hi, Math.pow(t, 0.8));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

// A crown: a dark solid core, covered with alpha-cut leaf cards scattered over its
// surface and facing outward, so the silhouette is ragged and leafy, not a blob.
function canopy(parts, base, top, { cards = 70, cardSize = 1.1, seed = 1 } = {}) {
  const core = mergeGeometries(parts.map(([geo, x, y, z]) => geo.translate(x, y, z)));
  core.computeVertexNormals();
  heightShade(core, new THREE.Color(base).multiplyScalar(0.5), new THREE.Color(top).multiplyScalar(0.55));

  const rng = makeRng(seed * 977);
  const pos = core.attributes.position, nrm = core.attributes.normal;
  const Z = new THREE.Vector3(0, 0, 1), v = new THREE.Vector3(), n = new THREE.Vector3();
  const quads = [];
  for (let i = 0; i < cards; i++) {
    const k = Math.floor(rng() * pos.count);
    v.fromBufferAttribute(pos, k);
    n.fromBufferAttribute(nrm, k).normalize();
    const quad = new THREE.PlaneGeometry(cardSize * (0.7 + rng() * 0.6), cardSize * (0.7 + rng() * 0.6));
    const face = new THREE.Quaternion().setFromUnitVectors(Z, n);
    const twist = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.9, (rng() - 0.5) * 0.9, rng() * Math.PI * 2));
    quad.applyQuaternion(face.multiply(twist));
    quad.translate(v.x + n.x * 0.1, v.y + n.y * 0.1, v.z + n.z * 0.1);
    quads.push(quad);
  }
  const leaves = heightShade(mergeGeometries(quads), base, top);
  // Light the cards like a volume (normals point out from the crown centre), not like paper.
  const c = new THREE.Vector3();
  leaves.boundingBox.getCenter(c);
  const ln = leaves.attributes.normal, lp = leaves.attributes.position;
  for (let i = 0; i < ln.count; i++) {
    v.fromBufferAttribute(lp, i).sub(c).normalize();
    v.y = v.y * 0.6 + 0.5;
    v.normalize();
    ln.setXYZ(i, v.x, v.y, v.z);
  }
  return { core, leaves };
}

// Leaf-cluster texture with alpha: many small leaves on a transparent card.
function leafTex(seed, { leaves = 70, len = 26, wid = 9 } = {}) {
  const rng = makeRng(seed);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  for (let i = 0; i < leaves; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 100;
    const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
    const v = 150 + rng() * 105;
    g.save();
    g.translate(x, y);
    g.rotate(rng() * Math.PI * 2);
    g.fillStyle = `rgb(${v * 0.92},${v},${v * 0.8})`;
    g.beginPath();
    g.ellipse(0, 0, len * (0.7 + rng() * 0.5) / 2, wid * (0.7 + rng() * 0.5) / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeTreeTypes() {
  const T = textures();
  const bark = T.wood.map.clone();
  bark.repeat.set(1, 2);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a7258, map: bark, roughness: 1 });
  const coreMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMapIntensity: 0.25 });
  // Matte leaves: no sky reflection at grazing angles (it showed as blue fringes).
  const leafMat = (tex) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.25, map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
  const broad = leafTex(1), needle = leafTex(2, { leaves: 160, len: 18, wid: 4 }), olive = leafTex(3, { leaves: 90, len: 22, wid: 6 });
  const cypressCone = mergeVertices(new THREE.ConeGeometry(1.1, 8.5, 12, 6).deleteAttribute('normal').deleteAttribute('uv'));
  {
    const p = cypressCone.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const r = Math.hypot(v.x, v.z), k = 1 + (valueNoise(v.y * 1.4, Math.atan2(v.z, v.x) * 2) - 0.5) * 0.35;
      // Rounder silhouette: bulge the lower-middle like a real cypress.
      const bulge = 1 + 0.25 * Math.sin(Math.min(1, (v.y + 4.25) / 8.5) * Math.PI);
      if (r > 1e-4) p.setXYZ(i, v.x * k * bulge, v.y, v.z * k * bulge);
    }
  }
  // A mountain fir: tiers of drooping cones up a tall bare trunk.
  // (Its lowest branches stay above a third-person camera.)
  const firTiers = [[2.5, 3.0, 6.0], [2.25, 2.8, 7.7], [1.9, 2.6, 9.3], [1.55, 2.5, 10.9], [1.15, 2.3, 12.4], [0.75, 2.3, 13.9], [0.4, 1.8, 15.3]].map(([r, h, y], i) => {
    const g = mergeVertices(new THREE.ConeGeometry(r, h, 11, 3, true).deleteAttribute('normal').deleteAttribute('uv'));
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      const rr = Math.hypot(v.x, v.z), n = 1 + (valueNoise(v.y * 1.7 + i * 3, Math.atan2(v.z, v.x) * 2.3) - 0.5) * 0.4;
      if (rr > 1e-4) p.setXYZ(k, v.x * n, v.y - rr * 0.18, v.z * n);      // the branch tips droop
    }
    return [g, 0, y, 0];
  });
  return [
    { // silver fir (the mountain forests; only on maps that ask for it)
      name: 'fir', count: 0, blender: 'treeFir', shade: { trunk: 0.32, crown: [0.46, 0.55, 0.52], far: [0.46, 0.55, 0.52] },
      trunk: new THREE.CylinderGeometry(0.14, 0.34, 16, 8).translate(0, 8, 0), trunkR: 0.34,
      crown: canopy(firTiers, 0x2f4a2b, 0x7a9763, { cards: 220, cardSize: 2.1, seed: 4 }),
      coreMat, leafMat: leafMat(needle), trunkMat, scale: [0.75, 1.3],
    },
    { // beech: a tall grey trunk and a broad crown
      name: 'beech', count: 0, blender: 'treeBeech', shade: { trunk: 0.45, crown: 0.62, far: 0.62 },
      trunk: new THREE.CylinderGeometry(0.2, 0.32, 8, 9).translate(0, 4, 0), trunkR: 0.32,
      crown: canopy([
        [blob(2.6, 1.2, 0.9, 1.2, 8, 0.25), 0, 9.0, 0],
        [blob(1.8, 1.1, 0.9, 1.1, 9), 1.6, 8.0, 0.9],
        [blob(1.8, 1.1, 0.9, 1.1, 10), -1.5, 8.2, -1.1],
      ], 0x34512a, 0x84a55c, { cards: 200, cardSize: 1.8, seed: 5 }),
      coreMat, leafMat: leafMat(broad), trunkMat, scale: [0.85, 1.25],
    },
    { // Italian cypress (the modelled one where it's loaded)
      name: 'cypress', count: 380, model: propGeometry('cypress', { y: 10 }),
      trunk: new THREE.CylinderGeometry(0.16, 0.22, 2, 10).translate(0, 1, 0), trunkR: 0.25,
      crown: canopy([[cypressCone, 0, 5.6, 0]], 0x2a4421, 0x5c7f48, { cards: 260, cardSize: 1.25, seed: 1 }),
      coreMat, leafMat: leafMat(needle), trunkMat, scale: [0.8, 1.3],
    },
    { // umbrella (stone) pine: a wide flat crown of overlapping clumps (or the model)
      name: 'pine', count: 160, model: propGeometry('pine', { y: 9 }),
      trunk: new THREE.CylinderGeometry(0.2, 0.32, 7, 10).translate(0, 3.5, 0), trunkR: 0.32,
      crown: canopy([
        [blob(2.4, 1.3, 0.45, 1.3, 1, 0.22, 2), 0, 7.6, 0],
        [blob(1.6, 1.2, 0.5, 1.2, 2), 1.9, 7.2, 0.8],
        [blob(1.6, 1.2, 0.5, 1.2, 3), -1.7, 7.3, -1.0],
        [blob(1.4, 1.2, 0.5, 1.2, 4), 0.3, 7.1, -2.1],
      ], 0x2c4220, 0x6f9050, { cards: 160, cardSize: 1.8, seed: 2 }),
      coreMat, leafMat: leafMat(broad), trunkMat, scale: [0.8, 1.2],
    },
    { // olive: silvery, clumpy and low
      name: 'olive', count: 520, blender: 'treeOlive', shade: { trunk: 0.45, crown: 0.75, far: 0.75 },
      trunk: new THREE.CylinderGeometry(0.18, 0.28, 1.8, 10).translate(0, 0.9, 0), trunkR: 0.3,
      crown: canopy([
        [blob(1.3, 1.2, 0.85, 1.2, 5, 0.3), 0, 2.6, 0],
        [blob(0.95, 1.1, 0.8, 1.1, 6, 0.3), 0.9, 2.3, 0.4],
        [blob(0.9, 1.1, 0.8, 1.1, 7, 0.3), -0.8, 2.4, -0.5],
      ], 0x56653b, 0xa9b78a, { cards: 90, cardSize: 1.15, seed: 3 }),
      coreMat, leafMat: leafMat(olive), trunkMat, scale: [0.8, 1.25],
    },
  ];
}

const CHUNK = 125;
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const LOD_NEAR = 55;     // m: closer chunks draw a Blender tree whole, farther ones its far cards

export function buildTrees(scene) {
  const rng = makeRng(1944);
  const trees = [];      // {x, z, r} for player collision
  const trunks = [];     // instanced meshes for bullet raycasts
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  // A map can ask for its own forest: { counts: { fir: 3000, ... }, density(x, z, name): 0…1, spacing }.
  const forest = activeMap().forest;
  const chunks = new Map();
  const spacing = forest?.spacing ?? 3, cell = (x, z) => `${Math.floor(x / spacing)},${Math.floor(z / spacing)}`;
  const taken = new Map();          // grid of placed trees, for the spacing check
  const near = (x, z) => {
    const cx = Math.floor(x / spacing), cz = Math.floor(z / spacing);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const t = taken.get(`${cx + i},${cz + j}`);
      if (t && Math.abs(t.x - x) < spacing && Math.abs(t.z - z) < spacing) return true;
    }
    return false;
  };
  for (const type of makeTreeTypes()) {
    if (forest) type.count = forest.counts[type.name] ?? 0;
    if (!type.count) continue;
    const placed = [];
    let tries = 0;
    while (placed.length < type.count && tries++ < type.count * 60) {
      const x = (rng() * 2 - 1) * (MAP_HALF - 10), z = (rng() * 2 - 1) * (MAP_HALF - 10);
      // Groves: density follows noise; olives cluster, cypresses line up along the road.
      const grove = fbm(x * 0.012 + type.name.length * 5, z * 0.012, 3);
      if (forest) { if (rng() > forest.density(x, z, type.name)) continue; }
      else if (type.name === 'cypress') {
        const nearRoad = x < COMPOUND.x - 30 && Math.abs(Math.abs(z - roadCenterZ(x)) - 7) < 1.5;
        if (!(nearRoad && rng() < 0.5) && grove < 0.62) continue;
      } else if (grove < (type.name === 'olive' ? 0.58 : 0.64)) continue;
      if (keepClear(x, z, 4)) continue;
      if (Math.hypot(x - START_HILL.x, z - START_HILL.z) < 14) continue;
      if (near(x, z)) continue;
      const y = heightAt(x, z);
      const sc = type.scale[0] + rng() * (type.scale[1] - type.scale[0]);
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      placed.push({ x, z, m: m.compose(p.set(x, y - 0.1, z), q, s.set(sc, sc, sc)).clone() });
      trees.push({ x, z, r: type.trunkR * sc });
      taken.set(cell(x, z), trees.at(-1));
    }
    // One set of instanced meshes per map chunk, so the ones out of view (or lost in the mist)
    // aren't drawn, and a ray only tests the trees in the chunks it passes.
    const byChunk = new Map();
    for (const t of placed) {
      const k = `${Math.floor(t.x / CHUNK)},${Math.floor(t.z / CHUNK)}`;
      if (!byChunk.has(k)) byChunk.set(k, []);
      byChunk.get(k).push(t);
    }
    // A tree built in Blender: the whole tree near by, its far cards beyond (see cullTreeChunks).
    const built = type.blender && treeParts(type.blender, type.shade);
    for (const [k, list] of byChunk) {
      const instanced = ([geo, mat]) => {
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((t, j) => im.setMatrixAt(j, t.m));
        im.castShadow = im.receiveShadow = true;
        im.computeBoundingSphere();
        scene.add(im);
        return im;
      };
      // A modelled tree draws itself whole; its trunk stays, undrawn, for bullets.
      const parts = type.model || built ? [[type.trunk, HIDDEN]]
        : [[type.trunk, type.trunkMat], [type.crown.core, type.coreMat], [type.crown.leaves, type.leafMat]];
      if (type.model && !built) parts.push([type.model.geometry, type.model.material]);
      const meshes = parts.map(instanced);
      trunks.push(meshes[0]);
      const [cx, cz] = k.split(',').map(Number);
      if (!chunks.has(k)) chunks.set(k, { x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK, meshes: [], near: [], far: [] });
      const c = chunks.get(k);
      c.meshes.push(...meshes);
      if (built) {
        c.near.push(instanced([built.trunk.geometry, built.trunk.material]), instanced([built.crown.geometry, built.crown.material]));
        c.far.push(instanced([built.far.geometry, built.far.material]));
      }
    }
  }
  return { trees, trunks, chunks: [...chunks.values()] };
}

// Hide the tree chunks beyond `far` metres of the viewer (a misty map can't see them anyway), and
// pick each chunk's detail: the whole Blender trees within `near` m (more through a scope: `zoom`),
// their far cards beyond.
export function cullTreeChunks(chunks, viewer, far = Infinity, zoom = 1) {
  const r = far + CHUNK * 0.71, near = LOD_NEAR * zoom;
  for (const c of chunks) {
    const v = (c.x - viewer.x) ** 2 + (c.z - viewer.z) ** 2 < r * r;
    const dx = Math.max(0, Math.abs(c.x - viewer.x) - CHUNK / 2), dz = Math.max(0, Math.abs(c.z - viewer.z) - CHUNK / 2);
    const close = dx * dx + dz * dz < near * near;
    for (const m of c.meshes) m.visible = v;
    for (const m of c.near) m.visible = v && close;
    for (const m of c.far) m.visible = v && !close;
  }
}


function tuftGeometry(rng, blades, height) {
  const positions = [], colors = [];
  const base = new THREE.Color(0x3f5a22), tip = new THREE.Color(0xa9b25c);
  for (let i = 0; i < blades; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 0.18;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const w = 0.035 + rng() * 0.03, h = height * (0.6 + rng() * 0.5);
    const lean = 0.15 + rng() * 0.2;
    const px = Math.cos(a + Math.PI / 2) * w, pz = Math.sin(a + Math.PI / 2) * w;
    positions.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + Math.cos(a) * lean, h, bz + Math.sin(a) * lean);
    const t = tip.clone().lerp(base, rng() * 0.3);
    colors.push(base.r, base.g, base.b, base.r, base.g, base.b, t.r, t.g, t.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  // Grass lit from above reads better than with per-blade normals.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function grassMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = 'uniform float uTime;\nuniform vec2 uWind;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 rootW = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float hN = clamp(position.y / 0.55, 0.0, 2.0);
      float phase = uTime * 2.4 + rootW.x * 0.23 + rootW.z * 0.19;
      float gust = 0.65 + 0.35 * sin(uTime * 0.6 + rootW.x * 0.02 + rootW.z * 0.015);
      vec2 bend = uWind * 0.045 * gust * (0.7 + 0.3 * sin(phase));
      transformed.xz += bend * hN * hN;`);
  };
  return mat;
}

// Grass is chunked on a grid so each chunk can be frustum-culled on its own.
export function buildGrass(scene) {
  grassDensity = activeMap().grassDensity ?? null;
  const rng = makeRng(77);
  const shortGeo = tuftGeometry(rng, 9, 0.5);
  const tallGeo = tuftGeometry(rng, 12, 0.55);
  const mat = grassMaterial();
  const CH = 8, CELL = (MAP_HALF * 2) / CH;
  const cells = Array.from({ length: CH * CH }, () => ({ short: [], tall: [] }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const cellOf = (x, z) => cells[Math.min(CH - 1, Math.floor((z + MAP_HALF) / CELL)) * CH + Math.min(CH - 1, Math.floor((x + MAP_HALF) / CELL))];

  // Short grass everywhere that isn't yard, road, lane or cliff.
  for (let i = 0; i < 70000; i++) {
    const x = (rng() * 2 - 1) * 360, z = (rng() * 2 - 1) * 360;
    if (keepClear(x, z)) continue;
    if (normalAt(x, z, nrm).y < 0.85) continue;
    if (fbm(x * 0.02, z * 0.02, 2) < 0.38) continue;
    if (grassDensity && rng() > grassDensity(x, z)) continue;
    const sc = 0.6 + rng() * 0.7;
    m.compose(p.set(x, heightAt(x, z) - 0.05, z), q.identity(), s.set(sc, sc, sc));
    cellOf(x, z).short.push(m.clone());
  }

  // Tall-grass patches: real cover for the stealth phase.
  const patches = [];
  const rngP = makeRng(4242);
  let attempts = 0;
  while (patches.length < 46 && attempts++ < 2000) {
    const x = (rngP() * 2 - 1) * 340, z = (rngP() * 2 - 1) * 340;
    if (keepClear(x, z, 8) && Math.hypot(x - COMPOUND.x, z - COMPOUND.z) < 58) continue;
    if (keepClear(x, z, 4)) continue;
    if (normalAt(x, z, nrm).y < 0.88) continue;
    patches.push({ x, z, r: 6 + rngP() * 9 });
  }
  // Guarantee cover on the way in (the vineyard's: on the way to the compound from the start hill).
  patches.push(...(activeMap().coverPatches ?? [{ x: -150, z: 95, r: 12 }, { x: -95, z: 40, r: 10 }, { x: -40, z: 30, r: 9 }]));
  for (const pt of patches) {
    const n = Math.floor(pt.r * pt.r * 3.2);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * pt.r;
      const x = pt.x + Math.cos(a) * r, z = pt.z + Math.sin(a) * r;
      if (keepClear(x, z)) continue;
      const sc = 1.7 + rng() * 0.8;
      m.compose(p.set(x, heightAt(x, z) - 0.05, z), q.identity(), s.set(sc, sc * (1.0 + rng() * 0.3), sc));
      cellOf(x, z).tall.push(m.clone());
    }
  }

  let total = 0;
  for (const cell of cells) {
    for (const [list, geo] of [[cell.short, shortGeo], [cell.tall, tallGeo]]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
      total += list.length;
    }
  }
  return { patches, tuftCount: total };
}

export function inTallGrass(patches, x, z) {
  return patches.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < p.r * p.r);
}

export { inPlayArea };

// Dense grass close to the camera: one instanced field in an 80 m window that wraps
// around the player (each tuft keeps a fixed world spot while it is in the window, so
// nothing pops). The shader reads terrain height and a density mask from textures.
export function buildNearGrass(scene, patches) {
  const RES = 512, SIZE = 80, COUNT = 50000;
  const heights = new Uint16Array(RES * RES), mask = new Uint8Array(RES * RES * 4);
  const nrm = new THREE.Vector3();
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const x = (i + 0.5) / RES * MAP_HALF * 2 - MAP_HALF, z = (j + 0.5) / RES * MAP_HALF * 2 - MAP_HALF;
      const k = j * RES + i;
      heights[k] = THREE.DataUtils.toHalfFloat(heightAt(x, z));
      let d = 0.55 + 0.45 * fbm(x * 0.03, z * 0.03, 2);
      if (keepClear(x, z) || !inPlayArea(x, z)) d = 0;
      if (normalAt(x, z, nrm).y < 0.82) d = 0;
      if (inTallGrass(patches, x, z)) d *= 0.3; // the tall-grass patches already cover it
      if (grassDensity) d *= grassDensity(x, z);
      mask[k * 4] = d * 255;
      mask[k * 4 + 3] = 255;
    }
  }
  const heightTex = new THREE.DataTexture(heights, RES, RES, THREE.RedFormat, THREE.HalfFloatType);
  const maskTex = new THREE.DataTexture(mask, RES, RES, THREE.RGBAFormat);
  for (const t of [heightTex, maskTex]) {
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
  }

  const rng = makeRng(808);
  const geo = tuftGeometry(rng, 7, 0.45);
  const offsets = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) offsets.set([rng() * SIZE, rng() * SIZE, 0.55 + rng() * 0.8], i * 3);
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));

  const uniforms = {
    uCenter: { value: new THREE.Vector2() }, uSize: { value: SIZE },
    uHeight: { value: heightTex }, uMask: { value: maskTex }, uHalf: { value: MAP_HALF },
  };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uTime: windUniforms.uTime, uWind: windUniforms.uWind });
    shader.vertexShader = `attribute vec3 aOffset;
      uniform vec2 uCenter; uniform float uSize; uniform float uHalf; uniform float uTime; uniform vec2 uWind;
      uniform sampler2D uHeight; uniform sampler2D uMask;\n` + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec2 rel = mod(aOffset.xy - uCenter + 0.5 * uSize, uSize) - 0.5 * uSize;
      vec2 wxz = uCenter + rel;
      vec2 tuv = (wxz + uHalf) / (2.0 * uHalf);
      float ground = texture2D(uHeight, tuv).r;
      float dens = texture2D(uMask, tuv).r;
      float hash = fract(sin(dot(aOffset.xy, vec2(12.9898, 78.233))) * 43758.5453);
      float edge = 1.0 - smoothstep(uSize * 0.32, uSize * 0.48, length(rel));
      float sc = aOffset.z * step(hash, dens) * edge;
      float hN = clamp(position.y / 0.45, 0.0, 2.0);
      float phase = uTime * 2.4 + wxz.x * 0.23 + wxz.y * 0.19;
      float gust = 0.65 + 0.35 * sin(uTime * 0.6 + wxz.x * 0.02 + wxz.y * 0.015);
      vec2 bend = uWind * 0.045 * gust * (0.7 + 0.3 * sin(phase));
      transformed *= sc;
      transformed.xz += bend * hN * hN * sc;
      transformed += vec3(wxz.x, ground - 0.04, wxz.y);`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.userData.noAO = true; // its positions only exist in this shader
  scene.add(mesh);
  return { mesh, update: (x, z) => uniforms.uCenter.value.set(x, z) };
}
