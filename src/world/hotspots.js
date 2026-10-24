// Weak spots you can shoot, Sniper Elite style:
//   siren horn     one hit wrecks the alarm (like cutting the wire, but loud)
//   generator      one hit stops it: no more sound cover there, and a guard comes to fix it
//   truck engines  first hit: smoke (the reinforcement truck stalls); second hit: it explodes,
//                  killing anyone close, and the radio truck takes the radio with it
// Each can be tagged with the binoculars; tagged spots show on screen and on the compass.
import * as THREE from 'three';

const BLAST_RADIUS = 6.5;        // soldiers this close to an exploding engine die
const PLAYER_BLAST = 12;         // the blast hurts you out to here

class Hotspot {
  constructor(opts) {
    Object.assign(this, { hits: 0, tagged: false, broken: false, exploded: false, ...opts });
    for (const m of this.meshes) m.userData.hotspot = this;
  }
  center(out = new THREE.Vector3()) {
    const m = this.meshes[0];
    m.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(m).getCenter(out);
  }
  get active() { return !this.exploded && !(this.broken && !this.explosive); }
  // Shots left to the next thing that happens, for the tag label.
  label() {
    if (this.explosive) {
      const left = 2 - this.hits;
      return `${this.title} · ${left} ${left === 1 ? 'hit' : 'hits'}`;
    }
    return `${this.title} · 1 hit`;
  }
  // Will the next hit blow it up? (The kill cam plays those.)
  explodesOnNext() { return this.explosive && !this.exploded && this.hits === 1; }
}

export class Hotspots {
  constructor({ scene, world, player, stealth, masking, audio, fx, hud, arsenal }) {
    Object.assign(this, { scene, world, player, stealth, masking, audio, fx, hud, arsenal });
    this.list = world.hotspots;
    this.fires = [];              // burning wrecks: smoke columns and flames
    this.ai = null;               // set by main (alarm, repairs, the reinforcement truck)
    this.mission = null;          // set by main (radio objective, kill count)
    this.repairT = 8;

    const siren = world.siren;
    this.add({ kind: 'siren', title: 'SIREN', meshes: siren.hornMeshes, onHit: (h) => this.breakSiren(h) });
    this.add({ kind: 'generator', title: 'GENERATOR', meshes: [world.generatorMesh], onHit: (h) => this.breakGenerator(h) });
    this.add({ kind: 'engine', title: 'RADIO TRUCK ENGINE', explosive: true, meshes: [world.radio.engine], parts: world.radio.truckParts,
      onExplode: () => {
        world.radio.antenna.visible = false;
        this.mission?.radioDestroyed();
      } });
  }

  add(opts) {
    const h = new Hotspot(opts);
    for (const m of h.meshes) if (!this.world.raycastTargets.includes(m)) this.world.raycastTargets.push(m);
    this.list.push(h);
    return h;
  }

  remove(h) {
    const i = this.list.indexOf(h);
    if (i >= 0) this.list.splice(i, 1);
  }

  // A bullet struck a weak spot.
  hit(h, point, dir, distance) {
    this.fx.emit(point, dir.clone().negate(), { color: 0xffe0a0, count: 6, speed: 4, size: 0.05, life: 0.25, grow: 1, gravity: -6 });
    this.audio.metalHit(this.player.pos.distanceTo(point));
    if (!h.active) return;
    h.hits++;
    if (h.explosive) {
      if (h.hits === 1) {
        h.broken = true;
        this.hud.message(`${h.title} HIT · SMOKING · ONE MORE SHOT`, '');
        h.onBreak?.(h);
      } else this.explode(h);
    } else {
      h.broken = true;
      h.onHit?.(h);
    }
  }

  // ---- the siren ----
  breakSiren(h) {
    const ai = this.ai;
    ai.alarm.working = false;
    ai.alarm.knownDead = false;            // a runner will still go and find it broken
    const [horn] = h.meshes;
    horn.rotation.x = 0.9;                 // knocked askew on its bracket
    horn.position.y -= 0.15;
    this.stealth.noise(h.center(), 30, 'impact');
    if (ai.alarm.on) ai.stopAlarm();
    this.hud.message('SIREN DESTROYED · THE ALARM CAN\'T SOUND', '');
  }

  // ---- the generator ----
  breakGenerator(h) {
    this.masking.generatorOn = false;
    const c = h.center();
    this.fx.emit(c, new THREE.Vector3(0, 1, 0), { color: 0x4a4640, count: 8, speed: 1.5, size: 0.6, life: 3, grow: 3, gravity: 0.6 });
    this.audio.generatorDie();
    this.stealth.noise(c, 25, 'impact');
    this.hud.message('GENERATOR DOWN · NO SOUND COVER THERE', '');
    this.repairT = 6;
  }

  // A guard puts the generator right again.
  repaired() {
    const h = this.list.find(x => x.kind === 'generator');
    h.broken = false; h.hits = 0;
    this.masking.generatorOn = true;
    this.audio.click(0, 700, 0.3);
  }

  // ---- explosions ----
  explode(h) {
    h.exploded = true;
    const at = h.center();
    // Fireball, debris and a black smoke column that keeps burning.
    this.fx.emit(at, new THREE.Vector3(0, 1, 0), { color: 0xfff0c0, count: 6, speed: 4, size: 3.5, life: 0.25, grow: 1.6, gravity: 0 });
    this.fx.emit(at, new THREE.Vector3(0, 1, 0), { color: 0xff8a30, count: 14, speed: 7, size: 1.8, life: 0.9, grow: 2.2, gravity: 1.5 });
    this.fx.emit(at, new THREE.Vector3(0, 1, 0), { color: 0x2a2520, count: 14, speed: 11, size: 0.25, life: 1.6, grow: 1, gravity: -9.8 });
    this.fx.emit(at, new THREE.Vector3(0, 1, 0), { color: 0x24211d, count: 10, speed: 4, size: 2.5, life: 5, grow: 3, gravity: 1.2 });
    this.fires.push({ at: at.clone(), t: 75, emitT: 0 });
    // The wreck goes black.
    for (const m of h.parts ?? h.meshes) {
      if (!m.material) continue;
      m.material = m.material.clone();
      m.material.color.multiplyScalar(0.18);
      m.material.map = null;
      m.material.needsUpdate = true;
    }
    const d = this.player.pos.distanceTo(at);
    this.audio.explosion(d);
    this.arsenal.shake = Math.max(this.arsenal.shake ?? 0, Math.max(0, 1.5 - d / 60));
    // Everyone around hears it: close guards know where it was.
    this.stealth.noise(at, 200, 'explosion');
    // Casualties.
    let kills = 0;
    for (const s of this.world.soldiers) {
      if (!s.alive || s.range) continue;
      const v = s.bodyPosition(new THREE.Vector3()).sub(at);
      if (v.length() < BLAST_RADIUS) {
        s.applyHit('torso', { damage: { torso: 999 } }, v.setY(0).normalize());
        kills++;
      }
    }
    if (d < PLAYER_BLAST) this.player.damage(110 * (1 - d / PLAYER_BLAST), at);
    if (kills) this.mission?.blastKills(kills);
    this.hud.message(kills ? `${h.title.replace(' ENGINE', '')} DESTROYED · ${kills} KILLED` : `${h.title.replace(' ENGINE', '')} DESTROYED`, 'head');
    h.onExplode?.(h);
  }

  // ---- per tick ----
  tick(dt) {
    // Damaged engines smoke; wrecks burn.
    for (const h of this.list) {
      if (!h.explosive || !h.broken || h.exploded) continue;
      h.smokeT = (h.smokeT ?? 0) - dt;
      if (h.smokeT <= 0) {
        h.smokeT = 0.3;
        this.fx.emit(h.center(), new THREE.Vector3(0, 1, 0), { color: 0x8a867e, count: 1, speed: 1.2, size: 0.5, life: 3, grow: 4, gravity: 0.5 });
      }
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
    // A broken generator: once things are quiet, a guard is sent to fix it.
    const gen = this.list.find(x => x.kind === 'generator');
    if (gen?.broken && this.ai && !this.ai.alarm.on) {
      this.repairT -= dt;
      if (this.repairT <= 0) {
        this.repairT = 20;
        this.ai.requestRepair(this.world.generatorStand, () => this.repaired());
      }
    }
  }

  // For the HUD: tagged, still-useful weak spots.
  tagged() { return this.list.filter(h => h.tagged && h.active); }
}
