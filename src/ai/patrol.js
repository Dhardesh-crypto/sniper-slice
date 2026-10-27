// A car patrol: a Kübelwagen with a driver and a man beside him, driving the map's road up to the
// compound and back out again, stopping a few seconds at each end and turning round. You hear it
// coming (its engine, louder near), it raises dust and prints its tyres in the dirt. The crew are
// guards like any other: they look about from their seats, they can be shot in them, and the moment
// either is alarmed the car pulls up and they jump out and fight on foot. Its engine (at the back)
// is a weak spot: one hit stalls it where it stands, two blow it up with the crew in it.
// One patrol on every map with a road, in runs that draw one (the run's seed: three in four); in
// two of five of those it's a motorcycle and sidecar instead (a rider, a man in the sidecar).
// The hidden blocks stop at the bodywork: the men sitting above it are targets.
import * as THREE from 'three';
import { vehicleModel } from '../world/vehicle-models.js';
import { propModel, hasProp } from '../world/props.js';
import { Soldier } from '../world/soldier.js';
import { roadCenterZ, COMPOUND, activeMap } from '../world/terrain.js';
import { addExhaust } from '../world/exhaust.js';
import { addGroundMarks } from '../world/groundmarks.js';
import { seeded } from '../core/run.js';

const PAUSE = 6;                        // s at each end
const OUT = 230;                        // m back down the road from where the reinforcements stop
// The two kinds, in their own frame (nose toward +z): the model, the body and engine blocks
// [w, h, d, x, y (bottom), z], where the two men sit (their feet; guards.js sits them low), its speed.
const KINDS = {
  car: { model: () => vehicleModel('car'), title: 'PATROL CAR ENGINE', speed: 8.5, rate: 1.15,
    body: [1.6, 0.75, 2.6, 0, 0.3, 0.4], engine: [1.5, 0.75, 0.9, 0, 0.45, -1.3],
    seats: [[0.36, 0.46, 0.15], [-0.36, 0.46, 0.15]], exhaust: [0.45, 0.35, -1.85], wheels: [[0.7, -1.2], [-0.7, -1.2]] },
  moto: { model: motorcycle, title: 'MOTORCYCLE ENGINE', speed: 10.5, rate: 1.5,
    body: [1.5, 0.45, 2.1, 0, 0.15, 0], engine: [0.4, 0.38, 0.55, 0.38, 0.22, 0.15],
    seats: [[0.38, 0.5, -0.3], [-0.42, 0.18, 0.0]], exhaust: [0.55, 0.3, -0.9], wheels: [[0.38, -0.8], [-0.5, 0]] },
};
// The motorcycle and sidecar prop, turned nose to +z (props lie nose toward −x).
function motorcycle() {
  const g = new THREE.Group();
  if (!hasProp('motorcycle')) return g;
  const m = propModel('motorcycle', { x: 2.4, y: 1.15, z: 1.7 }, { stretch: true, own: true });
  m.rotation.y = Math.PI / 2;
  g.add(m);
  g.userData.mesh = m.userData.meshes[0];
  return g;
}
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });

export class CarPatrol {
  constructor({ scene, world, ai, stealth, hotspots, audio, fx, hud, player, seed }) {
    Object.assign(this, { scene, world, ai, stealth, hotspots, audio, fx, hud, player });
    this.car = null;
    const road = activeMap().truck ?? { from: -230, stop: -46 };   // (the vineyard's road: guards.js's default)
    if (seeded(seed ^ 0xca5)() > 0.75) return;
    // The stretch it drives: where the road is, from the reinforcements' stop back out.
    const inner = COMPOUND.x + road.stop, outer = inner - OUT;
    if (!Number.isFinite(roadCenterZ(inner)) || !Number.isFinite(roadCenterZ(outer))) return;
    const kind = KINDS[seeded(seed ^ 0x30c)() < 0.4 && hasProp('motorcycle') ? 'moto' : 'car'];
    const model = kind.model();
    if (!model.userData.mesh) return;
    scene.add(model);
    const box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HIDDEN); m.position.set(x, y + h / 2, z); model.add(m); world.raycastTargets.push(m); return m; };
    box(...kind.body);                                                  // the body (bullets stop on it)
    const engine = box(...kind.engine);                                // the engine: the weak spot
    const c = this.car = { kind, model, x: outer, dir: 1, inner, outer, wait: 2, v: 0, stalled: false, crew: [], yaw: 0 };
    c.hotspot = hotspots.add({ kind: 'engine', title: kind.title, explosive: true, meshes: [engine], parts: [model.userData.mesh],
      onBreak: () => { c.stalled = true; this.dismount(); },
      onExplode: () => { c.stalled = true; for (const s of c.crew) if (s.alive && s.riding) s.applyHit('torso', { damage: { torso: 999 } }, new THREE.Vector3(0, 1, 0)); this.dismount(); this.audio.loopSample('patrolCar', 'army_truck', 0); } });
    addExhaust({ space: model, points: [new THREE.Vector3(...kind.exhaust)], dir: new THREE.Vector3(0, 0.3, -1), running: () => !c.stalled, speed: () => c.v });
    addGroundMarks({ object: model, wheels: kind.wheels.map(([x, z]) => ({ at: new THREE.Vector3(x, 0, z), kind: 'tyre' })) });
    this.place();
    // The crew, guards like the rest (the AI and the stealth system know them).
    for (const [i, seat] of kind.seats.map(q => new THREE.Vector3(...q)).entries()) {
      const at = model.localToWorld(seat.clone());
      const s = new Soldier({ position: at, yaw: model.rotation.y, name: i ? 'Patrol passenger' : 'Patrol driver', stance: 'alert' });   // (on a motorcycle: the rider, the man in the sidecar)
      world.addSoldier(s);
      stealth.enlist(s);
      ai.enlist(s);
      s.riding = c; s.seat = seat;
      s.home = at.clone();
      c.crew.push(s);
    }
    this.seatCrew();
  }

  at(x) { return new THREE.Vector3(x, this.world.groundAt(x, roadCenterZ(x)), roadCenterZ(x)); }

  // The car on the road at its x, nose the way it's going (turning round slowly at the ends).
  place() {
    const c = this.car, here = this.at(c.x), ahead = this.at(c.x + c.dir * 2);
    c.model.position.copy(here);
    const want = Math.atan2(ahead.x - here.x, ahead.z - here.z);
    c.yaw = c.v > 0.1 || c.turning ? c.yaw + Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw)) * (c.turning ? 0.04 : 0.3) : c.yaw || want;
    c.model.rotation.set(0, c.yaw, 0);
    // A pitch to the slope it's on.
    const back = this.at(c.x - 1.5), front = this.at(c.x + 1.5);
    c.model.rotateX(-Math.atan2(front.y - back.y, 3) * c.dir);
    c.model.updateMatrixWorld(true);
  }

  // The crew in their seats, folded down into the car (head and shoulders over the side).
  seatCrew() {
    const c = this.car;
    for (const s of c.crew) {
      if (!s.riding || !s.alive) continue;
      s.root.position.copy(c.model.localToWorld(s.seat.clone()));
      if (s.aware.state === 'calm') s.root.rotation.y = s.targetYaw = c.yaw + (s.seat.x < 0 ? 0.6 * Math.sin(this.world.time * 0.3) : 0);   // the passenger looks about
    }
  }

  // Out, both of them, on the side away from the road's centre, on their feet.
  dismount() {
    const c = this.car;
    if (!c) return;
    for (const s of c.crew) {
      if (!s.riding) continue;
      s.riding = null;
      s.crouchTarget = 0;
      if (!s.alive) continue;
      const side = c.model.localToWorld(s.seat.clone().setX(Math.sign(s.seat.x) * 1.6));
      side.y = this.world.floorAt(side.x, side.z, side.y + 1);
      s.root.position.copy(side);
      s.home = side.clone();
      s.brain.path = null;
    }
  }

  tick(dt) {
    const c = this.car;
    if (!c) return;
    const alarmed = c.crew.some(s => s.alive && s.aware.state !== 'calm') || this.ai.alarm.on;
    if (alarmed && c.crew.some(s => s.riding)) c.stopping = true;
    let speed = 0;
    if (!c.stalled && !c.stopping) {
      if (c.wait > 0) {
        c.wait -= dt;
        c.turning = c.wait > 0 && c.wait < PAUSE - 1;
      } else {
        const end = c.dir > 0 ? c.inner : c.outer, left = (end - c.x) * c.dir;
        speed = c.kind.speed * Math.min(1, left / 12 + 0.2);
        c.x += c.dir * speed * dt;
        if ((end - c.x) * c.dir <= 0) { c.x = end; c.dir = -c.dir; c.wait = PAUSE; }
      }
    } else if (c.stopping && c.v < 0.3 && c.crew.some(s => s.riding)) this.dismount();
    c.v += (speed - c.v) * Math.min(1, dt * (speed > c.v ? 1.5 : 3));
    if (c.stopping || c.stalled) c.x += c.dir * c.v * dt;
    this.place();
    // The body rides the road; dust off the back wheels.
    c.ride = (c.ride ?? 0) + dt * c.v;
    const k = Math.min(1, c.v / 5), body = c.model.children[0];
    body.position.y = k * (0.03 * Math.sin(c.ride * 2.4) + 0.015 * Math.sin(c.ride * 6.1));
    if (c.v > 2 && (c.dustT = (c.dustT ?? 0) - dt) <= 0) {
      c.dustT = 0.15;
      this.fx.emit(c.model.localToWorld(new THREE.Vector3(0, 0.2, -1.6)), new THREE.Vector3(0, 0.6, 0), { color: 0xb8a882, count: 1, speed: 1.2, size: 0.7, life: 1.8, grow: 3, gravity: 0.2 });
    }
    this.seatCrew();
    const d = c.model.position.distanceTo(this.player.pos);
    if (!c.hotspot?.exploded) this.audio.loopSample('patrolCar', 'army_truck', c.stalled ? 0 : Math.max(0, 1 - d / 300) ** 2 * (0.35 + 0.35 * Math.min(1, c.v / c.kind.speed)), { rate: c.kind.rate + 0.2 * Math.min(1, c.v / c.kind.speed), dull: Math.min(1, d / 300) });
  }
}
