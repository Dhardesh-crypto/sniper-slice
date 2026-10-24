// Knife takedowns, Sniper Elite style. Get within reach of a guard who hasn't raised the
// alarm and press F: from behind (within 70° of his back) it always works, even if he's
// wary; from the side or front only while he's calm. You step in behind him, grab and
// strike (Higgsfield thrust clip on you, strangled-fall clip on him) with a beat of slow
// motion, and he drops almost without a sound. F still drags bodies when no one's in reach.
import * as THREE from 'three';

const REACH = 1.7;
const BEHIND = Math.cos(THREE.MathUtils.degToRad(70));
const STEP_IN = 0.22;        // seconds to slide into place behind him
const STAND_OFF = 1.45;      // metres behind him: the thrust clip lunges ~0.8 m and reaches 1.6 m
const STRIKE_AT = 0.7;       // seconds: the thrust's hand peaks at 0.9 s of the clip, played 1.3× fast
const DURATION = 0.96;       // seconds: the clip's lunge ends at 1.25 s (after that it slashes again)

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
  constructor({ world, player, avatar, stealth, input, audio, fx, hud }) {
    Object.assign(this, { world, player, avatar, stealth, input, audio, fx, hud });
    this.active = null;
    this.knife = knifeModel();
    avatar.root.add(this.knife);
    this.onKill = null;      // (soldier) => void, for the mission stats
    this.onSlowmo = null;    // () => void
  }

  // The guard you could take down right now, or null.
  candidate() {
    const p = this.player;
    if (this.active || p.dead || p.climb || p.carrying || p.stance === 'prone' || !p.grounded) return null;
    let best = null, bestD = REACH;
    for (const s of this.world.soldiers) {
      if (!s.alive || s.range || !s.aware) continue;
      const dx = p.pos.x - s.root.position.x, dz = p.pos.z - s.root.position.z, d = Math.hypot(dx, dz);
      if (d > bestD || Math.abs(p.pos.y - s.root.position.y) > 0.8) continue;
      if (s.aware.state === 'alerted') continue;
      const fx = Math.sin(s.root.rotation.y), fz = Math.cos(s.root.rotation.y);  // where he faces
      const behind = (dx * fx + dz * fz) / Math.max(d, 1e-3) < -BEHIND;
      if (!behind && s.aware.state !== 'calm') continue;
      best = s; bestD = d;
    }
    return best;
  }

  state() {
    if (this.active) return null;
    const s = this.candidate();
    return s ? { label: 'F · TAKEDOWN', progress: 0 } : null;
  }

  tick(dt) {
    if (this.active) { this.run(dt); return; }
    if (!this.input.wasPressed('KeyF')) return;
    const s = this.candidate();
    if (!s) return;
    this.input.pressed.delete('KeyF'); // don't let the same press start a body drag
    this.start(s);
  }

  start(s) {
    const p = this.player;
    const yaw = s.root.rotation.y;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // Stand right behind him, facing the way he faces.
    const spot = s.root.position.clone().addScaledVector(fwd, -STAND_OFF);
    spot.y = this.world.floorAt(spot.x, spot.z, s.root.position.y + 0.3);
    this.active = { s, t: 0, from: p.pos.clone(), to: spot, struck: false, fwd, yaw: yaw + Math.PI, hips0: this.hipsAhead(fwd) };
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
    const k = Math.min(1, a.t / STEP_IN);
    p.prevPos.copy(p.pos);
    p.pos.lerpVectors(a.from, a.to, k * k * (3 - 2 * k));
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
}
