// Loud things that hide the sound of your shots: the compound generator (always on,
// local), planes crossing the valley (every ~90 s, loud near their path) and artillery
// on the far hills (a barrage every ~2 min; each boom masks for a moment).
// loudnessAt(pos) says how covered a sound made at `pos` is right now.
import * as THREE from 'three';
import { makeRng } from '../world/noise.js';
import { vehicleModel } from '../world/vehicle-models.js';

const GEN_RADIUS = 32;           // metres the generator drowns out
const PLANE = { speed: 75, alt: 140, every: [80, 110], first: 35, maskRange: 520 };
const ARTY = { every: 125, first: 70, shells: 8, spacing: [1.1, 2.4], window: 1.7 };

export class Masking {
  constructor({ scene, world, audio, fx }) {
    Object.assign(this, { scene, world, audio, fx });
    this.rng = makeRng(31337);
    this.generator = world.generatorPos.clone();
    this.generatorOn = true;

    this.plane = vehicleModel('plane');   // a trimotor transport (Higgsfield model), nose toward +z
    this.plane.visible = false;
    scene.add(this.plane);
    this.planeT = -1;             // seconds into the current pass, -1 = none
    this.nextPlane = PLANE.first;

    this.nextBarrage = ARTY.first;
    this.shells = [];             // scheduled booms in the current barrage
    this.lastBoom = -99;
    this.time = 0;
  }

  // ---- planes ----
  startPlanePass() {
    const a = this.rng() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((this.rng() - 0.5) * 300);
    this.planeFrom = dir.clone().multiplyScalar(-1300).add(side).setY(PLANE.alt);
    this.planeDir = dir;
    this.planeT = 0;
    this.plane.visible = true;
    this.plane.position.copy(this.planeFrom);
    this.plane.lookAt(this.planeFrom.clone().add(dir)); // an object's lookAt turns its +z (the nose) toward the point
  }

  planePos(out = new THREE.Vector3()) {
    return out.copy(this.planeFrom).addScaledVector(this.planeDir, this.planeT * PLANE.speed);
  }

  // ---- artillery ----
  startBarrage() {
    let t = this.time + 0.5;
    this.shells = [];
    const a = this.rng() * Math.PI * 2;   // a sector of the far hills
    for (let i = 0; i < ARTY.shells; i++) {
      t += ARTY.spacing[0] + this.rng() * (ARTY.spacing[1] - ARTY.spacing[0]);
      const b = a + (this.rng() - 0.5) * 0.5, r = 1100 + this.rng() * 500;
      this.shells.push({ t, pos: new THREE.Vector3(Math.cos(b) * r, 60 + this.rng() * 80, Math.sin(b) * r) });
    }
  }

  boom(shell, listener) {
    this.lastBoom = this.time;
    const dist = listener.distanceTo(shell.pos);
    this.audio.artillery(dist);
    // Flash and a smoke column on the horizon.
    this.fx.emit(shell.pos, new THREE.Vector3(0, 1, 0), { color: 0xffd08a, count: 2, speed: 2, size: 70, life: 0.35, grow: 1.3, gravity: 0 });
    this.fx.emit(shell.pos, new THREE.Vector3(0, 1, 0), { color: 0x7d7468, count: 6, speed: 12, size: 45, life: 9, grow: 2.2, gravity: 0.6 });
  }

  update(dt, listener) {
    this.time += dt;
    if (this.planeT < 0 && this.time >= this.nextPlane) this.startPlanePass();
    if (this.planeT >= 0) {
      this.planeT += dt;
      const p = this.planePos();
      this.plane.position.copy(p);
      for (const prop of this.plane.userData.props ?? []) prop.rotation.z += dt * 60; // propellers spin
      this.audio.setPlane(Math.max(0, 1 - p.distanceTo(listener) / 900));
      if (this.planeT * PLANE.speed > 2600) {
        this.planeT = -1;
        this.plane.visible = false;
        this.audio.setPlane(0);
        this.nextPlane = this.time + PLANE.every[0] + this.rng() * (PLANE.every[1] - PLANE.every[0]);
      }
    }
    if (!this.shells.length && this.time >= this.nextBarrage) {
      this.startBarrage();
      this.nextBarrage = this.time + ARTY.every;
    }
    while (this.shells.length && this.time >= this.shells[0].t) this.boom(this.shells.shift(), listener);
    this.audio.setGenerator(this.generatorOn ? Math.max(0, 1 - listener.distanceTo(this.generator) / 60) : 0);
  }

  // How masked a sound made at `pos` is: 0 = not at all, 1 = fully. Also names the source.
  loudnessAt(pos) {
    let best = 0, source = null;
    if (this.generatorOn) {
      const g = THREE.MathUtils.clamp(1 - (pos.distanceTo(this.generator) - GEN_RADIUS * 0.5) / (GEN_RADIUS * 0.5), 0, 1);
      if (g > best) { best = g; source = 'generator'; }
    }
    if (this.planeT >= 0) {
      const p = this.planePos(), d = Math.hypot(p.x - pos.x, p.z - pos.z);
      const k = THREE.MathUtils.clamp(1.4 - d / PLANE.maskRange, 0, 1);
      if (k > best) { best = k; source = 'plane'; }
    }
    const sinceBoom = this.time - this.lastBoom;
    if (sinceBoom < ARTY.window) {
      const k = 1 - Math.max(0, sinceBoom - 0.6) / (ARTY.window - 0.6);
      if (k > best) { best = k; source = 'artillery'; }
    }
    return { amount: best, source };
  }

  // For the HUD: what's coming, so you can time a shot.
  upcoming() {
    if (this.shells.length) return { kind: 'artillery', in: this.shells[0].t - this.time };
    if (this.planeT < 0) return { kind: 'plane', in: this.nextPlane - this.time };
    return null;
  }
}
