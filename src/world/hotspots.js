// Weak spots you can shoot, Sniper Elite style:
//   siren horn     one hit wrecks the alarm (like cutting the wire, but loud)
//   generator      one hit stops it: no more sound cover there, and a guard comes to fix it
//   truck engines  first hit: smoke (the reinforcement truck stalls); second hit: it explodes,
//                  killing anyone close, and the radio truck takes the radio with it
//   staff car      the same, engine at the back
//   tank           armoured: standard rounds ping off; two armour-piercing hits on the engine
//                  grille, or a satchel charge, destroy it
// An armour-piercing round counts as two hits on an ordinary engine (it blows in one shot).
// Each can be tagged with the binoculars; tagged spots show on screen and on the compass.
import * as THREE from 'three';

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
  get toExplode() { return this.hitsToExplode ?? 2; }
  label() {
    if (this.explosive) {
      const left = this.toExplode - this.hits;
      return this.armored ? `${this.title} · ${left} AP ${left === 1 ? 'hit' : 'hits'} or a satchel` : `${this.title} · ${left} ${left === 1 ? 'hit' : 'hits'}`;
    }
    return `${this.title} · 1 hit`;
  }
  // Will the next hit (with this ammunition) blow it up? (The kill cam plays those.)
  explodesOnNext(ap = false) {
    if (!this.explosive || this.exploded || (this.armored && !ap)) return false;
    return this.hits + (ap && !this.armored ? 2 : 1) >= this.toExplode;
  }
}

export class Hotspots {
  constructor({ scene, world, player, stealth, masking, audio, fx, hud, arsenal, explosions }) {
    Object.assign(this, { scene, world, player, stealth, masking, audio, fx, hud, arsenal, explosions });
    this.list = world.hotspots;
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
    this.add({ kind: 'engine', title: 'STAFF CAR ENGINE', explosive: true, meshes: [world.staffCar.engine], parts: world.staffCar.parts });
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

  // A bullet struck a weak spot (ap: an armour-piercing round).
  hit(h, point, dir, distance, ap = false) {
    this.fx.emit(point, dir.clone().negate(), { color: 0xffe0a0, count: 6, speed: 4, size: 0.05, life: 0.25, grow: 1, gravity: -6 });
    this.audio.metalHit(this.player.pos.distanceTo(point));
    if (!h.active) return;
    if (h.armored && !ap) { this.hud.message(`${h.title} · ARMOURED: USE AP ROUNDS OR A SATCHEL`, ''); return; }
    h.hits += ap && !h.armored ? 2 : 1;
    if (h.explosive) {
      if (h.hits < h.toExplode) {
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
    if (h.exploded) return;
    const at = h.center();
    this.wreck(h);
    const name = h.title.replace(' ENGINE', '');
    this.explosions.explode(at, { radius: h.armored ? 7.5 : 6.5, size: h.armored ? 1.5 : 1, burn: true, heavy: true, label: `${name} DESTROYED` });
    h.onExplode?.(h);
  }

  // The wreck goes black (also used when a save restores one).
  wreck(h) {
    h.exploded = true;
    for (const m of h.parts ?? h.meshes) {
      if (!m.material) continue;
      m.material = m.material.clone();
      m.material.color.multiplyScalar(0.18);
      m.material.map = null;
      m.material.needsUpdate = true;
    }
  }

  // ---- per tick ----
  tick(dt) {
    // Damaged engines smoke (wrecks burn: see explosions.js).
    for (const h of this.list) {
      if (!h.explosive || !h.broken || h.exploded) continue;
      h.smokeT = (h.smokeT ?? 0) - dt;
      if (h.smokeT <= 0) {
        h.smokeT = 0.3;
        this.fx.emit(h.center(), new THREE.Vector3(0, 1, 0), { color: 0x8a867e, count: 1, speed: 1.2, size: 0.5, life: 3, grow: 4, gravity: 0.5 });
      }
    }
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
