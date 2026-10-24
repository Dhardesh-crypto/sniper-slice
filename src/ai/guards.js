// The guards' minds. The stealth system says what each guard knows (calm / suspicious /
// alerted, where the news came from, whether he sees you right now); this decides what
// he does about it:
//   post        calm: stand your post or walk your patrol route, back home after a scare
//   investigate suspicious: walk to the noise or glimpse, look around
//   search      alerted, lost sight of you: run to where you were last seen, sweep around it
//   combat      alerted and you're in sight: find cover nearby, duck, rise and fire
//   alarm       the one guard sent running to the siren post to sound it
//   flee        the officer: unarmed, he runs for the villa's back wall
//   repair      sent to restart the generator after you shot it (a lure into the open)
// The siren brings every guard in and a truck with four more. Cut its wire and it can't sound.
import * as THREE from 'three';
import { NavGrid } from './nav.js';
import { Soldier } from '../world/soldier.js';
import { roadCenterZ, COMPOUND } from '../world/terrain.js';

const WALK = 1.4, RUN = 3.8;
const LOOK_AROUND = 5;          // seconds spent looking around at a spot
const LOST_SIGHT = 6;           // seconds in combat without seeing you before searching
const ALARM_QUIET = 60;         // the siren stops after this long without anyone seeing you
const REINFORCE_DELAY = 12;     // seconds from the siren to the truck setting off
const SIREN_ACTIVATE = 1.5;     // seconds at the post to sound it
const CUT_TIME = 1.6;           // seconds holding E to cut the wire

// Patrol routes, metres from the compound centre (walked in a loop at a stroll), with an
// optional pause in seconds at a point. The Oberst's is his daily routine.
const ROUTES = {
  'Officer': [[10, 0.5, 25], [8, 4], [-3.5, 9.8, 16], [6, 12], [20, 9, 10], [10, 4], [10, 0.5]],
  'Yard guard': [[20, 6], [20, 18], [2, 20], [-12, 6], [2, 0], [20, 6]],
  'Barn guard': [[-15, -6], [-26, -6], [-26, -20], [-6, -20], [-6, -6]],
};

function truckModel() {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0x55593f, roughness: 0.7, metalness: 0.2 });
  const canvas = new THREE.MeshStandardMaterial({ color: 0x6c6b4f, roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1e1b, roughness: 0.8 });
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; g.add(b); };
  box(2.2, 0.4, 6.4, paint, 0, 0.75, 0);          // chassis
  box(2.2, 1.6, 1.9, paint, 0, 1.75, 2.1);        // cab (front is +z)
  box(2.3, 2.1, 4.2, canvas, 0, 2.0, -1.1);       // covered cargo bed
  box(2.0, 0.85, 1.0, paint, 0, 1.2, 3.55);       // bonnet over the engine (a weak spot)
  for (const z of [2.2, -1.0, -2.3]) for (const x of [-1.05, 1.05]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.32, 14).rotateZ(Math.PI / 2), dark);
    w.position.set(x, 0.48, z); w.castShadow = true; g.add(w);
  }
  return g;
}

export class GuardAI {
  constructor({ scene, world, player, stealth, audio, fx, hud }) {
    Object.assign(this, { scene, world, player, stealth, audio, fx, hud });
    this.nav = new NavGrid(world);
    this.time = 0;
    this.siren = world.siren;
    this.alarm = { on: false, working: true, runner: null, quietT: 0, count: 0, activateT: 0 };
    this.truck = null;
    this.reinforced = false;
    this.cutProgress = 0;
    this.v = new THREE.Vector3();
    for (const s of world.soldiers) if (!s.range) this.enlist(s);
    // Debug overlay: each guard's path (F3).
    this.pathLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd060, depthTest: false }));
    this.pathLines.renderOrder = 999;
    this.pathLines.frustumCulled = false;
    this.pathLines.visible = false;
    scene.add(this.pathLines);
  }

  enlist(s) {
    const ground = this.world.groundAt(s.root.position.x, s.root.position.z);
    s.brain = {
      mode: 'post', path: null, wpi: 0, goal: null, repathT: 0, lookT: 0, sweeps: 0,
      fixed: s.root.position.y > ground + 3,            // tower guards hold their platform
      route: ROUTES[s.name]?.map(([x, z, wait = 0]) => Object.assign(new THREE.Vector3(COMPOUND.x + x, ground, COMPOUND.z + z), { wait })), routeI: 0, waitT: 0,
      lastSeen: null, lastSeenT: -99, fireT: 0, shots: 0, cover: null, coverTried: false,
      progressT: 0, progressAt: s.root.position.clone(), stuck: 0,
    };
  }

  guards() { return this.world.soldiers.filter(s => s.alive && !s.range && s.brain); }

  // ---------------------------------------------------------------- per tick
  tick(dt) {
    this.time += dt;
    const p = this.player;
    for (const s of this.guards()) {
      const a = s.aware, b = s.brain;
      if (a.seeing > 0 && a.state === 'alerted') { b.lastSeenT = this.time; b.lastSeen = p.pos.clone(); }
      const mode = this.decide(s);
      if (mode !== b.mode) this.enter(s, mode);
      this.run(s, dt);
    }
    this.tickAlarm(dt);
    this.tickTruck(dt);
    this.tickSabotage(dt);
    if (this.pathLines.visible) this.drawPaths();
  }

  decide(s) {
    const a = s.aware, b = s.brain;
    if (s.officer) return a.state === 'calm' ? 'post' : 'flee';
    if (b.task && a.state !== 'alerted') return 'repair';
    if (a.state === 'alerted') {
      if (this.alarm.runner === s) return 'alarm';
      if (this.time - b.lastSeenT < (b.mode === 'combat' ? LOST_SIGHT : 0.4)) return 'combat';
      return b.fixed ? 'post' : 'search';
    }
    if (a.state === 'suspicious' && !b.fixed) return 'investigate';
    return 'post';
  }

  enter(s, mode) {
    const b = s.brain;
    b.mode = mode;
    b.path = null; b.goal = null; b.lookT = 0; b.sweeps = 0; b.stuck = 0; b.atCover = false;
    s.aimDir = null;
    s.crouchTarget = 0;
    if (mode === 'combat') {
      // Reaction time before the first shot; slower at long range.
      const d = s.root.position.distanceTo(this.player.pos);
      b.fireT = (0.9 + Math.random() * 0.7) * (d > 100 ? 1.5 : 1);
      b.shots = 0;
      b.cover = null; b.coverTried = false; b.atCover = false;
    }
  }

  run(s, dt) {
    const b = s.brain, a = s.aware, p = this.player;
    switch (b.mode) {
      case 'post': {
        if (b.route && s.aware.state === 'calm') {
          const wp = b.route[b.routeI];
          if (b.waitT > 0) {
            this.stop(s);
            if ((b.waitT -= dt) <= 0) b.routeI = (b.routeI + 1) % b.route.length;
          } else if (this.goTo(s, wp, s.officer ? WALK * 0.8 : WALK, dt)) {
            if (wp.wait) b.waitT = wp.wait;
            else b.routeI = (b.routeI + 1) % b.route.length;
          }
        } else if (!b.fixed && Math.hypot(s.root.position.x - s.home.x, s.root.position.z - s.home.z) > 0.8) {
          this.goTo(s, s.home, WALK, dt);
        } else {
          this.stop(s);
          if (a.state === 'calm') s.targetYaw = s.homeYaw;
        }
        break;
      }
      case 'investigate': {
        const target = a.stimulus;
        if (target && b.lookT === 0 && Math.hypot(target.x - s.root.position.x, target.z - s.root.position.z) > 3) {
          if (this.goTo(s, target, WALK, dt)) b.lookT = 0.01;
        } else this.lookAround(s, dt);
        break;
      }
      case 'search': {
        const target = b.goal ?? b.lastSeen ?? a.stimulus;
        if (!target) { this.lookAround(s, dt); break; }
        if (b.lookT === 0) {
          if (this.goTo(s, target, b.sweeps === 0 ? RUN : WALK * 1.4, dt)) b.lookT = 0.01;
        } else if (this.lookAround(s, dt)) {
          // Sweep a few points around where you were.
          b.sweeps++;
          const c = b.lastSeen ?? a.stimulus;
          b.goal = this.randomPointNear(c, 14);
          b.path = null; b.lookT = 0;
        }
        break;
      }
      case 'combat': this.combat(s, dt); break;
      case 'alarm': {
        if (this.goTo(s, this.siren.standAt, RUN, dt)) {
          this.stop(s);
          s.targetYaw = Math.PI; // face the junction box
          this.alarm.activateT += dt;
          if (this.alarm.activateT > SIREN_ACTIVATE) {
            if (this.alarm.working) this.soundAlarm();
            else {
              this.alarm.knownDead = true; // nobody runs for it again
              this.hud.message('THEY FOUND THE SIREN DEAD', '');
              for (const o of this.guards()) if (o !== s && o.root.position.distanceTo(s.root.position) < 70) this.stealth.raise(o, 'alerted', a.stimulus, 'shout');
            }
            this.alarm.runner = null;
            this.alarm.activateT = 0;
          }
        }
        break;
      }
      case 'repair': {
        const task = b.task;
        if (this.goTo(s, task.at, WALK, dt)) {
          this.stop(s);
          s.targetYaw = 0; // face the generator (+z)
          s.crouchTarget = 0.7;
          if ((task.t -= dt) <= 0) { b.task = null; s.crouchTarget = 0; task.done(); }
        }
        break;
      }
      case 'flee': {
        const safe = this.v.set(COMPOUND.x + 8, s.home.y, COMPOUND.z - 17); // behind the villa
        if (this.goTo(s, safe, RUN, dt)) { this.stop(s); s.targetYaw = Math.atan2(p.pos.x - s.root.position.x, p.pos.z - s.root.position.z); }
        break;
      }
    }
  }

  // ---------------------------------------------------------------- combat
  combat(s, dt) {
    const b = s.brain, a = s.aware, p = this.player;
    // Cover first: a spot behind something solid within a short run, away from your line of fire.
    if (!b.fixed && !b.coverTried) {
      b.coverTried = true;
      b.cover = this.findCover(s);
    }
    if (b.cover && !b.atCover) {
      if (this.goTo(s, b.cover, RUN, dt)) { b.atCover = true; this.stop(s); }
      else return;
    }
    this.stop(s);
    const target = (a.seeing > 0 ? p.pos : b.lastSeen ?? p.pos);
    const aimPoint = target.clone(); aimPoint.y += a.headOnly ? p.eye + 0.05 : Math.max(0.3, p.eye * 0.75);
    s.targetYaw = Math.atan2(aimPoint.x - s.root.position.x, aimPoint.z - s.root.position.z);
    b.fireT -= dt;
    // In cover: duck between shots, rise for the last moment before firing.
    s.crouchTarget = b.atCover && b.fireT > 0.8 ? 1 : 0;
    const raised = b.fireT < 1.0;
    s.aimDir = raised ? aimPoint.clone().sub(s.headPosition(this.v).setY(s.headPosition(this.v).y - 0.2)).normalize() : null;
    if (b.fireT <= 0) {
      if (a.seeing > 0 && !p.dead) { this.fire(s, aimPoint); b.fireT = 2.1 + Math.random() * 1.2; }
      else b.fireT = 0.6;
    }
  }

  findCover(s) {
    const p = this.player, from = s.root.position, eye = p.pos.clone(); eye.y += 1.6;
    let best = null, bestD = 16;
    for (const box of this.world.boxes) {
      const ground = this.world.groundAt((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2);
      if (box.max.y < ground + 0.9 || box.min.y > ground + 0.3) continue; // tall enough to duck behind, standing on the ground
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      if (Math.hypot(cx - from.x, cz - from.z) > bestD + 6) continue;
      // The side of the box facing away from you.
      const away = new THREE.Vector3(cx - p.pos.x, 0, cz - p.pos.z).normalize();
      const hx = (box.max.x - box.min.x) / 2 + 0.55, hz = (box.max.z - box.min.z) / 2 + 0.55;
      const t = Math.min(hx / Math.max(1e-3, Math.abs(away.x)), hz / Math.max(1e-3, Math.abs(away.z)));
      for (const side of [0, -0.6, 0.6]) {
        const pt = new THREE.Vector3(cx + away.x * t - away.z * side, ground, cz + away.z * t + away.x * side);
        const d = Math.hypot(pt.x - from.x, pt.z - from.z);
        if (d >= bestD || !this.nav.walkable(pt.x, pt.z)) continue;
        const ducked = pt.clone(); ducked.y += 0.9;
        const hit = this.world.raycastSegment(eye, ducked);
        if (!hit || hit.distance > eye.distanceTo(ducked) - 0.3) continue; // not actually hidden from you
        best = pt; bestD = d;
      }
    }
    return best;
  }

  fire(s, aimPoint) {
    const p = this.player, b = s.brain;
    s.char.root.updateMatrixWorld(true);
    const muzzle = s.char.muzzleWorld(new THREE.Vector3());
    const d = muzzle.distanceTo(aimPoint);
    const dir = aimPoint.clone().sub(muzzle).normalize();
    s.kick = 1;
    this.fx.flash(muzzle, dir);
    this.audio.enemyShot(d);
    // How likely this shot lands: range, your stance and movement, how much of you shows,
    // and he finds his aim on a target that doesn't move.
    let hit = 0.48 * Math.exp(-d / 85);
    hit *= { stand: 1, crouch: 0.75, prone: 0.5 }[p.stance] ?? 1;
    if (p.moving) hit *= p.sprinting ? 0.5 : 0.75;
    if (s.aware.headOnly) hit *= 0.45;
    hit *= Math.min(1.6, 1 + 0.15 * b.shots);
    b.shots++;
    if (Math.random() < Math.min(0.8, hit)) {
      p.damage(24 + Math.random() * 10, s.root.position);
    } else {
      // A miss kicks up dust near you; a close one cracks past.
      const miss = p.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
      miss.y = this.world.floorAt(miss.x, miss.z, p.pos.y + 0.3);
      this.fx.dust(miss, new THREE.Vector3(0, 1, 0), d);
      if (d < 250) this.audio.crack();
    }
  }

  // ---------------------------------------------------------------- alarm
  tickAlarm(dt) {
    const al = this.alarm;
    // Someone has to sound it: the nearest free guard to the post runs for it.
    if (!al.on && !al.runner && !al.knownDead) {
      const alerted = this.guards().some(s => s.aware.state === 'alerted' && s.aware.why !== 'shout');
      if (alerted) {
        let best = null, bestD = 90;
        for (const s of this.guards()) {
          if (s.officer || s.brain.fixed) continue;
          const d = s.root.position.distanceTo(this.siren.pos);
          if (d < bestD) { best = s; bestD = d; }
        }
        if (best) { al.runner = best; al.activateT = 0; if (best.aware.state !== 'alerted') this.stealth.raise(best, 'alerted', best.aware.stimulus, 'shout'); }
      }
    }
    if (al.runner && !al.runner.alive) { al.runner = null; al.activateT = 0; }
    if (al.on) {
      const seen = this.guards().some(s => s.aware.seeing > 0 && s.aware.state === 'alerted');
      al.quietT = seen ? 0 : al.quietT + dt;
      if (al.quietT > ALARM_QUIET || !al.working) this.stopAlarm();
      if (!this.reinforced && !this.radioDown && (al.reinforceT -= dt) <= 0) this.sendTruck(); // the radio calls them
    }
  }

  soundAlarm() {
    const al = this.alarm;
    al.on = true; al.quietT = 0; al.count++;
    if (al.count === 1) al.reinforceT = REINFORCE_DELAY;
    this.stealth.alarm = true;
    this.audio.setSiren(1);
    this.hud.message('ALARM RAISED', 'wound');
    // Every guard hears it and heads for roughly where you were seen.
    const known = this.guards().reduce((k, s) => (s.brain.lastSeenT > (k?.t ?? -1) ? { t: s.brain.lastSeenT, at: s.brain.lastSeen } : k), null)?.at ?? this.player.pos;
    for (const s of this.guards()) {
      const guess = known.clone().add(new THREE.Vector3((Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20));
      this.stealth.raise(s, 'alerted', guess, 'shout');
      if (!s.brain.lastSeen) s.brain.lastSeen = guess;
    }
  }

  stopAlarm() {
    this.alarm.on = false;
    this.stealth.alarm = false;
    this.stealth.wariness = Math.min(1.6, this.stealth.wariness + 0.2); // they stay jumpy afterward
    this.audio.setSiren(0);
    this.hud.message(this.alarm.working ? 'THE ALARM HAS STOPPED' : 'THE SIREN GOES SILENT', '');
  }

  // ---------------------------------------------------------------- reinforcements
  sendTruck() {
    this.reinforced = true;
    const t = { model: truckModel(), x: COMPOUND.x - 230, stopX: COMPOUND.x - 46, speed: 13, unloaded: false, parkT: 0, stalled: false };
    this.scene.add(t.model);
    this.truck = t;
    // Bullets stop on it; the bonnet is a weak spot: one hit stalls it, two blow it up.
    const meshes = t.model.children.filter(m => m.isMesh);
    for (const m of meshes) this.world.raycastTargets.push(m);
    const bonnet = meshes[3];
    t.hotspot = this.hotspots?.add({ kind: 'engine', title: 'TRUCK ENGINE', explosive: true, meshes: [bonnet], parts: meshes,
      onBreak: () => { t.stalled = true; this.hud.message('TRUCK STALLED · THEY GET OUT ON FOOT', ''); },
      onExplode: () => { t.stalled = true; if (!t.unloaded) { t.unloaded = true; t.lost = true; this.hotspots.mission?.blastKills(4); } this.audio.setTruck(0); } });
    this.hud.message('ENEMY REINFORCEMENTS ON THE ROAD', 'wound');
  }

  tickTruck(dt) {
    const t = this.truck;
    if (!t) return;
    const pos = (x) => new THREE.Vector3(x, this.world.groundAt(x, roadCenterZ(x)), roadCenterZ(x));
    if (t.x < t.stopX && !t.stalled) {
      const slow = Math.min(1, (t.stopX - t.x) / 25 + 0.25);
      t.x = Math.min(t.stopX, t.x + t.speed * slow * dt);
    } else if (!t.unloaded) {
      t.parkT += dt;
      if (t.parkT > 1.5) this.unload(t);
    } else if ((t.parkT += dt) > 20) {
      this.audio.setTruck(0); // engine off after unloading
    }
    const here = pos(t.x), ahead = pos(t.x + 2);
    t.model.position.copy(here);
    t.model.lookAt(ahead); // an object's lookAt turns its +z (the cab) toward the point
    t.model.updateMatrixWorld(true); // bullets test against it every tick
    const d = here.distanceTo(this.player.pos);
    if ((!t.unloaded || t.parkT < 20) && !t.stalled) this.audio.setTruck(Math.max(0, 1 - d / 450));
    else if (t.stalled) this.audio.setTruck(0);
  }

  unload(t) {
    t.unloaded = true;
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(t.model.quaternion);
    const side = new THREE.Vector3(-back.z, 0, back.x);
    for (let i = 0; i < 4; i++) {
      const at = t.model.position.clone().addScaledVector(back, 4.2).addScaledVector(side, (i - 1.5) * 0.9);
      at.y = this.world.groundAt(at.x, at.z);
      const s = new Soldier({ position: at, yaw: Math.atan2(COMPOUND.x - at.x, COMPOUND.z - at.z), name: 'Reinforcement', stance: 'alert' });
      this.world.addSoldier(s);
      this.stealth.enlist(s);
      this.enlist(s);
      s.home = new THREE.Vector3(COMPOUND.x - 20 + i * 4, at.y, COMPOUND.z + (i % 2 ? 6 : -6)); // they stay to guard the yard
      const known = this.guards().reduce((k, o) => (o.brain.lastSeenT > (k?.t ?? -1) && o.brain.lastSeen ? { t: o.brain.lastSeenT, at: o.brain.lastSeen } : k), null)?.at;
      const guess = (known ?? this.player.pos).clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30));
      this.stealth.raise(s, 'alerted', guess, 'shout');
      s.brain.lastSeen = guess;
    }
    this.hud.message(t.stalled ? 'REINFORCEMENTS COMING ON FOOT' : 'REINFORCEMENTS HAVE ARRIVED', 'wound');
  }

  // Send the nearest calm guard to fix something at `at`; `done` runs when he has.
  requestRepair(at, done) {
    if (this.guards().some(s => s.brain.task)) return;
    let best = null, bestD = 120;
    for (const s of this.guards()) {
      if (s.officer || s.brain.fixed || s === this.alarm.runner || s.aware.state === 'alerted') continue;
      const d = s.root.position.distanceTo(at);
      if (d < bestD) { best = s; bestD = d; }
    }
    if (best) best.brain.task = { at, t: 8, done };
  }

  // ---------------------------------------------------------------- sabotage
  // Hold E at the siren's junction box to cut the wire.
  sabotageOption() {
    if (!this.alarm.working || this.player.climb) return null;
    const p = this.player.pos, j = this.siren.standAt;
    if (Math.hypot(p.x - j.x, p.z - j.z) > 1.4 || Math.abs(p.y - j.y) > 1) return null;
    return { label: 'E · CUT ALARM WIRE', progress: this.cutProgress };
  }

  tickSabotage(dt) {
    const can = this.sabotageOption();
    if (!can || !this.player.input.down('KeyE') || this.player.moving) { this.cutProgress = 0; return; }
    this.cutProgress += dt / CUT_TIME;
    if (this.cutProgress >= 1) {
      this.cutProgress = 0;
      this.alarm.working = false;
      this.siren.wire.visible = false;
      this.audio.click(0, 1800, 0.4);
      this.fx.emit?.(this.siren.junction, new THREE.Vector3(0, 1, 0), { color: 0xffe0a0, count: 6, speed: 2, size: 0.05, life: 0.3, grow: 1, gravity: 4 });
      this.hud.message('ALARM WIRE CUT', '');
    }
  }

  // ---------------------------------------------------------------- movement
  // Walk/run toward `target` along a path. Returns true on arrival.
  goTo(s, target, speed, dt) {
    const b = s.brain, pos = s.root.position;
    if (Math.hypot(target.x - pos.x, target.z - pos.z) < 0.6) { b.path = null; return true; }
    b.repathT -= dt;
    const moved = b.pathTarget && b.pathTarget.distanceTo(target) > 2;
    if (!b.path || ((moved || b.stuck) && b.repathT <= 0)) {
      b.path = this.nav.path(pos, target);
      b.pathTarget = target.clone();
      b.wpi = 0; b.repathT = 1;
      if (!b.path) { this.stop(s); b.lookT = b.lookT || 0.01; return true; } // no way there: treat it as reached
    }
    const wp = b.path[b.wpi];
    const dx = wp.x - pos.x, dz = wp.z - pos.z, dist = Math.hypot(dx, dz);
    if (dist < 0.5) {
      if (++b.wpi >= b.path.length) { b.path = null; return true; }
      return false;
    }
    const step = Math.min(dist, speed * dt);
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    this.world.collideCircle(pos, 0.3, pos.y, pos.y + 1.7);
    pos.y = this.world.floorAt(pos.x, pos.z, pos.y); // up terrace steps, onto the terrace
    s.targetYaw = Math.atan2(dx, dz);
    s.aimDir = null;
    s.crouchTarget = 0;
    s.setGait(speed > 2.5 ? 'run' : 'walk', speed);
    if (s.stance === 'easy' && speed > 2.5) { s.stance = 'alert'; s.applyStance(0.25); }
    // Stuck check: little progress for 2 s → repath; three times → give up on this target.
    b.progressT += dt;
    if (b.progressT > 2) {
      const prog = b.progressAt.distanceTo(pos);
      b.progressT = 0; b.progressAt.copy(pos);
      if (prog < 0.5) {
        b.stuck++;
        b.path = null;
        if (b.stuck >= 3) { b.stuck = 0; this.stop(s); return true; }
      } else b.stuck = 0;
    }
    return false;
  }

  stop(s) {
    s.setGait('stand');
  }

  // Turn this way and that for a while. Returns true when done looking.
  lookAround(s, dt) {
    const b = s.brain;
    this.stop(s);
    b.lookT += dt;
    if (Math.floor(b.lookT / 1.6) !== Math.floor((b.lookT - dt) / 1.6)) s.targetYaw = s.root.rotation.y + (Math.random() - 0.5) * 2.4;
    if (b.lookT > LOOK_AROUND) { b.lookT = 0; return true; }
    return false;
  }

  randomPointNear(c, r) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * r;
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (this.nav.walkable(x, z)) return new THREE.Vector3(x, this.world.groundAt(x, z), z);
    }
    return c.clone();
  }

  // ---------------------------------------------------------------- debug
  drawPaths() {
    const pts = [];
    for (const s of this.guards()) {
      const path = s.brain.path;
      if (!path) continue;
      let prev = s.root.position.clone().setY(s.root.position.y + 0.2);
      for (let i = s.brain.wpi; i < path.length; i++) {
        const q = path[i].clone(); q.y = this.world.groundAt(q.x, q.z) + 0.2;
        pts.push(prev, q); prev = q;
      }
    }
    this.pathLines.geometry.dispose();
    this.pathLines.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  state() {
    return { alarm: this.alarm.on, alarmWorking: this.alarm.working, runner: !!this.alarm.runner, truck: !!this.truck && !this.truck.unloaded };
  }
}
