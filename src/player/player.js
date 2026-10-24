// The player's body: stance, movement on the terrain and on top of things, collisions,
// climbing (Space: mantle onto a ledge or wall, get on a ladder) and heart rate.
// Look is applied per render frame from raw mouse deltas; movement runs at the fixed step.
import * as THREE from 'three';
import { STEP } from '../world/world.js';

const GRAVITY = 22;
const MANTLE_MAX = 2.7;      // highest ledge you can pull yourself onto (the compound wall is 2.6)
const LADDER_SPEED = 1.8;
const smooth = t => t * t * (3 - 2 * t);

export const STANCES = {
  stand: { eye: 1.65, walk: 3.2, sprint: 6.2, restHR: 74, moveHR: 96 },
  crouch: { eye: 0.85, peekEye: 1.2, walk: 1.8, sprint: 0, restHR: 70, moveHR: 88 },
  prone: { eye: 0.32, walk: 0.75, sprint: 0, restHR: 64, moveHR: 80 },
};

export class Player {
  constructor(world, input, audio) {
    this.world = world;
    this.input = input;
    this.audio = audio;
    this.pos = world.spawn.clone();
    this.prevPos = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = -Math.PI / 2;   // facing +x, down the range
    this.pitch = 0;
    this.stance = 'stand';
    this.eye = STANCES.stand.eye;
    this.prevEye = this.eye;
    this.heartRate = 74;
    this.sprinting = false;
    this.moving = false;
    this.stepT = 0;
    this.radius = 0.35;
    this.carrying = null;
    this.speed = 0;
    this.moveYaw = this.yaw;
    this.vy = 0;
    this.grounded = true;
    this.fallTop = this.pos.y;
    this.climb = null;         // { kind: 'mantle' | 'ladder', ... } while climbing
    this.onNoise = null;       // (pos, radius, kind) => void: climbing and landing sounds
    this.health = 100;
    this.hurtT = 99;           // seconds since the last hit
    this.hitFrom = null;       // where the last hit came from
    this.dead = false;
  }

  // A guard's bullet found you.
  damage(amount, from) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtT = 0;
    this.hitFrom = from.clone();
    this.heartRate = Math.min(175, this.heartRate + 18);
    this.audio.hurt();
    if (this.health <= 0) { this.dead = true; this.climb = null; this.vel.set(0, 0, 0); }
  }

  look(dx, dy, sens, invertY) {
    const k = 0.0022 * sens;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invertY ? -1 : 1);
    const lim = this.stance === 'prone' ? 0.9 : 1.45;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -lim, lim);
  }

  setStance(s) {
    if (s === this.stance) return;
    // Standing up needs headroom; boxes overhead are rare here, so just switch.
    this.stance = s;
  }

  tick(dt, { aiming }) {
    const inp = this.input;
    // Wounds close slowly once you're out of the fight for a while.
    this.hurtT += dt;
    if (this.hurtT > 8 && this.health < 100 && !this.dead) this.health = Math.min(100, this.health + 5 * dt);
    if (this.dead) { this.prevPos.copy(this.pos); this.prevEye = this.eye; this.eye += (0.3 - this.eye) * (1 - Math.exp(-3 * dt)); return; }
    if (inp.wasPressed('KeyC') && !this.climb) this.setStance(this.stance === 'crouch' ? 'stand' : 'crouch');
    if (inp.wasPressed('KeyZ') && !this.climb && this.grounded) this.setStance(this.stance === 'prone' ? 'crouch' : 'prone');

    // WASD or the arrow keys; while aiming, the arrows zero the scope instead.
    const key = (k, arrow) => inp.down(k) || (!aiming && inp.down(arrow));
    const fwd = (key('KeyW', 'ArrowUp') ? 1 : 0) - (key('KeyS', 'ArrowDown') ? 1 : 0);
    const strafe = (key('KeyD', 'ArrowRight') ? 1 : 0) - (key('KeyA', 'ArrowLeft') ? 1 : 0);
    this.prevPos.copy(this.pos);
    this.prevEye = this.eye;

    if (this.climb) this.tickClimb(dt, fwd);
    else {
      if (inp.wasPressed('Space') && !this.carrying) this.tryClimb();
      if (!this.climb) this.tickWalk(dt, fwd, strafe, aiming);
    }
    const st = STANCES[this.stance];

    // Eye height eases between stances; aiming from a crouch rises to look over cover.
    const eyeTarget = aiming && st.peekEye ? st.peekEye : st.eye;
    this.eye += (eyeTarget - this.eye) * (1 - Math.exp(-9 * dt));

    const horiz = Math.hypot(this.vel.x, this.vel.z);
    this.moving = horiz > 0.4;
    this.speed = horiz;
    if (horiz > 0.3) this.moveYaw = Math.atan2(-this.vel.x, -this.vel.z);

    // Heart rate: climbs fast with effort, settles slowly at rest.
    const target = this.sprinting ? 168 : this.climb ? 110 : this.moving ? st.moveHR : st.restHR;
    const rate = target > this.heartRate ? 16 : 4.5;
    this.heartRate += Math.sign(target - this.heartRate) * Math.min(Math.abs(target - this.heartRate), rate * dt);

    if (this.moving) {
      this.stepT -= dt * horiz;
      if (this.stepT <= 0) {
        this.stepT = this.stance === 'prone' ? 1.2 : 1.6;
        this.audio.step(this.stance);
      }
    }
  }

  tickWalk(dt, fwd, strafe, aiming) {
    const wantsSprint = this.input.down('ShiftLeft') && fwd > 0 && !aiming && !this.carrying && this.grounded;
    if (wantsSprint && this.stance !== 'stand') this.setStance('stand'); // sprinting stands you up
    this.sprinting = wantsSprint && this.stance === 'stand';

    const st = STANCES[this.stance];
    let speed = this.sprinting ? st.sprint : st.walk;
    if (aiming) speed *= 0.55;
    if (this.carrying) speed *= 0.45; // dragging a body

    // Wish direction in world space (yaw 0 faces -z).
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = new THREE.Vector3(-sin * fwd + cos * strafe, 0, -cos * fwd - sin * strafe);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(speed);
    const a = 1 - Math.exp(-(this.grounded ? 12 : 2) * dt);
    this.vel.x += (wish.x - this.vel.x) * a;
    this.vel.z += (wish.z - this.vel.z) * a;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.world.collideCircle(this.pos, this.radius, this.pos.y, this.pos.y + this.eye + 0.15);

    // Vertical: step up onto low ledges, follow slopes and stairs down, fall off anything higher.
    const floor = this.world.floorAt(this.pos.x, this.pos.z, this.pos.y);
    if (floor >= this.pos.y) {
      if (!this.grounded) this.land(floor);
      this.eye = Math.max(0.2, this.eye - (floor - this.pos.y)); // the view rises smoothly up a step
      this.pos.y = floor;
      this.vy = 0;
    } else if (this.grounded && this.pos.y - floor <= STEP + 0.05) {
      this.pos.y = floor;
    } else {
      if (this.grounded) { this.grounded = false; this.vy = 0; this.fallTop = this.pos.y; }
      this.vy -= GRAVITY * dt;
      this.pos.y = Math.max(floor, this.pos.y + this.vy * dt);
      if (this.pos.y <= floor) this.land(floor);
    }
  }

  land(floor) {
    const h = this.fallTop - floor;
    this.grounded = true;
    this.vy = 0;
    if (h > 1.2) {
      this.audio.step('stand');
      this.onNoise?.(this.pos.clone().setY(floor), Math.min(30, 4 + h * 3), 'landing');
      if (h > 4) { this.heartRate = Math.min(170, this.heartRate + h * 6); this.vel.multiplyScalar(0.2); }
    }
  }

  // ---- climbing ----
  // What Space would do here, for the HUD prompt (null = nothing).
  climbOption() {
    if (this.climb || this.carrying || !this.grounded || this.stance === 'prone') return null;
    const lad = this.nearLadder();
    if (lad) return { kind: 'ladder', ladder: lad.ladder, down: lad.down, label: lad.down ? 'SPACE · CLIMB DOWN' : 'SPACE · CLIMB LADDER' };
    const ledge = this.findLedge();
    if (ledge) return { kind: 'mantle', to: ledge, label: 'SPACE · CLIMB' };
    return null;
  }

  nearLadder() {
    for (const l of this.world.ladders ?? []) {
      if (Math.abs(this.pos.y - l.bottom) < 0.6 && Math.hypot(this.pos.x - l.foot.x, this.pos.z - l.foot.z) < 0.9) return { ladder: l, down: false };
      if (Math.abs(this.pos.y - l.top) < 0.3 && Math.hypot(this.pos.x - l.topSpot.x, this.pos.z - l.topSpot.z) < 0.8) return { ladder: l, down: true };
    }
    return null;
  }

  // A ledge in front of you (a wall top, crate, sandbags, truck) you can pull yourself onto.
  findLedge() {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const feet = this.pos.y;
    for (const d of [0.5, 0.7, 0.9]) {
      const x = this.pos.x + fx * d, z = this.pos.z + fz * d;
      const top = this.world.floorAt(x, z, feet, MANTLE_MAX);
      if (top <= feet + STEP || top > feet + MANTLE_MAX) continue;
      // Stand a little way onto the top (or in the middle of a thin wall), with room above.
      const box = this.world.boxes.find(b => Math.abs(b.max.y - top) < 1e-3 && x > b.min.x - 0.06 && x < b.max.x + 0.06 && z > b.min.z - 0.06 && z < b.max.z + 0.06);
      if (!box || Math.min(box.max.x - box.min.x, box.max.z - box.min.z) < 0.25) continue; // not onto railings or posts
      if (box.min.y > feet + 0.6) continue;  // only things rising from your level, not a roof overhead
      const inset = (lo, hi, v) => hi - lo < 0.5 ? (lo + hi) / 2 : THREE.MathUtils.clamp(v, lo + 0.25, hi - 0.25);
      const to = new THREE.Vector3(inset(box.min.x, box.max.x, x + fx * 0.25), top, inset(box.min.z, box.max.z, z + fz * 0.25));
      if (!this.world.clearAbove(to.x, to.z, top, top + 1.1)) continue;
      return to;
    }
    return null;
  }

  tryClimb() {
    const opt = this.climbOption();
    if (!opt) return;
    this.vel.set(0, 0, 0);
    this.sprinting = false;
    if (opt.kind === 'mantle') {
      const h = opt.to.y - this.pos.y;
      this.climb = { kind: 'mantle', from: this.pos.clone(), to: opt.to, t: 0, dur: 0.35 + h * 0.22 };
      if (this.stance !== 'stand') this.setStance('stand');
      this.onNoise?.(this.pos.clone(), 3 + h, 'climb');
      this.audio.rustle?.();
    } else if (opt.down) {
      // Step over the edge onto the ladder: a short move from the platform to the rungs.
      const l = opt.ladder;
      this.climb = { kind: 'mantle', from: this.pos.clone(), to: new THREE.Vector3(l.foot.x, l.top - 1.2, l.foot.z), t: 0, dur: 0.6, then: l };
      this.setStance('stand');
    } else {
      this.climb = { kind: 'ladder', ladder: opt.ladder, stepT: 0 };
      this.setStance('stand');
      this.pos.x = opt.ladder.foot.x; this.pos.z = opt.ladder.foot.z;
      this.pos.y = opt.ladder.bottom + 0.3; // feet on the first rung
    }
  }

  tickClimb(dt, fwd) {
    const c = this.climb;
    this.climbRate = 0;
    if (c.kind === 'mantle') {
      // Up first, then over: the body rises at the wall, then moves onto the top.
      c.t = Math.min(1, c.t + dt / c.dur);
      const up = smooth(Math.min(1, c.t / 0.7)), over = smooth(Math.max(0, (c.t - 0.35) / 0.65));
      const down = c.to.y < c.from.y;
      this.pos.x = c.from.x + (c.to.x - c.from.x) * (down ? up : over);
      this.pos.z = c.from.z + (c.to.z - c.from.z) * (down ? up : over);
      this.pos.y = c.from.y + (c.to.y - c.from.y) * (down ? over : up);
      if (c.t >= 1) {
        this.climb = c.then ? { kind: 'ladder', ladder: c.then, stepT: 0 } : null;
        this.grounded = !c.then;
        this.fallTop = this.pos.y;
      }
      return;
    }
    // On the ladder: W climbs, S goes down, Space lets go.
    const l = c.ladder;
    if (this.input.wasPressed('Space')) {
      this.climb = null;
      this.grounded = false;
      this.fallTop = this.pos.y;
      this.vy = 0;
      this.pos.x += (l.foot.x - l.topSpot.x) * 0.12; // push off backward, away from the rungs
      this.pos.z += (l.foot.z - l.topSpot.z) * 0.12;
      return;
    }
    this.pos.y += fwd * LADDER_SPEED * dt;
    this.climbRate = fwd * LADDER_SPEED;
    if (fwd) {
      c.stepT -= dt;
      if (c.stepT <= 0) { c.stepT = 0.42; this.audio.step('crouch'); this.onNoise?.(this.pos.clone(), 5, 'climb'); }
    }
    if (this.pos.y <= l.bottom && fwd < 0) {
      this.pos.y = l.bottom;
      this.climb = null;
      this.grounded = true;
    } else if (this.pos.y >= l.top - 1.0) {
      // Over the top onto the platform.
      this.climb = { kind: 'mantle', from: this.pos.clone(), to: l.topSpot.clone(), t: 0, dur: 0.7 };
    }
  }

  eyePosition(alpha, out = new THREE.Vector3()) {
    out.lerpVectors(this.prevPos, this.pos, alpha);
    out.y += this.prevEye + (this.eye - this.prevEye) * alpha;
    return out;
  }
}
