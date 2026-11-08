// Shoot twice from one spot and they start to work out where you are. Each shot someone hears
// from the same place tightens their fix: the third brings a squad, round the sides and in, while
// you've still time to move, and the squad goes where you were. Nothing here knows where you are:
// only what guards heard. A shot nobody hears, or one covered by a louder noise, tells them nothing.
// Guards with a stick grenade on the belt also use it, on a place they know you're near and can't see.
import * as THREE from 'three';
import { stickGrenade } from '../world/belt-grenades.js';

const SAME_SPOT = 15;        // m: shots from within this count as one firing point
const FORGET = 120;          // s of quiet before the fix goes cold
const COVERED = 0.6;         // masked this much, a shot gives nothing away
const SQUAD = 4, SQUAD_REACH = 220, REST = 75;   // men sent, how far off they come from, s before another goes
const ROUND = 22;            // m to the side of the line in that the squad swings out
const THROW = { min: 9, max: 26, wait: 14, flight: 1.25, fuse: 3.2 };   // m; s between throws, s in the air, s to the blast
const BLAST = { radius: 5, hurt: 9, size: 0.8, noise: 200, by: 'guard' };

export class CounterFire {
  constructor({ scene, world, player, stealth, ai, audio, explosions, beltGrenades }) {
    Object.assign(this, { scene, world, player, stealth, ai, audio, explosions, beltGrenades });
    this.fix = null;             // { at, n, t }
    this.squadAt = -99;          // when the last squad went
    this.thrownAt = -99;
    this.live = [];              // grenades thrown at you
    stealth.onGunshot = (shot) => this.heard(shot);
    ai.counterfire = this;
  }

  get time() { return this.stealth.time; }

  heard(shot) {
    if (!shot.heard.length || shot.masked >= COVERED) return;
    const f = this.fix;
    if (f && f.at.distanceTo(shot.origin) < SAME_SPOT && this.time - f.t < FORGET) { f.n++; f.t = this.time; }
    else this.fix = { at: shot.origin.clone(), n: 1, t: this.time };
    const n = this.fix.n;
    if (n === 2) shot.note = 'THEY HAVE A BEARING';
    if (n >= 3 && this.time - this.squadAt > REST && this.dispatch()) shot.note = 'THEY HAVE YOUR POSITION · MOVE';
  }

  // The nearest free men go. Their fix is good to a few metres, no better.
  dispatch() {
    const f = this.fix, at = f.at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10));
    at.y = this.world.groundAt(at.x, at.z);
    const free = this.ai.guards().filter(s => {
      const b = s.brain;
      return !b.fixed && !b.nest && !b.help && !b.task && !b.hunt && !s.officer && !s.riding && !s.manning && !s.surrendered && !s.unarmed && this.ai.alarm.runner !== s
        && s.root.position.distanceTo(at) < SQUAD_REACH;
    }).sort((a, b) => a.root.position.distanceTo(at) - b.root.position.distanceTo(at)).slice(0, SQUAD);
    if (!free.length) return false;
    free.forEach((s, i) => {
      const inward = at.clone().sub(s.root.position).setY(0).normalize();
      const side = new THREE.Vector3(-inward.z, 0, inward.x).multiplyScalar(i % 2 ? ROUND : -ROUND);
      s.brain.hunt = { at, via: this.ai.randomPointNear(at.clone().add(side).addScaledVector(inward, -10), 6), round: true, t: 0 };
      this.stealth.raise(s, 'alerted', at.clone(), 'shout');
    });
    this.squadAt = this.time;
    this.fix = null;
    return true;
  }

  // One of the squad, each tick: wide round the side at a run, then in.
  flank(s, dt) {
    const h = s.brain.hunt, ai = this.ai;
    s.aware.lastNews = this.time;             // (he's on an errand: he doesn't stand down)
    h.t += dt;
    if (h.round) {
      if (ai.goTo(s, h.via, 3.8, dt) || h.t > 40) { h.round = false; s.brain.path = null; }
      return;
    }
    this.tryGrenade(s, h.at);
    if (ai.goTo(s, h.at, 2.6, dt) || h.t > 90) {
      s.brain.hunt = null;                    // nobody there: he searches round about
      s.brain.lastSeen = h.at;
    }
  }

  // The stick grenade off his belt, if he has one and there's a clear lob to `at`.
  tryGrenade(s, at) {
    if (this.time - this.thrownAt < THROW.wait || s.surrendered || !s.beltGrenade || s.beltGrenade.gone) return false;
    const from = s.root.position.clone().setY(s.root.position.y + 1.7), d = Math.hypot(at.x - from.x, at.z - from.z);
    if (d < THROW.min || d > THROW.max) return false;
    const t = THROW.flight, vel = at.clone().sub(from).multiplyScalar(1 / t); vel.y += 4.9 * t;
    const a = from.clone(), b = new THREE.Vector3();
    for (let i = 1; i <= 16; i++) {           // (it mustn't drop at his own feet off a wall in front of him)
      const k = t * i / 16;
      b.copy(from).addScaledVector(vel, k); b.y -= 4.9 * k * k;
      const hit = this.world.raycastSegment(a, b);
      if (hit && !hit.soldier && hit.point.distanceTo(at) > 4) return false;
      a.copy(b);
    }
    this.beltGrenades.take(s);
    this.thrownAt = this.time;
    s.targetYaw = Math.atan2(at.x - from.x, at.z - from.z);
    s.root.rotation.y = s.targetYaw;          // (he squares up to throw: the clip throws straight ahead)
    this.audio.shout('spotted', s.root.position.distanceTo(this.player.pos));
    const mesh = stickGrenade();
    // Thrown with the throw clip: it leaves his hand as the arm comes over, on a fresh lob from
    // there to the same spot in the same time. Shot before then, he drops it where he stands.
    const launch = (hand, dropped) => {
      const v = dropped ? new THREE.Vector3(0, 1, 0) : at.clone().sub(hand).multiplyScalar(1 / t);
      if (!dropped) v.y += 4.9 * t;
      mesh.position.copy(hand);
      this.scene.add(mesh);
      this.live.push({ mesh, pos: hand.clone(), vel: v, fuse: dropped ? Math.min(THROW.fuse, 2.5) : THROW.fuse, spin: 7 + Math.random() * 5 });
    };
    if (!s.throwGrenade(mesh, launch)) { s.kick = 1; launch(from, false); }
    return true;
  }

  tick(dt) {
    const prev = new THREE.Vector3();
    for (const g of this.live) {
      g.fuse -= dt;
      if (!g.rest) {
        prev.copy(g.pos);
        g.vel.y -= 9.8 * dt;
        g.pos.addScaledVector(g.vel, dt);
        const hit = this.world.raycastSegment(prev, g.pos);
        if (hit && !hit.soldier) {
          g.vel.reflect(hit.normal).multiplyScalar(0.3);
          g.pos.copy(hit.point).addScaledVector(hit.normal, 0.06);
          if (g.vel.length() < 1) g.rest = true;
          this.audio.impact?.(this.player.pos.distanceTo(g.pos) + 30);
        }
        g.mesh.rotation.x += g.spin * dt;
      }
      g.mesh.position.copy(g.pos);
      if (g.fuse <= 0) {
        this.scene.remove(g.mesh);
        g.done = true;
        this.explosions.explode(g.pos.clone(), BLAST);
      }
    }
    this.live = this.live.filter(g => !g.done);
  }

  // For the HUD: grenades near enough to be your problem.
  near() { return this.live.filter(g => g.pos.distanceTo(this.player.pos) < 22); }
}
