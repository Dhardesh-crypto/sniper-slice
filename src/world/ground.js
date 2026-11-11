// Ground detail built in Blender (tools/blender/ground.py → models/ground_detail.glb): ferns,
// fallen needles, sawn stumps and dead branches on the forest floor; lentisk scrub, stones and
// boulders out in the open country. A map can set its own mix (`ground`: kind → count).
// Each kind is instanced per 160 m chunk and drawn only near the viewer (farther through a scope).
// Stumps and boulders are solid: you walk round them and bullets stop on them; the rest is too
// small to matter.
import * as THREE from 'three';
import { heightAt, normalAt, MAP_HALF_X, MAP_HALF_Z, keepClear, inPlayArea, activeMap, activeBiome, waterSurfaceAt } from './terrain.js';
import { fbm, makeRng } from './noise.js';
import { groundCounts, areaKm2, BIOME_KINDS } from './biomes.js';
import { makePath, pointAt } from './landforms.js';
import { modelParts } from './props.js';
import { addBrush } from './vegetation.js';
import { rockMaterial, ROCK_LOOK } from './stone.js';

const CHUNK = 160;      // m: big, or the far-reaching kinds split into dozens of tiny draws
// range: drawn within this many metres; slope: the steepest ground it sits on (normal's y);
// lie: laid along the slope rather than upright; sink: how far into the ground; clump: grows in
// patches (the noise threshold); shade: colour multiplier in the game's light.
const KINDS = {
  fern: { scale: [1.3, 2.1], noShadow: true, range: 90, slope: 0.82, clump: 0.5, shade: [0.4, 0.48, 0.34] },
  litter: { scale: [1.3, 2.4], range: 70, slope: 0.7, lie: true, shade: 0.75, flat: true },
  branch: { scale: [0.7, 1.2], range: 80, slope: 0.75, lie: true, shade: 0.45, flat: true },
  stump: { scale: [0.8, 1.25], range: 140, slope: 0.8, sink: 0.08, shade: 0.42, solid: 0.38 },
  bush: { scale: [0.9, 1.9], range: 170, slope: 0.75, clump: 0.42, shade: 0.62 },
  rock1: { scale: [0.9, 1.8], range: 150, slope: 0.55, sink: 0.12, shade: [0.5, 0.48, 0.45], tilt: true },
  rock2: { scale: [0.6, 1.4], noShadow: true, range: 90, slope: 0.55, sink: 0.08, shade: [0.5, 0.48, 0.45], tilt: true },
  rock3: { scale: [1.2, 2.2], range: 220, slope: 0.6, sink: 0.2, shade: [0.5, 0.48, 0.45], tilt: true, solid: 0.7 },
};
// The biomes' own growth (tools/blender/biome_ground.py → models/ground_biome.glb, loaded only by
// maps that use it). wet: it may stand in shallow water (reeds); the rest keep to dry ground.
// hide: metres round the plant (times its size) in which it hides you as tall grass does, crouched
// or prone (vegetation.js inBrush): cover is what the game is about, so what grows must give some.
Object.assign(KINDS, {
  gorse: { scale: [0.8, 1.5], range: 170, slope: 0.72, clump: 0.44, hide: 1.2, shade: [0.62, 0.66, 0.5] },
  heather: { scale: [0.8, 1.5], noShadow: true, range: 110, slope: 0.72, clump: 0.36, shade: [0.66, 0.6, 0.62] },
  reed: { scale: [0.8, 1.25], range: 160, slope: 0.8, wet: true, hide: 1.0, shade: [0.72, 0.72, 0.5] },
  marram: { scale: [0.8, 1.4], noShadow: true, range: 110, slope: 0.7, clump: 0.34, hide: 0.9, shade: [0.74, 0.76, 0.6] },
  juniper: { scale: [0.7, 1.4], range: 190, slope: 0.7, clump: 0.4, hide: 1.0, shade: [0.5, 0.56, 0.5] },
  scree: { scale: [0.9, 2.2], noShadow: true, range: 130, slope: 0.45, sink: 0.03, lie: true, rock: true, shade: [0.5, 0.48, 0.45] },
  hedge: { scale: [0.95, 1.15], range: 260, slope: 0, shade: [0.5, 0.58, 0.4], solid: 0.6 },   // (laid along a map's `hedges`, not scattered)
});
const OPEN = { bush: 1500, rock1: 450, rock2: 1400, rock3: 110 };
const HEDGE_LEN = 4;     // m: one section of hedge (its model's length)
let rockMat = null;

export function buildGround(scene, { boxes = [], water = null }) {
  const shades = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.shade]));
  const parts = modelParts('groundDetail', shades);
  if (!parts) return { chunks: [], solids: [], trees: [] };
  Object.assign(parts, modelParts('groundBiome', shades) ?? {});   // (the biomes' kinds, if this map loaded them)
  // What lies on this map: its own mix, or its biome's (per km², with where each kind grows), or
  // the open country's. A biome's entry is a count or { n, where(at) } (biomes.js).
  const B = activeBiome(), biomeMix = !activeMap().ground && B?.ground, km2 = areaKm2(activeMap());
  const counts = groundCounts(activeMap()) ?? OPEN;
  const bodies = activeMap().waters?.length ? waterSurfaceAt : null;
  const at = { x: 0, z: 0, y: 0, up: 1, slope: 0, water: null, sea: water, o: B?.o ?? null };
  // The site's blocks by 16 m cell, to keep stones out of houses and off the quay.
  const grid = new Map(), cell = (x, z) => `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
  for (const b of boxes) {
    for (let x = Math.floor(b.min.x / 16); x <= Math.floor(b.max.x / 16); x++)
      for (let z = Math.floor(b.min.z / 16); z <= Math.floor(b.max.z / 16); z++) {
        const k = `${x},${z}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(b);
      }
  }
  const blocked = (x, z, r) => (grid.get(cell(x, z)) ?? []).some(b => x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r);

  const rng = makeRng(2024), chunks = new Map(), solids = [], trees = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), tilt = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();
  const mix = Object.entries(counts).filter(([kind]) => kind !== 'hedge');
  for (const [kind, entry] of mix) {
    const K = KINDS[kind], part = parts[kind];
    const mat = kind.startsWith('rock') || K?.rock ? (rockMat ??= rockMaterial(ROCK_LOOK)) : part?.material;   // (stones: stone.js)
    const where = typeof entry === 'object' ? entry.where : null;
    const count = Math.round((typeof entry === 'object' ? entry.n : entry) * (biomeMix ? km2 : 1));
    if (!K || !part || !count) continue;
    const byChunk = new Map();
    let placed = 0, tries = 0;
    while (placed < count && tries++ < count * 30) {
      const x = (rng() * 2 - 1) * (MAP_HALF_X - 8), z = (rng() * 2 - 1) * (MAP_HALF_Z - 8);
      if (!inPlayArea(x, z) || (K.wet ? false : keepClear(x, z, 1.5))) continue;
      if (K.clump && fbm(x * 0.03 + kind.length * 7, z * 0.03, 2) < K.clump) continue;
      const y = heightAt(x, z);
      if (water != null && y < water + 0.4) continue;
      const surf = bodies ? bodies(x, z) : null;
      if (surf != null && (K.wet ? y < surf - 0.6 : y < surf + 0.15)) continue;   // (not under a pond; reeds up to their knees)
      normalAt(x, z, nrm);
      if (nrm.y < K.slope) continue;
      if (where) { at.x = x; at.z = z; at.y = y; at.up = nrm.y; at.slope = 1 - nrm.y; at.water = surf; if (!where(at)) continue; }
      if (blocked(x, z, 1.5)) continue;
      const sc = K.scale[0] + rng() * (K.scale[1] - K.scale[0]);
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      // Laid along the slope (litter, branches), or tipped a little (stones); upright otherwise.
      if (K.lie || K.tilt) {
        tilt.setFromUnitVectors(up, K.lie ? nrm : nrm.clone().lerp(new THREE.Vector3(rng() - 0.5, 1, rng() - 0.5).normalize(), 0.5).normalize());
        q.premultiply(tilt);
      }
      m.compose(p.set(x, y - (K.sink ?? 0) * sc + (K.flat ? 0.02 : 0), z), q, s.set(sc, K.flat ? 1 : sc, sc));
      const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      if (!byChunk.has(k)) byChunk.set(k, []);
      byChunk.get(k).push(m.clone());
      if (K.solid) trees.push({ x, z, r: K.solid * sc });
      if (K.hide) addBrush(x, z, K.hide * sc);
      placed++;
    }
    add(kind, K, part, mat, byChunk);
  }
  // Hedges: a map's `hedges` (polylines), a section every 4 m along each, turned to run with it
  // and set on the ground under its middle. Solid to walk into (three posts a section) and to bullets.
  if (activeMap().hedges?.length && parts.hedge) {
    const K = KINDS.hedge, byChunk = new Map();
    for (const line of activeMap().hedges) {
      const P = makePath(line), n = Math.max(1, Math.round(P.length / HEDGE_LEN));
      for (let i = 0; i < n; i++) {
        const c = pointAt(P, (i + 0.5) / n * P.length);
        if (keepClear(c.x, c.z, 0.5) || blocked(c.x, c.z, 1)) continue;        // (a gap where a road or a yard crosses it)
        const sc = K.scale[0] + rng() * (K.scale[1] - K.scale[0]);
        q.setFromAxisAngle(up, Math.atan2(-c.dz, c.dx));
        m.compose(p.set(c.x, heightAt(c.x, c.z) - 0.1, c.z), q, s.set(P.length / n / HEDGE_LEN * 1.04, sc, sc));
        const k = `${Math.floor(c.x / CHUNK)},${Math.floor(c.z / CHUNK)}`;
        if (!byChunk.has(k)) byChunk.set(k, []);
        byChunk.get(k).push(m.clone());
        for (const o of [-1.3, 0, 1.3]) { trees.push({ x: c.x + c.dx * o, z: c.z + c.dz * o, r: K.solid }); addBrush(c.x + c.dx * o, c.z + c.dz * o, 1.9); }   // (hidden crouched close against it, either side)
      }
    }
    add('hedge', K, parts.hedge, parts.hedge.material, byChunk);
  }
  return { chunks: [...chunks.values()], solids, trees };

  // One kind's instances, a mesh per chunk.
  function add(kind, K, part, mat, byChunk) {
    for (const [k, list] of byChunk) {
      const im = new THREE.InstancedMesh(part.geometry, mat, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = !K.flat && !K.noShadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
      if (K.solid) solids.push(im);
      const [cx, cz] = k.split(',').map(Number);
      if (!chunks.has(k)) chunks.set(k, { x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK, meshes: [] });
      chunks.get(k).meshes.push({ mesh: im, range: K.range });
    }
  }
}

// Draw each chunk's detail only within its kind's range of the viewer (`zoom`: a scope's magnification).
export function cullGround(chunks, viewer, zoom = 1) {
  const z = Math.min(zoom, 4);
  for (const c of chunks) {
    const dx = Math.max(0, Math.abs(c.x - viewer.x) - CHUNK / 2), dz = Math.max(0, Math.abs(c.z - viewer.z) - CHUNK / 2);
    const d2 = dx * dx + dz * dz;
    for (const e of c.meshes) e.mesh.visible = d2 < (e.range * z) ** 2;
  }
}
