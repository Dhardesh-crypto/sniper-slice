// A vehicle blowing up, not just going black: the blast heaves it up off its wheels and drops it
// back askew, a tank's turret is blown off its ring and comes down beside the hull, and pieces of
// it (panels torn from the body, a wheel or two) fly out spinning, some trailing smoke and fire,
// bounce and lie where they land, still burning a while. Then the fuel goes up a moment later.
// The burnt-out wreck itself is hotspots.js's (wreck / swapForWreck).
import * as THREE from 'three';

const MAX_PIECES = 160;
const GRAVITY = 9.8;
const WHEELED = new Set(['truck', 'car', 'bowser', 'motorcycle', 'halftrack', 'staffCar', 'kubelwagen']);

export class Wreckage {
  constructor({ scene, world, fx }) {
    Object.assign(this, { scene, world, fx });
    this.pieces = [];
    this.heaves = [];
    this.rubber = new THREE.MeshStandardMaterial({ color: 0x171513, roughness: 0.95 });
  }

  // `root`: the vehicle's group (what moves when it heaves); `body`: a mesh of it, for its paint;
  // `at`: the blast; `armored`: a tank (heavier: it barely lifts; its turret goes instead).
  blow({ root, body, at, armored = false, kind = null, size = 1 }) {
    if (!root) return;
    root.updateMatrixWorld(true);
    const bb = new THREE.Box3();
    root.traverse(o => { if (o.isMesh && o.visible !== false && o.material?.visible !== false) bb.expandByObject(o); });
    if (bb.isEmpty()) bb.setFromCenterAndSize(at, new THREE.Vector3(2, 1.5, 4));
    const dims = bb.getSize(new THREE.Vector3()), centre = bb.getCenter(new THREE.Vector3());
    const span = Math.max(dims.x, dims.z);
    // Burnt paint: the vehicle's own material (its texture), charred.
    const src = Array.isArray(body?.material) ? body.material[0] : body?.material;
    const paint = src?.isMaterial ? src.clone() : new THREE.MeshStandardMaterial({ color: 0x4a4a40 });
    paint.color?.setRGB(0.13, 0.12, 0.11);   // (scorched; a set level: some models' colours run past white under the texture)
    paint.roughness = 1; paint.metalness = 0.2;
    // Panels and chunks, more off a bigger vehicle.
    const n = Math.round(THREE.MathUtils.clamp(span * 3, 10, 24) * (armored ? 0.7 : 1));
    for (let i = 0; i < n; i++) {
      const plate = Math.random() < 0.6;
      const s = (0.15 + Math.random() * 0.35) * Math.min(1.6, span / 4);
      const geo = plate ? new THREE.BoxGeometry(s * (1 + Math.random()), 0.03 + Math.random() * 0.03, s * (0.6 + Math.random())) : new THREE.BoxGeometry(s, s * (0.5 + Math.random() * 0.5), s * (0.6 + Math.random() * 0.6));
      const from = new THREE.Vector3(bb.min.x + Math.random() * dims.x, centre.y + Math.random() * dims.y * 0.5, bb.min.z + Math.random() * dims.z);
      this.throw(new THREE.Mesh(geo, paint), from, at, armored ? 0.8 : 1.15, Math.random() < 0.45);
    }
    // A wheel or two off anything that runs on them.
    if (kind && WHEELED.has(kind)) {
      const r = THREE.MathUtils.clamp(dims.y * 0.22, 0.25, 0.5);
      for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 0.6, 14).rotateZ(Math.PI / 2), this.rubber);
        const from = new THREE.Vector3(bb.min.x + Math.random() * dims.x, bb.min.y + r, Math.random() < 0.5 ? bb.min.z + 0.5 : bb.max.z - 0.5);
        this.throw(wheel, from, at, 0.9, false);
      }
    }
    // A tank's turret: blown off its ring, up and over, down beside the hull.
    let turret = null;
    root.traverse(o => { if (!turret && o.userData.turret) turret = o; });
    if (turret) {
      const crew = turret.userData.crew;
      if (crew) crew.dead = true;
      this.scene.attach(turret);
      turret.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color?.multiplyScalar(0.3); if ('metalness' in o.material) { o.material.metalness = 0.15; o.material.roughness = 1; } } });
      const side = Math.random() * Math.PI * 2, out = 2.5 + Math.random() * 1.5;   // (over the side: it comes down beside the hull, not on it)
      const p = { mesh: turret, vel: new THREE.Vector3(Math.cos(side) * out, 8 + Math.random() * 2, Math.sin(side) * out), spin: new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).normalize(), rate: 3 + Math.random() * 3, half: 0.15, burn: 6, heavy: true };
      this.add(p);
    }
    // The vehicle itself: heaved up and tipped, slammed back down a little askew.
    const axis = new THREE.Vector3(centre.z - at.z, 0, at.x - centre.x);
    if (axis.lengthSq() < 0.01) axis.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    this.heaves.push({ root, base: root.position.clone(), quat: root.quaternion.clone(), axis: axis.normalize(), t: 0, lift: (armored ? 1.2 : 4.5) * size, tip: (armored ? 0.08 : 0.32) * (0.7 + Math.random() * 0.6), rest: (armored ? 0.02 : 0.06) * (Math.random() < 0.5 ? -1 : 1) });
    return { turret };
  }

  throw(mesh, from, at, power, burning) {
    mesh.castShadow = true;
    mesh.position.copy(from);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.scene.add(mesh);
    const out = from.clone().sub(at).setY(0);
    if (out.lengthSq() < 0.01) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    out.normalize().applyAxisAngle(UP, (Math.random() - 0.5) * 0.8);
    const vel = out.multiplyScalar((3 + Math.random() * 7) * power).setY((4.5 + Math.random() * 7) * power);
    this.add({ mesh, vel, spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), rate: 6 + Math.random() * 10, half: 0.05, burn: burning ? 5 + Math.random() * 6 : 0 });
  }

  add(p) {
    p.trailT = 0;
    this.pieces.push(p);
    if (this.pieces.length > MAX_PIECES) {
      const old = this.pieces.shift();
      if (!old.heavy) { old.mesh.removeFromParent(); old.mesh.geometry.dispose?.(); }
    }
  }

  tick(dt) {
    for (const p of this.pieces) {
      if (p.burn > 0) {
        p.burn -= dt;
        if ((p.trailT -= dt) <= 0) {
          p.trailT = p.rest ? 0.25 : 0.05;
          const at = p.mesh.position;
          if (p.rest) this.fx.emit(at, UP, { color: 0xff7a2a, count: 1, speed: 0.6, size: 0.35, life: 0.5, grow: 1.5, gravity: -1, glow: true, heat: 3 });
          this.fx.emit(at, UP, { color: 0x1d1a17, count: 1, speed: p.rest ? 0.8 : 0.2, size: p.rest ? 0.6 : 0.4, life: p.rest ? 2.5 : 1.4, grow: 3, gravity: 0.8 });
        }
      }
      if (p.rest) continue;
      p.vel.y -= GRAVITY * dt;
      const m = p.mesh, from = m.position.clone();
      m.position.addScaledVector(p.vel, dt);
      m.rotateOnWorldAxis(p.spin, p.rate * dt);
      // Into a wall: it stops there and drops.
      if (this.world.boxAlong && this.world.boxAlong(from, m.position) !== null) { m.position.x = from.x; m.position.z = from.z; p.vel.x *= -0.2; p.vel.z *= -0.2; }
      const floor = this.world.floorAt(m.position.x, m.position.z, from.y + 0.5) + p.half;
      if (m.position.y <= floor && p.vel.y < 0) {
        m.position.y = floor;
        if (Math.abs(p.vel.y) > 2.5) { p.vel.y *= -0.3; p.vel.x *= 0.5; p.vel.z *= 0.5; p.rate *= 0.5; }
        else {
          // Lies where it fell, flat on its biggest face.
          p.rest = true;
          const e = new THREE.Euler().setFromQuaternion(m.quaternion);
          m.rotation.set(Math.round(e.x / (Math.PI / 2)) * Math.PI / 2, e.y, Math.round(e.z / (Math.PI / 2)) * Math.PI / 2);
          if (p.heavy) this.fx.emit(m.position, UP, { color: 0x8a7a62, count: 10, speed: 4, size: 1.2, life: 1.6, grow: 3, gravity: 0.5 });   // (the turret lands: dust)
        }
      }
    }
    // The heave: up, tipped over the blast's far side, down again with a jolt; it settles askew.
    for (const h of this.heaves) {
      if (h.done) continue;
      h.t += dt;
      const T = Math.max(0.5, 2 * h.lift / GRAVITY), k = Math.min(1, h.t / T);
      const y = h.lift * T * k - 0.5 * GRAVITY * (T * k) ** 2;   // (a hop: up and back down in T)
      const bounce = k >= 1 ? 0.06 * Math.exp(-(h.t - T) * 9) * Math.sin((h.t - T) * 30) : 0;
      h.root.position.copy(h.base).y += Math.max(0, y) + bounce;
      const tip = k < 1 ? h.tip * Math.sin(k * Math.PI) + h.rest * k : h.rest;
      h.root.quaternion.copy(h.quat).premultiply(_q.setFromAxisAngle(h.axis, tip));
      if (h.t > T + 0.5) { h.done = true; h.root.position.copy(h.base); }
    }
    this.heaves = this.heaves.filter(h => !h.done || h.keep);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
