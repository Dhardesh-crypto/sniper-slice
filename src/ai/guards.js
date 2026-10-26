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
import { vehicleModel } from '../world/vehicle-models.js';
import { roadCenterZ, COMPOUND, activeMap } from '../world/terrain.js';
import { addExhaust } from '../world/exhaust.js';
import { addGroundMarks } from '../world/groundmarks.js';

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
  // (in through the front door to the hall and back out, then the yard)
  'Officer': [[10, 0.5, 25], [8, -1.2], [8, -6.5, 18], [8, -1.2], [8, 4], [-3.5, 9.8, 16], [6, 12], [20, 9, 10], [10, 4], [10, 0.5]],
  'Yard guard': [[20, 6], [20, 18], [2, 20], [-12, 6], [2, 0], [20, 6]],
  'Barn guard': [[-15, -6], [-26, -6], [-26, -20], [-6, -20], [-6, -6]],
  'Sergeant': [[-20, 10, 6], [-20, 20], [0, 21, 5], [0, 10], [-20, 10]],
  'Lieutenant': [[16, -3, 18], [24, -10, 8], [16, -3]],
  'Sentry': [[0, -21, 6], [20, -21], [28, -12, 6], [20, -21], [0, -21]],
};

// The reinforcement truck: the Opel Blitz model (cab toward +z), with invisible blocks fitted
// to it for bullets (and the one over the engine is the weak spot).
function truckModel() {
  const g = new THREE.Group();
  const body = vehicleModel('truck');
  g.add(body);
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const block = (w, h, d, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hidden); m.position.set(0, y + h / 2, z); g.add(m); return m; };
  const proxies = [block(2.3, 2.4, 3.6, 0.35, -1.2), block(2.1, 2.0, 1.2, 0.35, 1.2)];
  const bonnet = block(1.8, 1.25, 1.2, 0.5, 2.4);
  g.userData = { body, bodyMesh: body.userData.mesh, proxies, bonnet };
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
      route: (activeMap().routes ?? ROUTES)[s.name]?.map(([x, z, wait = 0]) => Object.assign(new THREE.Vector3(COMPOUND.x + x, ground, COMPOUND.z + z), { wait })), routeI: 0, waitT: 0,
      lastSeen: null, lastSeenT: -99, fireT: 0, shots: 0, cover: null, coverTried: false,
      progressT: 0, progressAt: s.root.position.clone(), stuck: 0,
    };
  }

  guards() { return this.world.soldiers.filter(s => s.alive && !s.range && s.brain && !s.takenDown); }

  // ---------------------------------------------------------------- per tick
  tick(dt) {
    this.time += dt;
    const p = this.player;
    for (const s of this.guards()) {
      const a = s.aware, b = s.brain;
      if (a.spotted && a.state === 'alerted') { b.lastSeenT = this.time; b.lastSeen = p.pos.clone(); }
      const mode = this.decide(s);
      if (mode !== b.mode) this.enter(s, mode);
      s.nextActivity = null;           // run() says if he's looking around or at work this tick
      this.run(s, dt);
      s.setActivity(s.nextActivity);
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
          if (s.char.action('kneelWork')) s.nextActivity = 'kneelWork'; else s.crouchTarget = 0.7;
          if ((task.t -= dt) <= 0) { b.task = null; s.crouchTarget = 0; task.done(); }
        }
        break;
      }
      case 'flee': {
        const f = activeMap().flee ?? [8, -17];                        // the vineyard: behind the villa
        const safe = this.v.set(COMPOUND.x + f[0], s.home.y, COMPOUND.z + f[1]);
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
    const target = (a.spotted ? p.pos : b.lastSeen ?? p.pos);
    const aimPoint = target.clone(); aimPoint.y += a.headOnly ? p.eye + 0.05 : Math.max(0.3, p.eye * 0.75);
    s.targetYaw = Math.atan2(aimPoint.x - s.root.position.x, aimPoint.z - s.root.position.z);
    b.fireT -= dt;
    // In cover: duck between shots, rise for the last moment before firing.
    s.crouchTarget = b.atCover && b.fireT > 0.8 ? 1 : 0;
    const raised = b.fireT < 1.0;
    s.aimDir = raised ? aimPoint.clone().sub(s.headPosition(this.v).setY(s.headPosition(this.v).y - 0.2)).normalize() : null;
    if (b.fireT <= 0) {
      if (a.spotted && !p.dead) { this.fire(s, aimPoint); b.fireT = 2.1 + Math.random() * 1.2; } // only at what he can actually see
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
    // Something solid on his line of aim (a girder, the edge of the wall you hide behind) takes
    // the round instead. (He aims down the sights, so it's traced from his eye, a metre out: a
    // railing right at his elbow he shoots past.)
    const eye = s.headPosition(new THREE.Vector3()); eye.y -= 0.25;
    const block = this.world.raycastSegment(eye.addScaledVector(aimPoint.clone().sub(eye).normalize(), 1), aimPoint);
    if (block && !block.soldier && block.point.distanceTo(aimPoint) > 0.5) {
      this.fx.dust(block.point, block.normal, d);
      return;
    }
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
    if (!this.siren) return;                 // a map without a siren: no alarm to sound
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
      const seen = this.guards().some(s => s.aware.spotted && s.aware.state === 'alerted');
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
  sendTruck({ quiet = false } = {}) {
    this.reinforced = true;
    // It drives in along the map's road, from the west, and stops short of the target area.
    const road = activeMap().truck ?? { from: -230, stop: -46 };
    const t = { model: truckModel(), x: COMPOUND.x + road.from, stopX: COMPOUND.x + road.stop, speed: 13, unloaded: false, parkT: 0, stalled: false };
    this.scene.add(t.model);
    this.truck = t;
    // Its engine runs until it's stalled, wrecked or switched off; its tyres print the ground.
    const running = () => !t.stalled && !(t.unloaded && t.parkT > 20);
    addExhaust({ space: t.model, points: [new THREE.Vector3(0.7, 0.4, -3.0)], dir: new THREE.Vector3(0, 0.3, -1), running, speed: () => t.v ?? 0 });
    addGroundMarks({ object: t.model, wheels: [{ at: new THREE.Vector3(0.85, 0, -1.6), kind: 'tyre' }, { at: new THREE.Vector3(-0.85, 0, -1.6), kind: 'tyre' }] });
    // Bullets stop on it; the bonnet is a weak spot: one hit stalls it, two blow it up.
    const { proxies, bonnet, bodyMesh } = t.model.userData;
    for (const m of proxies) this.world.raycastTargets.push(m);
    t.hotspot = this.hotspots?.add({ kind: 'engine', title: 'TRUCK ENGINE', explosive: true, meshes: [bonnet], parts: [bodyMesh],
      onBreak: () => { t.stalled = true; this.hud.message('TRUCK STALLED · THEY GET OUT ON FOOT', ''); },
      onExplode: () => { t.stalled = true; if (!t.unloaded) { t.unloaded = true; t.lost = true; this.hotspots.mission?.blastKills(4); } this.audio.setTruck(0); } });
    if (!quiet) this.hud.message('ENEMY REINFORCEMENTS ON THE ROAD', 'wound');
    this.audio.truckStart?.(new THREE.Vector3(t.x, 0, roadCenterZ(t.x)).distanceTo(this.player.pos.clone().setY(0)));
  }

  tickTruck(dt) {
    const t = this.truck;
    if (!t) return;
    const pos = (x) => new THREE.Vector3(x, this.world.groundAt(x, roadCenterZ(x)), roadCenterZ(x));
    let speed = 0;
    if (t.x < t.stopX && !t.stalled) {
      const slow = Math.min(1, (t.stopX - t.x) / 25 + 0.25);
      speed = t.speed * slow;
      t.x = Math.min(t.stopX, t.x + speed * dt);
      t.v = speed;
    } else if (!t.unloaded) {
      t.v = 0;
      t.parkT += dt;
      if (t.parkT > 1.5) this.unload(t);
    } else if ((t.parkT += dt) > 20) {
      this.audio.setTruck(0); // engine off after unloading
    }
    const here = pos(t.x), ahead = pos(t.x + 2);
    t.model.position.copy(here);
    t.model.lookAt(ahead); // an object's lookAt turns its +z (the cab) toward the point
    // On the move: the body rides the road (a bounce, a little pitch and roll) and the rear
    // wheels throw up dust. Parked or stalled, it settles.
    t.ride = (t.ride ?? 0) + dt * speed;
    const k = Math.min(1, speed / 6), body = t.model.userData.body;
    body.position.y = k * (0.035 * Math.sin(t.ride * 2.1) + 0.02 * Math.sin(t.ride * 5.3));
    body.rotation.x = k * 0.012 * Math.sin(t.ride * 1.3);
    body.rotation.z = k * 0.015 * Math.sin(t.ride * 0.9 + 1);
    if (speed > 2 && (t.dustT = (t.dustT ?? 0) - dt) <= 0) {
      t.dustT = 0.12;
      for (const side of [-1, 1]) {
        const p = t.model.localToWorld(new THREE.Vector3(side * 1.0, 0.25, -1.9));
        this.fx.emit(p, new THREE.Vector3(0, 0.6, 0), { color: 0xb8a882, count: 1, speed: 1.5, size: 0.9, life: 2.2, grow: 3, gravity: 0.2 });
      }
    }
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
      const s = this.spawnReinforcement(at, Math.atan2(COMPOUND.x - at.x, COMPOUND.z - at.z), i);
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

  // A reinforcement soldier at `at` (from the truck, or from a loaded save).
  spawnReinforcement(at, yaw, i = 0) {
    const s = new Soldier({ position: at, yaw, name: 'Reinforcement', stance: 'alert' });
    this.world.addSoldier(s);
    this.stealth.enlist(s);
    this.enlist(s);
    const h = activeMap().reinforceHome ?? [-20, 6];               // they stay to guard the yard
    s.home = new THREE.Vector3(COMPOUND.x + h[0] + (i % 4) * 4, at.y, COMPOUND.z + (i % 2 ? h[1] : -h[1]));
    return s;
  }

  // ---------------------------------------------------------------- sabotage
  // Hold E at the siren's junction box to cut the wire.
  sabotageOption() {
    if (!this.siren || !this.alarm.working || this.player.climb) return null;
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
    s.nextActivity = 'lookAround';
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
