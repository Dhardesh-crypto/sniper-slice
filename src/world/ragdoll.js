// A dead man's fall, worked out live from the hit (no physics library). His joints become points
// with weight, joined at their bones' lengths; gravity takes them, the round's push goes into the
// joints nearest where it struck, and the floor, steps, slopes and walls stop them. It starts from
// the pose he was in, at the speed he was moving.
//   Muscle: for a moment each joint still tries to hold the shape he had (in his pelvis's frame,
//   so the whole of him can still topple). How long it holds depends on the wound: a head shot
//   cuts it at once, a body shot lets it go over about a second, a leg shot takes that leg first.
//   Limits: knees bend one way only, a limb can't fold flat on itself, the spine and neck bend
//   within reason, the legs and feet don't pass through each other.
// The points are copied back onto his skeleton every frame (each bone turned from the pose he
// died in to where its joints are now), until he lies still; then it stops costing anything.
import * as THREE from 'three';

const G = 9.8;
const SUB = 3, ITER = 6;            // substeps a frame, constraint passes a substep
const DRAG = 0.15;                  // /s: air
const FRICTION = 9;                 // /s: sliding on the ground
const SLEEP_V = 0.06, SLEEP_T = 0.5, MAX_T = 9;
const LEDGE = 0.17;                 // m: a box top this far over a joint's underside is still floor to it
const TONE = 14;                    // /s: how hard full muscle pulls a joint back to his pose
// Joints and how fat the body is around them (m): what touches the ground.
const RADIUS = {
  Hips: 0.13, Spine02: 0.13, Spine01: 0.13, Spine: 0.14, neck: 0.07, Head: 0.1, head_end: 0.1,
  LeftShoulder: 0.07, RightShoulder: 0.07, LeftArm: 0.07, RightArm: 0.07, LeftForeArm: 0.05, RightForeArm: 0.05,
  LeftHand: 0.045, RightHand: 0.045, LeftUpLeg: 0.1, RightUpLeg: 0.1, LeftLeg: 0.06, RightLeg: 0.06,
  LeftFoot: 0.05, RightFoot: 0.05, LeftToeBase: 0.035, RightToeBase: 0.035,
};
const MASS = { Hips: 3, Spine02: 2, Spine01: 2, Spine: 3, Head: 1.5, LeftUpLeg: 2, RightUpLeg: 2 };   // (others 1)
// Extra struts, [a, b, shortest, longest] as shares of the length in the pose he died in: they keep
// his chest, shoulders and pelvis whole and let the spine and neck bend only so far.
const STRUTS = [
  ['LeftUpLeg', 'RightUpLeg', 1, 1], ['LeftUpLeg', 'Spine02', 1, 1], ['RightUpLeg', 'Spine02', 1, 1],
  ['LeftArm', 'RightArm', 1, 1], ['LeftArm', 'Spine', 1, 1], ['RightArm', 'Spine', 1, 1], ['LeftArm', 'neck', 1, 1], ['RightArm', 'neck', 1, 1],
  ['LeftShoulder', 'RightShoulder', 1, 1], ['LeftShoulder', 'Spine', 1, 1], ['RightShoulder', 'Spine', 1, 1],
  ['neck', 'head_end', 1, 1], ['Spine', 'Head', 0.86, 1.06],
  ['Hips', 'Spine01', 0.85, 1.05], ['Spine02', 'Spine', 0.85, 1.05], ['Hips', 'Spine', 0.82, 1.05], ['Hips', 'neck', 0.8, 1.05],
  ['LeftArm', 'LeftUpLeg', 0.8, 1.06], ['RightArm', 'RightUpLeg', 0.8, 1.06], ['LeftArm', 'RightUpLeg', 0.82, 1.06], ['RightArm', 'LeftUpLeg', 0.82, 1.06],
];
// A limb can't fold flat: the hand stays this share of the arm's length from the shoulder, the foot from the hip.
const FOLD = [['LeftArm', 'LeftHand', 0.32], ['RightArm', 'RightHand', 0.32], ['LeftUpLeg', 'LeftFoot', 0.36], ['RightUpLeg', 'RightFoot', 0.36]];
// Bones turned by two directions (along the bone, and across him), not just swung: the trunk and head.
const FRAMED = {
  Hips: ['Spine02', 'hips'], Spine02: ['Spine01', 'hips'], Spine01: ['Spine', 'chest'], Spine: ['neck', 'chest'],
  neck: ['Head', 'chest'], Head: ['head_end', 'chest'],
};
// Which joints belong to which wound's part (for muscle: that part lets go first).
const LEG = { Left: ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'], Right: ['RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'] };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

// The frame a soldier's body is in: origin at the hips, x across to his right hip, y up his back.
function pelvisFrame(P, out) {
  const o = P.Hips.p, x = _a.subVectors(P.RightUpLeg.p, P.LeftUpLeg.p).normalize();
  const y = _b.subVectors(P.Spine.p, o);
  y.addScaledVector(x, -y.dot(x)).normalize();
  const z = _c.crossVectors(x, y);
  return out.makeBasis(x, y, z).setPosition(o);
}

// A rotation from the basis (along, across): `along` exact, `across` made square to it.
function basis(along, across, out) {
  const y = _a.copy(along).normalize(), x = _b.copy(across);
  x.addScaledVector(y, -x.dot(y));
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0).addScaledVector(y, -y.x);
  x.normalize();
  const z = _c.crossVectors(x, y);
  return out.setFromRotationMatrix(_m.makeBasis(x, y, z));
}

export class Ragdoll {
  // s: the soldier (his char, bones, and the world's hooks floorAt / collide).
  // hit: { dir (unit), point, zone, power 0-1.2, blast 0-1.5, vel (his own speed, m/s) }.
  constructor(s, hit) {
    this.s = s;
    this.t = 0; this.stillT = 0; this.asleep = false;
    const bones = s.char.bones;
    s.char.model.updateMatrixWorld(true);
    // The joints, with their bones: parents before children.
    this.P = {}; this.list = [];
    for (const name of Object.keys(RADIUS)) {
      const bone = bones[name];
      if (!bone) continue;
      const p = bone.getWorldPosition(new THREE.Vector3());
      const j = { name, bone, p, prev: p.clone(), v: new THREE.Vector3(), r: RADIUS[name], w: 1 / (MASS[name] ?? 1), tone: 0, toneT: 0, ground: false };
      this.P[name] = j; this.list.push(j);
    }
    const P = this.P;
    // Bones: each joint to its child joint, at the length it has now.
    this.links = [];
    for (const j of this.list) {
      const parent = j.bone.parent;
      if (parent?.isBone && P[parent.name]) this.links.push(this.link(P[parent.name], j, 1, 1));
    }
    for (const [a, b, lo, hi] of STRUTS) if (P[a] && P[b]) this.links.push(this.link(P[a], P[b], lo, hi));
    this.folds = FOLD.filter(([a, b]) => P[a] && P[b]).map(([a, b, k]) => {
      const mid = a.replace('Arm', 'ForeArm').replace('UpLeg', 'Leg');
      return { a: P[a], b: P[b], min: k * (P[a].p.distanceTo(P[mid].p) + P[mid].p.distanceTo(P[b].p)) };
    });
    // The pose he died in, for the bones (each bone's world turn and its directions then) and for
    // muscle (each joint in his pelvis's frame).
    this.F0 = pelvisFrame(P, new THREE.Matrix4());
    const inv = this.F0.clone().invert();
    for (const j of this.list) {
      j.local = j.p.clone().applyMatrix4(inv);
      j.q0 = j.bone.getWorldQuaternion(new THREE.Quaternion());
      const child = this.childOf(j);
      j.child = child;
      j.dir0 = child ? child.p.clone().sub(j.p) : null;
      if (FRAMED[j.name]) j.b0 = basis(P[FRAMED[j.name][0]].p.clone().sub(j.p), this.across(FRAMED[j.name][1]), new THREE.Quaternion());
    }
    this.order = this.list.slice();     // (already parents first: RADIUS lists them that way)
    // Which way across × up points: to his front or his back (it depends on the rig).
    const yaw = s.root.rotation.y, facing = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.front = this.frontOf(1).dot(facing) >= 0 ? 1 : -1;
    this.hit(hit);
    s.char.mixer.stopAllAction();       // (from now on the bones are his fall's)
    s.char.base = null;
  }

  link(a, b, lo, hi) { const d = a.p.distanceTo(b.p); return { a, b, lo: d * lo, hi: d * hi }; }

  childOf(j) {
    const P = this.P, n = j.name;
    if (FRAMED[n]) return P[FRAMED[n][0]];
    for (const c of j.bone.children) if (c.isBone && P[c.name]) return P[c.name];
    return null;
  }

  // Across him: from his left hip to his right, or his left shoulder to his right.
  across(which) {
    const P = this.P;
    return which === 'hips' ? _d.subVectors(P.RightUpLeg.p, P.LeftUpLeg.p) : _d.subVectors(P.RightArm.p, P.LeftArm.p);
  }

  // The round, or the blast, and how long his muscles hold.
  hit({ dir, point = null, zone = 'torso', power = 1, blast = 0, vel = null }) {
    const P = this.P, d = dir.clone().normalize();
    for (const j of this.list) if (vel) j.v.copy(vel);
    if (blast > 0) {
      // Thrown: up and away, tumbling the way he flies.
      const k = Math.min(1.5, blast), flat = d.clone().setY(0).normalize();
      const axis = new THREE.Vector3(flat.z, 0, -flat.x), spin = 2 + 3 * k * (0.7 + 0.6 * Math.random());
      for (const j of this.list) {
        const r = _a.subVectors(j.p, P.Hips.p);
        j.v.addScaledVector(flat, (1.5 + 6.5 * k) * (0.9 + 0.2 * Math.random())).setY(j.v.y + (2 + 4.5 * k) * (0.9 + 0.2 * Math.random()));
        j.v.addScaledVector(_b.crossVectors(axis, r), spin);
        j.tone = 0;
      }
      return;
    }
    // The push: into the joints near where it struck, and a little into all of him.
    // (A round barely moves a man; what it does is take his legs or his balance. The push is kept
    // small, and an arm goes with its shoulder unless it's the arm that was hit: else the arms fly.)
    const at = point ?? P.Spine.p, kick = { head: 1.1, torso: 1.3, pelvis: 1.5, arm: 1.4, leg: 2.2 }[zone] ?? 1.3;
    const near = (j) => Math.exp(-((j.p.distanceTo(at) / 0.22) ** 2));
    for (const j of this.list) {
      const shoulder = zone !== 'arm' && /ForeArm|Hand/.test(j.name) ? P[j.name.startsWith('Left') ? 'LeftArm' : 'RightArm'] : j;
      j.v.addScaledVector(d, power * (0.3 + kick * near(shoulder)));
    }
    // A leg shot: that leg goes from under him (the shin and foot are kicked back as it buckles).
    const side = zone === 'leg' && point ? (P.LeftUpLeg.p.distanceTo(point) < P.RightUpLeg.p.distanceTo(point) ? 'Left' : 'Right') : null;
    // Muscle: [tone 0-1, seconds it lasts]. Head: none; heart and chest: it fades over about a second.
    const [tone, last] = zone === 'head' ? [0, 0] : zone === 'leg' ? [0.55, 1.1] : zone === 'arm' ? [0.5, 1.0] : [0.45, 0.55 + 0.6 * Math.random()];
    for (const j of this.list) {
      const leg = side && LEG[side].includes(j.name);
      const arm = /Arm|Hand|Shoulder/.test(j.name);   // (the arms hang: no one holds them up once he's hit)
      j.tone = leg ? 0 : arm ? tone * 0.25 : tone;
      j.toneT = leg ? 0 : last * (j.name.includes('Leg') || j.name.includes('Foot') ? 0.6 : 1);   // (the legs give first)
    }
  }

  step(dt) {
    if (this.asleep) return;
    dt = Math.min(dt, 1 / 30);
    this.t += dt;
    const h = dt / SUB;
    const frame = pelvisFrame(this.P, _m.clone());
    // What he might touch this frame: the boxes and trunks within reach of him.
    const hips = this.P.Hips.p;
    this.boxes = this.s.nearBoxes ? this.s.nearBoxes(hips, 2.5) : [];
    this.trees = this.s.treesNear ? this.s.treesNear(hips.x, hips.z) : [];
    let fastest = 0;
    for (let s = 0; s < SUB; s++) {
      for (const j of this.list) {
        j.prev.copy(j.p);
        j.v.y -= G * h;
        j.v.multiplyScalar(1 - DRAG * h);
        if (j.ground) { const k = Math.max(0, 1 - FRICTION * h); j.v.x *= k; j.v.z *= k; }
        j.p.addScaledVector(j.v, h);
      }
      // Muscle: each joint drawn toward where it was in his body's frame, while it lasts.
      for (const j of this.list) {
        if (j.tone <= 0 || this.t > j.toneT) continue;
        const k = 1 - Math.exp(-TONE * j.tone * (1 - this.t / j.toneT) * h);
        _a.copy(j.local).applyMatrix4(frame);
        j.p.lerp(_a, k);
      }
      for (let i = 0; i < ITER; i++) {
        for (const l of this.links) this.solve(l.a, l.b, l.lo, l.hi);
        for (const f of this.folds) this.solve(f.a, f.b, f.min, Infinity);
        this.limits();
      }
      this.collide();
      for (const j of this.list) {
        j.v.subVectors(j.p, j.prev).divideScalar(h);
        fastest = Math.max(fastest, j.v.lengthSq());
      }
    }
    this.pose();
    this.stillT = fastest < SLEEP_V * SLEEP_V ? this.stillT + dt : 0;
    if ((this.stillT > SLEEP_T && this.t > 1) || this.t > MAX_T) this.asleep = true;
  }

  solve(a, b, lo, hi) {
    const d = _a.subVectors(b.p, a.p), len = d.length();
    if (len < 1e-6 || (len >= lo && len <= hi)) return;
    const want = len < lo ? lo : hi, k = (len - want) / len / (a.w + b.w);
    a.p.addScaledVector(d, k * a.w);
    b.p.addScaledVector(d, -k * b.w);
  }

  // The way his pelvis faces (sign: `this.front`).
  frontOf(sign = this.front) {
    const P = this.P, x = _c.subVectors(P.RightUpLeg.p, P.LeftUpLeg.p).normalize();
    return _d.crossVectors(x, _b.subVectors(P.Spine.p, P.Hips.p)).normalize().multiplyScalar(sign);
  }

  // Knees bend forward only; the legs and feet don't pass through each other.
  limits() {
    const P = this.P, fwd = this.frontOf();
    for (const side of ['Left', 'Right']) {
      const hip = P[side + 'UpLeg'], knee = P[side + 'Leg'], foot = P[side + 'Foot'];
      if (!hip || !knee || !foot) continue;
      const line = _a.subVectors(foot.p, hip.p), L = line.lengthSq();
      if (L < 1e-6) continue;
      const t = _b.subVectors(knee.p, hip.p).dot(line) / L;
      const off = _b.copy(hip.p).addScaledVector(line, t).sub(knee.p).negate();   // knee off the hip-foot line
      const back = off.dot(fwd);
      if (back < 0) knee.p.addScaledVector(fwd, -back * 1.6);
    }
    this.apart(P.LeftLeg, P.RightLeg, 0.13);
    this.apart(P.LeftFoot, P.RightFoot, 0.11);
    this.apart(P.LeftHand, P.Spine01, 0.12);
    this.apart(P.RightHand, P.Spine01, 0.12);
  }

  apart(a, b, min) { if (a && b) this.solve(a, b, min, Infinity); }

  // The floor (terrain, a step, a deck), and walls and trunks. A box whose top is within a hand's
  // breadth under a joint is floor to it; anything higher is a wall it's pushed out of.
  collide() {
    const s = this.s, boxes = this.boxes, trees = this.trees;
    for (const j of this.list) {
      const p = j.p, r = j.r, feet = Math.max(j.prev.y, p.y) - r;
      for (const b of boxes) {
        if (b.max.y <= feet + LEDGE || b.min.y > p.y + r) continue;
        const cx = Math.min(Math.max(p.x, b.min.x), b.max.x), cz = Math.min(Math.max(p.z, b.min.z), b.max.z);
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-8) {                     // (inside it: out the shortest way)
          const ox = Math.min(p.x - b.min.x, b.max.x - p.x), oz = Math.min(p.z - b.min.z, b.max.z - p.z);
          if (ox < oz) p.x = p.x - b.min.x < b.max.x - p.x ? b.min.x - r : b.max.x + r;
          else p.z = p.z - b.min.z < b.max.z - p.z ? b.min.z - r : b.max.z + r;
          continue;
        }
        const d = Math.sqrt(d2);
        p.x = cx + dx / d * r; p.z = cz + dz / d * r;
      }
      for (const t of trees) {
        const dx = p.x - t.x, dz = p.z - t.z, rr = r + t.r, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2); p.x = t.x + dx / d * rr; p.z = t.z + dz / d * rr; }
      }
      let floor = s.groundAt ? s.groundAt(p.x, p.z) : -Infinity;
      for (const b of boxes) {
        if (b.max.y > feet + LEDGE || b.max.y <= floor) continue;
        if (p.x < b.min.x - 0.03 || p.x > b.max.x + 0.03 || p.z < b.min.z - 0.03 || p.z > b.max.z + 0.03) continue;
        floor = b.max.y;
      }
      j.ground = p.y - r <= floor + 0.01;
      if (j.ground) p.y = floor + r;
    }
  }

  // The bones from the joints: each turned from the pose he died in to where its joints are now.
  pose() {
    const s = this.s, P = this.P, hips = P.Hips.bone;
    hips.parent.updateMatrixWorld(true);
    hips.position.copy(hips.parent.worldToLocal(P.Hips.p.clone()));
    const world = new Map();
    for (const j of this.order) {
      let q;
      if (j.b0) {
        q = basis(j.child.p.clone().sub(j.p), this.across(FRAMED[j.name][1]), new THREE.Quaternion()).multiply(_q.copy(j.b0).invert()).multiply(j.q0);
      } else if (j.child && j.dir0) {
        // (swung, keeping its parent's turn about its own length)
        const pd = world.get(j.bone.parent.name), p0 = P[j.bone.parent.name]?.q0;
        const carried = pd && p0 ? _q2.copy(pd).multiply(_q.copy(p0).invert()) : new THREE.Quaternion();
        const dir0 = j.dir0.clone().applyQuaternion(carried);
        q = new THREE.Quaternion().setFromUnitVectors(dir0.normalize(), _a.subVectors(j.child.p, j.p).normalize()).multiply(carried).multiply(j.q0);
      } else {
        const pd = world.get(j.bone.parent.name), p0 = P[j.bone.parent.name]?.q0;
        q = pd && p0 ? pd.clone().multiply(_q.copy(p0).invert()).multiply(j.q0) : j.q0.clone();   // (a hand or toe: as its parent turned)
      }
      world.set(j.name, q);
      const parentQ = world.get(j.bone.parent.name) ?? j.bone.parent.getWorldQuaternion(new THREE.Quaternion());
      j.bone.quaternion.copy(parentQ.clone().invert().multiply(q));
    }
    // (bones with no joint of their own, the face's: they ride on the head)
    s.root.updateMatrixWorld(true);
  }

  // He's being dragged, or a save is loading: stop where he is.
  stop() { this.asleep = true; }
}

// His pose as it lies, for a save: each bone's turn and where his hips are, in his own frame.
export function bodyPose(char) {
  const out = { hips: char.bones.Hips.position.toArray().map(v => +v.toFixed(4)), q: {} };
  for (const [n, b] of Object.entries(char.bones)) out.q[n] = b.quaternion.toArray().map(v => +v.toFixed(4));
  return out;
}

export function setBodyPose(char, pose) {
  char.mixer.stopAllAction();
  char.base = null;
  for (const [n, q] of Object.entries(pose.q)) char.bones[n]?.quaternion.fromArray(q).normalize();
  char.bones.Hips.position.fromArray(pose.hips);
  char.model.updateMatrixWorld(true);
}
