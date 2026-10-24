// The player's own body, seen in third person: the Higgsfield/Meshy sniper model,
// animated by stance and speed (idle, walk, rifle sprint, crouch walk, crawl), with the
// arms holding the rifle on a separate layer. Faces -z at yaw 0, like the camera.
import * as THREE from 'three';
import { Character } from '../world/characters.js';

// Natural ground speed (m/s) of each clip at timeScale 1, to keep feet from sliding.
const CLIP_SPEED = { walkLegs: 1.35, crouchLegs: 0.95, sprint: 4.6, crawl: 0.55 };
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

function pistolModel() {
  const steel = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.45, metalness: 0.5 });
  const g = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.045), steel);
  grip.position.set(0, -0.04, 0.02);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.2, 12), steel);
  body.rotation.x = Math.PI / 2;
  body.position.set(0, 0.02, -0.08);
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 14), steel);
  can.rotation.x = Math.PI / 2;
  can.position.set(0, 0.02, -0.27);
  g.add(grip, body, can);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.38);
  return g;
}

export class Avatar {
  constructor(scene) {
    this.char = new Character('player', { faceMinusZ: true });
    this.root = this.char.root;
    this.pistol = pistolModel();
    this.root.add(this.pistol);
    scene.add(this.root);
    this.yaw = 0;
    this.s = { prone: 0, crouch: 0, aim: 0, ready: 0, pitch: 0 };
    this.state = '';
    this.char.play('idleLegs', { fade: 0 });
  }

  muzzle(weapon, out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    if (weapon === 'pistol') return out.copy(this.pistol.userData.muzzle).applyMatrix4(this.pistol.matrixWorld);
    return this.char.muzzleWorld(out);
  }

  // st: { pos, lookYaw, lookPitch, moveYaw, stance, speed, sprinting, weapon, aiming, ready, boltT, reloading, visible }
  update(dt, st) {
    const s = this.s, c = this.char;
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
    const facing = climb?.kind === 'ladder' ? climb.ladder.yaw
      : climb ? Math.atan2(-(climb.to.x - climb.from.x), -(climb.to.z - climb.from.z)) || this.yaw
      : st.aiming || st.ready > 0.05 || st.speed < 0.3 ? st.lookYaw : st.moveYaw;
    let d = facing - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-(st.aiming ? 18 : 9) * dt));
    this.root.rotation.y = this.yaw;

    // Pick the base clip from stance and speed, and match its pace to the real speed.
    const moving = st.speed > 0.25;
    let clip, rate = 1;
    if (climb) {
      // No climbing clip yet: a slow stride on the rungs, a crouched push over a ledge.
      clip = climb.kind === 'ladder' ? 'walkLegs' : 'crouchLegs';
      rate = climb.kind === 'ladder' ? (st.climbRate ?? 0) / 1.2 : 0.8;
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
      c.play(clip, { fade: clip === 'crawl' || this.state === 'crawl' ? 0.35 : 0.22 });
      this.state = clip;
    }
    if (c.base) c.base.timeScale = rate;

    // Arms hold the rifle except while sprinting (the sprint clip carries it) or crawling.
    s.prone = damp(s.prone, st.stance === 'prone' ? 1 : 0, 6, dt);
    const holdTarget = st.sprinting || st.stance === 'prone' || climb ? 0 : 1;
    c.setHoldWeight(damp(c.hold?.getEffectiveWeight() ?? 1, holdTarget, 10, dt));
    c.update(dt);
    // Crouched low behind cover; aiming raises you to look over it.
    const peek = st.aiming || st.ready > 0.35;
    s.crouch = damp(s.crouch, st.stance === 'crouch' && !climb ? (peek ? 0.4 : 1) : 0, 8, dt);
    c.lowerBody(s.crouch, { plant: !moving });

    // Weapon up: after a shot or while aiming, the rifle comes to the shoulder.
    s.ready = damp(s.ready, Math.max(st.ready, st.aiming ? 1 : 0), 14, dt);
    this.root.updateMatrixWorld(true);

    // Weapons: rifle shouldered or carried in both hands, or slung with the pistol drawn.
    if (climb) {
      c.slingRifle(); // both hands for climbing
      this.pistol.visible = false;
    } else if (st.weapon === 'rifle') {
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
  }
}
