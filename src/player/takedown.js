// Knife takedowns, Sniper Elite style. Get within reach of a guard who hasn't raised the
// alarm and press F: from behind (within 70° of his back) it always works, even if he's
// wary; from the side or front only while he's calm. You step in behind him, grab and
// strike (Higgsfield thrust clip on you, strangled-fall clip on him) with a beat of slow
// motion, and he drops almost without a sound. F still drags bodies when no one's in reach.
// Ambush: hidden in tall grass, any guard who hasn't spotted you can be taken from any side
// (calm, wary or searching), even in the moment he stumbles onto you; he's spun round as
// you grab him.
// Bayonet (a muzzle part, defs.js): with it fitted and the rifle in your hands, F runs any guard
// through who's close in front of you, whatever he knows: a lunge and a thrust, face to face. Not
// quiet: he cries out.
import * as THREE from 'three';
import { animalsNear, killAnimal } from '../world/animals.js';

const REACH = 1.7;
const AMBUSH_REACH = 2.8;    // from hiding you can spring a little further
const BEHIND = Math.cos(THREE.MathUtils.degToRad(70));
const STEP_IN = 0.22;        // seconds to slide into place behind him
const STAND_OFF = 1.45;      // metres behind him: the thrust clip lunges ~0.8 m and reaches 1.6 m
const STRIKE_AT = 0.7;       // seconds: the thrust's hand peaks at 0.9 s of the clip, played 1.3× fast
const DURATION = 0.96;
const BAYONET_REACH = 2.4;   // m (any side: you turn to it as you lunge)
const DOG_REACH = 2.2, DOG_STRIKE = 0.22, DOG_TIME = 0.55;   // m; s to the blade going in; s before you're your own again
const LUNGE = 0.22, BAYONET_TIME = 0.5;   // s to close in and strike; s before you're your own again       // seconds: the clip's lunge ends at 1.25 s (after that it slashes again)

function knifeModel() {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.17), new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.25, metalness: 0.9 }));
  blade.position.z = 0.1;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.1), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8 }));
  g.add(blade, grip);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.visible = false;
  return g;
}

export class Takedown {
  constructor({ world, player, avatar, stealth, input, audio, fx, hud, arsenal }) {
    Object.assign(this, { world, player, avatar, stealth, input, audio, fx, hud, arsenal });
    this.active = null;
    this.knife = knifeModel();
    avatar.root.add(this.knife);
    this.onKill = null;      // (soldier) => void, for the mission stats
    this.onSlowmo = null;    // () => void
  }

  // The guard you could take down right now, or null.
  candidate() {
    const p = this.player, hidden = !!this.stealth.concealed;
    if (this.active || p.dead || p.climb || p.carrying || !p.grounded || (p.stance === 'prone' && !hidden)) return null;
    let best = null, bestD = hidden ? AMBUSH_REACH : REACH;
    for (const s of this.world.soldiers) {
      if (!s.alive || s.range || !s.aware) continue;
      const dx = p.pos.x - s.root.position.x, dz = p.pos.z - s.root.position.z, d = Math.hypot(dx, dz);
      if (d > bestD || Math.abs(p.pos.y - s.root.position.y) > 0.8) continue;
      const ambush = hidden && !s.aware.spotted;   // includes the startled moment
      if (!ambush) {
        if (d > REACH || s.aware.state === 'alerted') continue;
        const fx = Math.sin(s.root.rotation.y), fz = Math.cos(s.root.rotation.y);  // where he faces
        const behind = (dx * fx + dz * fz) / Math.max(d, 1e-3) < -BEHIND;
        if (!behind && s.aware.state !== 'calm') continue;
      }
      best = s; bestD = d;
    }
    return best;
  }

  // With a bayonet fitted and the rifle out: whatever's nearest within reach, from any side (you
  // turn to it as you lunge): a guard, whatever he knows, a guard dog, a farm animal.
  // { kind: 'soldier' | 'dog' | 'animal', ref, pos }.
  bayonetCandidate() {
    const p = this.player, a = this.arsenal;
    if (this.active || this.bayo || this.dogStab || p.dead || p.climb || p.carrying || p.mounted || p.driving || p.stance === 'prone' || !a || a.current !== 'rifle' || a.mount || !a.def.bayonet || a.reloadT > 0 || a.pendingSwitch) return null;
    let best = null, bestD = BAYONET_REACH;
    const consider = (kind, ref, pos, dy = 0.8) => {
      const d = Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z);
      if (d < bestD && Math.abs(p.pos.y - pos.y) < dy) { best = { kind, ref, pos }; bestD = d; }
    };
    for (const s of this.world.soldiers) if (s.alive && !s.range && !s.downed && !s.riding && !s.manning) consider('soldier', s, s.root.position);
    for (const dog of this.dogs?.dogs ?? []) if (dog.mode !== 'dead') consider('dog', dog, dog.a.root.position, 1);
    for (const an of animalsNear(p.pos, BAYONET_REACH + 1)) consider('animal', an, an.root.position, 1.5);
    return best;
  }

  // A guard dog close by (whatever it's doing: biting you, or about to): the knife.
  dogCandidate() {
    const p = this.player;
    if (this.active || this.bayo || this.dogStab || p.dead || p.climb || p.carrying || p.mounted || p.driving) return null;
    let best = null, bestD = DOG_REACH;
    for (const dog of this.dogs?.dogs ?? []) {
      if (dog.mode === 'dead') continue;
      const d = dog.a.root.position, dist = Math.hypot(d.x - p.pos.x, d.z - p.pos.z);
      if (dist < bestD && Math.abs(d.y - p.pos.y) < 1) { best = dog; bestD = dist; }
    }
    return best;
  }

  state() {
    if (this.active || this.bayo || this.dogStab) return null;
    const b = this.bayonetCandidate();                  // (the bayonet, when it's fixed and the rifle's out)
    if (b) return { label: b.kind === 'dog' ? 'F · BAYONET THE DOG' : b.kind === 'animal' ? `F · BAYONET THE ${b.ref.kind.toUpperCase()}` : 'F · BAYONET', progress: 0 };
    if (this.dogCandidate()) return { label: 'F · KNIFE THE DOG', progress: 0 };
    return this.candidate() ? { label: 'F · TAKEDOWN', progress: 0 } : null;
  }

  tick(dt) {
    if (this.active) { this.run(dt); return; }
    if (this.bayo) { this.runBayonet(dt); return; }
    if (this.dogStab) { this.runDog(dt); return; }
    if (!this.input.wasPressed('KeyF')) return;
    const b = this.bayonetCandidate();
    if (b) { this.input.pressed.delete('KeyF'); this.startBayonet(b); return; }
    const dog = this.dogCandidate();
    if (dog) { this.input.pressed.delete('KeyF'); this.startDog(dog); return; }
    const s = this.candidate();
    if (!s) return;
    this.input.pressed.delete('KeyF'); // don't let the same press start a body drag
    this.start(s);
  }

  start(s) {
    const p = this.player;
    // He ends up facing away from you: from behind that's how he stands already; from the
    // front or side (an ambush) he's spun round as you grab him.
    const yaw0 = s.root.rotation.y;
    const yaw = Math.atan2(s.root.position.x - p.pos.x, s.root.position.z - p.pos.z);
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // Stand right behind him, facing the way he faces.
    const spot = s.root.position.clone().addScaledVector(fwd, -STAND_OFF);
    spot.y = this.world.floorAt(spot.x, spot.z, s.root.position.y + 0.3);
    this.active = { s, t: 0, from: p.pos.clone(), to: spot, struck: false, fwd, yaw: yaw + Math.PI, yaw0, guardYaw: yaw, hips0: this.hipsAhead(fwd) };
    p.locked = true;
    p.vel.set(0, 0, 0);
    if (p.stance !== 'stand') p.setStance('stand');
    p.yaw = yaw + Math.PI;                 // the player faces -z at yaw 0, a soldier +z
    p.pitch = Math.min(p.pitch, 0.1);
    s.takenDown = true;                    // the AI leaves him alone from here
    s.setGait('stand');
    s.aimDir = null;
    s.targetYaw = yaw;
    s.grabbed();                           // his clip starts: grabbed from behind, then falls
    this.knife.visible = true;
    this.audio.rustle();
    this.onSlowmo?.();
  }

  run(dt) {
    const a = this.active, p = this.player, s = a.s;
    a.t += dt;
    // Slide into place behind him.
    const k = Math.min(1, a.t / STEP_IN), e = k * k * (3 - 2 * k);
    p.prevPos.copy(p.pos);
    p.pos.lerpVectors(a.from, a.to, e);
    // Spin him to face away over the same moment.
    const dy = Math.atan2(Math.sin(a.guardYaw - a.yaw0), Math.cos(a.guardYaw - a.yaw0));
    s.root.rotation.y = s.targetYaw = a.yaw0 + dy * e;
    if (!a.struck && a.t >= STRIKE_AT) {
      a.struck = true;
      s.applyHit('torso', { damage: { torso: 999 } }, new THREE.Vector3(Math.sin(s.root.rotation.y), 0, Math.cos(s.root.rotation.y)), { quiet: true });
      this.audio.knife();
      this.stealth.noise(s.root.position.clone(), 3, 'takedown');
      this.fx.blood(s.headPosition(new THREE.Vector3()).setY(s.root.position.y + 1.35), new THREE.Vector3(0, -0.3, 0).add(new THREE.Vector3(Math.sin(s.root.rotation.y), 0, Math.cos(s.root.rotation.y))));
      this.onKill?.(s);
      this.hud.message(s.officer ? 'TAKEDOWN · TARGET ELIMINATED' : 'SILENT TAKEDOWN', s.officer ? 'head' : '');
    }
    if (a.t >= DURATION) {
      // The lunge carried the body forward inside the clip: move you there, so going back
      // to the standing pose doesn't snap you backwards.
      const moved = this.hipsAhead(a.fwd) - a.hips0;
      p.pos.addScaledVector(a.fwd, moved);
      p.pos.y = this.world.floorAt(p.pos.x, p.pos.z, p.pos.y + 0.3);
      p.prevPos.copy(p.pos);
      this.active = null;
      p.locked = false;
      this.knife.visible = false;
    }
  }

  // How far ahead of your feet the avatar's hips are, along `fwd`.
  hipsAhead(fwd) {
    const hips = this.avatar.char.bones.Hips;
    if (!hips) return 0;
    this.avatar.root.updateMatrixWorld(true);
    return hips.getWorldPosition(new THREE.Vector3()).sub(this.avatar.root.position).setY(0).dot(fwd);
  }

  // Keep the knife in the right hand while it's out (called after the avatar is posed).
  placeKnife() {
    if (!this.knife.visible) return;
    const hand = this.avatar.char.bones.RightHand;
    if (!hand) return;
    hand.updateWorldMatrix(true, false);
    const at = hand.getWorldPosition(new THREE.Vector3());
    this.knife.position.copy(this.avatar.root.worldToLocal(at));
    // Blade along the forearm-to-hand line, pointing on past the fist.
    const fore = this.avatar.char.bones.RightForeArm.getWorldPosition(new THREE.Vector3());
    const dir = at.clone().sub(fore).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    this.knife.quaternion.copy(this.avatar.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
  }

  // A dog: down on one knee to it, a short step in and one stab; it yelps and drops.
  startDog(dog) {
    const p = this.player, d = dog.a.root.position, to = new THREE.Vector3(d.x - p.pos.x, 0, d.z - p.pos.z);
    const dist = to.length(), dir = to.normalize();
    this.dogStab = { dog, t: 0, struck: false, dir, from: p.pos.clone(), to: p.pos.clone().addScaledVector(dir, Math.max(0, dist - 0.8)), stance: p.stance };
    p.locked = true;
    p.vel.set(0, 0, 0);
    p.yaw = Math.atan2(-dir.x, -dir.z);
    if (p.stance === 'stand') p.setStance('crouch');
    this.knife.visible = true;
    this.audio.rustle?.();
  }

  runDog(dt) {
    const k = this.dogStab, p = this.player;
    k.t += dt;
    const e = Math.min(1, k.t / DOG_STRIKE);
    p.pos.x = k.from.x + (k.to.x - k.from.x) * e * (2 - e);
    p.pos.z = k.from.z + (k.to.z - k.from.z) * e * (2 - e);
    if (!k.struck && k.t >= DOG_STRIKE) {
      k.struck = true;
      const at = k.dog.a.root.position.clone().setY(k.dog.a.root.position.y + 0.45);
      this.dogs.kill(k.dog);
      this.fx.blood(at, k.dir.clone().negate());
      this.audio.knife();
      this.stealth.noise(at, 16, 'shout');                       // (the yelp carries a little way)
    }
    if (k.t >= DOG_TIME) {
      this.dogStab = null;
      this.knife.visible = false;
      p.locked = false;
      if (k.stance === 'stand' && p.stance === 'crouch') p.setStance('stand');
    }
  }

  // The charge: you close in over a fifth of a second, the blade goes in, he goes down backward.
  startBayonet(target) {
    const p = this.player, to = new THREE.Vector3(target.pos.x - p.pos.x, 0, target.pos.z - p.pos.z);
    const d = to.length(), dir = to.normalize();
    this.bayo = { target, t: 0, struck: false, dir, from: p.pos.clone(), to: p.pos.clone().addScaledVector(dir, Math.max(0, d - 1.05)) };
    p.locked = true;
    p.yaw = Math.atan2(-dir.x, -dir.z);
    this.audio.rustle?.();
  }

  runBayonet(dt) {
    const b = this.bayo, p = this.player;
    b.t += dt;
    const k = Math.min(1, b.t / LUNGE), e = k * (2 - k);
    p.pos.x = b.from.x + (b.to.x - b.from.x) * e;
    p.pos.z = b.from.z + (b.to.z - b.from.z) * e;
    this.arsenal.viewKick = b.t < LUNGE ? -2.5 * k : this.arsenal.viewKick;   // (the rifle thrust forward)
    if (!b.struck && b.t >= LUNGE) {
      b.struck = true;
      const { kind, ref } = b.target;
      if (kind !== 'soldier') {                           // a dog or a farm animal
        const at = (kind === 'dog' ? ref.a.root.position : ref.root.position).clone();
        at.y += kind === 'dog' ? 0.45 : 0.9;
        if (kind === 'dog') this.dogs.kill(ref); else killAnimal(ref);
        this.fx.blood(at, b.dir.clone().negate());
        this.audio.thump?.({ freq: 120, dur: 0.18, gain: 0.6 });
        this.stealth.noise(at, 16, 'shout');
      }
      const s = kind === 'soldier' ? ref : null;
      if (s?.alive) {
        const chest = s.char.bones.Spine02?.getWorldPosition(new THREE.Vector3()) ?? s.bodyPosition(new THREE.Vector3());
        s.applyHit('torso', { damage: { torso: 999 } }, b.dir.clone().setY(-0.05), { point: chest, power: 1.1 });
        this.fx.blood(chest, b.dir.clone().negate());
        this.audio.thump?.({ freq: 120, dur: 0.18, gain: 0.6 });
        this.stealth.noise(chest.clone(), 14, 'shout');
        this.onKill?.(s);
      }
    }
    if (b.t >= BAYONET_TIME) { this.bayo = null; p.locked = false; }
  }
}
