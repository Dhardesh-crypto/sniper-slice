// The X-ray kill cam. Takes a shot that was pre-simulated at the trigger pull and plays
// it out: ride the bullet in slow motion, swing to the side of the target, switch the
// body to X-ray as the bullet goes through (breaking the bones and organs it passes),
// then watch the fall. The hit itself is applied at the moment of impact.
// A shot into a vehicle's engine plays the same ride, then pulls back to watch it blow.
import * as THREE from 'three';
import { buildXray, partsAlong, setXrayView, XRAY_LAYER } from '../world/anatomy.js';

const LABEL = { heart: 'HEART', lungs: 'LUNG', liver: 'LIVER', kidney: 'KIDNEY', brain: 'BRAIN', stomach: 'STOMACH', intestines: 'GUT', skull: 'SKULL', spine: 'SPINE' };
const APPROACH = 1.6;    // metres before impact where the camera starts swinging round
const THROUGH = 0.95;    // metres of body the bullet travels during the X-ray
const smooth = (x) => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const easeInOut = (x) => 0.5 - 0.5 * Math.cos(Math.PI * THREE.MathUtils.clamp(x, 0, 1));
const easeOut = (x) => 1 - (1 - THREE.MathUtils.clamp(x, 0, 1)) ** 2;

function bulletMesh() {
  const g = new THREE.Group();
  const copper = new THREE.MeshStandardMaterial({ color: 0xc8793f, metalness: 0.9, roughness: 0.25, emissive: 0x3a1a08 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0039, 0.0039, 0.02, 12), copper);
  body.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0039, 0.014, 12), copper);
  tip.rotation.x = Math.PI / 2; // nose along +z: Object3D.lookAt points +z at the target
  tip.position.z = 0.017;
  g.add(body, tip);
  g.scale.setScalar(3); // larger than life so it reads on screen
  g.traverse(o => o.layers.enable(XRAY_LAYER));
  return g;
}

export class KillCam {
  constructor({ scene, camera, audio, world }) {
    Object.assign(this, { scene, camera, audio, world });
    this.active = false;
    this.bullet = bulletMesh();
    this.bullet.visible = false;
    scene.add(this.bullet);

    this.trailPts = Array.from({ length: 24 }, () => new THREE.Vector3());
    this.trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.trailPts),
      new THREE.LineBasicMaterial({ color: 0xf2efe6, transparent: true, opacity: 0.45, fog: false }));
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.trail.layers.enable(XRAY_LAYER);
    scene.add(this.trail);

    // X-ray pass: a dark blue wash over the world, then the skeleton on top.
    this.tintScene = new THREE.Scene();
    this.tintCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.tint = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ color: 0x041420, transparent: true, opacity: 0.68, depthTest: false, depthWrite: false }));
    this.tintScene.add(this.tint);
    this.xrayLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.xrayLight.layers.set(XRAY_LAYER);
    this.xrayLight.visible = false;
    scene.add(this.xrayLight, this.xrayLight.target);

    this.shards = [];
    this.v = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3() };
  }

  // cine: { bullet, path, hit, time, vel, distance }. onImpact applies the hit; onEnd(result).
  start(cine, onImpact, onEnd) {
    this.cine = cine;
    this.onImpact = onImpact;
    this.onEnd = onEnd;
    this.soldier = cine.hit.soldier ?? null;
    this.vehicle = !this.soldier;
    this.path = cine.path;
    this.cum = [0];
    for (let i = 1; i < this.path.length; i++) this.cum.push(this.cum[i - 1] + this.path[i].distanceTo(this.path[i - 1]));
    this.D = this.cum.at(-1);
    this.entry = cine.hit.point.clone();
    this.dir = cine.vel.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    this.side = new THREE.Vector3().crossVectors(this.dir, up).normalize();
    if (this.side.lengthSq() < 0.5) this.side.set(1, 0, 0);
    this.up = new THREE.Vector3().crossVectors(this.side, this.dir).normalize();
    if (this.up.y < 0) this.up.negate();
    // Watch from whichever side has a clear view of the impact (random if both do).
    if (Math.random() < 0.5) this.side.negate();
    const blocked = (side) => {
      const eye = this.entry.clone().addScaledVector(side, 3.6).add(new THREE.Vector3(0, 0.3, 0));
      const hit = this.world.raycastSegment(eye, this.entry);
      return hit && hit.soldier !== this.soldier;
    };
    if (blocked(this.side) && !blocked(this.side.clone().negate())) this.side.negate();

    if (this.soldier) {
      buildXray(this.soldier);
      const exit = this.entry.clone().addScaledVector(this.dir, THROUGH);
      this.parts = partsAlong(this.soldier, this.entry.clone().addScaledVector(this.dir, -0.05), exit)
        .filter((p, i, all) => all.findIndex(q => q.part === p.part) === i);
    } else this.parts = [];
    this.nextPart = 0;
    this.hitNames = [];

    this.T = { flight: THREE.MathUtils.clamp(0.9 + this.D / 350, 1.2, 2.6), approach: 0.6, xray: 1.9, after: 1.3 };
    this.phase = 'flight';
    this.t = 0;
    this.impacted = false;
    this.active = true;
    this.savedFov = this.camera.fov;
    this.bullet.visible = this.trail.visible = true;
    this.camPos = null;
    this.audio.killcamWhoosh(this.T.flight + this.T.approach);
    document.body.classList.add('killcam');
  }

  pointAt(d, out) {
    if (d >= this.D) return out.copy(this.entry).addScaledVector(this.dir, d - this.D);
    if (d <= 0) return out.copy(this.path[0]);
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] < d) lo = m; else hi = m; }
    const f = (d - this.cum[lo]) / Math.max(1e-6, this.cum[hi] - this.cum[lo]);
    return out.lerpVectors(this.path[lo], this.path[hi], f);
  }

  skip() {
    if (!this.active) return;
    if (!this.impacted) this.impact();
    this.finish();
  }

  impact() {
    this.impacted = true;
    this.onImpact?.();
    this.audio.killcamImpact();
  }

  // Returns how fast the world should run (fraction of real time) this frame.
  update(realDt) {
    if (!this.active) return 1;
    this.t += realDt;
    const T = this.T, cam = this.camera, { a, b } = this.v;
    let d, worldScale = 0.03;
    let camPos = new THREE.Vector3(), look = new THREE.Vector3();
    const followCam = (dist, k) => {
      const ang = 0.35 + k * 1.3;
      return this.pointAt(dist, a).clone()
        .addScaledVector(this.dir, -0.75)
        .addScaledVector(this.side, Math.cos(ang) * 0.3)
        .addScaledVector(this.up, 0.06 + Math.sin(ang) * 0.16);
    };
    const impactView = (ang, radius) => {
      const center = this.entry.clone().addScaledVector(this.dir, 0.3);
      const offs = this.side.clone().multiplyScalar(radius).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      return center.add(offs).addScaledVector(this.dir, -0.35).add(new THREE.Vector3(0, 0.2, 0));
    };

    if (this.phase === 'flight') {
      const u = this.t / T.flight;
      d = Math.max(0, this.D - APPROACH) * easeInOut(u);
      camPos = followCam(d, u);
      look.copy(this.pointAt(d, b)).addScaledVector(this.dir, 1.2);
      if (u >= 1) { this.phase = 'approach'; this.t = 0; }
    } else if (this.phase === 'approach') {
      const v = this.t / T.approach;
      d = this.D - APPROACH + APPROACH * easeOut(v);
      const k = smooth(v);
      camPos = followCam(d, 1).lerp(impactView(0, this.vehicle ? 4 : 2.1), k);
      look.copy(this.pointAt(d, b)).addScaledVector(this.dir, 1.2 * (1 - k)).lerp(this.entry, k);
      if (v >= 1 && this.vehicle) { this.phase = 'blast'; this.t = 0; this.impact(); this.bullet.visible = this.trail.visible = false; }
      else if (v >= 1) { this.phase = 'xray'; this.t = 0; this.impact(); setXrayView(this.soldier, true); }
    } else if (this.phase === 'blast') {
      // Slow motion fireball, the camera drawing back from it.
      const z = this.t / 2.4;
      worldScale = 0.3;
      camPos = impactView(0.5 * smooth(z), 4 + 10 * smooth(z));
      camPos.y += 1.5 * smooth(z);
      look.copy(this.entry).add(new THREE.Vector3(0, 1 + 1.5 * smooth(z), 0));
      if (z >= 1) { this.finish(); return 1; }
    } else if (this.phase === 'xray') {
      const w = this.t / T.xray;
      d = this.D + THROUGH * smooth(w * 1.15);
      worldScale = 0.02;
      camPos = impactView(0.55 * smooth(w), 2.1);
      look.copy(this.entry).addScaledVector(this.dir, 0.25);
      // Break what the bullet reaches.
      const through = d - this.D;
      while (this.nextPart < this.parts.length && this.parts[this.nextPart].t * THROUGH <= through) {
        this.breakPart(this.parts[this.nextPart++]);
      }
      if (w >= 1) { this.phase = 'after'; this.t = 0; setXrayView(this.soldier, false); this.clearShards(); this.bullet.visible = this.trail.visible = false; }
    } else if (this.phase === 'after') {
      const z = this.t / T.after;
      worldScale = 0.55;
      camPos = impactView(0.55 + 0.25 * z, 2.1 + 1.6 * smooth(z));
      look.copy(this.soldier.root.position).add(new THREE.Vector3(0, 0.6, 0));
      if (z >= 1) { this.finish(); return 1; }
    }

    if (d !== undefined) {
      this.pointAt(d, this.bullet.position);
      this.bullet.lookAt(this.v.c.copy(this.bullet.position).add(this.dir));
      this.trailPts.forEach((p, i) => this.pointAt(Math.max(0, d - i * (this.phase === 'xray' ? 0.03 : 0.35)), p));
      this.trail.geometry.setFromPoints(this.trailPts);
    }
    cam.position.copy(camPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    if (cam.fov !== 45) { cam.fov = 45; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();

    this.updateShards(realDt * 0.35);
    return worldScale;
  }

  breakPart({ kind, part }) {
    const name = part.name;
    const pos = part.mesh.getWorldPosition(new THREE.Vector3());
    if (kind === 'bone') {
      part.mesh.material = part.mesh.material.clone();
      part.mesh.material.color.set(0xb9ae94);
      part.mesh.scale.multiplyScalar(0.6);
      this.spawnShards(pos, 9, 0xf0e8d4, 0.012);
      this.audio.boneCrack();
    } else {
      part.mesh.material.color.set(0x3a0503);
      part.mesh.material.emissive.set(0x200000);
      part.mesh.scale.multiplyScalar(1.15);
      this.spawnShards(pos, 12, 0x8e140f, 0.014);
      this.audio.organHit();
    }
    if (LABEL[name] && !this.hitNames.includes(LABEL[name])) this.hitNames.push(LABEL[name]);
  }

  spawnShards(pos, n, color, size) {
    const mat = new THREE.MeshBasicMaterial({ color, fog: false });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.TetrahedronGeometry(size * (0.6 + Math.random())), mat);
      m.layers.set(XRAY_LAYER);
      m.position.copy(pos);
      const v = this.dir.clone().multiplyScalar(0.5 + Math.random() * 0.8)
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.7));
      m.userData.vel = v;
      m.userData.spin = new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(8);
      this.scene.add(m);
      this.shards.push(m);
    }
  }

  updateShards(dt) {
    for (const s of this.shards) {
      s.position.addScaledVector(s.userData.vel, dt);
      s.rotation.x += s.userData.spin.x * dt;
      s.rotation.y += s.userData.spin.y * dt;
    }
  }

  clearShards() {
    for (const s of this.shards) { this.scene.remove(s); s.geometry.dispose(); }
    this.shards = [];
  }

  finish() {
    if (this.soldier) setXrayView(this.soldier, false);
    this.clearShards();
    this.bullet.visible = this.trail.visible = false;
    this.active = false;
    this.camera.fov = this.savedFov;
    this.camera.updateProjectionMatrix();
    document.body.classList.remove('killcam');
    const zone = this.cine.hit.zone ?? 'engine';
    this.onEnd?.({ distance: this.cine.distance, zone, parts: this.hitNames });
  }

  render(renderer, post) {
    const cam = this.camera;
    if (!(this.active && this.phase === 'xray')) {
      post.draw();
      return;
    }
    this.xrayLight.visible = true;
    this.xrayLight.position.copy(cam.position).add(new THREE.Vector3(0.5, 1.5, 0.5));
    this.xrayLight.target.position.copy(this.entry);
    this.xrayLight.target.updateMatrixWorld();
    renderer.render(this.scene, cam);           // world, without the target's flesh
    renderer.autoClear = false;
    renderer.render(this.tintScene, this.tintCam);
    renderer.clearDepth();
    cam.layers.set(XRAY_LAYER);                  // skeleton, organs, ghost, bullet
    renderer.render(this.scene, cam);
    cam.layers.set(0);
    renderer.autoClear = true;
    this.xrayLight.visible = false;
  }
}
