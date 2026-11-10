// Skins: a building's outside, textured whole (StableGen in Blender: generated views projected
// onto it and baked, tools/skins/), laid over the code-built walls. Only the faces seen from
// outside are in it, at exactly the walls' places; drawn a hair in front of them, so the skin
// shows and the walls underneath still do everything else (collision, bullets, the inside, the
// doors). A skin that doesn't load leaves the building as it was.
import { loadGLB } from './gltf.js';
import { built } from './buildings.js';
import { normalizeModel } from './materials.js';
import { asset } from '../core/version.js';

// The buildings that have one, by mission and the building's centre (x_z): public/models/skin_<that>.glb.
export const SKINNED = new Set([
  'airfield/-150_170', 'airfield/40_112',
  'bridge/-140_58',
  'forest/-10_190', 'forest/-120_75', 'forest/95_-45',
  'harbour/-140_30', 'harbour/-40_30', 'harbour/0_25',
  'radar/-30_30', 'radar/60_70',
  'railway/0_-16', 'railway/60_26', 'railway/78_-11',
  'town/-114_165', 'town/104_-8', 'town/55_-112', 'town/80_-33', 'town/80_-87',
  'vineyard/28_-38',
]);

// Every walk-in building of the mission that has a skin gets it (call once the world is built).
// Returns a promise for when they're all in the scene (main.js waits for it before warming up
// the shaders and textures: a skin arriving mid-play uploaded its big texture as you looked at it).
export function skinBuildings(scene, mission) {
  const jobs = [];
  for (const b of built) {
    const key = `${mission}/${Math.round(b.x)}_${Math.round(b.z)}`;
    if (SKINNED.has(key)) jobs.push(addSkin(scene, `skin_${key.replace('/', '_')}`, b.x, b.y, b.z));
  }
  return Promise.all(jobs);
}

export function addSkin(scene, file, x, y, z) {
  return loadGLB(asset(`models/${file}.glb`)).then(({ scene: skin }) => {
    normalizeModel(skin, file, 'skin');           // (matte, its brightness fix, the sky's share: materials.js)
    skin.position.set(x, y, z);
    skin.traverse(o => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      o.castShadow = false;                       // (the walls cast it)
      o.material.polygonOffset = true;            // (wins over the wall face it sits on)
      o.material.polygonOffsetFactor = o.material.polygonOffsetUnits = -2;
    });
    scene.add(skin);
  }, () => {});
}
