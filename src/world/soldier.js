// A German soldier: the animated Higgsfield/Meshy guard model with hit zones riding
// on its bones. The stealth system drives its awareness and the guard AI (src/ai) moves
// it: this class is the body: gait and clips, turning, rifle carry or aim, crouching
// behind cover, wounds and a shot-and-fall death.
import * as THREE from 'three';
import { clearXray } from './anatomy.js';
import { Character, buildHitZones, solveArmIK } from './characters.js';

const UP = new THREE.Vector3(0, 1, 0), MIDDLE = new THREE.Vector3(0, 0.9, 0);

export class Soldier {
  // stance: 'alert' (rifle at low ready, both hands) or 'easy' (relaxed, rifle slung).
  // look: which character model ('guard', 'guardCamo', 'guardSergeant', 'officerLieutenant';
  // the Oberst is 'officerColonel').
  constructor({ position, yaw = 0, officer = false, name = 'Guard', stance = 'easy', look = null }) {
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

    this.char = new Character(look ?? (officer ? 'officerColonel' : 'guard'));
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
      this.die(bulletDir, { zone, power: THREE.MathUtils.clamp((weapon.damage.torso ?? damage) / 100, 0.3, 1.2), ...opts });
      return { zone, killed: true, damage };
    }
    this.wounded = true;
    // Where it hit him tells for the rest of the fight: a leg and he goes down on a knee, then limps;
    // an arm and his aim is shaky; the body and he bleeds, and may bleed out a while later.
    if (zone === 'leg') { this.limp = true; this.kneelT = 1.4; }
    else if (zone === 'arm') { this.armHit = true; this.shakenT = 1.5; }
    else this.bleed = (this.bleed ?? 0) + damage / 60;        // hp a second: half a minute or so
    if (this.char.action('hitReact')) {
      // He reels from the hit, then carries on.
      this.reactT = 0.9;
      this.char.setHoldWeight(0);
      this.char.play('hitReact', { fade: 0.06, once: true, timeScale: 2 });
    } else this.staggerT = 0.45;
    return { zone, killed: false, damage };
  }

  // A round cracked past him: he flinches and ducks for a moment.
  nearMiss() {
    if (!this.alive || this.riding || this.manning) return;
    this.staggerT = Math.max(this.staggerT ?? 0, 0.45);
    this.duckT = 0.9 + Math.random() * 0.8;
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

  // He goes down the way the hit sends him. `zone`: where a bullet struck; `point`: where (off his
  // centre line it turns him: a shoulder hit spins him round); `power`: the round's punch (0–1.2);
  // `blast`: an explosion's force on him (0–1.5), which throws him through the air.
  die(bulletDir, { quiet = false, zone = 'torso', point = null, power = 1, blast = 0 } = {}) {
    this.alive = false;
    this.quietDeath = quiet;
    const yaw = this.root.rotation.y;
    const facing = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // The way he's pushed, flat; straight down or up (a fall, a vehicle going up): back off his feet.
    const push = new THREE.Vector3(bulletDir.x, 0, bulletDir.z);
    if (push.lengthSq() < 0.02) push.copy(facing).negate().applyAxisAngle(UP, (Math.random() - 0.5) * 1.5);
    push.normalize();
    // Shot from the front falls backward; from behind falls forward.
    let fallBack = push.dot(facing) < 0;
    // He falls the way there's room: not backward through the wall he stood against.
    const room = (dir) => {
      if (!this.wallHit) return 1;
      const a = this.root.position.clone(); a.y += 0.9;
      return this.wallHit(a, a.clone().addScaledVector(dir, 1.7)) ?? 1;
    };
    const behind = room(facing.clone().negate()), ahead = room(facing);
    if (fallBack ? behind < 0.9 && ahead > behind : ahead < 0.9 && behind > ahead) fallBack = !fallBack;
    this.char.setHoldWeight(0);
    this.deathClip = quiet && this.grabClip ? 'takedownVic' : fallBack ? 'deathBack' : 'deathFwd'; // for saving: the pose he ends in
    this.fallFrom = this.root.position.clone();
    this.knock = new THREE.Vector3();
    this.deathT = 1;
    this.fall = null; this.fly = null;
    if (quiet) {
      if (!this.grabClip) this.char.play(this.deathClip, { fade: 0.08, once: true, timeScale: 1.15 });
      if (this.char.rifle.visible) this.dropRifle(bulletDir);
      return;
    }
    // Turned as he goes: round to fall along the push (the clips fall straight ahead or straight
    // back), and by the hit's leverage: struck off his centre line, that side is driven back.
    const clipDir = fallBack ? facing.clone().negate() : facing;
    const heading = (v) => Math.atan2(v.x, v.z);
    let spin = heading(push) - heading(clipDir);
    spin = Math.atan2(Math.sin(spin), Math.cos(spin));   // (about +y: from the way the clip falls to the push)
    if (point) {
      const r = point.clone().sub(this.root.position).setY(0);
      const lever = THREE.MathUtils.clamp((r.z * push.x - r.x * push.z) / 0.25, -1, 1);   // (r × push).y, per 25 cm off centre
      spin += lever * ({ arm: 1.1, torso: 0.45, leg: 0.6, head: 0.25 }[zone] ?? 0.4) * Math.min(1, power);
    }
    const steep = bulletDir.y < -0.55;                     // from high above: he folds where he stands
    let rate = 1.15, shove = 0.4 * power, delay = 0;
    if (blast > 0) { rate = 1.7; shove = 0; }
    else if (steep) { rate = 1.4; shove = 0.06; spin *= 0.4; }
    else if (zone === 'head') { rate = 1.6; shove = 0.12 * power; spin *= 0.5; }   // the strings cut: down at once
    else if (zone === 'leg') { rate = 0.85; shove = 0.15; }                         // his legs go: he pitches over slowly
    else if (zone === 'torso' && power > 0.7 && Math.random() < 0.4 && this.char.action('hitReact')) {
      delay = 0.3 + Math.random() * 0.2;                   // he reels a step or two with it, then drops
      shove = 0.75 * power;
      this.char.play('hitReact', { fade: 0.05, once: true, timeScale: 1.8 });
    }
    this.fall = { yaw0: yaw, spin, t: 0, delay, rate, played: false, dur: blast > 0 ? 0.25 : 0.45 };
    this.knock = push.clone().multiplyScalar(shove);
    if (this.knock.lengthSq() && room(push) < 0.5) this.knock.set(0, 0, 0);   // (not into a wall)
    this.deathT = 0;
    if (blast > 0) {
      // Thrown: up and away along the push, tumbling over the way he flies, until he comes down.
      const k = Math.min(1.5, blast);
      this.fly = { pos: this.root.position.clone(), vel: push.clone().multiplyScalar(1.5 + 6.5 * k).setY(2 + 4.5 * k), tumble: 0.8 + 1.4 * k, t: 0, axis: new THREE.Vector3(push.z, 0, -push.x), landed: false, skid: 0 };
      this.knock.set(0, 0, 0);
      this.deathT = 1;
    }
    if (this.char.rifle.visible) this.dropRifle(bulletDir.clone().setY(0).add(blast > 0 ? new THREE.Vector3(0, 0.6, 0) : new THREE.Vector3()));
    if (!delay) this.startFall();
  }

  startFall() {
    this.fall.played = true;
    this.char.play(this.deathClip, { fade: this.fall.delay ? 0.15 : 0.08, once: true, timeScale: this.fall.rate });
  }

  // The fall, after the death clip has posed him: the turn, the shove, or the flight through the air.
  updateFall(dt) {
    const f = this.fall;
    if (f) {
      f.t += dt;
      if (!f.played && f.t >= f.delay) this.startFall();
      const k = Math.min(1, f.t / (f.delay + f.dur)), e = k * k * (3 - 2 * k);
      this.fallYaw = f.yaw0 + f.spin * e;
      if (!this.fly) this.root.rotation.y = this.fallYaw;
      if (k >= 1 && !this.fly) this.fall = null;
    }
    if (this.fly) this.updateFlight(dt);
    else if (this.deathT < 1) {
      // A short shove from the bullet on top of the fall animation (longer when he reels first).
      this.deathT = Math.min(1, this.deathT + dt / (0.35 + (f?.delay ?? 0)));
      const t = this.deathT;
      this.root.position.copy(this.fallFrom).addScaledVector(this.knock, 1 - (1 - t) * (1 - t));
    }
  }

  updateFlight(dt) {
    const fl = this.fly, p = fl.pos;                  // (his feet's path; the root is posed about his middle)
    fl.t += dt;
    const from = p.clone();
    if (!fl.landed) {
      fl.vel.y -= 9.8 * dt;
      p.addScaledVector(fl.vel, dt);
      // Against a wall he stops dead and drops.
      if (this.wallHit) {
        const a = from.clone(), b = p.clone(); a.y += 0.9; b.y += 0.9;
        if (this.wallHit(a, b) !== null) { p.x = from.x; p.z = from.z; fl.vel.x = fl.vel.z = 0; }
      }
      const floor = this.floorAt ? this.floorAt(p.x, p.z, Math.max(p.y, from.y) + 0.5) : this.fallFrom.y;
      if (p.y <= floor && fl.vel.y < 0) { p.y = floor; fl.landed = true; fl.skid = Math.hypot(fl.vel.x, fl.vel.z) * 0.5; fl.landT = fl.t; }
    } else {
      // He skids on, slowing, and lies still.
      fl.skid = Math.max(0, fl.skid - 8 * dt);
      const next = p.clone().addScaledVector(fl.vel.clone().setY(0).normalize(), fl.skid * dt);
      const a = p.clone(), b = next.clone(); a.y += 0.4; b.y += 0.4;
      if (!this.wallHit || this.wallHit(a, b) === null) { p.x = next.x; p.z = next.z; }
      if (this.floorAt) p.y = this.floorAt(p.x, p.z, p.y + 0.5);
    }
    // The tumble: tipped over the way he flies, and back by the time he lands (the clip leaves him lying).
    const air = fl.landed ? Math.max(0, 1 - (fl.t - fl.landT) / 0.15) : Math.sin(Math.min(1, fl.t / 0.8) * Math.PI / 2);
    const q = new THREE.Quaternion().setFromAxisAngle(fl.axis, fl.tumble * air);
    this.root.quaternion.setFromEuler(new THREE.Euler(0, this.fallYaw, 0)).premultiply(q);
    this.root.position.copy(p).add(MIDDLE).sub(MIDDLE.clone().applyQuaternion(q));
    if (fl.landed && fl.skid <= 0 && air <= 0) {
      this.root.rotation.set(0, this.fallYaw, 0);
      this.root.position.copy(p);
      this.fly = null; this.fall = null; this.fallFrom = p.clone();
    }
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
    if (!this.alive && (this.fall || this.fly || this.deathT < 1)) this.updateFall(dt);
    if (this.reactT > 0 && (this.reactT -= dt) <= 0 && this.alive) this.applyStance(0.3);
    if (this.staggerT > 0) {
      this.staggerT = Math.max(0, this.staggerT - dt);
      const k = Math.sin((0.45 - this.staggerT) / 0.45 * Math.PI);
      this.char.bones.Spine01?.rotateX(-0.25 * k);
    }
    // Ducking behind cover (the same world-space crouch as the player's).
    // (down on a knee for a moment after a leg wound)
    if (this.kneelT > 0) this.kneelT -= dt;
    if (this.duckT > 0) this.duckT -= dt;
    this.crouch += ((this.alive ? Math.max(this.crouchTarget, this.kneelT > 0.3 ? 0.85 : 0, this.duckT > 0 ? 1 : 0) : 0) - this.crouch) * (1 - Math.exp(-7 * dt));
    if (this.alive && this.crouch > 0.01) this.char.lowerBody(this.crouch, { plant: this.gait === 'stand', kneel: this.gait === 'stand' ? this.crouch : 0 });   // still: down on one knee
    this.kick = Math.max(0, this.kick - dt * 4);
    // Bleeding from a body wound (applyHit).
    if (this.alive && this.bleed > 0) {
      this.hp -= this.bleed * dt;
      if (this.hp <= 0) { this.die(new THREE.Vector3(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y)), { power: 0.2 }); this.bledOut = true; }   // he folds forward
    }
    if (this.alive && this.grabClip) { /* struggling: the clip owns his arms, the rifle hangs */ this.char.slingRifle(); }
    else if (this.alive && this.manning) this.onGun(this.manning);
    else if (this.alive && this.activity === 'kneelWork' && this.gait === 'stand') this.char.slingRifle();
    else if (this.alive && this.aimDir && this.stance !== 'officer') this.keepRifleClear(this.aimDir);
    else if (this.alive && (this.stance === 'alert' || this.gait === 'run')) this.keepRifleClear(null, this.gait === 'run' ? 'port' : 'low');
    else if (this.alive && this.stance === 'easy') this.char.slingRifle();
    this.root.updateMatrixWorld(true);
  }

  // The rifle shouldered along `aim` (or carried), but never through a wall: up against one he
  // draws it in close, and if the barrel still meets it, raises the muzzle until it's clear; at
  // the last, holds it upright. Carried, it comes up across him, or goes on his back.
  keepRifleClear(aim, carry) {
    const c = this.char, kick = this.kick * 0.07;
    this.rifleBlocked = false;
    if (aim) c.placeRifleShouldered(aim, kick); else c.placeRifleInHands(carry);
    if (!this.wallHit || !this.inWall()) return;
    if (!aim) { c.placeRifleInHands('high'); if (this.inWall()) c.slingRifle(); return; }   // (face to a wall: slung)
    const h = this._clear ??= new THREE.Vector3(), pitch = Math.asin(THREE.MathUtils.clamp(aim.y, -1, 1));
    h.set(aim.x, 0, aim.z).normalize();
    for (const [pull, lift] of [[0.25, 0], [0.4, 0], [0.4, 0.5], [0.4, 0.95], [0.35, 1.4]]) {
      const p = Math.min(1.45, pitch + lift), dir = this._clearDir ??= new THREE.Vector3();
      dir.set(h.x * Math.cos(p), Math.sin(p), h.z * Math.cos(p));
      c.placeRifleShouldered(dir, kick + pull);
      if (!this.inWall()) return;
    }
    // Still: hold it upright, and (guards.js) step back before he can shoot.
    c.placeRifleInHands('up');
    this.rifleBlocked = true;
  }

  // On a nest's machine gun (mgnest.js): his rifle on his back, stooped behind the gun, hands on it.
  onGun(n) {
    const c = this.char, b = c.bones;
    c.slingRifle();
    if (!b.Hips) return;
    const [right, left] = n.grips(), hips = b.Hips.getWorldPosition(new THREE.Vector3());
    const out = (x, y, z) => c.modelDir(x, y, z).applyQuaternion(this.root.quaternion).add(hips);
    solveArmIK(b.RightArm, b.RightForeArm, b.RightHand, right, out(-0.8, -1, -0.3));
    solveArmIK(b.LeftArm, b.LeftForeArm, b.LeftHand, left, out(0.8, -1, -0.3));
  }

  // Does his rifle, from his body out to the muzzle, go into a wall?
  inWall() {
    const m = this.char.muzzleWorld(this._muzzle ??= new THREE.Vector3());
    const from = (this._body ??= new THREE.Vector3()).copy(this.root.position);
    from.y = m.y;
    return this.wallHit(from, m) !== null;
  }

  reset() {
    clearXray(this);
    if (this.fallFrom) this.root.position.copy(this.fallFrom);
    this.fallFrom = null;
    this.fall = this.fly = null;
    this.root.rotation.set(0, this.root.rotation.y, 0);
    if (this.drop) { this.root.add(this.char.rifle); this.drop = null; }
    this.hp = 100;
    this.alive = true;
    this.wounded = false;
    this.searched = false;
    this.found = this.hidden = this.dragged = this.deathNoted = false;
    this.takenDown = this.grabClip = this.quietDeath = false;
    this.stance = this.baseStance;
    this.gait = 'stand'; this.speed = 0; this.aimDir = null; this.crouch = this.crouchTarget = 0; this.manning = null;
    this.limp = this.armHit = false; this.kneelT = this.shakenT = this.bleed = 0; this.bledOut = false;
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
