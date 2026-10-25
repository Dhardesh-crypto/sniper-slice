// Searching bodies for supplies: stand over a dead soldier and hold E. The player
// crouches over the body; after a short search the supplies go into the reserve.
import * as THREE from 'three';

const REACH = 1.9;          // metres from the body (horizontal)
const SEARCH_TIME = 1.1;    // seconds of holding E
const MAX_RESERVE = { rifle: 40, pistol: 32 };
const MAX_KIT = { grenade: 4, bottle: 4, mine: 4, tnt: 3, satchel: 3, bandage: 5, medkit: 2 };
const MAX_SPECIAL = { subsonic: 20, ap: 12 };

// What a body carries. Guards: rifle rounds, now and then special rounds, a grenade, a
// bandage or a bottle. Officers: pistol rounds, a medkit and papers.
function rollLoot(soldier, rng = Math.random) {
  const n = (a, b) => a + Math.floor(rng() * (b - a + 1));
  if (soldier.officer) return { rifle: 0, pistol: n(6, 10), papers: 1, kit: { medkit: 1 } };
  const kit = {};
  if (rng() < 0.35) kit.grenade = 1;
  if (rng() < 0.4) kit.bandage = 1;
  if (rng() < 0.25) kit.bottle = 1;
  return {
    rifle: n(3, 7), pistol: rng() < 0.35 ? n(2, 5) : 0, papers: 0, kit,
    special: { subsonic: rng() < 0.3 ? n(2, 4) : 0, ap: rng() < 0.2 ? n(1, 2) : 0 },
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
    const got = [];
    for (const kind of ['rifle', 'pistol']) {
      if (!loot[kind]) continue;
      const w = this.arsenal.weapons[kind];
      // Rifle rounds from a guard are standard ones, whatever you have loaded.
      const have = kind === 'rifle' ? w.ammo.standard : w.reserve;
      const take = Math.max(0, Math.min(loot[kind], MAX_RESERVE[kind] - have));
      if (kind === 'rifle') w.ammo.standard += take; else w.reserve += take;
      if (take > 0) got.push(`+${take} ${kind} rounds`);
      else got.push(`${kind} ammo full`);
    }
    for (const [type, k] of Object.entries(loot.special ?? {})) {
      const ammo = this.arsenal.weapons.rifle.ammo, take = Math.max(0, Math.min(k, MAX_SPECIAL[type] - ammo[type]));
      if (take) { ammo[type] += take; got.push(`+${take} ${type === 'ap' ? 'AP' : 'subsonic'} rounds`); }
    }
    for (const [id, k] of Object.entries(loot.kit ?? {})) {
      if (!this.items) break;
      const take = Math.max(0, Math.min(k, MAX_KIT[id] - this.items.count[id]));
      if (take) { this.items.count[id] += take; got.push(`+${take} ${id}`); }
    }
    if (loot.papers) { this.papers += loot.papers; got.push("officer's papers"); }
    if (s.officer) { const part = this.pickups?.givePart(); if (part) got.push(`part: ${part.name}`); }  // the Oberst carries a weapon part
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
