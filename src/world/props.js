// Modelled props for the missions' key elements (Higgsfield: a reference picture, lifted to a
// textured mesh by Tripo): locomotives and wagons, the supply ship, cranes, guns, the hunting
// stands, the safe… Each mission names the ones it uses (`props` in its module) and they load
// before its site is built; a site that finds one missing keeps its box-built stand-in.
//
// propModel() returns a copy laid along x (its front toward −x, the way trains and columns run),
// sitting on y = 0, centred on its footprint and scaled into the space the game gives it, so it
// can stand in for the collision blocks that are already there.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assets } from './characters.js';

// file: in public/models; turn: quarter turns (about y) that lay its length along x with the
// front toward −x (measured from each mesh; see the comments).
export const PROPS = {
  safe: { file: 'prop_safe', turn: 3 },               // door turned from +x to +z
  locomotive: { file: 'prop_locomotive', turn: 2 },        // smokebox was at +x
  railgun: { file: 'prop_railgun', turn: 3 },              // muzzle was at +z
  boxcar: { file: 'prop_boxcar', turn: 1 },
  boxcarGrey: { file: 'prop_boxcar_grey', turn: 0 },
  coach: { file: 'prop_coach', turn: 1 },
  flakWagon: { file: 'prop_flak_wagon', turn: 1 },
  waterTower: { file: 'prop_water_tower', turn: 0 },
  ship: { file: 'prop_ship', turn: 1 },
  crane: { file: 'prop_crane', turn: 0 },
  flak: { file: 'prop_flak', turn: 0 },
  eboat: { file: 'prop_eboat', turn: 1 },
  fuelTank: { file: 'prop_fuel_tank', turn: 0 },
  huntingStand: { file: 'prop_hunting_stand', turn: 3 },   // ladder turned from +x to +z (south)
  drums: { file: 'prop_drums', turn: 0 },
  logs: { file: 'prop_logs', turn: 1 },
  sawBench: { file: 'prop_saw_bench', turn: 1 },
  generator: { file: 'prop_generator', turn: 0 },
  siren: { file: 'prop_siren', turn: 3 },             // horn turned from −z to +x
  fountain: { file: 'prop_fountain', turn: 0 },
  mgNest: { file: 'prop_mg_nest', turn: 0 },
  crates: { file: 'prop_crates', turn: 0 },
  watchtower: { file: 'prop_watchtower', turn: 0 },
  stoneBridge: { file: 'prop_stone_bridge', turn: 1 },
  tiger: { file: 'prop_tiger', turn: 2 },              // gun was toward +x
  halftrack: { file: 'prop_halftrack', turn: 3 },         // nose was toward +z
  tent: { file: 'prop_tent', turn: 0 },
  pontoons: { file: 'prop_pontoons', turn: 0 },
  sentryBox: { file: 'prop_sentry_box', turn: 0 },
  bf110: { file: 'prop_bf110', turn: 3 },               // nose was toward +z
  ju88: { file: 'prop_ju88', turn: 3 },
  radar: { file: 'prop_radar', turn: 0 },
  hangar: { file: 'prop_hangar', turn: 1 },              // its doors were at +x: now at −z
  bowser: { file: 'prop_bowser', turn: 1 },
  searchlight: { file: 'prop_searchlight', turn: 0 },
  freya: { file: 'prop_freya', turn: 0 },
  casemate: { file: 'prop_casemate', turn: 1 },           // gun was toward +x: now −z (its door then faces +x)
  lighthouse: { file: 'prop_lighthouse', turn: 0 },
  hedgehog: { file: 'prop_hedgehog', turn: 0 },
  tobruk: { file: 'prop_tobruk', turn: 0 },
};

export async function loadProps(keys, onProgress = () => {}) {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all([...new Set(keys)].filter(k => PROPS[k] && !assets.models[k]).map(async (k) => {
    try { assets.models[k] = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${PROPS[k].file}.glb`); }
    catch (e) { console.warn(`prop ${k} missing`, e); }
    onProgress(++done / keys.length);
  }));
}

export const hasProp = (k) => !!assets.models[k];

// A copy of prop `k` fitted into `size` ({ x, y, z } in metres; give one for a uniform scale, or
// several with stretch: true to fill a box exactly). own: its own materials (a wreck blackens it).
// bright: multiplies its colour (for a texture that came out too dark).
export function propModel(k, size, { stretch = false, own = false, turn = 0, bright = 1 } = {}) {
  const outer = new THREE.Group();
  const src = assets.models[k]?.scene;
  if (!src) return null;
  const inner = src.clone(true);
  const meshes = [];
  inner.traverse(o => {
    if (!o.isMesh) return;
    if (own || bright !== 1) o.material = o.material.clone();
    if (bright !== 1) o.material.color.multiplyScalar(bright);      // (a dark texture lifted)
    if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
    o.material.envMapIntensity = 0.6;
    o.castShadow = o.receiveShadow = true;
    meshes.push(o);
  });
  const spin = new THREE.Group();
  spin.add(inner);
  spin.rotation.y = ((PROPS[k].turn ?? 0) + turn) * Math.PI / 2;
  spin.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(spin), dim = bb.getSize(new THREE.Vector3());
  const given = ['x', 'y', 'z'].filter(a => size[a]);
  const uni = Math.min(...given.map(a => size[a] / dim[a]));
  const s = new THREE.Vector3(...['x', 'y', 'z'].map(a => (stretch && size[a] ? size[a] / dim[a] : uni)));
  const place = new THREE.Group();
  place.add(spin);
  spin.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  place.scale.copy(s);
  outer.add(place);
  outer.userData.meshes = meshes;
  return outer;
}

// The pieces several maps share: the alarm siren and the generator get their models (their
// blocks stay as the weak spots you shoot, undrawn). The siren rides on its horn block, so a
// hit still knocks it askew.
export function dressSite(world) {
  const off = new THREE.MeshBasicMaterial({ visible: false });
  const siren = world.siren;
  if (siren && hasProp('siren')) {
    const [horn, ...rest] = siren.hornMeshes;
    const m = propModel('siren', { y: 0.85 });
    m.position.set(-0.17, -0.42, 0);
    horn.add(m);
    for (const h of [horn, ...rest]) h.material = off;
  }
  const gen = world.generatorMesh;
  if (gen && hasProp('generator')) {
    gen.geometry.computeBoundingBox();
    const size = gen.geometry.boundingBox.getSize(new THREE.Vector3());
    const m = propModel('generator', { x: size.x * 1.25, z: size.z * 1.25 }, { stretch: true });
    m.position.set(0, -size.y / 2, 0);
    gen.add(m);
    gen.material = off;
  }
}

// Cut a placed prop off above world height `y`: its triangles reaching higher are dropped (a new
// index over the same vertices). For the watchtowers and hunting stands: a generated cabin is solid
// where the picture showed openings, which would hide the guard inside; above its railing the
// plain posts and roof take over. (The prop must already be placed; it turns only about y.)
export function clipAbove(model, y) {
  model.updateMatrixWorld(true);
  for (const m of model.userData.meshes) {
    const inv = m.matrixWorld.clone().invert();
    const cut = new THREE.Vector3(0, y, 0).applyMatrix4(inv).y;    // the height in the mesh's own units
    const g = m.geometry, pos = g.attributes.position;
    const idx = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
    const keep = [];
    for (let t = 0; t < idx.length; t += 3) {
      if (pos.getY(idx[t]) <= cut && pos.getY(idx[t + 1]) <= cut && pos.getY(idx[t + 2]) <= cut) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    const cutGeo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) cutGeo.setAttribute(name, attr);
    cutGeo.setIndex(keep);
    m.geometry = cutGeo;
    m.material = m.material.clone();
    m.material.side = THREE.DoubleSide;           // (the cut shows the inside of the walls)
  }
}

// Split a placed prop into pieces that can move apart (a bridge's spans and piers): each
// triangle goes to the piece `classify(centroid)` names (null: dropped). Returns { name: mesh },
// each mesh in world coordinates with its own material, not yet added anywhere.
export function splitProp(model, classify) {
  model.updateMatrixWorld(true);
  const lists = new Map(), out = {};
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const m of model.userData.meshes) {
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld), pos = g.attributes.position;
    const idx = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
    for (let t = 0; t < idx.length; t += 3) {
      a.fromBufferAttribute(pos, idx[t]); b.fromBufferAttribute(pos, idx[t + 1]); c.fromBufferAttribute(pos, idx[t + 2]);
      const key = classify(a.add(b).add(c).divideScalar(3));
      if (key == null) continue;
      if (!lists.has(key)) lists.set(key, { g, mat: m.material, idx: [] });
      lists.get(key).idx.push(idx[t], idx[t + 1], idx[t + 2]);
    }
  }
  for (const [key, { g, mat, idx }] of lists) {
    const piece = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) piece.setAttribute(name, attr);
    piece.setIndex(idx);
    piece.computeBoundingSphere();
    const mesh = new THREE.Mesh(piece, mat.clone());
    mesh.castShadow = mesh.receiveShadow = true;
    out[key] = mesh;
  }
  return out;
}
