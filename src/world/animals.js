// Animals about the farms and hills: cows and a horse in the vineyard, goats on the coast, deer in
// the forest. Each wanders slowly round its patch, stops to graze (head down, a step now and then),
// and bolts away at a run from a loud noise nearby (a shot, a blast) or from you walking up close.
// The models are single rigid meshes, so each kind is skinned here once, from its own shape: a hip
// and a knee bone per leg, a neck and a tail, and the legs walk a real gait in step with the ground.
import * as THREE from 'three';
import { propModel } from './props.js';
import { heightAt } from './terrain.js';

const SPECS = {
  cow: { size: { x: 2.4 }, walk: 0.9, run: 4.5, shy: 6 },
  horse: { size: { x: 2.4 }, walk: 1.1, run: 9, shy: 10 },
  goat: { size: { x: 1.3 }, walk: 0.8, run: 6, shy: 14 },
  deer: { size: { x: 2.0 }, walk: 1.0, run: 11, shy: 45 },
  dog: { size: { x: 1.3 }, walk: 1.4, run: 8, shy: 0 },     // a guard's dog (ai/dogs.js drives it)
};

// The rig, as fractions of the animal's height: where the legs part from the belly; `crown`: the
// height above which everything is head, horns and antlers; `withers`: how far up from the belly
// to the back the neck bows from (lower for a long neck). `run`: its gait when it bolts.
const RIGS = {
  cow: { belly: 0.36, run: 'trot' },
  horse: { belly: 0.42, withers: 0.15, run: 'gallop' },
  goat: { belly: 0.32, crown: 0.84, run: 'gallop' },
  deer: { belly: 0.32, crown: 0.66, run: 'gallop' },
  dog: { belly: 0.38, withers: 0.4, run: 'gallop' },
};

// Gaits: stride (one full cycle) in leg lengths, the share of it each hoof is on the ground, how far
// the knees fold in the swing, and when each leg (LF, RF, LH, RH) puts its hoof down in the cycle.
// The walk is four-beat (left hind, left fore, right hind, right fore); the trot moves in diagonal
// pairs; the gallop lands hinds then fores.
const GAITS = {
  walk: { stride: 1.3, duty: 0.62, knee: 0.55, phase: [0.25, 0.75, 0, 0.5] },
  trot: { stride: 2.4, duty: 0.4, knee: 0.8, phase: [0, 0.5, 0.5, 0] },
  gallop: { stride: 3.6, duty: 0.25, knee: 0.85, phase: [0.42, 0.55, 0, 0.12] },
};

const herd = [];
const rigs = {};   // kind → its skinned geometry and bone layout, shared by the whole herd

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Skin weights from the shape, in the animal's own frame (nose toward +z, feet on y = 0).
function buildRig(kind, mesh, toRoot) {
  const pos = mesh.geometry.attributes.position, n = pos.count, v = new THREE.Vector3();
  const P = new Float32Array(n * 3), lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toRoot).toArray(P, i * 3);
    lo.min(v); hi.max(v);
  }
  const H = hi.y - lo.y, L = hi.z - lo.z, R = RIGS[kind];
  const belly = lo.y + R.belly * H;
  // The hooves: the lowest vertices, parted into fore and hind, left and right.
  const feet = [];
  for (let i = 0; i < n; i++) if (P[i * 3 + 1] < lo.y + 0.08 * H) feet.push(i);
  const mean = (ids, k) => ids.reduce((s, i) => s + P[i * 3 + k], 0) / ids.length;
  const midZ = mean(feet, 2), midX = mean(feet, 0);
  const legOf = (x, z) => (z > midZ ? 0 : 2) + (x > midX ? 0 : 1);   // LF, RF, LH, RH (+x is the animal's left)
  const legs = [0, 1, 2, 3].map(l => {
    const ids = feet.filter(i => legOf(P[i * 3], P[i * 3 + 2]) === l);
    return { x: mean(ids, 0), z: mean(ids, 2) };
  });
  const foreZ = (legs[0].z + legs[1].z) / 2;
  const hip = belly + 0.1 * H, knee = [0.45, 0.45, 0.38, 0.38].map(f => lo.y + f * (belly - lo.y));
  // The neck bows from the shoulder and the head from half way to the muzzle, so it reaches the grass.
  let nose = 0;
  for (let i = 1; i < n; i++) if (P[i * 3 + 2] > P[nose * 3 + 2]) nose = i;
  const muzzle = new THREE.Vector3().fromArray(P, nose * 3);
  const neck = new THREE.Vector3(midX, belly + (R.withers ?? 0.35) * (hi.y - belly), foreZ);
  const head = neck.clone().lerp(muzzle, 0.6).setX(midX);
  let tailTop = lo.y;
  for (let i = 0; i < n; i++) if (P[i * 3 + 2] < lo.z + 0.06 * L) tailTop = Math.max(tailTop, P[i * 3 + 1]);
  const tail = new THREE.Vector3(midX, tailTop - 0.04 * H, lo.z + 0.03 * L);
  // The tail is what hangs clear behind the rump: at each height, behind the rearmost flesh off
  // the midline (the haunches), within a narrow band either side of it.
  const band = 0.15 * (Math.abs(legs[0].x - legs[1].x) + Math.abs(legs[2].x - legs[3].x)) / 2;
  const rump = new Array(24).fill(Infinity), slice = (y) => Math.min(23, Math.floor((y - lo.y) / H * 24));
  for (let i = 0; i < n; i++) if (Math.abs(P[i * 3] - midX) > 2 * band) rump[slice(P[i * 3 + 1])] = Math.min(rump[slice(P[i * 3 + 1])], P[i * 3 + 2]);
  for (let k = 0; k < 24; k++) if (rump[k] === Infinity) rump[k] = lo.z - L;   // (no haunch at this height: no tail either)

  // Bones: 0 the body, 1–4 the hips, 5–8 the knees, 9 the neck, 10 the tail, 11 the head.
  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], l = legOf(x, z);
    // A leg up to the hip, but not the belly and udder between the legs.
    const near = Math.hypot(x - legs[l].x, z - legs[l].z);
    const wl = (1 - smooth(belly - 0.04 * H, hip - 0.02 * H, y))
      * Math.max(1 - smooth(belly - 0.1 * H, belly - 0.03 * H, y), 1 - smooth(0.05 * L, 0.11 * L, near));
    const wk = wl * (1 - smooth(knee[l] - 0.03 * H, knee[l] + 0.03 * H, y));
    let wn = (1 - wl) * smooth(neck.z - 0.02 * L, neck.z + 0.12 * L, z) * smooth(belly, belly + 0.1 * H, y);
    let wh = wn * smooth(head.z - 0.04 * L, head.z + 0.02 * L, z);
    if (R.crown && y > lo.y + R.crown * H && z > lo.z + 0.4 * L) wn = wh = 1 - wl;   // horns, antlers
    const wt = (1 - wl) * (1 - wn) * (1 - smooth(rump[slice(y)] - 0.04 * L, rump[slice(y)] - 0.01 * L, z))
      * (1 - smooth(band, 2 * band, Math.abs(x - midX))) * (1 - smooth(tail.y - 0.1 * H, tail.y, y));
    const w = [[0, Math.max(0, 1 - wl - wn - wt)], [1 + l, wl - wk], [5 + l, wk], [9, wn - wh], [11, wh], [10, wt]]
      .sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = w.reduce((s, [, v]) => s + v, 0);
    w.forEach(([b, v], j) => { skinIndex[i * 4 + j] = b; skinWeight[i * 4 + j] = v / sum; });
  }
  const geometry = mesh.geometry.clone();
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  // How far the neck bows (the head tucking a little further) to put the muzzle in the grass.
  const bow = (v, a) => v.y * Math.cos(a) - v.z * Math.sin(a);
  const h = head.clone().sub(neck), m = muzzle.clone().sub(head);
  let graze = 0;
  while (graze < 1.6 && neck.y + bow(h, graze) + bow(m, 1.3 * graze) > lo.y + 0.04 * H) graze += 0.02;

  return {
    geometry, graze, legLen: hip - lo.y,
    pivots: [new THREE.Vector3(midX, belly, (foreZ + legs[2].z) / 2),
      ...legs.map(g => new THREE.Vector3(g.x, hip, g.z)), ...legs.map((g, l) => new THREE.Vector3(g.x, knee[l], g.z)), neck, tail, head],
  };
}

// The model made a skinned mesh, with its bones under `body` (still at the origin, unturned).
function skin(kind, model, body) {
  body.updateMatrixWorld(true);
  const mesh = model.userData.meshes[0];
  const rig = rigs[kind] ??= buildRig(kind, mesh, mesh.matrixWorld);
  const bones = rig.pivots.map(() => new THREE.Bone());
  rig.pivots.forEach((p, b) => {
    const from = b === 0 ? null : b >= 5 && b <= 8 ? b - 4 : b === 11 ? 9 : 0;   // knees from hips, the head from the neck, the rest from the body
    bones[b].position.copy(p);
    if (from !== null) bones[b].position.sub(rig.pivots[from]);
    (from === null ? body : bones[from]).add(bones[b]);
  });
  const sk = new THREE.SkinnedMesh(rig.geometry, mesh.material);
  sk.castShadow = sk.receiveShadow = true;
  sk.userData.animal = true;
  sk.position.copy(mesh.position); sk.quaternion.copy(mesh.quaternion); sk.scale.copy(mesh.scale);
  mesh.parent.add(sk);
  mesh.removeFromParent();
  model.userData.meshes[0] = sk;
  body.updateMatrixWorld(true);
  sk.bind(new THREE.Skeleton(bones), sk.matrixWorld);
  return { rig, bones };
}

// A few of one kind round (x, z) within `radius` m.
export function addAnimals(scene, kind, x, z, radius, count = 1) {
  const spec = SPECS[kind];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
    const animal = makeAnimal(scene, kind, x + Math.cos(a) * r, z + Math.sin(a) * r, i);
    if (!animal) return;
    Object.assign(animal, { home: new THREE.Vector3(x, 0, z), radius, t: 2 + Math.random() * 8 });
    herd.push(animal);
  }
}

// One animal, skinned and standing at (x, z), not yet in the herd: addAnimals puts the farm's in
// it; a guard's dog is driven by ai/dogs.js instead, which moves it and calls poseAnimal.
export function makeAnimal(scene, kind, x, z, i = 0) {
  const spec = SPECS[kind];
  const model = propModel(kind, spec.size, { own: true });
  if (!model) return null;
  const body = new THREE.Group();            // bobs and pitches inside the root, which walks
  body.add(model);
  model.rotation.y = Math.PI / 2;           // (props lie nose toward −x; the root walks toward +z)
  const { rig, bones } = skin(kind, model, body);
  const root = new THREE.Group();
  root.add(body);
  root.position.set(x, heightAt(x, z), z);
  root.rotation.y = Math.random() * Math.PI * 2;
  scene.add(root);
  return {
    kind, spec, root, body, rig, bones, goal: null, state: 'graze',
    phase: Math.random() * 10, v: 0, cycle: Math.random(),
    shuffle: 0, idle: 3 + Math.random() * 20, look: 3 + Math.random() * 8, swish: Math.random() * 6, rest: 2 + (i % 2),
  };
}
export const poseAnimal = (a, dt) => pose(a, dt);

// Something loud at `at` (heard up to `radius` m): animals within it bolt away.
export function startle(at, radius) {
  for (const a of herd) {
    if (a.root.position.distanceTo(at) > radius) continue;
    const away = a.root.position.clone().sub(at).setY(0).normalize();
    a.goal = a.root.position.clone().addScaledVector(away, 25 + Math.random() * 20);
    a.state = 'flee';
    a.t = 6;
  }
}

const _d = new THREE.Vector3();
export function tickAnimals(dt, player) {
  for (const a of herd) {
    const p = a.root.position;
    a.phase += dt;
    if (a.state !== 'flee' && player && p.distanceTo(player.pos) < a.spec.shy) startle(player.pos, a.spec.shy + 1);
    if (a.state === 'graze' && (a.t -= dt) <= 0) {
      // A few steps to somewhere else in the patch.
      const ang = Math.random() * Math.PI * 2, r = Math.random() * a.radius;
      a.goal = new THREE.Vector3(a.home.x + Math.cos(ang) * r, 0, a.home.z + Math.sin(ang) * r);
      a.state = 'walk';
    }
    let speed = 0;
    if (a.state === 'walk' || a.state === 'flee') {
      _d.copy(a.goal).sub(p).setY(0);
      const dist = _d.length();
      speed = a.state === 'flee' ? a.spec.run : a.spec.walk;
      if (dist < 0.5 || (a.state === 'flee' && (a.t -= dt) <= 0)) {
        if (a.state === 'flee') { a.home.copy(p).setY(0); }   // it settles where it ran to
        a.state = 'graze'; a.t = 4 + Math.random() * 10; speed = 0;
        a.rest = 2 + Math.floor(Math.random() * 2);
      } else {
        const want = Math.atan2(_d.x, _d.z);
        let turn = Math.atan2(Math.sin(want - a.root.rotation.y), Math.cos(want - a.root.rotation.y));
        a.root.rotation.y += Math.sign(turn) * Math.min(Math.abs(turn), (a.state === 'flee' ? 3 : 1.2) * dt);
      }
    } else if ((a.shuffle -= dt) > 0) speed = a.spec.walk * 0.4;   // grazing on, a step or two forward
    else if (a.shuffle < -a.idle) { a.shuffle = 1 + Math.random() * 1.5; a.idle = 5 + Math.random() * 25; }
    // It gathers speed and slows rather than starting and stopping dead, and the legs keep pace.
    a.v += (speed - a.v) * Math.min(1, dt * (speed > a.v ? 2.5 : 4));
    p.x += Math.sin(a.root.rotation.y) * a.v * dt;
    p.z += Math.cos(a.root.rotation.y) * a.v * dt;
    p.y = heightAt(p.x, p.z);
    pose(a, dt);
  }
}

// Where a leg is in its cycle `u` (0–1, the hoof coming down at 0): the swing of the whole leg
// (+ forward) and the fold of its knee. On the ground the hoof slides back under the body at the
// body's speed, so it stays put on the ground; in the air it is lifted and carried forward.
function legPose(u, duty, amp) {
  if (u < duty) return [amp * (1 - 2 * u / duty), 0];
  const s = (u - duty) / (1 - duty);
  return [-amp * Math.cos(Math.PI * s), Math.sin(Math.PI * s)];
}

const ease = (o, axis, to, rate) => { o.rotation[axis] += (to - o.rotation[axis]) * rate; };
function pose(a, dt) {
  const { rig, bones, body, spec } = a, k = Math.min(1, dt * 18), slow = Math.min(1, dt * 3);
  const running = a.v > spec.walk * 1.6, g = GAITS[running ? RIGS[a.kind].run : 'walk'];
  const stride = g.stride * rig.legLen;
  a.cycle = (a.cycle + a.v * dt / stride) % 1;
  // The swing that keeps a planted hoof still, faded in as it picks up a walk.
  const moving = Math.min(1, a.v / spec.walk);
  const amp = Math.asin(Math.min(0.5, g.duty * stride / (2 * rig.legLen))) * moving;
  for (let l = 0; l < 4; l++) {
    let [swing, fold] = legPose((a.cycle - g.phase[l] + 1) % 1, g.duty, amp);
    fold *= g.knee * moving;
    if (a.v < 0.05 && a.state === 'graze' && l === a.rest) { swing = 0.04; fold = 0.25; }   // resting a hind hoof
    ease(bones[1 + l], 'x', -swing, k);
    ease(bones[5 + l], 'x', l < 2 ? fold : -0.8 * fold, k);   // a foreleg folds back at the knee, a hind one forward at the hock
  }
  // The body: a bob twice a stride at the walk, a rocking pitch at the gallop.
  const beat = Math.sin(a.cycle * Math.PI * 4), rock = Math.sin(a.cycle * Math.PI * 2);
  body.position.y = running ? Math.abs(rock) * 0.06 * rig.legLen : -Math.abs(beat) * 0.015 * rig.legLen * moving;
  ease(body, 'x', running && RIGS[a.kind].run === 'gallop' ? rock * 0.06 : 0, k);
  ease(body, 'z', running ? 0 : rock * 0.015 * moving, k);
  // The head: down in the grass, now and then up to look about; nodding along at the walk;
  // up and forward at the run.
  if ((a.look -= dt) < -2.5) a.look = 4 + Math.random() * 10;
  let head = running ? -0.15 + 0.08 * rock : 0.15 + 0.06 * beat * moving;
  if (a.state === 'graze' && a.v < spec.walk * 0.5 && a.look > 0) head = rig.graze + 0.06 * Math.sin(a.phase * 1.3);
  const nod = a.state === 'graze' ? slow : Math.min(1, dt * 6);
  ease(bones[9], 'x', head, nod);
  ease(bones[11], 'x', 0.3 * head, nod);
  ease(bones[9], 'y', a.state === 'graze' && a.look <= 0 ? 0.3 * Math.sin(a.phase * 0.6) : 0, slow);
  // The tail: streaming out behind at the run, otherwise hanging, with a swish at the flies.
  if ((a.swish -= dt) < -1.2) a.swish = 2 + Math.random() * 7;
  const flick = a.swish < 0 ? Math.sin(-a.swish * 9) * Math.sin(-a.swish / 1.2 * Math.PI) : 0;
  ease(bones[10], 'x', running ? 0.45 : 0.05, slow);
  ease(bones[10], 'z', 0.3 * flick + 0.04 * Math.sin(a.phase * 0.9), k);
}
