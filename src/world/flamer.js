// The flamethrower man (look 'guardFlamer'): a different threat from the riflemen. He doesn't shoot
// from far off; he comes for you (or for where you were last seen) and burns you out: two-second
// bursts of flame in a cone, about 13 m long, that hurt fast and leave the ground burning for a
// while, so a hiding place in the grass can catch fire. His fuel tanks are his weak spot: one
// round in them and they go up, taking him and anyone near him (a rifle hit from 300 m is the
// sniper's way to deal with him, and it plays in the kill cam).
//   fitFlamer(soldier)   at the soldier's construction (soldier.js): the flame gun in his hands
//                        instead of a rifle, and a hit box over the tanks on his back
//   Flamers              the controller (main.js): his fighting (called from guards.js combat),
//                        the flame and the burning ground (fx), the damage, the roar, the blast
import * as THREE from 'three';

const RANGE = 13;              // m the flame reaches
const CLOSE = 9.5;             // m he closes to before he opens up
const CONE = 0.3;              // rad either side of his aim the flame catches you
const BURST = 2.2, PAUSE = 1.5;// s of flame, s between bursts
const HURT = 34;               // per s in the flame (the combat difficulty scales it: player.damage)
const PATCH_LIFE = 11, PATCH_R = 1.4, PATCH_HURT = 22;   // the burning ground: s, m, per s standing in it

// ---- the kit (soldier.js)

// The flame gun: a fuel pipe with a nozzle and a pilot light, and a hose back to the tanks. Built
// in code (no model to buy): in the rifle's frame (origin at the grip, +z to the muzzle).
export function flameGun() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x3c3f3a, roughness: 0.55, metalness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1d1c1a, roughness: 0.9, metalness: 0.0 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a32, roughness: 0.45, metalness: 0.7 });
  const tube = (r, len, mat, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat); m.rotation.x = Math.PI / 2; m.position.z = z; g.add(m); return m; };
  tube(0.024, 0.78, steel, 0.2);                  // the fuel pipe
  tube(0.034, 0.12, brass, 0.6);                  // the nozzle head
  tube(0.018, 0.06, steel, 0.68);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.05), black); grip.position.set(0, -0.07, 0); g.add(grip);
  const fore = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.05), black); fore.position.set(0, -0.06, 0.32); g.add(fore);
  const hose = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 6, 14, Math.PI * 1.1), black);
  hose.rotation.set(0, Math.PI / 2, 0); hose.position.set(-0.02, -0.12, -0.13); g.add(hose);
  const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb347 }));
  pilot.position.set(0, 0.035, 0.7); g.add(pilot);
  g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  g.userData.muzzle = new THREE.Vector3(0, 0, 0.72);
  g.userData.buttToGrip = 0.2;
  g.userData.kind = 'flamegun';
  g.userData.pilot = pilot;
  return g;
}

// At construction: the gun in his hands, and the tanks as a hit zone (a box behind his upper back,
// on the Spine02 bone, so it follows him: a round there is zone 'tanks', soldier.js applyHit).
export function fitFlamer(s) {
  const c = s.char;
  c.rifle.removeFromParent();
  c.rifle = flameGun();
  c.root.add(c.rifle);
  c.root.updateMatrixWorld(true);
  const spine = c.bones.Spine02 ?? c.bones.Spine01;
  if (spine) {
    const fwd = c.modelDir(0, 0, 1, new THREE.Vector3()).applyQuaternion(c.root.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.24), new THREE.MeshBasicMaterial({ visible: false }));
    box.position.copy(spine.getWorldPosition(new THREE.Vector3())).addScaledVector(fwd, -0.24).add(new THREE.Vector3(0, 0.08, 0));
    box.quaternion.copy(c.root.getWorldQuaternion(new THREE.Quaternion()));
    box.userData.zone = 'tanks';
    box.userData.soldier = s;
    c.root.add(box); box.updateMatrixWorld(true);
    spine.attach(box);
    s.hitMeshes.push(box);
    s.tankBox = box;
  }
  s.flamer = { on: false, t: 0, burst: 0, blown: false, patchT: 0, aim: new THREE.Vector3(0, 0, 1) };
}

// ---- the controller (main.js)

export class Flamers {
  constructor({ world, player, stealth, audio, fx, explosions, ai }) {
    Object.assign(this, { world, player, stealth, audio, fx, explosions, ai });
    this.patches = [];          // burning ground: { at, t }
    this.list = () => world.soldiers.filter(s => s.flamer);
    this._v = new THREE.Vector3(); this._m = new THREE.Vector3(); this._c = new THREE.Vector3();
  }

  // From guards.js combat(), instead of the rifleman's cover-and-shoot.
  combat(s, dt) {
    const f = s.flamer, a = s.aware, b = s.brain, p = this.player;
    const target = a.spotted ? p.pos : b.lastSeen;
    if (!target || f.blown) { this.ai.stop(s); f.on = false; return; }
    const pos = s.root.position, d = Math.hypot(target.x - pos.x, target.z - pos.z);
    // Too far, or no clear line to it: come on (at a run, no cover: he's carrying fire).
    const eye = this._c.copy(pos); eye.y += 1.4;
    const aimAt = this._m.copy(target); aimAt.y += a.spotted ? Math.max(0.4, p.eye * 0.6) : 0.4;
    const block = this.world.raycastSegment(eye, aimAt, s);   // (not his own body)
    const clear = !block || block.soldier || block.distance > eye.distanceTo(aimAt) - 0.6;
    if (d > CLOSE || !clear) {
      f.on = false; s.aimDir = null;
      this.ai.goTo(s, target, d > 30 ? 3.6 : 2.4, dt);
      return;
    }
    this.ai.stop(s);
    s.targetYaw = Math.atan2(target.x - pos.x, target.z - pos.z);
    f.aim.copy(aimAt).sub(s.char.muzzleWorld(this._v)).normalize();
    s.aimDir = f.aim.clone();
    // Bursts: on, then a pause to let the pump catch up.
    f.t -= dt;
    if (f.t <= 0) {
      f.on = !f.on;
      f.t = f.on ? BURST * (0.8 + 0.4 * Math.random()) : PAUSE * (0.7 + 0.6 * Math.random());
      if (f.on) { this.stealth.noise(pos.clone(), 70, 'shot'); this.audio.combatShout?.(pos.distanceTo(p.pos)); }
    }
  }

  tick(dt) {
    const p = this.player;
    let loudest = 0;
    for (const s of this.list()) {
      const f = s.flamer;
      // The tanks hit: they go up, once (soldier.js marks it).
      if (f.blownPending && !f.blown) {
        f.blown = true; f.blownPending = false; f.on = false;
        const at = s.tankBox ? s.tankBox.getWorldPosition(new THREE.Vector3()) : s.root.position.clone().setY(s.root.position.y + 1.2);
        this.explosions.explode(at, { radius: 6, hurt: 14, size: 1.3, noise: 320, burn: true, heavy: true, label: 'FLAMETHROWER TANKS', by: 'player' });
        for (let i = 0; i < 6; i++) this.patches.push({ at: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5)), t: PATCH_LIFE });
        if (s.char.rifle.userData.pilot) s.char.rifle.userData.pilot.visible = false;
      }
      if (!s.alive || s.downed || f.blown) { f.on = false; continue; }
      if (!f.on || s.brain.mode !== 'combat') { f.on = f.on && s.brain.mode === 'combat'; continue; }
      // The flame: a roaring stream from the nozzle, hot core and smoke.
      s.char.root.updateMatrixWorld(true);
      const muzzle = s.char.muzzleWorld(this._v.set(0, 0, 0)), dir = f.aim;
      this.fx.emit(muzzle, dir, { color: 0xff7a1e, count: 5, speed: 15, size: 0.42, life: 0.7, grow: 5, gravity: -3, glow: true, heat: 1.6 });
      this.fx.emit(muzzle, dir, { color: 0xffd36a, count: 2, speed: 11, size: 0.22, life: 0.45, grow: 4, gravity: -2, glow: true, heat: 1.8 });
      if (Math.random() < 0.35) this.fx.emit(muzzle.clone().addScaledVector(dir, 6), dir, { color: 0x2b2622, count: 1, speed: 3, size: 1.1, life: 1.6, grow: 2.5, gravity: -1.5 });
      // Where it reaches: the first solid thing or its full length; the ground there catches.
      const reach = this.world.raycastSegment(muzzle, this._m.copy(muzzle).addScaledVector(dir, RANGE), s);
      const end = reach && !reach.soldier ? reach.point.clone() : muzzle.clone().addScaledVector(dir, RANGE);
      if ((f.patchT -= dt) <= 0) {
        f.patchT = 0.35;
        const at = end.clone(); at.y = this.world.floorAt(at.x, at.z, at.y + 0.5);
        this.patches.push({ at, t: PATCH_LIFE });
      }
      // You in the flame: within reach, inside the cone, with nothing solid between.
      const chest = this._c.copy(p.pos); chest.y += p.eye * 0.6;
      const to = chest.clone().sub(muzzle), dist = to.length();
      if (!p.dead && dist < (reach && !reach.soldier ? reach.distance + 0.8 : RANGE) && to.angleTo(dir) < CONE) {
        const wall = this.world.raycastSegment(muzzle, chest, s);
        if (!wall || wall.soldier || wall.distance > dist - 0.5) p.damage(HURT * dt, s.root.position);
      }
      loudest = Math.max(loudest, Math.max(0, 1 - muzzle.distanceTo(p.pos) / 140));
    }
    // The burning ground: flames licking up, then smoke; it hurts to stand in.
    for (const pt of this.patches) {
      pt.t -= dt;
      const k = pt.t / PATCH_LIFE;
      if (Math.random() < 0.5) this.fx.emit(pt.at, new THREE.Vector3(0, 1, 0), { color: k > 0.3 ? 0xff8a2a : 0x3a332c, count: 1, speed: 1.8, size: 0.6 * (0.5 + k), life: 0.9, grow: 3, gravity: -2.5, glow: k > 0.3, heat: 1.4 });
      if (!p.dead && k > 0.15 && Math.hypot(p.pos.x - pt.at.x, p.pos.z - pt.at.z) < PATCH_R && Math.abs(p.pos.y - pt.at.y) < 1.2) p.damage(PATCH_HURT * dt / Math.max(1, this.patches.length / 8), pt.at);
    }
    this.patches = this.patches.filter(pt => pt.t > 0);
    if (this.patches.length > 80) this.patches.splice(0, this.patches.length - 80);
    // The roar, as loud as the nearest one firing.
    this.roar(loudest);
  }

  // A flame's roar, made in code: low rumbling noise with crackle, looped (no recording needed).
  roar(level) {
    const au = this.audio;
    if (!au.ctx) return;
    if (!au.samples.flameRoar) {
      const sr = au.ctx.sampleRate, n = sr * 2, buf = au.ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
      let b = 0;
      for (let i = 0; i < n; i++) {
        b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);                 // a low, rumbling roar
        const crack = Math.random() < 0.0008 ? (Math.random() * 2 - 1) * 0.9 : 0;   // and crackle
        d[i] = b * 3.2 + (Math.random() * 2 - 1) * 0.08 + crack;
      }
      for (let i = 0; i < 2000; i++) { const w = i / 2000; d[i] *= w; d[n - 1 - i] *= w; }   // (seamless loop)
      au.samples.flameRoar = buf;
    }
    au.loopSample('flameRoar', 'flameRoar', 0.8 * level, { dull: 1 - level });
  }
}
