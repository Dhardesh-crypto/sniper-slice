// Searching bodies for supplies: stand over a dead soldier and hold E. The player
// crouches over the body; after a short search the supplies go into the reserve.
import * as THREE from 'three';

const REACH = 1.9;          // metres from the body (horizontal)
const SEARCH_TIME = 1.1;    // seconds of holding E
const MAX_RESERVE = { rifle: 40, pistol: 32 };

// What a body carries. Guards: rifle rounds, sometimes pistol rounds.
// Officers: pistol rounds and papers (intel for later objectives).
function rollLoot(soldier, rng = Math.random) {
  if (soldier.officer) return { rifle: 0, pistol: 6 + Math.floor(rng() * 5), papers: 1 };
  return { rifle: 3 + Math.floor(rng() * 5), pistol: rng() < 0.35 ? 2 + Math.floor(rng() * 4) : 0, papers: 0 };
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
      const take = Math.max(0, Math.min(loot[kind], MAX_RESERVE[kind] - w.reserve));
      w.reserve += take;
      if (take > 0) got.push(`+${take} ${kind} rounds`);
      else got.push(`${kind} ammo full`);
    }
    if (loot.papers) { this.papers += loot.papers; got.push("officer's papers"); }
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
