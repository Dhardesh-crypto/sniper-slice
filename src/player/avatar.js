// The player's own body, seen in third person: the Higgsfield/Meshy sniper model,
// animated by stance and speed (idle, walk, rifle sprint, crouch walk, crawl), with the
// arms holding the rifle on a separate layer. Faces -z at yaw 0, like the camera.
import * as THREE from 'three';
import { Character, pistolModelFor, fitMuzzle, fitBayonet, solveArmIK, assets } from '../world/characters.js';
import { CATALOG } from '../weapons/defs.js';

// Natural ground speed (m/s) of each clip at timeScale 1, to keep feet from sliding.
const CLIP_SPEED = { walkLegs: 1.35, crouchLegs: 0.95, sprint: 4.6, crawl: 0.55 };
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// The Welrod: a long silenced tube with the magazine as the grip, a trigger guard, and the
// bolt knob at the back. Origin at the grip, muzzle toward -z.
export function pistolModel() {
  const steel = new THREE.MeshStandardMaterial({ color: 0x2b2d2f, roughness: 0.45, metalness: 0.55 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x3b3631, roughness: 0.9 });
  const g = new THREE.Group();
  const tube = (r, len, z, mat = steel) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(0, 0.02, z);
    g.add(m);
    return m;
  };
  tube(0.017, 0.12, -0.02);                 // the receiver
  tube(0.021, 0.24, -0.2);                  // the silencer, fatter
  tube(0.019, 0.012, -0.32);                // the end cap
  tube(0.012, 0.02, 0.05);                  // the bolt knob at the back
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 8), steel);
  knob.position.set(0, 0.02, 0.065);
  // The magazine is the grip, wrapped in rubber, angled back a little.
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.1, 0.034), rubber);
  grip.position.set(0, -0.04, 0.02);
  grip.rotation.x = -0.18;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.008, 0.038), steel);
  base.position.set(0, -0.09, 0.03);
  base.rotation.x = -0.18;
  // The trigger and its guard.
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.003, 6, 16, Math.PI), steel);
  guard.rotation.set(Math.PI, Math.PI / 2, 0);
  guard.position.set(0, 0.003, -0.022);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.018, 0.005), steel);
  trigger.position.set(0, -0.004, -0.02);
  g.add(knob, grip, base, guard, trigger);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.33);
  return g;
}

// Full-body actions: clip, speed, where in the clip to start (a fraction), and for one-shots
// how long they last. Aiming a throw holds the wind-up (speed 0); letting go plays the throw on
// from there.
const ACTIONS = {
  aim: { clip: 'throw', rate: 0, from: 0.4 },
  aimCrouch: { clip: 'throwCrouch', rate: 0, from: 0.42 },
  throw: { clip: 'throw', rate: 1.8, from: 0.4, dur: 0.9, once: true },
  throwCrouch: { clip: 'throwCrouch', rate: 2.2, from: 0.42, dur: 1.0, once: true },
  place: { clip: 'place', rate: 4.5, from: 0, dur: 1.8, once: true },
  heal: { clip: 'kneelWork', rate: 1.3, from: 0 },
  search: { clip: 'search', rate: 3, from: 0, once: true },
};

export class Avatar {
  constructor(scene) {
    this.char = new Character('player', { faceMinusZ: true });
    this.root = this.char.root;
    this.pistol = this.welrod = pistolModel();
    this.pistolKind = 'welrod';
    this.root.add(this.pistol);
    scene.add(this.root);
    this.yaw = 0;
    this.s = { prone: 0, crouch: 0, kneel: 0, upright: 0, aim: 0, ready: 0, pitch: 0 };
    this.state = '';
    this.char.play('idleLegs', { fade: 0 });
    this.buildConcealLook();
  }

  // A guard's uniform over your own kit (disguise.js): his model's mesh, bound to your bones (the
  // guards and you share one skeleton), your own hidden under it.
  wearUniform(look) {
    this.takeOffUniform();
    let src = null;
    (assets.models[look] ?? assets.models.guard)?.scene.traverse(o => { if (o.isSkinnedMesh && !src) src = o; });
    const mine = this.char.skinned;
    if (!src || !mine) return false;
    const bones = src.skeleton.bones.map(b => this.char.bones[b.name]);
    if (bones.some(b => !b)) return false;
    const mesh = new THREE.SkinnedMesh(src.geometry, src.material);
    mesh.position.copy(src.position); mesh.quaternion.copy(src.quaternion); mesh.scale.copy(src.scale);
    mine.parent.add(mesh);
    mesh.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses.map(m => m.clone())), src.bindMatrix.clone());
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.boundingSphere = mine.boundingSphere?.clone() ?? null;
    mesh.frustumCulled = mine.frustumCulled;
    mine.visible = false;
    this.uniform = mesh;
    return true;
  }

  takeOffUniform() {
    if (!this.uniform) return;
    this.uniform.removeFromParent();
    this.uniform = null;
    if (this.char.skinned) this.char.skinned.visible = true;
  }

  // Carry the loadout: the rifle's model (with a fitted suppressor or muzzle brake on it) and
  // the pistol (the Welrod, or the P38 or Luger with a suppressor if fitted).
  setWeapons(loadout, arsenal) {
    const rdef = arsenal.weapons.rifle.def, pdef = arsenal.weapons.pistol.def;
    this.rifleKind = CATALOG[loadout.rifle].model;
    this.rifleDevice = rdef.suppressor && !rdef.integralSuppressor ? 'suppressor' : rdef.brake ? 'brake' : null;
    this.rifleBayonet = !!rdef.bayonet;
    this.heavyKind = loadout.heavy ? CATALOG[loadout.heavy].model : null;
    this.char.rifle.userData.kind = null;     // refit on the next holdLongGun
    this.holdLongGun(arsenal.current);
    const want = loadout.pistol;
    if (this.pistolKind !== want) {
      const visible = this.pistol.visible;
      this.pistol.removeFromParent();
      this.pistol = (want !== 'welrod' && pistolModelFor(CATALOG[want].model)) || this.welrod;
      this.pistol.visible = visible;
      this.root.add(this.pistol);
      this.pistolKind = want;
    }
    if (this.pistol !== this.welrod) fitMuzzle(this.pistol, pdef.suppressor ? 'suppressor' : null, -1);
  }

  // One long gun in the hands or on the back: the heavy weapon while it's the one out, else the rifle.
  holdLongGun(weapon) {
    const kind = weapon === 'heavy' && this.heavyKind ? this.heavyKind : this.rifleKind;
    if (!kind || this.char.rifle.userData.kind === kind) return;
    this.char.setRifle(kind);
    if (kind === this.rifleKind) { fitMuzzle(this.char.rifle, this.rifleDevice, 1); fitBayonet(this.char.rifle, this.rifleBayonet, 1); }
    if (this.concealParts) this.char.rifle.traverse(o => { if (o.isMesh && !this.fadeMats.includes(o.material)) { o.material = o.material.clone(); this.fadeMats.push(o.material); } });
  }

  // Concealed in tall grass: the body turns translucent with a white outline. The outline is
  // a slightly inflated copy of the skinned body drawn back faces only (so just its rim shows);
  // a depth-only copy drawn first keeps the far side of the body from showing through.
  buildConcealLook() {
    this.conceal = 0;
    this.outlineMats = [];
    this.fadeMats = [];
    this.concealParts = [];
    const skins = [];
    this.char.model.traverse(o => { if (o.isSkinnedMesh) skins.push(o); });
    for (const m of skins) {
      m.material = m.material.clone();
      this.fadeMats.push(m.material);
      const depth = m.clone();
      depth.material = new THREE.MeshBasicMaterial({ colorWrite: false });
      depth.renderOrder = 999; // after the rest of the opaque scene, so what is behind the body still gets drawn
      const outline = m.clone();
      outline.material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false });
      outline.material.onBeforeCompile = (sh) => {
        sh.uniforms.uWidth = { value: 0.02 }; // metres: the skinned geometry is in metres (the skeleton undoes the node's 0.01)
        sh.vertexShader = sh.vertexShader
          .replace('void main() {', 'uniform float uWidth;\nvoid main() {')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * uWidth;');
      };
      this.outlineMats.push(outline.material);
      for (const c of [depth, outline]) { c.castShadow = c.receiveShadow = false; c.visible = false; c.userData.noAO = true; c.userData.concealCopy = true; m.parent.add(c); }
      this.concealParts.push(depth, outline);
    }
    this.char.rifle.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); this.fadeMats.push(o.material); } });
  }

  updateConcealLook(dt, concealed) {
    this.conceal = damp(this.conceal, concealed ? 1 : 0, 6, dt);
    const k = this.conceal, on = k > 0.01;
    for (const m of this.fadeMats) {
      m.transparent = on;
      m.opacity = 1 - 0.55 * k;
      m.depthWrite = !on || m.isMeshBasicMaterial; // the depth copy has already written the body's depth
    }
    for (const m of this.outlineMats) m.opacity = 0.85 * k;
    for (const p of this.concealParts) p.visible = on;
    // Kept out of the AO pass while see-through, or it would darken the ground behind.
    this.char.model.traverse(o => { if (o.isSkinnedMesh && !o.userData.concealCopy) o.userData.noAO = on; });
  }

  muzzle(weapon, out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    if (weapon === 'pistol') return out.copy(this.pistol.userData.muzzle).applyMatrix4(this.pistol.matrixWorld);
    return this.char.muzzleWorld(out);
  }

  // A one-off action (from the item kit): 'throw' (or 'throwCrouch') or 'place'.
  perform(kind) { this.oneShot = { kind, t: 0, dur: ACTIONS[kind].dur }; }

  // st: { pos, lookYaw, lookPitch, moveYaw, stance, speed, sprinting, weapon, aiming, ready, boltT, reloading, visible }
  update(dt, st) {
    const s = this.s, c = this.char;
    this.updateConcealLook(dt, st.concealed && !st.dead);
    this.root.visible = st.visible;
    this.root.position.copy(st.pos);
    if (st.dead) {
      if (this.state !== 'dead') { this.state = 'dead'; c.setHoldWeight(0); c.play('deathBack', { fade: 0.1, once: true }); }
      c.update(dt);
      this.root.updateMatrixWorld(true);
      c.placeRifleInHands('low');
      return;
    }

    // Face where you're moving; face the camera when aiming or shooting; face the rungs on a ladder.
    const climb = st.climb;
    const facing = st.takedownYaw ?? (climb?.kind === 'ladder' ? climb.ladder.yaw
      : climb ? Math.atan2(-(climb.to.x - climb.from.x), -(climb.to.z - climb.from.z)) || this.yaw
      : st.aiming || st.ready > 0.05 || st.speed < 0.3 ? st.lookYaw : st.moveYaw);
    let d = facing - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-(st.aiming || st.takedownYaw !== undefined ? 18 : 9) * dt));
    this.root.rotation.y = this.yaw;

    // Pick the base clip from stance and speed, and match its pace to the real speed.
    const moving = st.speed > 0.25;
    if (this.oneShot && (this.oneShot.t += dt) > this.oneShot.dur) this.oneShot = null;
    const act = st.stance === 'prone' ? null : this.oneShot ? ACTIONS[this.oneShot.kind]
      : st.throwAim ? ACTIONS[st.stance === 'crouch' ? 'aimCrouch' : 'aim']
      : st.healing && !moving ? ACTIONS.heal : st.searching ? ACTIONS.search : null;   // (healing on the move: just walk)
    let clip, rate = 1, from = null;
    if (st.takedown && c.action('takedownAtk')) {
      clip = 'takedownAtk';
      rate = 1.3;
    } else if (climb) {
      // Hand over hand up the rungs (paced to the climb, reversed going down); hauling up a ledge.
      const ladder = climb.kind === 'ladder';
      clip = ladder ? (c.action('ladderClimb') ? 'ladderClimb' : 'walkLegs') : (c.action('climbWall') ? 'climbWall' : 'crouchLegs');
      rate = ladder ? THREE.MathUtils.clamp((st.climbRate ?? 0) / 0.28, -3, 3) : 1.6;
    } else if (act && c.action(act.clip)) {
      // Throwing (wound up while you aim, then the throw), placing a charge, bandaging, searching.
      clip = act.clip; rate = act.rate; from = act.from;
    } else if (st.stance === 'prone') {
      clip = 'crawl';
      rate = moving ? -st.speed / CLIP_SPEED.crawl : 0; // the crawl clip goes backward: play it reversed
    } else if (st.sprinting) {
      clip = 'sprint';
      rate = st.speed / CLIP_SPEED.sprint;
    } else if (st.stance === 'crouch') {
      clip = 'crouchLegs';
      rate = moving ? st.speed / CLIP_SPEED.crouchLegs : 0; // hold a crouched stride when still
    } else if (moving) {
      clip = 'walkLegs';
      rate = st.speed / CLIP_SPEED.walkLegs;
    } else {
      clip = 'idleLegs';
    }
    if (clip !== this.state) {
      c.play(clip, { fade: clip === 'takedownAtk' ? 0.1 : clip === 'crawl' || this.state === 'crawl' ? 0.35 : 0.22, once: clip === 'takedownAtk' || !!act?.once });
      if (from !== null && c.base) c.base.time = from * c.base.getClip().duration;
      this.state = clip;
    }
    if (c.base) c.base.timeScale = rate;
    const busy = !!(climb || st.takedown || st.mounted || (act && this.state === act.clip));   // both hands busy: the rifle goes on the back

    // Arms hold the rifle except while sprinting (the sprint clip carries it) or crawling.
    s.prone = damp(s.prone, st.stance === 'prone' ? 1 : 0, 6, dt);
    const holdTarget = st.sprinting || st.stance === 'prone' || busy ? 0 : 1;
    c.setHoldWeight(damp(c.hold?.getEffectiveWeight() ?? 1, holdTarget, 10, dt));
    c.update(dt);
    // Crouched low behind cover; aiming raises you to look over it.
    const peek = st.aiming || st.ready > 0.35;
    s.crouch = damp(s.crouch, st.mounted ? 0.55 : st.stance === 'crouch' && !busy ? (peek ? 0.4 : 1) : 0, 8, dt);   // (the action clips crouch by themselves; stooped over a nest's gun)
    s.kneel = damp(s.kneel, st.stance === 'crouch' && !busy && !st.mounted && !moving ? 1 : 0, 6, dt);   // crouched and still: down on one knee
    s.upright = damp(s.upright, peek ? 1 : 0, 8, dt);
    c.lowerBody(s.crouch, st.mounted ? { drop: 0.3, sitBack: 0.1, lean: 0.32, plant: true } : { plant: !moving, kneel: s.kneel, upright: s.upright });

    // Leaning out past a corner (player.js): the spine rolls toward that side, the head back level.
    if (Math.abs(st.lean ?? 0) > 0.01) {
      const fwd = new THREE.Vector3(-Math.sin(st.lookYaw), 0, -Math.cos(st.lookYaw));   // (rolling about it by + tips you right)
      this.root.updateMatrixWorld(true);
      for (const [name, k] of [['Spine', 0.3], ['Spine01', 0.3], ['Spine02', 0.3], ['neck', -0.55]]) {
        const bone = c.bones[name];
        if (!bone) continue;
        // (undone at the next update, like the crouch, in case no clip drives these bones)
        c._lowered ??= [];
        if (!c._lowered.some(([b]) => b === bone)) c._lowered.push([bone, bone.position.clone(), bone.quaternion.clone()]);
        rollBone(bone, fwd, st.lean * k);
      }
    }

    // Weapon up: after a shot or while aiming, the rifle comes to the shoulder.
    s.ready = damp(s.ready, Math.max(st.ready, st.aiming ? 1 : 0), 14, dt);
    this.root.updateMatrixWorld(true);

    // Weapons: rifle (or heavy weapon) shouldered or carried in both hands, or slung with the pistol drawn.
    this.holdLongGun(st.weapon);
    if (busy) {
      c.slingRifle(); // both hands for climbing, the knife, throwing, placing, bandaging, searching
      this.pistol.visible = false;
    } else if (st.weapon === 'rifle' || st.weapon === 'heavy') {
      const shoulder = s.ready > 0.35 && !st.reloading && !st.sprinting && st.stance !== 'prone';
      if (shoulder) {
        const cp = Math.cos(st.lookPitch);
        const dir = new THREE.Vector3(-Math.sin(st.lookYaw) * cp, Math.sin(st.lookPitch), -Math.cos(st.lookYaw) * cp);
        const bolt = st.boltT >= 0 ? Math.sin(st.boltT * Math.PI) : 0; // the bolt draws the rifle back a little
        c.placeRifleShouldered(dir, (st.kick ?? 0) * 0.06 + bolt * 0.03);
      } else {
        c.placeRifleInHands(st.stance === 'prone' ? 'prone' : 'port');
      }
      this.pistol.visible = false;
    } else {
      c.slingRifle();
      this.pistol.visible = true;
      const hand = c.bones.RightHand;
      if (hand) {
        hand.getWorldPosition(this.pistol.position);
        this.root.worldToLocal(this.pistol.position);
        // Point along the body's facing, tilted with the look pitch when aimed.
        this.pistol.rotation.set(st.lookPitch * s.ready, 0, 0); // muzzle is -z, the body's forward
      }
    }
    // On a nest's machine gun: the right hand on its grip, the left on top of the receiver.
    if (st.mounted) {
      const [right, left] = st.mounted.grips(), b = c.bones, out = (x, y, z) => c.modelDir(x, y, z).applyQuaternion(this.root.quaternion).add(b.Hips.getWorldPosition(new THREE.Vector3()));
      solveArmIK(b.RightArm, b.RightForeArm, b.RightHand, right, out(-0.8, -1, -0.3));
      solveArmIK(b.LeftArm, b.LeftForeArm, b.LeftHand, left, out(0.8, -1, -0.3));
    }
  }
}

// Turn a bone by `angle` about a world-space axis, keeping its parent where it is.
const _q = new THREE.Quaternion(), _w = new THREE.Quaternion(), _p = new THREE.Quaternion();
function rollBone(bone, axis, angle) {
  if (!bone) return;
  bone.getWorldQuaternion(_w);
  bone.parent.getWorldQuaternion(_p);
  bone.quaternion.copy(_p.invert().multiply(_q.setFromAxisAngle(axis, angle).multiply(_w)));
  bone.updateMatrixWorld(true);
}
