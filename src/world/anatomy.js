// The inside of a soldier, for the X-ray kill cam: a skeleton, the vital organs and a
// translucent "ghost" of the body. Everything lives on render layer 1, so it is only
// drawn in the kill cam's X-ray pass. Parts hang off the soldier's bone-attached hit
// frames (local y along the bone, z forward, x to the soldier's left), so they follow
// the animated body in any pose. The bones and organs are modelled in Blender
// (tools/blender/anatomy.py → anatomy.glb); until that has loaded, simple shapes stand in.
import * as THREE from 'three';
import { assets } from './characters.js';

export const XRAY_LAYER = 1;

const BONE = new THREE.MeshStandardMaterial({ color: 0xded6c1, roughness: 0.6, emissive: 0x15140f, fog: false });
const ORGAN = {
  brain: 0xd99a95, heart: 0xb3201c, lung: 0xd47c78, liver: 0x6e2016,
  stomach: 0xc4806e, kidney: 0x7c2a22, gut: 0xc98c7c,
};

// Fresnel ghost on the real skinned mesh: bright at grazing angles, clear face-on.
const GHOST = new THREE.MeshStandardMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
});
GHOST.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
    float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0);
    gl_FragColor = vec4(vec3(0.62, 0.83, 1.0), 0.05 + 0.6 * fres);`);
};

// The modelled parts by name (geometry as modelled, in metres), or null if not loaded.
let KIT;
function kit() {
  if (KIT !== undefined) return KIT;
  const src = assets.models.anatomy?.scene;
  if (!src) return null;
  src.updateMatrixWorld(true);
  KIT = {};
  src.traverse(o => { if (o.isMesh) KIT[o.name] = o.geometry.clone().applyMatrix4(o.matrixWorld); });
  return KIT;
}
// A copy of a modelled organ centred on its bounds and scaled to fit a sphere of radius r.
function organGeo(name, r) {
  const g = kit()?.[name]?.clone();
  if (!g) return null;
  g.computeBoundingSphere();
  const { center, radius } = g.boundingSphere;
  return g.translate(-center.x, -center.y, -center.z).scale(r / radius, r / radius, r / radius);
}

function onLayer(mesh) {
  mesh.layers.set(XRAY_LAYER);
  mesh.castShadow = mesh.receiveShadow = false;
  return mesh;
}

export function buildXray(soldier) {
  if (soldier.xray) return soldier.xray;
  const f = soldier.frames;
  const bones = [], organs = [], extras = [];
  const ty = (f.torso?.userData.length ?? 0.5) / 0.5; // stretch the torso layout to this body

  const K = kit();
  // A bone: the modelled part `model` (placed at (x, y, z), scaled by `size`), or the stand-in `geo`.
  const bone = (frame, name, geo, x, y, z, r, rot, model = null) => {
    if (!frame) return;
    const own = K && model && K[model.part];
    const m = onLayer(new THREE.Mesh(own ? K[model.part].clone() : geo, BONE));
    if (own) {
      const [mx, my, mz] = model.at ?? [x, y, z];
      m.position.set(mx, my, mz);
      m.scale.set(...(model.size ?? [1, 1, 1]));
      if (model.rot) m.rotation.set(...model.rot);
    } else {
      m.position.set(x, y, z);
      if (rot) m.rotation.set(...rot);
    }
    frame.add(m);
    bones.push({ name, mesh: m, r });
  };
  // An organ: the modelled one fitted to its sphere (mirrored on the body's right where it isn't
  // symmetrical), or a stand-in ellipsoid.
  const organ = (frame, name, key, r, x, y, z, scale = [1, 1, 1], model = null) => {
    if (!frame) return;
    const mat = new THREE.MeshStandardMaterial({ color: ORGAN[key], roughness: 0.45, emissive: new THREE.Color(ORGAN[key]).multiplyScalar(0.25), fog: false });
    const geo = model && organGeo(model, r * (model === 'lung' ? 1.1 : Math.max(...scale)));   // (the lungs stay inside the ribs)
    const m = onLayer(new THREE.Mesh(geo ?? new THREE.SphereGeometry(r, 14, 10), mat));
    m.position.set(x, y, z);
    if (geo) m.scale.set(x < 0 && ['lung', 'kidney'].includes(model) ? -1 : 1, 1, 1);
    else m.scale.set(...scale);
    frame.add(m);
    organs.push({ name, mesh: m, r: r * Math.max(...scale) });
  };

  // Head
  bone(f.head, 'skull', new THREE.SphereGeometry(0.096, 14, 10), 0, 0.05, 0.0, 0.1, null, { part: 'skull' });
  bone(f.head, 'jaw', new THREE.BoxGeometry(0.1, 0.035, 0.08), 0, -0.05, 0.035, 0.05, null, { part: 'jaw', at: [0, -0.024, 0.012] });
  organ(f.head, 'brain', 'brain', 0.073, 0, 0.07, 0.0, [1, 0.85, 1.1]);
  if (K?.brain && organs.length) {            // the modelled brain sits at its own size inside the skull
    const b = organs.at(-1).mesh;
    b.geometry.dispose(); b.geometry = K.brain.clone(); b.scale.set(1, 1, 1); b.position.set(0, 0.06, -0.008);
  }
  // Spine through the pelvis and torso
  for (const [frame, n] of [[f.pelvis, 3], [f.torso, 8]]) {
    if (!frame) continue;
    const L = frame.userData.length;
    for (let i = 0; i < n; i++) bone(frame, 'spine', new THREE.BoxGeometry(0.045, 0.042, 0.045), 0, -L / 2 + (i + 0.5) * L / n, -0.075, 0.035, null,
      { part: 'vertebra', size: [0.85, 0.85 * Math.min(1.3, L / n / 0.042), 0.85] });
  }
  // Rib cage: horizontal rings open at the back, sternum, collarbones, shoulder blades
  for (let i = 0; i < 6; i++) {
    const ring = new THREE.TorusGeometry(0.14 - Math.abs(i - 2.5) * 0.008, 0.007, 5, 20, Math.PI * 1.7)
      .rotateX(Math.PI / 2).rotateY(Math.PI * 0.35).scale(1.2, 1, 0.85);
    const k = 1.15 - Math.abs(i - 2.5) * 0.06;    // (the middle ribs are the widest)
    bone(f.torso, 'ribs', ring, 0, (-0.08 + i * 0.055) * ty, -0.005, 0.08, null, { part: 'rib_pair', at: [0, (-0.06 + i * 0.055) * ty, 0.0], size: [k, 1, k] });
  }
  bone(f.torso, 'sternum', new THREE.BoxGeometry(0.03, 0.2, 0.015), 0, 0.07 * ty, 0.1, 0.04, null, { part: 'sternum', at: [0, 0.06 * ty, 0], size: [1, ty, 1] });
  for (const s of [-1, 1]) {
    bone(f.torso, 'collarbone', new THREE.CylinderGeometry(0.008, 0.008, 0.2, 5), s * 0.1, 0.24 * ty, 0.04, 0.03, [0, 0, s * 1.35], { part: 'clavicle', at: [s * 0.015, 0.24 * ty, 0.07], size: [s, 1, 1] });
    bone(f.torso, 'shoulder blade', new THREE.BoxGeometry(0.1, 0.12, 0.01), s * 0.11, 0.14 * ty, -0.1, 0.06, null, { part: 'scapula', at: [s * 0.11, 0.14 * ty, -0.1], size: [s, 1, 1] });
  }
  bone(f.pelvis, 'pelvis', new THREE.BoxGeometry(0.28, 0.1, 0.12), 0, -0.02, 0, 0.1, null, { part: 'pelvis', at: [0, -0.02, 0] });
  // Limb bones along each limb frame
  const LIMB = { Arm: 'humerus', ForeArm: 'forearm', UpLeg: 'femur', Leg: 'tibia' };
  for (const [key, frame] of Object.entries(f.limbs)) {
    const kind = key.replace(/^(Left|Right)/, '');
    if (!LIMB[kind] || !frame) continue;
    const L = frame.userData.length * 0.92, r = kind === 'UpLeg' ? 0.021 : kind === 'Leg' ? 0.018 : 0.016;
    bone(frame, LIMB[kind], new THREE.CylinderGeometry(r, r * 0.85, L, 6), 0, 0, 0, r * 2, null, { part: 'long_bone', size: [r / 0.02, L, r / 0.02] });
  }
  // Organs
  organ(f.torso, 'heart', 'heart', 0.055, 0.04, 0.04 * ty, 0.04, [1, 1, 1], 'heart');
  organ(f.torso, 'lungs', 'lung', 0.075, 0.095, 0.08 * ty, 0.0, [1, 1.5, 1], 'lung');
  organ(f.torso, 'lungs', 'lung', 0.075, -0.095, 0.08 * ty, 0.0, [1, 1.5, 1], 'lung');
  organ(f.torso, 'liver', 'liver', 0.07, -0.07, -0.15 * ty, 0.035, [1.4, 0.7, 1], 'liver');
  organ(f.torso, 'stomach', 'stomach', 0.055, 0.08, -0.15 * ty, 0.045, [1, 1, 1], 'stomach');
  organ(f.torso, 'kidney', 'kidney', 0.035, 0.075, -0.24 * ty, -0.06, [1, 1, 1], 'kidney');
  organ(f.torso, 'kidney', 'kidney', 0.035, -0.075, -0.24 * ty, -0.06, [1, 1, 1], 'kidney');
  organ(f.pelvis, 'intestines', 'gut', 0.085, 0, 0.05, 0.04, [1.4, 0.8, 1], 'intestines');

  // Ghost: a see-through copy of the real skinned body, sharing its skeleton.
  const sk = soldier.char.skinned;
  if (sk) {
    const ghost = onLayer(new THREE.SkinnedMesh(sk.geometry, GHOST));
    ghost.bind(sk.skeleton, sk.bindMatrix);
    ghost.frustumCulled = false;
    ghost.position.copy(sk.position);
    ghost.quaternion.copy(sk.quaternion);
    ghost.scale.copy(sk.scale);
    sk.parent.add(ghost);
    extras.push(ghost);
  }

  soldier.root.updateMatrixWorld(true);
  soldier.xray = { bones, organs, extras };
  return soldier.xray;
}

// Bones and organs the straight segment a→b passes through, in order along it.
export function partsAlong(soldier, a, b) {
  const { bones, organs } = buildXray(soldier);
  const ab = new THREE.Vector3().subVectors(b, a);
  const len2 = ab.lengthSq();
  const c = new THREE.Vector3();
  const out = [];
  for (const [kind, list] of [['bone', bones], ['organ', organs]]) {
    for (const p of list) {
      p.mesh.getWorldPosition(c);
      const t = THREE.MathUtils.clamp(c.clone().sub(a).dot(ab) / len2, 0, 1);
      const closest = a.clone().addScaledVector(ab, t);
      if (closest.distanceTo(c) < p.r + 0.012) out.push({ kind, part: p, t });
    }
  }
  // Bones a hair before the organs they protect (skull before brain, ribs before heart).
  const key = (p) => p.t - (p.kind === 'bone' ? 0.04 : 0);
  return out.sort((x, y) => key(x) - key(y));
}

// Swap the visible body for the ghost (the body moves to a layer no camera renders).
export function setXrayView(soldier, on) {
  soldier.root.traverse((o) => {
    if (o.isMesh && !o.layers.isEnabled(XRAY_LAYER)) o.layers.set(on ? 2 : 0);
  });
}

// Remove the anatomy (after a kill cam damaged it); it is rebuilt fresh when needed.
export function clearXray(soldier) {
  const x = soldier.xray;
  if (!x) return;
  for (const p of [...x.bones, ...x.organs]) {
    p.mesh.removeFromParent();
    p.mesh.geometry.dispose();
    if (p.mesh.material !== BONE) p.mesh.material.dispose();
  }
  for (const g of x.extras) g.removeFromParent();
  setXrayView(soldier, false);
  soldier.xray = null;
}
