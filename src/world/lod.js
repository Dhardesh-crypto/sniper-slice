// Detail levels for the people: far away, a character is drawn (and casts its shadow) with a
// simplified copy of its mesh, made once per model with meshoptimizer when the game starts. The
// copies share the full mesh's vertices (only the triangle list is new), so the skinning, the
// texture and the bones stay exactly the same; only fewer triangles are drawn.
// The level follows how big the character is on screen, not just its distance: through the
// scope (a narrow view) a guard 300 m away is as big as one 20 m away and gets the full mesh.
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';

export const lodReady = MeshoptSimplifier.ready;

const LEVELS = [0.3, 0.1];          // share of the triangles kept at level 1, 2
const BANDS = [25, 70];             // from this "distance at the normal view" (m), level 1, 2
const BASE_FOV = 68;                // a usual field of view (the bands are for it)
const HYST = 0.1;                   // ±10% around a band, so a level doesn't flicker on its edge

const made = new WeakMap();         // full geometry → [full, level 1, level 2]
const meshes = new Map();           // skinned mesh → { lods, lod } (not in userData: a clone would JSON-copy it)

function levelsOf(geo) {
  if (made.has(geo)) return made.get(geo);
  const out = [geo];
  if (MeshoptSimplifier.supported && geo.index) {
    const pos = geo.attributes.position, p = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { p[3 * i] = pos.getX(i); p[3 * i + 1] = pos.getY(i); p[3 * i + 2] = pos.getZ(i); }
    const uv = geo.attributes.uv, a = new Float32Array(pos.count * 2);
    if (uv) for (let i = 0; i < pos.count; i++) { a[2 * i] = uv.getX(i); a[2 * i + 1] = uv.getY(i); }
    const idx = new Uint32Array(geo.index.array);
    for (const keep of LEVELS) {
      const target = Math.floor(idx.length * keep / 3) * 3;
      // Meshy's UV seams are everywhere, so it may close them (Permissive); weighing the UVs
      // keeps it from smearing the texture across them (a pale stripe down the coat otherwise).
      const [tris] = MeshoptSimplifier.simplifyWithAttributes(idx, p, 3, a, 2, [0.5, 0.5], null, target, 1, ['Permissive']);
      const lod = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(geo.attributes)) lod.setAttribute(name, attr);   // (shared, not copied)
      lod.setIndex(new THREE.BufferAttribute(tris, 1));
      lod.groups = [];
      lod.boundingSphere = geo.boundingSphere; lod.boundingBox = geo.boundingBox;
      out.push(lod);
    }
  }
  made.set(geo, out);
  return out;
}

// A character's skinned meshes start switching (call once its model is set up).
export function addLods(model) {
  model.traverse(o => {
    if (!o.isSkinnedMesh) return;
    meshes.set(o, { lods: levelsOf(o.geometry), lod: 0 });
  });
}

// The full-detail geometry of a mesh, whatever level it is drawn at now (anatomy.js's X-ray copy).
export const fullGeometry = (o) => meshes.get(o)?.lods[0] ?? o.geometry;

const v = new THREE.Vector3(), c = new THREE.Vector3();

// Pick every character's level for this camera (scene.onBeforeRender: every camera that draws
// the world, the kill cam's included, gets the right one before anything is drawn).
export function updateLods(camera) {
  camera.getWorldPosition(c);
  const k = Math.tan(THREE.MathUtils.degToRad(camera.fov ?? BASE_FOV) / 2) / Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2);
  for (const [o, m] of meshes) {
    const d = o.getWorldPosition(v).distanceTo(c) * k;
    let l = m.lod;
    while (l < BANDS.length && d > BANDS[l] * (1 + HYST)) l++;
    while (l > 0 && d < BANDS[l - 1] * (1 - HYST)) l--;
    l = Math.min(l, m.lods.length - 1);
    if (l !== m.lod) { m.lod = l; o.geometry = m.lods[l]; }
  }
}
