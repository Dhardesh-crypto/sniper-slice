// Searching bodies for supplies: stand over a dead soldier and hold E. The player
// crouches over the body; after a short search the supplies go into the reserve.
import * as THREE from 'three';

const REACH = 1.9;          // metres from the body (horizontal)
const SEARCH_TIME = 1.1;    // seconds of holding E
import { takeSupplies, MAX_KIT } from './supplies.js';

// What a body carries: a soldier's own kit. Rifle rounds, sometimes pistol or special rounds,
// a bandage or a medkit now and then, and the grenade on his belt if he has one. The Oberst: pistol rounds, a medkit, his
// papers and a weapon part. (Bottles, mines, TNT and satchels are only in the supply caches
// around the map: see world/pickups.js.) The Oberst also gives you his Luger, the first time.
function rollLoot(soldier, rng = Math.random) {
  const n = (a, b) => a + Math.floor(rng() * (b - a + 1));
  if (soldier.officer) return { rifle: 0, pistol: n(6, 10), papers: 1, kit: { medkit: rng() < 0.5 ? 1 : 0 } };
  return {
    rifle: n(3, 7), pistol: rng() < 0.35 ? n(2, 5) : 0, papers: 0,
    special: { subsonic: rng() < 0.25 ? n(2, 4) : 0, ap: rng() < 0.15 ? n(1, 2) : 0 },
    kit: { grenade: 0, bandage: rng() < 0.35 ? 1 : 0, medkit: rng() < 0.08 ? 1 : 0 },
  };
}

export class Search {
  constructor({ world, player, arsenal, input, audio, hud }) {
    Object.assign(this, { world, player, arsenal, input, audio, hud });
    this.target = null;
    this.progress = 0;
    this.papers = 0;
    this.wasStance = null;
    this.rustleT = 0;
  }

  nearestBody() {
    const p = this.player.pos, v = new THREE.Vector3();
    let best = null, bestD = REACH;
    for (const s of this.world.soldiers) {
      if (s.alive || s.searched || s.range) continue;
      s.bodyPosition(v);
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < bestD && Math.abs(v.y - p.y) < 2.5) { best = s; bestD = d; }
    }
    return best;
  }

  tick(dt) {
    const body = this.nearestBody();
    if (body !== this.target) { this.target = body; this.cancel(); }
    const holding = this.target && this.input.down('KeyE') && !this.player.moving && !this.arsenal.aiming && !this.arsenal.busy;
    if (!holding) { this.cancel(); return; }
    if (this.progress === 0 && this.player.stance === 'stand') {
      this.wasStance = 'stand';
      this.player.setStance('crouch'); // kneel over the body
    }
    this.progress += dt / SEARCH_TIME;
    this.rustleT -= dt;
    if (this.rustleT <= 0) { this.rustleT = 0.28; this.audio.rustle(); }
    if (this.progress >= 1) this.finish();
  }

  cancel() {
    if (this.progress > 0 && this.wasStance) this.player.setStance(this.wasStance);
    this.progress = 0;
    this.wasStance = null;
  }

  finish() {
    const s = this.target;
    s.searched = true;
    const loot = rollLoot(s);
    // The grenade on his belt, if you have room for it (otherwise it stays on him).
    if ((this.items?.count.grenade ?? 0) < MAX_KIT.grenade && this.beltGrenades?.take(s)) loot.kit.grenade = 1;
    const got = [];
    got.push(...takeSupplies({ arsenal: this.arsenal, items: this.items }, loot));
    if (!got.length && (loot.rifle || loot.pistol)) got.push('ammo full');
    if (loot.papers) { this.papers += loot.papers; got.push("officer's papers"); this.onPapers?.(); }
    if (s.officer) { const part = this.pickups?.givePart(); if (part) got.push(`part: ${part.name}`); }  // the Oberst carries a weapon part
    if (s.officer && this.pickups?.profile.addWeapon('luger')) got.push('weapon: Luger P08 · fit it at a workbench');  // and his Luger
    this.audio.pickup();
    this.hud.message(got.length ? got.join(' · ').toUpperCase() : 'NOTHING USEFUL');
    if (this.wasStance) this.player.setStance(this.wasStance);
    this.progress = 0;
    this.wasStance = null;
    this.target = null;
  }

  // For the HUD prompt.
  state() {
    return this.target ? { label: this.progress > 0 ? 'SEARCHING…' : 'HOLD E · SEARCH BODY', progress: this.progress } : null;
  }
}
