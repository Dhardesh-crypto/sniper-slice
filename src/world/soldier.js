// A German soldier: the animated Higgsfield/Meshy guard model with hit zones riding
// on its bones. The stealth system drives its awareness and the guard AI (src/ai) moves
// it: this class is the body: gait and clips, turning, rifle carry or aim, crouching
// behind cover, wounds and a shot-and-fall death.
import * as THREE from 'three';
import { clearXray } from './anatomy.js';
import { Character, buildHitZones } from './characters.js';

export class Soldier {
  // stance: 'alert' (rifle at low ready, both hands) or 'easy' (relaxed, rifle slung).
  constructor({ position, yaw = 0, officer = false, name = 'Guard', stance = 'easy' }) {
    this.name = name;
    this.officer = officer;
    this.stance = officer ? 'officer' : stance;
    this.baseStance = this.stance;
    this.hp = 100;
    this.alive = true;
    this.wounded = false;
    this.tagged = false;
    this.searched = false;
    this.staggerT = 0;
    this.reactT = 0;             // reeling from a hit (the hit-reaction clip)
    this.activity = null;

    // Officers: the same model in a lighter, better-pressed tunic.
    this.char = new Character('guard', { tint: officer ? 0xd9d2bd : null });
    this.root = this.char.root;
    // `body` is the soldier's own frame (origin at the feet, facing +z), kept for
    // code that reads positions relative to the body (tagging, the head marker).
    this.body = new THREE.Group();
    this.root.add(this.body);
    const zones = buildHitZones(this.char, this);
    this.hitMeshes = zones.meshes;
    this.frames = zones.frames;

    this.root.position.copy(position);
    this.root.rotation.y = yaw;
    this.homeYaw = this.targetYaw = yaw;
    this.home = position.clone();
    this.gait = 'stand';         // 'stand' | 'walk' | 'run', set by the AI
    this.speed = 0;
    this.aimDir = null;          // world direction while shouldering the rifle to fire
    this.kick = 0;
    this.crouch = 0;             // 0..1, ducking behind cover
    this.crouchTarget = 0;
    this.applyStance();
    this.char.mixer.setTime(Math.random() * 4); // don't breathe in unison
    this.root.updateMatrixWorld(true);
    if (officer) this.addHolster();
  }

  // The officer's Luger in its brown leather holster at his right hip.
  addHolster() {
    const leather = new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.7 });
    const h = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.15, 0.11), leather);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.12), leather);
    flap.position.set(0, 0.07, 0.01);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.012, 0.03), new THREE.MeshStandardMaterial({ color: 0x8a8678, roughness: 0.4, metalness: 0.6 }));
    strap.position.set(0, 0.035, 0.05);
    for (const m of [body, flap, strap]) { m.castShadow = true; h.add(m); }
    const hips = this.char.bones.Hips ?? this.root;
    const hipY = this.root.worldToLocal(hips.getWorldPosition(new THREE.Vector3())).y;
    h.position.set(-0.19, hipY - 0.1, 0.0);
    h.rotation.set(-0.35, 0, 0.08);   // the grip end tilted forward
    this.root.add(h);
    hips.attach(h);
  }

  // Apply a bullet hit. Returns { zone, killed, damage } for the HUD and the kill cam.
  // Alert guards idle on the legs with the arms on the rifle; at ease and officers
  // play the whole relaxed idle (officers carry no rifle).
  // Standing still with something to do (`activity`): looking around (alert: the legs and body
  // turn, the arms stay on the rifle) or kneeling at work (the rifle on his back).
  applyStance(fade = 0) {
    if (this.reactT > 0) return;          // let the hit reaction finish
    const alert = this.stance === 'alert';
    const c = this.char;
    let clip = alert ? 'idleLegs' : 'idle', hold = alert ? 1 : 0, rate = 1;
    if (this.gait === 'run') { clip = 'sprint'; hold = 0; rate = Math.max(0.6, this.speed / 4.6); }
    else if (this.gait === 'walk') { clip = alert || !c.action('walk') ? 'walkLegs' : 'walk'; rate = Math.max(0.5, this.speed / 1.35); }
    else if (this.activity === 'kneelWork' && c.action('kneelWork')) { clip = 'kneelWork'; hold = 0; }
    else if (this.activity === 'lookAround' && c.action('lookAround')) { clip = alert ? 'lookAroundLegs' : 'lookAround'; }
    c.play(clip, { fade, timeScale: rate });
    c.setHoldWeight(hold);
    c.rifle.visible = this.stance !== 'officer';
  }

  // Walk or run at `speed` (m/s), or stand. The AI moves the root; this picks the clip.
  setGait(gait, speed = 0) {
    this.speed = speed;
    if (gait === this.gait) {
      if (this.char.base) this.char.base.timeScale = gait === 'run' ? speed / 4.6 : gait === 'walk' ? speed / 1.35 : 1;
      return;
    }
    this.gait = gait;
    this.applyStance(0.25);
  }

  applyHit(zone, weapon, bulletDir, opts = {}) {
    if (!this.alive) return { zone, killed: false, damage: 0, already: true };
    const damage = weapon.damage[zone] ?? 50;
    this.hp -= damage;
    if (this.hp <= 0) {
      this.die(bulletDir, opts);
      return { zone, killed: true, damage };
    }
    this.wounded = true;
    if (this.char.action('hitReact')) {
      // He reels from the hit, then carries on.
      this.reactT = 0.9;
      this.char.setHoldWeight(0);
      this.char.play('hitReact', { fade: 0.06, once: true, timeScale: 2 });
    } else this.staggerT = 0.45;
    return { zone, killed: false, damage };
  }

  // What he's doing while standing (set by the guard AI each tick): 'lookAround', 'kneelWork' or null.
  setActivity(name) {
    if (name === this.activity) return;
    this.activity = name;
    if (this.alive && this.gait === 'stand') this.applyStance(0.35);
  }

  // Awareness changed (from the stealth system): face the news, rifle up when wary.
  react(state, stimulus) {
    if (!this.alive) return;
    if (state === 'calm') {
      this.targetYaw = this.homeYaw;
      if (this.stance !== this.baseStance) { this.stance = this.baseStance; this.applyStance(0.4); }
      return;
    }
    if (stimulus) {
      const dx = stimulus.x - this.root.position.x, dz = stimulus.z - this.root.position.z;
      if (dx * dx + dz * dz > 0.25) this.targetYaw = Math.atan2(dx, dz); // faces +z at yaw 0
    }
    if (this.stance === 'easy') { this.stance = 'alert'; this.applyStance(0.35); }
  }

  // Grabbed from behind for a knife takedown: his struggle-and-fall clip starts now; the
  // killing blow comes a moment later (die with quiet: true keeps the clip playing).
  grabbed() {
    if (!this.char.action('takedownVic')) return;
    this.char.setHoldWeight(0);
    this.char.play('takedownVic', { fade: 0.12, once: true, timeScale: 1.8 });
    this.char.base.time = 2.6; // skip the long standing struggle: straight to the sag and fall
    this.grabClip = true;
  }

  die(bulletDir, { quiet = false } = {}) {
    this.alive = false;
    this.quietDeath = quiet;
    // Shot from the front falls backward; from behind falls forward.
    const facing = new THREE.Vector3(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
    const fromFront = bulletDir.dot(facing) < 0;
    this.char.setHoldWeight(0);
    this.deathClip = quiet && this.grabClip ? 'takedownVic' : fromFront ? 'deathBack' : 'deathFwd'; // for saving: the pose he ends in
    if (!(quiet && this.grabClip)) this.char.play(this.deathClip, { fade: 0.08, once: true, timeScale: 1.15 });
    this.fallFrom = this.root.position.clone();
    this.knock = new THREE.Vector3(bulletDir.x, 0, bulletDir.z).normalize().multiplyScalar(quiet ? 0 : 0.35);
    this.deathT = 0;
    if (this.char.rifle.visible) this.dropRifle(bulletDir);
  }

  // The rifle leaves his hands: it joins the scene, tumbles and comes to rest lying on
  // its side on whatever is below it (the ground, a tower platform).
  dropRifle(bulletDir) {
    const r = this.char.rifle;
    this.root.updateMatrixWorld(true);
    this.root.parent.attach(r);
    const along = new THREE.Vector3(0, 0, 1).applyQuaternion(r.quaternion).setY(0);
    if (along.lengthSq() < 1e-4) along.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
    along.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.2);
    const up = new THREE.Vector3(0, 1, 0);
    const rest = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(up, along.clone().cross(up), along));
    const floor = this.floorAt?.(r.position.x, r.position.z, r.position.y) ?? r.position.y - 1;
    this.drop = {
      vel: new THREE.Vector3(bulletDir.x, 0, bulletDir.z).normalize().multiplyScalar(0.8).setY(0.6),
      from: r.quaternion.clone(), rest, floor, t: 0,
      dur: Math.max(0.35, Math.sqrt(2 * Math.max(0, r.position.y - floor) / 9.8) + 0.1),
      bounced: false,
    };
  }

  updateDrop(dt) {
    const d = this.drop, r = this.char.rifle;
    if (d.done) return;
    d.t += dt;
    d.vel.y -= 9.8 * dt;
    r.position.addScaledVector(d.vel, dt);
    const restY = d.floor + 0.04;
    if (r.position.y <= restY) {
      r.position.y = restY;
      if (!d.bounced && d.vel.y < -2) { d.bounced = true; d.vel.y *= -0.22; d.vel.x *= 0.4; d.vel.z *= 0.4; }
      else { d.vel.set(0, 0, 0); if (d.t >= d.dur) d.done = true; }
    }
    const k = Math.min(1, d.t / d.dur);
    r.quaternion.slerpQuaternions(d.from, d.rest, k * k * (3 - 2 * k));
    r.updateMatrixWorld(true);
  }

  update(dt) {
    if (this.alive) {
      // Turn toward whatever he's attending to.
      let d = this.targetYaw - this.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.root.rotation.y += Math.sign(d) * Math.min(Math.abs(d), 2.6 * dt);
    }
    this.char.update(dt);
    if (this.drop) this.updateDrop(dt);
    if (!this.alive && this.deathT < 1) {
      // A short shove from the bullet on top of the fall animation.
      this.deathT = Math.min(1, this.deathT + dt / 0.35);
      const t = this.deathT;
      this.root.position.copy(this.fallFrom).addScaledVector(this.knock, 1 - (1 - t) * (1 - t));
    }
    if (this.reactT > 0 && (this.reactT -= dt) <= 0 && this.alive) this.applyStance(0.3);
    if (this.staggerT > 0) {
      this.staggerT = Math.max(0, this.staggerT - dt);
      const k = Math.sin((0.45 - this.staggerT) / 0.45 * Math.PI);
      this.char.bones.Spine01?.rotateX(-0.25 * k);
    }
    // Ducking behind cover (the same world-space crouch as the player's).
    this.crouch += ((this.alive ? this.crouchTarget : 0) - this.crouch) * (1 - Math.exp(-7 * dt));
    if (this.alive && this.crouch > 0.01) this.char.lowerBody(this.crouch, { plant: this.gait === 'stand' });
    this.kick = Math.max(0, this.kick - dt * 4);
    if (this.alive && this.grabClip) { /* struggling: the clip owns his arms, the rifle hangs */ this.char.slingRifle(); }
    else if (this.alive && this.activity === 'kneelWork' && this.gait === 'stand') this.char.slingRifle();
    else if (this.alive && this.aimDir && this.stance !== 'officer') this.char.placeRifleShouldered(this.aimDir, this.kick * 0.07);
    else if (this.alive && (this.stance === 'alert' || this.gait === 'run')) this.char.placeRifleInHands(this.gait === 'run' ? 'port' : 'low');
    else if (this.alive && this.stance === 'easy') this.char.slingRifle();
    this.root.updateMatrixWorld(true);
  }

  reset() {
    clearXray(this);
    if (this.fallFrom) this.root.position.copy(this.fallFrom);
    this.fallFrom = null;
    if (this.drop) { this.root.add(this.char.rifle); this.drop = null; }
    this.hp = 100;
    this.alive = true;
    this.wounded = false;
    this.searched = false;
    this.found = this.hidden = this.dragged = this.deathNoted = false;
    this.takenDown = this.grabClip = this.quietDeath = false;
    this.stance = this.baseStance;
    this.gait = 'stand'; this.speed = 0; this.aimDir = null; this.crouch = this.crouchTarget = 0;
    this.root.rotation.y = this.targetYaw = this.homeYaw;
    if (this.aware) Object.assign(this.aware, { meter: 0, state: 'calm', stimulus: null });
    for (const a of Object.values(this.char.actions)) if (a !== this.char.hold) a.stop();
    this.char.base = null;
    this.applyStance();
    this.root.updateMatrixWorld(true);
  }

  // Lying dead from the start (a loaded save): the end of his death clip, no fall, no noise.
  restoreDead(clip, rifle) {
    this.alive = false;
    this.hp = 0;
    this.deathClip = clip;
    this.deathNoted = true;
    this.fallFrom = this.root.position.clone();
    this.deathT = 1;
    this.knock = new THREE.Vector3();
    this.char.setHoldWeight(0);
    this.char.play(clip, { fade: 0, once: true });
    if (this.char.base) this.char.base.time = this.char.base.getClip().duration;
    if (rifle && this.char.rifle.visible) {
      const r = this.char.rifle;
      this.root.parent.attach(r);
      r.position.fromArray(rifle.pos);
      r.quaternion.fromArray(rifle.quat);
      this.drop = { done: true };
    }
    this.char.update(0);
    this.root.updateMatrixWorld(true);
  }

  // Where the body lies (follows the fall), for searching and the map.
  bodyPosition(out = new THREE.Vector3()) {
    return (this.char.bones.Hips ?? this.root).getWorldPosition(out);
  }

  headPosition(out = new THREE.Vector3()) {
    const h = this.char.bones.head_end ?? this.char.bones.Head;
    return h.getWorldPosition(out).add(new THREE.Vector3(0, 0.2, 0));
  }
}
