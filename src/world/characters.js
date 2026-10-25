// Animated characters from the Higgsfield/Meshy models: loading, cloning, clip
// cross-fades, a rifle-holding arm layer, the two-handed rifle, and hit zones that
// ride on the skeleton's bones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const MODELS = { player: 'player_idle', guard: 'guard_idle', rifle: 'rifle', tank: 'tank', opel: 'opel_blitz', kubel: 'kubelwagen', plane: 'plane',
  enfield: 'enfield', g43: 'g43', p38: 'p38', luger: 'luger', m1carbine: 'm1carbine', delisle: 'delisle' };
const CLIP_FILES = {
  walk: 'anim_walk', sprint: 'anim_sprint', crouch: 'anim_crouch', crawl: 'anim_crawl',
  deathFwd: 'anim_death_fwd', deathBack: 'anim_death_back',
  takedownAtk: 'anim_takedown_atk', takedownVic: 'anim_takedown_vic', // knife takedown: you, him
  ladderClimb: 'anim_ladder_climb', climbWall: 'anim_climb_wall',          // climbing
  throw: 'anim_throw', throwCrouch: 'anim_throw_crouch', place: 'anim_place', // grenades, bottles; charges at your feet
  search: 'anim_search', kneelWork: 'anim_kneel_work',                     // searching a body; bandaging, repairs
  hitReact: 'anim_hit_react', lookAround: 'anim_look_around',              // a guard hit; a guard searching
};
// Arm bones driven by the "holding a rifle" layer instead of the base clip.
const HOLD_BONES = ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'];

// Rifle models: which axis they lie along, which end is the muzzle (measured from the geometry:
// the muzzle is the thin end, the butt the tall one) and how long the real rifle is.
const RIFLES = {
  springfield: { key: 'rifle', axis: 'x', muzzleSign: -1, length: 1.10 },  // 2 cm at the muzzle vs 20 cm at the stock
  enfield: { key: 'enfield', axis: 'z', muzzleSign: 1, length: 1.13 },
  g43: { key: 'g43', axis: 'x', muzzleSign: 1, length: 1.12 },
  m1carbine: { key: 'm1carbine', axis: 'z', muzzleSign: 1, length: 0.90 },  // butt 14 cm tall at -z, muzzle 5 cm at +z
  delisle: { key: 'delisle', axis: 'z', muzzleSign: 1, length: 0.96 },
};
const GRIP_FROM_BUTT = 0.29;     // fraction of the length from the butt plate to the grip

export const assets = { models: {}, clips: {} };

export async function loadAssets(onProgress = () => {}) {
  const loader = new GLTFLoader();
  const url = (f) => `${import.meta.env.BASE_URL}models/${f}.glb`;
  const jobs = [
    ...Object.entries(MODELS).map(([k, f]) => [k, f, 'model']),
    ...Object.entries(CLIP_FILES).map(([k, f]) => [k, f, 'clip']),
  ];
  let done = 0;
  await Promise.all(jobs.map(async ([key, file, kind]) => {
    try {
      const gltf = await loader.loadAsync(url(file));
      if (kind === 'model') assets.models[key] = gltf;
      else assets.clips[key] = gltf.animations[0];
    } catch (e) {
      console.warn(`model ${file} missing`, e);
    }
    onProgress(++done / jobs.length);
  }));
  assets.clips.idle = assets.models.guard?.animations[0] ?? assets.models.player?.animations[0];
  buildDerivedClips();
}

const boneOf = (track) => track.name.split('.')[0];

// Remove the twist around the vertical axis from a quaternion track (swing-twist split),
// keeping the tilt. Meshy's idle stands side-on (hips and spine twisted); this squares
// the body up to the way the character faces.
function removeYaw(track) {
  const q = new THREE.Quaternion(), twist = new THREE.Quaternion();
  const v = track.values;
  for (let i = 0; i < v.length; i += 4) {
    q.fromArray(v, i);
    twist.set(0, q.y, 0, q.w).normalize();
    q.multiply(twist.invert()).toArray(v, i);
  }
}

// Take the travel out of a clip (the game moves the body itself): the hips' net drift over the
// clip, along these axes, is removed, keeping the sway within it. The clips are in centimetres.
function inPlace(clip, axes) {
  const t = clip?.tracks.find(tr => tr.name === 'Hips.position');
  if (!t) return;
  const v = t.values, n = v.length / 3, T = t.times[t.times.length - 1] || 1;
  for (const a of axes) {
    const i = 'xyz'.indexOf(a), drift = v[(n - 1) * 3 + i] - v[i];
    for (let k = 0; k < n; k++) v[k * 3 + i] -= drift * t.times[k] / T;
  }
}

function buildDerivedClips() {
  const c = assets.clips;
  for (const k of ['throw', 'throwCrouch', 'place', 'search', 'kneelWork', 'hitReact', 'lookAround']) inPlace(c[k], 'xz');
  for (const k of ['ladderClimb', 'climbWall']) inPlace(c[k], 'xyz');
  if (c.idle) {
    c.idle = c.idle.clone();
    const SQUARE = ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck'];
    for (const t of c.idle.tracks) if (t.name.endsWith('.quaternion') && SQUARE.includes(boneOf(t))) removeYaw(t);
  }
  // Lower-body versions of the stand/walk/crouch clips (the arms come from the hold layer).
  for (const k of ['idle', 'walk', 'crouch', 'lookAround']) {
    if (c[k]) c[k + 'Legs'] = new THREE.AnimationClip(k + 'Legs', c[k].duration, c[k].tracks.filter(t => !HOLD_BONES.includes(boneOf(t))));
  }
  // A frozen arm pose from the rifle sprint: both hands on the rifle.
  if (c.sprint) {
    const t = c.sprint.duration * 0.3;
    const tracks = c.sprint.tracks.filter(tr => HOLD_BONES.includes(boneOf(tr))).map((tr) => {
      const v = tr.createInterpolant().evaluate(t).slice();
      return new tr.constructor(tr.name, [0, 1], [...v, ...v]);
    });
    c.hold = new THREE.AnimationClip('hold', 1, tracks);
  }
}

export function assetsReady() {
  return !!(assets.models.player && assets.models.guard && assets.clips.idle);
}

// ---------------------------------------------------------------------------------

export function rifleModel(kind = 'springfield') {
  const spec = RIFLES[kind] ?? RIFLES.springfield;
  const src = assets.models[spec.key]?.scene ?? assets.models.rifle?.scene;
  const outer = new THREE.Group();   // origin at the grip, +z toward the muzzle
  if (!src) return outer;
  const m = src.clone(true);
  m.traverse(o => { if (o.isMesh && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); if (o.isMesh && o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace; });
  const box = new THREE.Box3().setFromObject(m);
  const a = spec.axis, len = box.max[a] - box.min[a];
  const butt = spec.muzzleSign > 0 ? box.min[a] : box.max[a];
  const c = box.getCenter(new THREE.Vector3());
  m.position.copy(c).negate();
  m.position[a] = -(butt + spec.muzzleSign * GRIP_FROM_BUTT * len);
  m.position.y = -(box.min.y + box.max.y) / 2 * 0.6;
  const inner = new THREE.Group();
  inner.add(m);
  inner.scale.setScalar(spec.length / len);
  // Turn the muzzle end to +z.
  inner.rotation.y = a === 'x' ? (spec.muzzleSign > 0 ? -Math.PI / 2 : Math.PI / 2) : (spec.muzzleSign > 0 ? 0 : Math.PI);
  outer.add(inner);
  outer.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Muzzle in the outer group's frame.
  outer.userData.muzzle = new THREE.Vector3(0, 0.04, spec.length * (1 - GRIP_FROM_BUTT));
  outer.userData.buttToGrip = GRIP_FROM_BUTT * spec.length; // metres from butt plate to grip
  outer.userData.kind = kind;
  return outer;
}

// Pistol models: the axis they lie along (the muzzle at its + end for both, measured: the thin
// barrel end, away from the grip that reaches down), the real length, where the hand holds it
// (from the back) and how high (from the bottom).
const PISTOLS = {
  p38: { axis: 'z', length: 0.22, grip: 0.3, gripY: 0.62 },
  luger: { axis: 'x', length: 0.222, grip: 0.2, gripY: 0.72 },
};

// A pistol model for the hand: origin at the grip, muzzle toward -z (the body's forward).
export function pistolModelFor(kind) {
  const spec = PISTOLS[kind];
  if (!spec || !assets.models[kind]) return null;
  const m = assets.models[kind].scene.clone(true);
  m.traverse(o => { if (o.isMesh) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace; o.castShadow = true; } });
  const a = spec.axis, box = new THREE.Box3().setFromObject(m), len = box.max[a] - box.min[a];
  const c = box.getCenter(new THREE.Vector3());
  m.position.set(-c.x, -(box.min.y + (box.max.y - box.min.y) * spec.gripY), -c.z);
  m.position[a] = -(box.min[a] + len * spec.grip);
  const inner = new THREE.Group();
  inner.add(m);
  inner.scale.setScalar(spec.length / len);
  inner.rotation.y = a === 'x' ? Math.PI / 2 : Math.PI;   // muzzle to -z
  const outer = new THREE.Group();
  outer.add(inner);
  outer.userData.muzzle = new THREE.Vector3(0, 0.02, -spec.length * (1 - spec.grip));
  return outer;
}

// Fitted parts you can see: a suppressor or a muzzle brake on the muzzle.
export function fitMuzzle(gun, kind, forward = 1) {
  gun.userData.device?.removeFromParent();
  gun.userData.device = null;
  const base = gun.userData.baseMuzzle ?? (gun.userData.baseMuzzle = gun.userData.muzzle.clone());
  gun.userData.muzzle = base.clone();
  if (!kind) return;
  const steel = new THREE.MeshStandardMaterial({ color: 0x1e1f1c, roughness: 0.45, metalness: 0.6 });
  const len = kind === 'suppressor' ? (forward > 0 ? 0.2 : 0.12) : 0.06, r = kind === 'suppressor' ? (forward > 0 ? 0.021 : 0.016) : 0.017;
  const dev = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14).rotateX(Math.PI / 2), steel);
  dev.position.copy(base).add(new THREE.Vector3(0, -0.04 * (forward > 0 ? 1 : 0), forward * len / 2));
  dev.castShadow = true;
  gun.add(dev);
  gun.userData.device = dev;
  gun.userData.muzzle = base.clone().add(new THREE.Vector3(0, 0, forward * len));
}

export class Character {
  // kind: 'player' | 'guard'. faceMinusZ: the game's player convention (yaw 0 faces -z).
  constructor(kind, { faceMinusZ = false, tint = null } = {}) {
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(assets.models[kind].scene);
    this.model.updateMatrixWorld(true);
    if (faceMinusZ) this.model.rotation.y = Math.PI;
    this.root.add(this.model);
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) {
        this.skinned = o;
        o.castShadow = o.receiveShadow = true;
        // Skinned bounds don't follow the animation: use a generous fixed sphere around
        // the body so off-screen characters are still culled.
        // In the mesh node's own units (Meshy exports centimetres: node scale 0.01).
        const k = 1 / o.getWorldScale(new THREE.Vector3()).x;
        o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9 * k, 0), 1.7 * k); // covers poses and falls
        if (tint) {
          o.material = o.material.clone();
          o.material.color.multiply(new THREE.Color(tint));
        }
      }
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    this.base = null;
    this.hold = this.action('hold');
    if (this.hold) { this.hold.play(); this.hold.setEffectiveWeight(1); }
    this.rifle = rifleModel();
    this.root.add(this.rifle);
    this._initScratch();
  }

  // Swap the rifle model (a different weapon from the loadout or a workbench).
  setRifle(kind) {
    if (this.rifle.userData.kind === kind) return;
    const old = this.rifle, visible = old.visible;
    old.removeFromParent();
    this.rifle = rifleModel(kind);
    this.rifle.visible = visible;
    this.root.add(this.rifle);
  }

  _initScratch() {
    this._v = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Quaternion() };
  }

  action(name) {
    if (this.actions[name]) return this.actions[name];
    const clip = assets.clips[name];
    if (!clip) return null;
    return (this.actions[name] = this.mixer.clipAction(clip));
  }

  // Cross-fade the base (full or lower-body) layer to `name`.
  play(name, { fade = 0.25, once = false, timeScale = 1 } = {}) {
    const a = this.action(name);
    if (!a) return;
    a.timeScale = timeScale;
    if (this.base === a) return;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.fadeIn(fade).play();
    if (this.base) this.base.fadeOut(fade);
    this.base = a;
  }

  setHoldWeight(w) {
    if (this.hold) this.hold.setEffectiveWeight(w);
  }

  update(dt) {
    // Undo last frame's crouch adjustment first, in case no clip drives these bones.
    if (this._lowered) { for (const [bone, pos, q] of this._lowered) { bone.position.copy(pos); bone.quaternion.copy(q); } this._lowered = null; }
    this.mixer.update(dt);
    this.model.updateMatrixWorld(true);
  }

  // A deeper crouch on top of the animation: the hips sink and sit back, the legs re-bend
  // (two-bone IK) so the feet stay where the clip put them, and the spine leans forward.
  // All world-space, so it doesn't depend on the rig's bone axes. k: 0..1 blend.
  lowerBody(k, { drop = 0.3, sitBack = 0.1, lean = 0.32, plant = false } = {}) {
    const b = this.bones;
    if (k <= 0.001 || !b.Hips) return;
    const v = this._v, fwd = v.a, up = new THREE.Vector3(0, 1, 0);
    this.modelDir(0, 0, 1, fwd).applyQuaternion(this.root.getWorldQuaternion(v.q)).setY(0).normalize();
    this._lowered = ['Hips', 'Spine', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']
      .filter(n => b[n]).map(n => [b[n], b[n].position.clone(), b[n].quaternion.clone()]);
    const feet = ['Left', 'Right'].map(side => b[side + 'Foot']?.getWorldPosition(new THREE.Vector3()));
    if (plant) { // standing still: both feet down (the paused stride holds one foot up)
      const floor = this.root.getWorldPosition(v.c).y + 0.15;
      for (const f of feet) if (f) f.y = Math.min(f.y, floor);
    }
    const hips = b.Hips.getWorldPosition(v.b).addScaledVector(up, -drop * k).addScaledVector(fwd, -sitBack * k);
    b.Hips.position.copy(b.Hips.parent.worldToLocal(hips));
    b.Hips.updateMatrixWorld(true);
    ['Left', 'Right'].forEach((side, i) => {
      if (!feet[i]) return;
      const foot = b[side + 'Foot'], footQ = foot.getWorldQuaternion(new THREE.Quaternion());
      const knee = feet[i].clone().addScaledVector(fwd, 1).addScaledVector(up, 0.4); // knees bend forward
      solveArmIK(b[side + 'UpLeg'], b[side + 'Leg'], foot, feet[i], knee);
      foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(footQ)); // sole stays flat
    });
    if (b.Spine) turnBone(b.Spine, up.clone(), up.clone().applyAxisAngle(new THREE.Vector3().crossVectors(up, fwd).normalize(), lean * k));
    this.model.updateMatrixWorld(true);
  }

  // Body-relative direction (model space: left = +x, up = +y, forward = +z) to root space.
  modelDir(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z).normalize().applyQuaternion(this.model.quaternion);
  }

  // Orient the rifle along `dir` (root space) with the scope toward `upHint`.
  aimRifle(dir, upHint) {
    const x = new THREE.Vector3().crossVectors(upHint, dir).normalize();
    const y = new THREE.Vector3().crossVectors(dir, x);
    this.rifle.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, dir));
  }

  // Rifle in both hands: grip in the right hand, the left hand pulled onto the fore-end
  // by IK. carry: 'port' (raised across the chest), 'low' (low ready), 'prone' (forward).
  placeRifleInHands(carry = 'port') {
    const { a } = this._v;
    const rh = this.bones.RightHand;
    if (!rh) return;
    rh.getWorldPosition(a);
    this.root.worldToLocal(a);
    this.rifle.position.copy(a);
    const DIRS = { port: [0.7, 0.35, 0.62], low: [0.5, -0.2, 0.8], prone: [0.04, 0.02, 1] };
    this.aimRifle(this.modelDir(...DIRS[carry]), this.modelDir(0, 1, 0));
    this.root.updateMatrixWorld(true);
    this.leftHandToForeEnd();
  }

  // Shouldered, as when aiming or right after a shot: butt in the right shoulder pocket,
  // barrel along `dir` (world space, the line of sight), both hands placed by IK.
  // `kick` pulls the rifle back along the barrel (recoil, working the bolt).
  placeRifleShouldered(dir, kick = 0) {
    const R = this.bones.RightArm;
    if (!R) return;
    const toWorld = (v) => v.applyQuaternion(this.root.quaternion);
    const shoulder = R.getWorldPosition(new THREE.Vector3());
    const pocket = shoulder.clone().add(toWorld(this.modelDir(0.08, -0.03, 0.12).multiplyScalar(0.15))).addScaledVector(dir, -kick);
    const grip = pocket.clone().addScaledVector(dir, this.rifle.userData.buttToGrip ?? 0.32);
    this.rifle.position.copy(this.root.worldToLocal(grip.clone()));
    const rootInv = this.root.quaternion.clone().invert();
    this.aimRifle(dir.clone().applyQuaternion(rootInv).normalize(), this.modelDir(0, 1, 0));
    this.root.updateMatrixWorld(true);
    const pole = shoulder.clone().add(toWorld(this.modelDir(-0.8, -1, -0.3)));
    solveArmIK(R, this.bones.RightForeArm, this.bones.RightHand, grip, pole);
    this.leftHandToForeEnd();
  }

  // Left hand onto the fore-end, as far forward as the arm can actually reach.
  leftHandToForeEnd() {
    const shoulder = this.bones.LeftArm.getWorldPosition(new THREE.Vector3());
    const reach = this.armLength ?? (this.armLength = shoulder.distanceTo(this.bones.LeftForeArm.getWorldPosition(new THREE.Vector3()))
      + this.bones.LeftForeArm.getWorldPosition(new THREE.Vector3()).distanceTo(this.bones.LeftHand.getWorldPosition(new THREE.Vector3())));
    const foreEnd = new THREE.Vector3();
    for (let t = 0.36; t >= 0.08; t -= 0.02) {
      this.rifle.localToWorld(foreEnd.set(0, -0.035, t));
      if (foreEnd.distanceTo(shoulder) < reach * 0.96) break;
    }
    const pole = shoulder.clone().add(this.modelDir(0.7, -1, -0.25).applyQuaternion(this.root.quaternion));
    solveArmIK(this.bones.LeftArm, this.bones.LeftForeArm, this.bones.LeftHand, foreEnd, pole);
  }

  // Rifle slung on the right shoulder, muzzle up, scope facing out: guards at ease,
  // or the player with the pistol drawn.
  // Slung across the back: the muzzle up past the right shoulder, the butt at the left hip,
  // the scope facing out. The torso's own frame is taken from the bones (hips to neck, shoulder
  // to shoulder), so it stays on the back when he bends, crouches, kneels or climbs.
  slingRifle() {
    const b = this.bones;
    if (!b.Hips || !b.neck || !b.LeftArm || !b.RightArm || !b.Spine02) return;
    const S = this._sling ??= { hips: new THREE.Vector3(), neck: new THREE.Vector3(), l: new THREE.Vector3(), r: new THREE.Vector3(), chest: new THREE.Vector3(),
      up: new THREE.Vector3(), right: new THREE.Vector3(), back: new THREE.Vector3(), dir: new THREE.Vector3(), inv: new THREE.Quaternion() };
    b.Hips.getWorldPosition(S.hips); b.neck.getWorldPosition(S.neck);
    b.LeftArm.getWorldPosition(S.l); b.RightArm.getWorldPosition(S.r); b.Spine02.getWorldPosition(S.chest);
    S.up.subVectors(S.neck, S.hips).normalize();
    S.right.subVectors(S.r, S.l).normalize();
    S.back.crossVectors(S.right, S.up).normalize();
    // The grip a little left of the spine and low on the back; the rifle lies close against it.
    S.chest.addScaledVector(S.back, 0.15).addScaledVector(S.right, -0.04).addScaledVector(S.up, -0.12);
    S.dir.copy(S.up).addScaledVector(S.right, 0.55).normalize();
    this.root.getWorldQuaternion(S.inv).invert();
    this.rifle.position.copy(this.root.worldToLocal(S.chest));
    this.aimRifle(S.dir.applyQuaternion(S.inv), S.back.applyQuaternion(S.inv));
  }

  muzzleWorld(out = new THREE.Vector3()) {
    return out.copy(this.rifle.userData.muzzle ?? new THREE.Vector3()).applyMatrix4(this.rifle.matrixWorld);
  }
}

// ---------------------------------------------------------------------------------
// Hit zones: invisible capsules/boxes attached to bones, built in the bind pose.

const PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false });

function segment(char, from, to, radius, zone, { box = null } = {}) {
  const A = char.bones[from], B = char.bones[to];
  if (!A || !B) return null;
  const a = A.getWorldPosition(new THREE.Vector3()), b = B.getWorldPosition(new THREE.Vector3());
  const len = Math.max(0.05, a.distanceTo(b));
  const geo = box ? new THREE.BoxGeometry(box[0], len, box[1]) : new THREE.CylinderGeometry(radius, radius, len, 8);
  const mesh = new THREE.Mesh(geo, PROXY_MAT);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.userData.zone = zone;
  mesh.userData.length = len;
  char.root.add(mesh);
  mesh.updateMatrixWorld(true);
  A.attach(mesh);
  return mesh;
}

// Returns { meshes, frames } where frames.head/torso/pelvis/limbs are the proxy meshes
// (their local frames: y along the bone, z forward), used by the X-ray anatomy.
export function buildHitZones(char, owner) {
  char.root.updateMatrixWorld(true);
  const frames = { limbs: {} };
  frames.pelvis = segment(char, 'Hips', 'Spine01', 0, 'pelvis', { box: [0.36, 0.24] });
  frames.torso = segment(char, 'Spine01', 'neck', 0, 'torso', { box: [0.4, 0.26] });
  frames.head = segment(char, 'neck', 'head_end', 0.115, 'head');
  for (const s of ['Left', 'Right']) {
    frames.limbs[s + 'Arm'] = segment(char, s + 'Arm', s + 'ForeArm', 0.065, 'arm');
    frames.limbs[s + 'ForeArm'] = segment(char, s + 'ForeArm', s + 'Hand', 0.055, 'arm');
    frames.limbs[s + 'UpLeg'] = segment(char, s + 'UpLeg', s + 'Leg', 0.095, 'leg');
    frames.limbs[s + 'Leg'] = segment(char, s + 'Leg', s + 'Foot', 0.07, 'leg');
    frames.limbs[s + 'Foot'] = segment(char, s + 'Foot', s + 'ToeBase', 0.06, 'leg');
  }
  const meshes = [frames.pelvis, frames.torso, frames.head, ...Object.values(frames.limbs)].filter(Boolean);
  for (const m of meshes) m.userData.soldier = owner;
  return { meshes, frames };
}

// ---------------------------------------------------------------------------------
// Two-bone IK (shoulder → elbow → hand) in world space: bend the elbow toward `pole`
// so the hand reaches `target`, then turn the forearm onto it. Runs after the mixer.

const _ik = { s: new THREE.Vector3(), e: new THREE.Vector3(), h: new THREE.Vector3(), q: new THREE.Quaternion(), pq: new THREE.Quaternion(), wq: new THREE.Quaternion() };

function turnBone(bone, from, to) {
  const { q, pq, wq } = _ik;
  q.setFromUnitVectors(from.normalize(), to.normalize());      // world-space delta
  bone.getWorldQuaternion(wq);
  bone.parent.getWorldQuaternion(pq);
  bone.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
  bone.updateMatrixWorld(true);
}

export function solveArmIK(upper, lower, hand, target, pole) {
  if (!upper || !lower || !hand) return;
  const { s, e, h } = _ik;
  upper.getWorldPosition(s);
  lower.getWorldPosition(e);
  hand.getWorldPosition(h);
  const a = s.distanceTo(e), b = e.distanceTo(h);
  const toT = target.clone().sub(s);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = toT.normalize();
  // Elbow on the circle where the two bones meet, on the pole side.
  const x = (a * a - b * b + d * d) / (2 * d);
  const y = Math.sqrt(Math.max(0, a * a - x * x));
  const p = pole.clone().sub(s);
  const perp = p.sub(dir.clone().multiplyScalar(p.dot(dir))).normalize();
  const elbow = s.clone().addScaledVector(dir, x).addScaledVector(perp, y);
  turnBone(upper, e.clone().sub(s), elbow.clone().sub(s));
  lower.getWorldPosition(e);
  hand.getWorldPosition(h);
  turnBone(lower, h.clone().sub(e), target.clone().sub(e));
}
