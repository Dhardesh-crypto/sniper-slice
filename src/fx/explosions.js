// Everything that goes bang: grenades, mines, TNT, satchels, vehicles and tank shells.
// One explosion = fireball and debris (and a smoke column for big ones), casualties in the
// kill radius, hurt to you nearer than the hurt radius, a noise every guard in earshot hears,
// and chain reactions: vehicles and placed explosives caught in the blast go off too.
import * as THREE from 'three';

export class Explosions {
  constructor({ scene, world, player, stealth, audio, fx, hud, arsenal }) {
    Object.assign(this, { scene, world, player, stealth, audio, fx, hud, arsenal });
    // The flash lights up the surroundings for an instant (two lights, reused; always in the
    // scene at zero brightness, since adding or hiding a light recompiles every material).
    this.lights = [0, 1].map(() => { const l = new THREE.PointLight(0xffb060, 0, 30, 1.6); scene?.add(l); return l; });
    this.flashes = [];
    // Scorch marks left on the ground (reused, fading over a minute).
    this.scorchTex = scorchTexture();
    this.scorches = [];
    this.fires = [];          // burning wrecks: smoke columns (and flames early on)
    this.pending = [];        // chain reactions, a beat after the blast that set them off
    this.hotspots = null;     // set by main: vehicles that can be set off
    this.chainers = [];       // set by main: things a blast can set off (placed charges, explosives crates)
    this.onKills = null;      // (n) => void, for the mission stats
  }

  // radius: soldiers closer die; hurt: you take damage nearer than this; size: visual scale;
  // noise: how far guards hear it; burn: leave a smoke column; heavy: can wreck armour (satchel, shell).
  // chain: how close an engine must be to be set off (default: the kill radius, at most 4 m).
  explode(at, { radius = 6.5, hurt = 12, size = 1, noise = 200, burn = false, heavy = false, label = null, by = 'player', chain = null } = {}) {
    this.visuals(at, size);
    if (burn) this.fires.push({ at: at.clone(), t: 75, emitT: 0 });
    const d = this.player.pos.distanceTo(at);
    this.audio.explosion(d, size >= 1.2 || burn);
    this.arsenal.shake = Math.max(this.arsenal.shake ?? 0, Math.max(0, 1.5 * size - d / 60));
    this.stealth.noise(at, noise, 'explosion');
    // Casualties.
    let kills = 0;
    for (const s of this.world.soldiers) {
      if (!s.alive || s.range) continue;
      const v = s.bodyPosition(new THREE.Vector3()).sub(at);
      if (v.length() < radius && this.clear(at, s.bodyPosition(new THREE.Vector3()))) {
        s.applyHit('torso', { damage: { torso: 999 } }, v.setY(0).normalize());
        kills++;
      }
    }
    if (d < hurt && this.clear(at, this.player.pos.clone().setY(this.player.pos.y + 1))) this.player.damage(110 * (1 - d / hurt), at);
    if (kills && by === 'player') this.onKills?.(kills);
    if (label) this.hud.message(kills ? `${label} · ${kills} KILLED` : label, kills ? 'head' : '');
    // Chain reactions: engines and charges caught in the blast.
    for (const h of this.hotspots?.list ?? []) {
      if (!h.explosive || h.exploded || (h.armored && !heavy)) continue;
      if (h.distanceTo(at) < (chain ?? Math.min(radius, 4))) this.pending.push({ t: 0.25, run: () => this.hotspots.explode(h) });
    }
    for (const c of this.chainers) c.caughtIn(at, radius, this.pending);
    return kills;
  }

  // What a blast looks like: a white-hot flash that lights everything around, a glowing
  // fireball that rolls upward into black smoke, sparks and dirt flung out, a ring of dust
  // racing along the ground, a column of grey smoke, and a scorch mark left behind.
  visuals(at, size) {
    const up = new THREE.Vector3(0, 1, 0), fx = this.fx;
    const ground = this.world.groundAt(at.x, at.z), low = at.y - ground < 1.2;
    fx.emit(at, up, { color: 0xfff4d8, count: 4, speed: 2 * size, size: 4.5 * size, life: 0.14, grow: 1.5, gravity: 0, glow: true, heat: 14 });  // the flash
    fx.emit(at, up, { color: 0xffa040, count: 16, speed: 6 * size, size: 2.6 * size, life: 0.55, grow: 2.0, gravity: 3, glow: true, heat: 5 });   // fireball
    fx.emit(at, up, { color: 0xff5a14, count: 12, speed: 4 * size, size: 2.0 * size, life: 0.95, grow: 2.4, gravity: 4, glow: true, heat: 2.5 }); // rolling flames
    fx.emit(at, up, { color: 0xffd27a, count: 22, speed: 22 * size, size: 0.09, life: 0.7, grow: 0.5, gravity: -9.8, glow: true, heat: 8 });   // sparks
    fx.emit(at, up, { color: 0x14110e, count: 18, speed: 9 * size, size: 2.4 * size, life: 4, grow: 3.2, gravity: 2.4 });                        // black billows
    fx.emit(at, up, { color: 0x3a3127, count: 24, speed: 16 * size, size: 0.2, life: 1.8, grow: 1, gravity: -9.8 });                             // dirt and debris
    fx.emit(at, up, { color: 0x5d5850, count: 12, speed: 3 * size, size: 3 * size, life: 9, grow: 4.5, gravity: 1.3 });                          // grey smoke column
    if (low) {
      // A ring of dust racing out along the ground.
      const p = at.clone(); p.y = ground + 0.3;
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2;
        fx.emit(p, new THREE.Vector3(Math.cos(a), 0.05, Math.sin(a)), { color: 0x9c8b6c, count: 1, speed: 11 * size, size: 1.4 * size, life: 2.2, grow: 4, gravity: 0.2 });
      }
      this.scorch(p, size);
    }
    const light = this.lights.find(l => !this.flashes.some(f => f.light === l)) ?? this.lights[0];
    light.position.copy(at).y += 0.8;
    this.flashes = this.flashes.filter(f => f.light !== light);
    this.flashes.push({ light, t: 0, peak: 60 * size * size });
  }

  scorch(at, size) {
    let s = this.scorches.find(x => x.t <= 0);
    if (!s && this.scorches.length < 10) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, color: 0x000000 }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.noAO = true;
      this.scene?.add(mesh);
      s = { mesh, t: 0 };
      this.scorches.push(s);
    }
    s ??= this.scorches.reduce((a, b) => (a.t < b.t ? a : b));
    s.mesh.position.copy(at).y += 0.03 - 0.3;
    s.mesh.scale.setScalar(3.2 * size);
    s.mesh.rotation.z = Math.random() * Math.PI * 2;
    s.mesh.visible = true;
    s.t = 60;
  }

  // Walls stop a blast: is there nothing solid between the blast and `p`?
  clear(at, p) {
    const from = at.clone().add(new THREE.Vector3(0, 0.4, 0));
    const hit = this.world.raycastSegment(from, p);
    return !hit || hit.soldier || hit.hotspot || hit.distance > from.distanceTo(p) - 0.5;
  }

  tick(dt) {
    for (const f of this.flashes) {
      f.t += dt;
      f.light.intensity = f.peak * Math.exp(-f.t / 0.07);
      if (f.t > 0.4) { f.light.intensity = 0; f.done = true; }
    }
    this.flashes = this.flashes.filter(f => !f.done);
    for (const s of this.scorches) {
      if (s.t <= 0) continue;
      s.t -= dt;
      s.mesh.material.opacity = Math.min(0.75, s.t / 20);
      if (s.t <= 0) s.mesh.visible = false;
    }
    for (const f of this.fires) {
      f.t -= dt;
      f.emitT -= dt;
      if (f.t > 0 && f.emitT <= 0) {
        f.emitT = 0.3;
        this.fx.emit(f.at, new THREE.Vector3(0, 1, 0), { color: 0x262320, count: 1, speed: 2, size: 1.6, life: 7, grow: 4, gravity: 0.8 });
        if (f.t > 30) this.fx.emit(f.at, new THREE.Vector3(0, 1, 0), { color: 0xff7a28, count: 1, speed: 1.5, size: 0.7, life: 0.5, grow: 1.5, gravity: 2 });
      }
    }
    this.fires = this.fires.filter(f => f.t > 0);
    for (const p of this.pending) p.t -= dt;
    const due = this.pending.filter(p => p.t <= 0);
    this.pending = this.pending.filter(p => p.t > 0);
    for (const p of due) p.run();
  }
}

// A soft-edged blotch for scorch marks: dark in the middle, ragged at the rim.
function scorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 30, x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, R = 18 + Math.random() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, R);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}
