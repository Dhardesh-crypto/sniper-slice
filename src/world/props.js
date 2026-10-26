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
  sandbags: { file: 'prop_sandbags', turn: 1 },
  wire: { file: 'prop_wire', turn: 0 },
  pole: { file: 'prop_pole', turn: 0 },
  signpost: { file: 'prop_signpost', turn: 0 },
  barrels: { file: 'prop_barrels', turn: 1 },
  cart: { file: 'prop_cart', turn: 1 },
  haystack: { file: 'prop_haystack', turn: 0 },
  well: { file: 'prop_well', turn: 0 },
  motorcycle: { file: 'prop_motorcycle', turn: 1 },
  pak40: { file: 'prop_pak40', turn: 2 },
  kitchen: { file: 'prop_kitchen', turn: 1 },
  supplies: { file: 'prop_supplies', turn: 0 },
  fishingBoat: { file: 'prop_fishing_boat', turn: 0 },
  // The realism pass: vegetation (the vineyard's rows, cypresses, umbrella pines, rocks) and burnt-out wrecks.
  // (Leafy crowns don't come out of image-to-3D: the olives and oaks stay the drawn leaf-card trees.)
  vineRow: { file: 'prop_vine_row', turn: 1 }, cypress: { file: 'tree_cypress', turn: 0 }, pine: { file: 'tree_pine', turn: 0 }, rock: { file: 'prop_rock', turn: 0 },
  wreckPanzer: { file: 'wreck_panzer', turn: 3 }, wreckTiger: { file: 'wreck_tiger', turn: 2 }, wreckTruck: { file: 'wreck_truck', turn: 3 },
  wreckCar: { file: 'wreck_car', turn: 3 }, wreckHalftrack: { file: 'wreck_halftrack', turn: 3 },
  wreckPlane: { file: 'wreck_plane', turn: 0 },
  // Signature props per mission, furniture for the interiors, animals.
  marketStall: { file: 'prop_market_stall', turn: 0 }, cafeSet: { file: 'prop_cafe_set', turn: 0 }, fiat: { file: 'prop_fiat', turn: 2 },
  rowboat: { file: 'prop_rowboat', turn: 0 }, cargoPallet: { file: 'prop_cargo_pallet', turn: 0 }, felledTree: { file: 'prop_felled_tree', turn: 0 },
  handcar: { file: 'prop_handcar', turn: 0 }, waterCrane: { file: 'prop_water_crane', turn: 0 }, bombTrolley: { file: 'prop_bomb_trolley', turn: 0 },
  kettenkrad: { file: 'prop_kettenkrad', turn: 3 }, fuelTrailer: { file: 'prop_fuel_trailer', turn: 3 }, wurzburg: { file: 'prop_wurzburg', turn: 0 },
  assaultBoat: { file: 'prop_assault_boat', turn: 0 }, pontoonSection: { file: 'prop_pontoon_section', turn: 0 },
  desk: { file: 'prop_desk', turn: 0 }, mapTable: { file: 'prop_map_table', turn: 0 }, radioSet: { file: 'prop_radio_set', turn: 0 },
  bunk: { file: 'prop_bunk', turn: 0 }, locker: { file: 'prop_locker', turn: 0 }, stove: { file: 'prop_stove', turn: 0 },
  filingCabinet: { file: 'prop_filing_cabinet', turn: 0 }, tableSet: { file: 'prop_table_set', turn: 0 }, horseCart: { file: 'prop_horse_cart', turn: 1 },
  cow: { file: 'animal_cow', turn: 1 }, horse: { file: 'animal_horse', turn: 3 }, goat: { file: 'animal_goat', turn: 1 }, deer: { file: 'animal_deer', turn: 1 },
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
  outer.userData.propKey = k;
  outer.userData.dims = dim.clone().multiply(s);   // its size as placed (metres, along its own axes)
  return outer;
}

// A prop as one geometry with its fitting baked in (base at the origin, sized like propModel)
// and its material: for drawing it many times over as instances (the trees). null if not loaded.
export function propGeometry(k, size, stretch = false) {
  const model = propModel(k, size, { stretch });
  if (!model) return null;
  model.updateMatrixWorld(true);
  const mesh = model.userData.meshes[0];
  return { geometry: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), material: mesh.material };
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

// ---- set dressing ----
// Size (metres; one axis = uniform scale) and collision block for the props used as scenery.
// block: [w, h, d] of the block that stops you and bullets (or null: you walk through it, like a
// pole's base is too thin to matter); wire stops you but not bullets.
const DRESS = {
  sandbags: { size: { x: 4, y: 1.2, z: 0.9 }, block: [4, 1.1, 0.9] },
  wire: { size: { x: 5, y: 1.2, z: 1.2 }, block: [5, 1.2, 1.2], bullets: false },
  pole: { size: { y: 8 }, block: [0.3, 8, 0.3] },
  signpost: { size: { y: 3.2 }, block: null },
  barrels: { size: { x: 3.2, y: 1.8, z: 2.0 }, block: [3, 1.6, 1.8] },
  cart: { size: { x: 4.4, y: 1.7, z: 1.7 }, block: [2.2, 1.3, 1.6] },
  haystack: { size: { y: 4.2 }, block: [3.2, 3.6, 3.2] },
  well: { size: { y: 3 }, block: [1.8, 0.9, 1.8] },
  motorcycle: { size: { x: 2.4, y: 1.15, z: 1.7 }, block: [2.2, 1.0, 1.6] },
  pak40: { size: { x: 6, y: 1.9, z: 2.2 }, block: [2.2, 1.4, 2.1] },
  kitchen: { size: { x: 4.2, y: 2.3, z: 1.9 }, block: [3, 1.8, 1.8] },
  supplies: { size: { x: 1.5, y: 1.3, z: 1.2 }, block: [1.4, 1.2, 1.1] },
  fishingBoat: { size: { x: 6, y: 1.5, z: 2.2 }, block: [5.5, 1.0, 2.0] },
  tent: { size: { x: 3.6, y: 2.4, z: 4.6 }, block: [3.4, 1.0, 4.4] },
  sentryBox: { size: { x: 1.8, y: 2.9, z: 1.8 }, block: [1.7, 2.6, 1.7] },
  mgNest: { size: { x: 5, y: 1.2, z: 5 }, block: null },
  searchlight: { size: { y: 2.6 }, block: [1.6, 1.4, 1.6] },
  drums: { size: { x: 2.1, y: 1.85, z: 1.45 }, block: [2.0, 1.8, 1.4], bright: 1.9 },
  crates: { size: { x: 1.7, y: 1.64, z: 0.95 }, block: [1.6, 1.6, 0.9] },
  pontoons: { size: { x: 6, y: 1.5, z: 2.2 }, block: [6, 1.4, 2.2] },
  hedgehog: { size: { x: 2.2, y: 1.6, z: 2.2 }, block: null },
  tobruk: { size: { x: 4.5, y: 1.6, z: 4.5 }, block: [3.2, 0.9, 3.2] },
  logs: { size: { x: 8.4, y: 2.2, z: 3.2 }, block: [8, 2.1, 3] },
  bowser: { size: { x: 6.6, y: 2.7, z: 2.4 }, block: [6.2, 2.4, 2.3] },
  halftrack: { size: { x: 5.8, y: 2.0, z: 2.1 }, block: [5.6, 1.9, 2.0] },
  tiger: { size: { x: 6.6, y: 3.0, z: 3.6 }, block: [6.4, 2.6, 3.4] },
  // The realism pass's signature props.
  marketStall: { size: { x: 3.2 }, block: [3.0, 2.2, 1.6] }, cafeSet: { size: { x: 1.8 }, block: null },
  fiat: { size: { x: 3.2 }, block: [3.1, 1.4, 1.4] }, rowboat: { size: { x: 4.5 }, block: [4.3, 0.8, 1.5] },
  cargoPallet: { size: { x: 1.8 }, block: [1.6, 1.4, 1.4] }, felledTree: { size: { x: 10 }, block: [9, 0.9, 1.0] },
  handcar: { size: { x: 2.4 }, block: [2.2, 1.2, 1.5] }, waterCrane: { size: { y: 4.5 }, block: [0.8, 4.5, 0.8] },
  bombTrolley: { size: { x: 3.4 }, block: [3.2, 1.2, 1.6] }, kettenkrad: { size: { x: 3 }, block: [2.8, 1.2, 1.1] },
  fuelTrailer: { size: { x: 4 }, block: [3.6, 1.8, 1.8] }, wurzburg: { size: { y: 6 }, block: [3, 6, 3] },
  assaultBoat: { size: { x: 6 }, block: [5.8, 0.9, 1.6] }, pontoonSection: { size: { x: 7 }, block: [6.8, 1.2, 3.4] },
  horseCart: { size: { x: 6 }, block: [5.5, 2.2, 1.8] }, rock: { size: { x: 2.2 }, block: [2.0, 1.3, 1.8] },
  stove: { size: { y: 2.2 }, block: [0.8, 1.0, 0.8] },
  truck: { vehicle: 'truck', block: [6, 2.4, 2.3] },
  car: { vehicle: 'car', block: [3.6, 1.5, 1.6] },
};
export const DRESS_KEYS = Object.keys(DRESS).filter(k => !DRESS[k].vehicle);

// Place set dressing: items are [key, x, z, rotY = 0]. Each stands on the ground (heightAt) with
// its block; one whose block would overlap a building or another block (`avoid`) is left out, so
// nothing ends up inside a wall or across a doorway. Returns the meshes for bullets and the boxes.
export function dressProps(scene, items, heightAt, avoid = [], vehicleModel = null) {
  const group = new THREE.Group(), solids = [], boxes = [], hidden = new THREE.MeshBasicMaterial({ visible: false });
  scene.add(group);
  for (const [key, x, z, rotY = 0] of items) {
    const spec = DRESS[key];
    if (!spec) continue;
    const model = spec.vehicle ? vehicleModel?.(spec.vehicle) : propModel(key, spec.size, { stretch: Object.keys(spec.size).length > 1, bright: spec.bright ?? 1 });
    if (!model) continue;
    const y = heightAt(x, z);
    // (blocks are axis-aligned: swap their footprint when the prop is turned across)
    const across = Math.abs(Math.sin(rotY)) > 0.7;
    const [w, h, d] = spec.block ?? [0.01, 0.01, 0.01];
    const [bw, bd] = across ? [d, w] : [w, d];
    const box = new THREE.Box3(new THREE.Vector3(x - bw / 2, y, z - bd / 2), new THREE.Vector3(x + bw / 2, y + h, z + bd / 2));
    if (spec.block && [...avoid, ...boxes].some(b => b.intersectsBox(box))) continue;
    model.position.set(x, y, z);
    model.rotation.y = rotY;
    group.add(model);
    if (!spec.block) continue;
    boxes.push(box);
    if (spec.bullets === false) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, h, bd), hidden);
    m.position.set(x, y + h / 2, z);
    group.add(m);
    m.updateMatrixWorld(true);
    solids.push(m);
  }
  return { solids, boxes, group };
}
