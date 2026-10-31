// Skins: a building's outside, textured whole (StableGen in Blender: generated views projected
// onto it and baked, tools/skins/), laid over the code-built walls. Only the faces seen from
// outside are in it, at exactly the walls' places; drawn a hair in front of them, so the skin
// shows and the walls underneath still do everything else (collision, bullets, the inside, the
// doors). A skin that doesn't load leaves the building as it was.
import { loadGLB } from './gltf.js';

export function addSkin(scene, file, x, y, z) {
  loadGLB(`${import.meta.env.BASE_URL}models/${file}.glb`).then(({ scene: skin }) => {
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
