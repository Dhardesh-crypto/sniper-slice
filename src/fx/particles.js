// Pooled sprite puffs for impacts: dust on ground/walls, red mist on body hits.
import * as THREE from 'three';

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Particles {
  constructor(scene, size = 96) {
    const tex = softDot();
    this.pool = [];
    for (let i = 0; i < size; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true }));
      s.visible = false;
      s.userData = { noAO: true, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1 };
      scene.add(s);
      this.pool.push(s);
    }
    this.next = 0;
  }

  emit(point, normal, { color, count, speed, size, life, grow = 2, gravity = -1 }) {
    for (let i = 0; i < count; i++) {
      const s = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      s.visible = true;
      s.material.color.set(color);
      s.material.opacity = 0.9;
      s.position.copy(point).addScaledVector(normal, 0.05);
      const v = s.userData.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8).add(normal).normalize();
      v.multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      s.userData.life = 0;
      s.userData.max = life * (0.7 + Math.random() * 0.6);
      s.userData.size = size * (0.6 + Math.random() * 0.8);
      s.userData.grow = grow;
      s.userData.gravity = gravity;
      s.scale.setScalar(s.userData.size);
    }
  }

  dust(point, normal, distance) {
    // Scale puffs up with range so they stay visible through the scope.
    const k = 1 + distance / 150;
    this.emit(point, normal, { color: 0xb8a882, count: 12, speed: 3.5, size: 0.45 * k, life: 1.8, grow: 3 });
    this.emit(point, normal, { color: 0x6d5f45, count: 5, speed: 6, size: 0.12 * k, life: 0.6, grow: 1.2, gravity: -9 });
  }

  // Entry puff faces the shooter; `exit` sprays forward along the bullet.
  blood(point, dir, exit = false) {
    if (exit) this.emit(point, dir, { color: 0x6e0c08, count: 14, speed: 3.2, size: 0.22, life: 0.9, grow: 2.2, gravity: -4 });
    else this.emit(point, dir, { color: 0x8a120c, count: 8, speed: 1.4, size: 0.2, life: 0.6, grow: 1.8, gravity: -3 });
  }

  flash(point, dir) {
    this.emit(point, dir, { color: 0xffd27a, count: 3, speed: 1.5, size: 0.28, life: 0.07, grow: 1.4, gravity: 0 });
    this.emit(point, dir, { color: 0xcfc8b8, count: 4, speed: 1.2, size: 0.25, life: 0.9, grow: 3, gravity: 0.3 });
  }

  update(dt) {
    for (const s of this.pool) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life += dt;
      if (u.life >= u.max) { s.visible = false; continue; }
      u.vel.y += u.gravity * dt;
      u.vel.multiplyScalar(Math.exp(-2.5 * dt));
      s.position.addScaledVector(u.vel, dt);
      const t = u.life / u.max;
      s.scale.setScalar(u.size * (1 + (u.grow - 1) * t));
      s.material.opacity = 0.85 * (1 - t);
    }
  }
}
