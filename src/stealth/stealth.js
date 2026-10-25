// Stealth: how far you're heard, how easily you're seen, and how each guard's awareness
// grows from calm to suspicious to alerted. Guards see in a cone, hear noise events
// (footsteps, shots, impacts, falling bodies) unless the sound is masked, and find
// bodies left in the open. Phase 5 turns these states into investigating and combat.
import * as THREE from 'three';
import { inTallGrass } from '../world/vegetation.js';
import { activeMap } from '../world/terrain.js';

const STEP_NOISE = { stand: 8, crouch: 3.5, prone: 1.2 };      // metres, walking
const SPRINT_NOISE = 20;
const STANCE_VIS = { stand: 1, crouch: 0.55, prone: 0.25 };
const GRASS_VIS = { stand: 0.7, crouch: 0.12, prone: 0.05 };     // extra factor in tall grass
const SIGHT = { range: 120, cone: THREE.MathUtils.degToRad(55), peripheral: THREE.MathUtils.degToRad(90) };
const SUSPICIOUS = 0.45;
const MASKED_SHOT = 0.12;        // a fully masked shot carries 12% as far
const CALM_DOWN = 14;            // seconds without news before a suspicious guard relaxes
const ALERT_HOLD = 45;           // seconds an alerted guard stays alerted (Phase 5: searching)
const SHOUT = 40;                // an alerted guard alerts others this close
// Concealed in tall grass (crouched or prone), a guard can't make you out beyond this
// (metres; half as far again while you move). Inside it, you're merely hard to see.
const CONCEAL_SIGHT = { crouch: 7, prone: 4 };
// Concealed, a guard has really spotted you (knows where you are, can shoot) only with a
// clear enough look: detection this fast, or you right under his nose. Fainter glimpses only
// make him wary. In the open any clear line of sight counts, as before.
const SPOT_RATE = 0.3;
const POINT_BLANK = 2.5;
// A guard who stumbles onto you in hiding needs a moment to take it in before he shouts or
// fires: your window for an ambush takedown.
const REACTION = 1.0;

export class Stealth {
  constructor({ world, player, arsenal, masking, audio, hud }) {
    Object.assign(this, { world, player, arsenal, masking, audio, hud });
    this.time = 0;
    this.noiseRadius = 0;        // your footsteps, for the minimap ring
    this.lastShot = null;        // { radius, masked, t }
    this.mask = { amount: 0, source: null };
    this.alarm = false;          // the siren is sounding: alerted guards stay alerted
    this.wariness = 1;           // rises after each alarm: guards spot you faster
    this.v = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3() };
    for (const s of world.soldiers) this.enlist(s);
  }

  guards() { return this.world.soldiers.filter(s => s.alive && !s.range && !s.takenDown); }

  // A soldier who joins during play (reinforcements) gets an awareness record.
  enlist(s) {
    s.aware = { meter: 0, state: 'calm', stimulus: null, lastNews: -99, checkT: Math.random() * 0.2, bodyT: Math.random() * 0.3 };
  }

  // ---- what you give away ----
  playerVisibility() {
    const p = this.player;
    let v = STANCE_VIS[p.stance];
    // Ground-level grass only: not when you're up on a wall, tower or truck.
    this.inGrass = p.grounded && !p.climb && p.pos.y - this.world.groundAt(p.pos.x, p.pos.z) < 0.3 && inTallGrass(this.world.grassPatches, p.pos.x, p.pos.z);
    if (this.inGrass) v *= GRASS_VIS[p.stance];
    // In a forest's shade (maps that have one): each tree close by hides you a little more.
    if (activeMap().canopyShade && p.pos.y - this.world.groundAt(p.pos.x, p.pos.z) < 1) v *= 1 - 0.1 * Math.min(4, this.world.canopyAt(p.pos.x, p.pos.z));
    if (p.sprinting) v *= 1.8;
    else if (p.moving) v *= 1 + p.speed / 5;
    return v;
  }

  footstepRadius() {
    const p = this.player;
    if (!p.moving) return 0;
    const r = p.sprinting ? SPRINT_NOISE : STEP_NOISE[p.stance] * Math.min(1.3, p.speed / 2.5 + 0.4);
    return r * (1 - 0.7 * this.mask.amount);
  }

  // ---- noise events ----
  gunshot(origin, def) {
    const masked = this.masking.loudnessAt(origin).amount;
    const radius = def.noiseRadius * (1 - (1 - MASKED_SHOT) * masked);
    this.lastShot = { radius, masked, t: this.time, source: this.masking.loudnessAt(origin).source };
    this.noise(origin, radius, 'shot');
  }

  noise(pos, radius, kind) {
    for (const s of this.guards()) {
      const ear = s.root.position;
      const d = ear.distanceTo(pos);
      if (d > radius) continue;
      if (kind === 'explosion') {
        // Everyone hears a blast; those close by know exactly where it was.
        this.raise(s, d < radius * 0.5 ? 'alerted' : 'suspicious', pos.clone(), 'explosion');
      } else if (kind === 'shot') {
        // Close shots give the direction away; far ones only a rough bearing.
        const fuzz = d * (d < radius * 0.5 ? 0.04 : 0.15);
        const guess = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * fuzz, 0, (Math.random() - 0.5) * fuzz));
        this.raise(s, d < radius * 0.5 ? 'alerted' : 'suspicious', guess, 'shot');
      } else {
        this.raise(s, 'suspicious', pos.clone(), kind);
      }
    }
  }

  // Move a guard to at least `state`, pointing him at `where`.
  raise(s, state, where, why) {
    const a = s.aware;
    const rank = { calm: 0, suspicious: 1, alerted: 2 };
    a.lastNews = this.time;
    if (where) a.stimulus = where;
    if (rank[state] <= rank[a.state]) return;
    a.state = state;
    a.meter = Math.max(a.meter, state === 'alerted' ? 1 : SUSPICIOUS);
    a.why = why;
    this.onRaise?.(why, state);
    // The guard who noticed calls out (the ones a shout reaches just join in).
    if (why !== 'shout') this.audio.shout(why === 'body' ? 'body' : why === 'seen' ? 'spotted' : 'suspicious', s.root.position.distanceTo(this.player.pos));
    s.react(a.state, a.stimulus);
    if (state === 'alerted' && why !== 'shout') { // a shout reaches neighbours but isn't passed on (the siren comes in Phase 5)
      if (why === 'seen') this.hud.message('SPOTTED', 'wound');
      if (why === 'body') this.hud.message('A BODY HAS BEEN FOUND', 'wound');
      // Shouting: guards nearby join in.
      for (const o of this.guards()) {
        if (o !== s && o.root.position.distanceTo(s.root.position) < SHOUT) this.raise(o, 'alerted', where, 'shout');
      }
    }
  }

  // ---- per tick ----
  tick(dt) {
    this.time += dt;
    const p = this.player;
    const eye = this.v.a.copy(p.pos); eye.y += p.eye;
    this.mask = this.masking.loudnessAt(eye);
    this.noiseRadius = this.footstepRadius();
    const vis = this.playerVisibility();
    const chest = this.v.b.copy(p.pos); chest.y += Math.max(0.25, p.eye * 0.75);
    const head = p.pos.clone(); head.y += p.eye + 0.08;
    this.concealed = this.inGrass && p.stance !== 'stand' && !p.sprinting;

    // New deaths: the body thuds down (nearby guards hear it); one that falls in tall grass is hidden.
    for (const b of this.world.soldiers) {
      if (b.alive || b.range || b.deathNoted) continue;
      b.deathNoted = true;
      const bp = b.bodyPosition(new THREE.Vector3());
      b.hidden = inTallGrass(this.world.grassPatches, bp.x, bp.z);
      this.noise(bp, b.quietDeath ? 2 : 9, 'body'); // a takedown lowers him down almost silently
    }

    for (const s of this.guards()) {
      const a = s.aware;
      const d = s.root.position.distanceTo(p.pos);
      let seenRate = 0;
      // Vision, checked a few times a second per guard (raycasts are not free).
      a.checkT -= dt;
      if (a.checkT <= 0) {
        a.checkT = 0.15;
        // Chest or, if that's behind cover, the head (a head over a wall is harder to spot).
        const c = this.canSee(s, chest, vis, d);
        a.seeing = c || 0.6 * this.canSee(s, head, vis, d);
        a.headOnly = !c && a.seeing > 0;
      }
      seenRate = a.seeing ?? 0;
      const sees = seenRate > 0 && (!this.concealed || seenRate >= SPOT_RATE || d < POINT_BLANK);
      if (!sees) a.seenSince = null;
      else if (a.seenSince == null) a.seenSince = this.time;
      // Out of cover a clear look is a sighting at once. Flushed out of hiding, he's startled
      // for a moment first: he turns to look, but can't shout or shoot yet.
      a.startled = sees && this.concealed && this.time - a.seenSince < REACTION;
      a.spotted = sees && !a.startled;
      if (a.startled && a.state === 'calm') this.raise(s, 'suspicious', p.pos.clone(), 'glimpse');
      if (a.spotted && this.concealed && d < POINT_BLANK && a.state !== 'alerted') { a.meter = 1; this.raise(s, 'alerted', p.pos.clone(), 'seen'); }
      // Footsteps within earshot add suspicion and point the guard at you.
      if (this.noiseRadius > 0 && d < this.noiseRadius) {
        a.meter += (1 - d / this.noiseRadius) * 0.9 * dt;
        a.stimulus = p.pos.clone();
        a.lastNews = this.time;
      }
      if (a.spotted) {
        a.meter += seenRate * dt;
        a.stimulus = p.pos.clone();
        a.lastNews = this.time;
      } else if (seenRate > 0 && a.state === 'calm') {
        // Something odd over there: he grows wary and looks roughly that way, no more.
        a.meter = Math.min(SUSPICIOUS + 0.05, a.meter + seenRate * dt);
        if (!a.stimulus || a.stimulus.distanceTo(p.pos) > 8) a.stimulus = p.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8));
      } else if (a.state === 'calm') {
        a.meter = Math.max(0, a.meter - 0.12 * dt);
      }
      if (a.meter >= 1 && a.state !== 'alerted') this.raise(s, 'alerted', p.pos.clone(), a.spotted ? 'seen' : 'heard');
      else if (a.meter >= SUSPICIOUS && a.state === 'calm') this.raise(s, 'suspicious', a.stimulus, seenRate > 0 ? 'glimpse' : 'heard');
      a.meter = Math.min(1, a.meter);
      // Calming down.
      const quiet = this.time - a.lastNews;
      if (a.state === 'suspicious' && quiet > CALM_DOWN) { a.state = 'calm'; a.meter = 0.2; s.react('calm', null); }
      if (a.state === 'alerted' && quiet > ALERT_HOLD && !this.alarm) { a.state = 'suspicious'; a.meter = 0.6; a.lastNews = this.time; s.react('suspicious', a.stimulus); }
      else if (a.state !== 'calm' && a.stimulus) s.react(a.state, a.stimulus); // keep facing the latest news
      // Bodies in the open.
      a.bodyT -= dt;
      if (a.bodyT <= 0) { a.bodyT = 0.3; this.lookForBodies(s); }
    }
  }

  // Detection rate (meter per second) of `s` seeing a target at `chest`, or 0.
  canSee(s, chest, vis, d) {
    const a = s.aware;
    if (this.concealed && d > CONCEAL_SIGHT[this.player.stance] * (this.player.moving ? 1.5 : 1)) return 0;
    const eye = s.headPosition(this.v.c).setY(s.headPosition(this.v.c).y - 0.25);
    const range = SIGHT.range * (eye.y - s.root.position.y > 4 ? 1.3 : 1) * (a.state === 'alerted' ? 1.3 : 1);
    if (d > range * Math.sqrt(vis) + 3) return 0;
    const to = chest.clone().sub(eye);
    const facing = new THREE.Vector3(Math.sin(s.root.rotation.y), 0, Math.cos(s.root.rotation.y));
    const ang = Math.acos(THREE.MathUtils.clamp(to.clone().setY(0).normalize().dot(facing), -1, 1));
    const coneK = ang < SIGHT.cone ? 1 : ang < SIGHT.peripheral ? 0.3 : 0;
    if (!coneK) return 0;
    const start = eye.clone().addScaledVector(to.clone().normalize(), 0.4);
    const hit = this.world.raycastSegment(start, chest);
    if (hit && !(hit.soldier === undefined && hit.point.distanceTo(chest) < 0.4)) return 0;
    const stateK = a.state === 'alerted' ? 2 : a.state === 'suspicious' ? 1.5 : 1;
    return 1.1 * this.wariness * vis * coneK * stateK * Math.pow(Math.max(0, 1 - d / range), 1.3);
  }

  lookForBodies(s) {
    for (const b of this.world.soldiers) {
      if (b.alive || b.range || b.hidden || b.dragged || s.aware.bodiesSeen?.has(b)) continue;
      const bp = b.bodyPosition(this.v.c).clone();
      const d = s.root.position.distanceTo(bp);
      if (d > 45) continue;
      const facing = new THREE.Vector3(Math.sin(s.root.rotation.y), 0, Math.cos(s.root.rotation.y));
      const to = bp.clone().sub(s.root.position).setY(0).normalize();
      if (to.dot(facing) < Math.cos(THREE.MathUtils.degToRad(70)) && d > 4) continue;
      const eye = s.headPosition(new THREE.Vector3());
      // A body lying on a tower platform or a roof can't be seen from the ground below: only
      // from about the same height (another tower) or from above.
      if (bp.y - eye.y > 1.2 && (bp.y - eye.y) / Math.max(1, Math.hypot(bp.x - eye.x, bp.z - eye.z)) > 0.08) continue;
      const hit = this.world.raycastSegment(eye.clone().addScaledVector(bp.clone().sub(eye).normalize(), 0.4), bp.clone().add(new THREE.Vector3(0, 0.2, 0)));
      if (hit && hit.soldier !== b) continue;
      b.found = true;
      (s.aware.bodiesSeen ??= new Set()).add(b); // each guard reacts to each body once
      this.raise(s, 'alerted', bp, 'body');
      return;
    }
  }

  // For the HUD.
  state() {
    let worst = 'calm';
    for (const s of this.guards()) if (s.aware.state === 'alerted') worst = 'alerted'; else if (s.aware.state === 'suspicious' && worst === 'calm') worst = 'suspicious';
    // Concealed: crouched or prone in tall grass (standing, the grass hides you only a little).
    const p = this.player;
    const concealed = this.inGrass && p.stance !== 'stand' && !p.sprinting;
    return { inGrass: !!this.inGrass, concealed,
      alarm: this.alarm, mask: this.mask, noise: this.noiseRadius, lastShot: this.lastShot, time: this.time, worst, upcoming: this.masking.upcoming() };
  }
}
