// Everything that goes bang: grenades, mines, TNT, satchels, vehicles and tank shells.
// One explosion = fireball and debris (and a smoke column for big ones), casualties in the
// kill radius, hurt to you nearer than the hurt radius, a noise every guard in earshot hears,
// and chain reactions: vehicles and placed explosives caught in the blast go off too.
import * as THREE from 'three';

export class Explosions {
  constructor({ world, player, stealth, audio, fx, hud, arsenal }) {
    Object.assign(this, { world, player, stealth, audio, fx, hud, arsenal });
    this.fires = [];          // burning wrecks: smoke columns (and flames early on)
    this.pending = [];        // chain reactions, a beat after the blast that set them off
    this.hotspots = null;     // set by main: vehicles that can be set off
    this.traps = null;        // set by main: placed mines/TNT/satchels that can be set off
    this.onKills = null;      // (n) => void, for the mission stats
  }

  // radius: soldiers closer die; hurt: you take damage nearer than this; size: visual scale;
  // noise: how far guards hear it; burn: leave a smoke column; heavy: can wreck armour (satchel, shell).
  explode(at, { radius = 6.5, hurt = 12, size = 1, noise = 200, burn = false, heavy = false, label = null, by = 'player' } = {}) {
    const up = new THREE.Vector3(0, 1, 0);
    this.fx.emit(at, up, { color: 0xfff0c0, count: 6, speed: 4 * size, size: 3.5 * size, life: 0.25, grow: 1.6, gravity: 0 });
    this.fx.emit(at, up, { color: 0xff8a30, count: 12, speed: 7 * size, size: 1.8 * size, life: 0.9, grow: 2.2, gravity: 1.5 });
    this.fx.emit(at, up, { color: 0x2a2520, count: 12, speed: 11 * size, size: 0.25, life: 1.6, grow: 1, gravity: -9.8 });
    this.fx.emit(at, up, { color: 0x24211d, count: 8, speed: 4 * size, size: 2.5 * size, life: 5, grow: 3, gravity: 1.2 });
    if (burn) this.fires.push({ at: at.clone(), t: 75, emitT: 0 });
    const d = this.player.pos.distanceTo(at);
    this.audio.explosion(d);
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
      if (h.center().distanceTo(at) < Math.min(radius, 4)) this.pending.push({ t: 0.25, run: () => this.hotspots.explode(h) });
    }
    this.traps?.caughtIn(at, radius, this.pending);
    return kills;
  }

  // Walls stop a blast: is there nothing solid between the blast and `p`?
  clear(at, p) {
    const from = at.clone().add(new THREE.Vector3(0, 0.4, 0));
    const hit = this.world.raycastSegment(from, p);
    return !hit || hit.soldier || hit.hotspot || hit.distance > from.distanceTo(p) - 0.5;
  }

  tick(dt) {
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
