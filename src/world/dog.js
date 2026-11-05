// The guard dog's body: the German shepherd of tools/blender/dog_rig.py, a canine skeleton with its
// clips (idle, walk, trot, gallop, the nose-down walk and trot, bite, die). Each gait clip is true
// at one speed and plays faster or slower to match the ground, so the paws don't slide. Bark, the
// lean into a turn and the eyes on you go on top of whatever clip is playing, bone by bone, after
// the mixer has run. ai/dogs.js moves the root and sets `a.v`, `a.nose`, `a.watch`.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { assets } from './characters.js';
import { heightAt } from './terrain.js';

// The speed each gait is true at (dog_rig.py prints these), and where one gives way to the next.
const TRUE_AT = { walk: 1.34, trot: 3.23, gallop: 6.52, walk_nose: 1.34, trot_nose: 3.23 };
const TROT_FROM = 2.1, GALLOP_FROM = 4.8, GIVE = 0.25;      // (m/s; GIVE: it holds a gait a little past the change)
const FADE = 10;                                             // /s: how fast one clip gives way to another
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

export function makeDog(scene, x, z) {
  const src = assets.models.dog;
  if (!src?.animations?.length) return null;
  const model = SkeletonUtils.clone(src.scene);
  const bones = {};
  model.traverse(o => {
    if (o.isBone) bones[o.name] = o;
    if (!o.isMesh) return;
    o.material = o.material.clone();
    if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
    o.material.envMapIntensity = 0.6;
    o.castShadow = o.receiveShadow = true;
    o.userData.animal = true;
    o.frustumCulled = false;       // (its bounds are the standing dog's, not where the bones have put it)
  });
  const root = new THREE.Group();
  root.add(model);
  root.position.set(x, heightAt(x, z), z);
  root.rotation.y = Math.random() * Math.PI * 2;
  scene.add(root);
  root.updateMatrixWorld(true);
  const mixer = new THREE.AnimationMixer(model);
  const clips = {};
  for (const c of src.animations) {
    const act = clips[c.name] = mixer.clipAction(c);
    act.enabled = true;
    act.setEffectiveWeight(0);
    act.play();
    if (c.name === 'bite' || c.name === 'die') { act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; act.paused = true; }
  }
  clips.idle.setEffectiveWeight(1);
  clips.idle.time = Math.random() * clips.idle.getClip().duration;
  // Each overlaid bone's way of turning about the dog's own axes (its rest frame differs from theirs).
  const inv = model.getWorldQuaternion(new THREE.Quaternion()).invert();
  const axes = {};
  for (const n of ['spine1', 'chest', 'neck1', 'neck2', 'head', 'jaw']) {
    const q = bones[n].getWorldQuaternion(new THREE.Quaternion()).premultiply(inv).invert();
    axes[n] = { x: X.clone().applyQuaternion(q), y: Y.clone().applyQuaternion(q) };
  }
  return { root, model, bones, mixer, clips, axes, gait: 'idle', once: null, dead: false, v: 0, nose: false, watch: null,
    yaw: root.rotation.y, turn: 0, look: 0, barkT: 1 };
}

// One bark (ai/dogs.js has already played the sound): the jaw opens and the head throws up.
export function dogBark(a) { a.barkT = 0; }

function playOnce(a, name) {
  const c = a.clips[name];
  c.reset();
  c.paused = false;
  a.once = name;
}
export function dogBite(a) { if (!a.dead && a.once !== 'bite') playOnce(a, 'bite'); }
export function dogDie(a) { a.dead = true; playOnce(a, 'die'); }

function pickGait(a) {
  const v = a.v, g = a.gait;
  if (Math.abs(a.turn) > 1 && v < 0.5) return 'walk';           // (it steps round, it doesn't spin on the spot)
  if (v < 0.12) return 'idle';
  const base = g.replace('_nose', '');
  const gallop = v > GALLOP_FROM - (base === 'gallop' ? GIVE : 0);
  const trot = v > TROT_FROM - (base === 'walk' ? -GIVE : base === 'idle' ? 0 : GIVE);
  const pick = gallop ? 'gallop' : trot ? 'trot' : 'walk';
  return a.nose && pick !== 'gallop' ? `${pick}_nose` : pick;
}

const _q = new THREE.Quaternion();
function turnBone(a, n, axis, angle) {
  a.bones[n].quaternion.multiply(_q.setFromAxisAngle(a.axes[n][axis], angle));
}

export function poseDog(a, dt) {
  if (a.dead && a.settled) return;
  // How fast it's turning, smoothed: the spine and neck lead into it.
  const d = Math.atan2(Math.sin(a.root.rotation.y - a.yaw), Math.cos(a.root.rotation.y - a.yaw));
  a.yaw = a.root.rotation.y;
  a.turn += ((dt > 0 ? d / dt : 0) - a.turn) * Math.min(1, dt * 8);

  const was = a.gait, now = pickGait(a);
  if (now !== was) {
    // The new gait picks up at the same point in its stride, so the legs don't jump.
    const from = a.clips[was], to = a.clips[now];
    if (was !== 'idle' && now !== 'idle') to.time = from.time / from.getClip().duration * to.getClip().duration;
    a.gait = now;
  }
  if (a.once && a.once !== 'die' && a.clips[a.once].time >= a.clips[a.once].getClip().duration - 0.02) {
    a.clips[a.once].paused = true;
    a.once = null;
  }
  const k = Math.min(1, dt * (a.once ? FADE * 2 : FADE));
  for (const [name, c] of Object.entries(a.clips)) {
    const want = a.once ? +(name === a.once) : +(name === a.gait);
    c.setEffectiveWeight(c.getEffectiveWeight() + (want - c.getEffectiveWeight()) * k);
    if (TRUE_AT[name]) c.setEffectiveTimeScale(Math.min(1.6, Math.max(0.35, Math.max(a.v, Math.abs(a.turn) * 0.3) / TRUE_AT[name])));
  }
  a.mixer.update(dt);
  if (a.dead) { a.settled = a.clips.die.time >= a.clips.die.getClip().duration; return; }

  const lean = Math.max(-1, Math.min(1, a.turn / 4));
  turnBone(a, 'spine1', 'y', 0.12 * lean);
  turnBone(a, 'chest', 'y', 0.16 * lean);
  // Its head comes round to you before its body does.
  let want = 0;
  if (a.watch) {
    const b = Math.atan2(a.watch.x - a.root.position.x, a.watch.z - a.root.position.z) - a.root.rotation.y;
    want = Math.max(-0.9, Math.min(0.9, Math.atan2(Math.sin(b), Math.cos(b))));
  }
  a.look += (want - a.look) * Math.min(1, dt * 5);
  const y = a.look + 0.3 * lean;
  turnBone(a, 'neck1', 'y', 0.35 * y);
  turnBone(a, 'neck2', 'y', 0.35 * y);
  turnBone(a, 'head', 'y', 0.3 * y);
  // A bark: a quarter of a second, the mouth wide on the sound and the head thrown up with it.
  a.barkT += dt;
  if (a.barkT < 0.26) {
    const e = Math.sin(Math.PI * a.barkT / 0.26);
    turnBone(a, 'jaw', 'x', 0.55 * e);
    turnBone(a, 'neck2', 'x', -0.16 * e);
    turnBone(a, 'head', 'x', -0.2 * e);
  }
}
