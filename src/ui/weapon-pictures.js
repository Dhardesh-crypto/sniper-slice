// Side-view pictures of the weapons for the loadout screen, rendered from the same 3D models
// the game uses (muzzle to the right), with a suppressor or muzzle brake when one is fitted.
// Rendered once each on a small offscreen canvas and kept as image URLs.
import * as THREE from 'three';
import { CATALOG } from '../weapons/defs.js';
import { rifleModel, pistolModelFor, fitMuzzle } from '../world/characters.js';
import { pistolModel } from '../player/avatar.js';

const W = 480, H = 150;
const cache = new Map();
let renderer = null, scene = null, camera = null;

function setup() {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.7;     // brighter than the game: dark steel on a dark menu
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf2ede1, 0x3a3328, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-2, 3, 1.5);
  const rim = new THREE.DirectionalLight(0xffe8c0, 1.5);     // a rim light from behind and below
  rim.position.set(1, -1, -2);
  scene.add(key, rim);
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
}

// device: 'suppressor', 'brake' or null.
export function weaponPicture(id, device = null) {
  const k = `${id}:${device ?? ''}`;
  if (cache.has(k)) return cache.get(k);
  if (!renderer) setup();
  const def = CATALOG[id];
  let gun;
  if (def.slot !== 'pistol') { gun = rifleModel(def.model); fitMuzzle(gun, device, 1); }   // rifles and heavy weapons
  else {
    gun = (id !== 'welrod' && pistolModelFor(def.model)) || pistolModel();
    if (id !== 'welrod') fitMuzzle(gun, device, -1);
    gun.rotation.y = Math.PI;                 // pistols point to -z: turn the muzzle to +z
  }
  scene.add(gun);
  gun.updateMatrixWorld(true);
  // Look from the left side (-x), so +z (the muzzle) is to the right; fit the gun in the frame.
  const box = new THREE.Box3().setFromObject(gun), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  // (pistols at a fixed scale, so they look like pistols next to the rifles, not blown up)
  const halfW = Math.max(size.z / 2, (size.y / 2) * (W / H), def.slot === 'pistol' ? 0.3 : 0) * 1.06;
  Object.assign(camera, { left: -halfW, right: halfW, top: halfW * H / W, bottom: -halfW * H / W });
  camera.updateProjectionMatrix();
  camera.position.set(c.x - 5, c.y, c.z);
  camera.lookAt(c);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(gun);
  cache.set(k, url);
  return url;
}
