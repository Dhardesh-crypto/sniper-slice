// Disguise: take a dead guard's uniform (hold U over the body: three seconds of changing, low
// down) and walk among them. Dressed as one of theirs you're hard to make out for what you are:
// far off a guard sees only a soldier going about his business; close up, or to an officer's eye,
// it takes less. It only holds while you act the part: running, crouching, crawling, climbing,
// aiming or carrying a body, they see you as plainly as ever. A bloodstained tunic gets looks.
// Once a guard has seen through it (spotted you outright) the alarm goes out about the man in
// their uniform and it's worth nothing; and if they find the body you stripped, they're on the
// lookout. Blown up or burnt, a uniform's no use. Hold U with no body by you to take it off.
import * as THREE from 'three';

const REACH = 1.9;
const CHANGE = 3.0;             // s to change
const FAR = 0.12;               // how much of you a guard makes out, acting the part
const LOOKOUT = 0.35;           // the same, once they've found the stripped body
const CLOSE = 4;                // m: inside this a guard gets a proper look

export class Disguise {
  constructor({ world, player, avatar, arsenal, input, audio, hud, carry, takedown }) {
    Object.assign(this, { world, player, avatar, arsenal, input, audio, hud, carry, takedown });
    this.on = false;            // wearing one
    this.blown = false;         // seen through: no good any more
    this.look = null;
    this.bloody = false;
    this.lookout = false;
    this.progress = 0;
    this.target = null;
  }

  nearestBody() {
    const p = this.player.pos, v = new THREE.Vector3();
    let best = null, bestD = REACH;
    for (const s of this.world.soldiers) {
      if (s.alive || s.range || s.stripped || s.uniformRuined) continue;
      s.bodyPosition(v);
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < bestD && Math.abs(v.y - p.y) < 2.5) { best = s; bestD = d; }
    }
    return best;
  }

  // Acting the part: walking or standing, weapon down, hands free.
  inCharacter() {
    const p = this.player, a = this.arsenal;
    return !p.sprinting && p.stance === 'stand' && !p.climb && !p.carrying && !a.aiming && !this.takedown?.active && a.current !== 'heavy';
  }

  // How much of the usual sighting rate guard `s` gets at distance d.
  factor(s, d) {
    if (!this.on || this.blown || !this.inCharacter()) return 1;
    let k = this.lookout ? LOOKOUT : FAR;
    if (this.bloody) k *= 2;
    if (d < CLOSE) k *= 2;
    if (s.officer) k *= 2;
    return Math.min(1, k);
  }

  // A guard has spotted you for what you are (stealth.js: alerted by what he saw).
  seenThrough() {
    if (!this.on || this.blown) return;
    this.blown = true;
    this.hud.message('YOUR DISGUISE IS BLOWN', 'wound');
  }

  tick(dt) {
    // Found the man you stripped: they know to look twice at their own.
    if (this.on && !this.lookout && this.world.soldiers.some(s => s.stripped && s.found)) {
      this.lookout = true;
      if (!this.blown) this.hud.message('THEY FOUND THE STRIPPED BODY · THEY ARE LOOKING TWICE AT THEIR OWN', 'wound');
    }
    this.target = this.nearestBody();
    const can = this.target || this.on;
    const holding = can && this.input.down('KeyU') && !this.player.moving && !this.arsenal.aiming && !this.arsenal.busy && !this.player.carrying;
    if (!holding) { if (this.progress > 0) this.standBack(); this.progress = 0; return; }
    if (this.progress === 0) { this.audio.rustle?.(); this.wasStance = this.player.stance; }
    if (this.player.stance === 'stand') this.player.setStance?.('crouch');   // (changing, low down)
    this.progress += dt / CHANGE;
    if (this.progress < 1) return;
    this.progress = 0;
    this.standBack();
    if (this.target) this.wear(this.target);
    else this.takeOff();
  }

  standBack() {
    if (this.wasStance === 'stand' && this.player.stance === 'crouch') this.player.setStance?.('stand');
    this.wasStance = null;
  }

  wear(body) {
    if (this.on) this.takeOff(true);
    body.stripped = true;
    body.searched = true;                                         // (you went through his pockets as well)
    this.look = body.look ?? 'guard';
    this.bloody = !!body.bloodied;
    this.on = this.avatar.wearUniform(this.look);
    this.blown = false;
    this.lookout = this.world.soldiers.some(s => s.stripped && s.found);
    if (this.on) this.hud.message(this.bloody ? 'IN HIS UNIFORM · THE BLOODSTAINS WILL GET LOOKS' : 'IN HIS UNIFORM · WALK, DON\'T RUN', '');
  }

  takeOff(quiet = false) {
    this.avatar.takeOffUniform();
    this.on = false;
    this.blown = false;
    if (!quiet) this.hud.message('BACK IN YOUR OWN CLOTHES', '');
  }

  state() {
    if (this.progress > 0) return { label: this.target ? 'CHANGING INTO HIS UNIFORM…' : 'TAKING THE UNIFORM OFF…', progress: this.progress };
    if (this.target && !this.player.carrying) return { label: `HOLD U · TAKE HIS UNIFORM${this.target.bloodied ? ' (BLOODSTAINED)' : ''}`, progress: 0 };
    return null;
  }

  // For the HUD's banner.
  status() {
    if (!this.on) return null;
    if (this.blown) return 'DISGUISE BLOWN';
    return this.inCharacter() ? 'IN DISGUISE' : 'IN DISGUISE · ACTING SUSPICIOUSLY';
  }

  snapshot() { return this.on ? { look: this.look, bloody: this.bloody, blown: this.blown, lookout: this.lookout } : null; }
  restore(d) {
    if (!d) return;
    this.on = this.avatar.wearUniform(d.look);
    Object.assign(this, { look: d.look, bloody: d.bloody, blown: d.blown, lookout: d.lookout });
  }
}
