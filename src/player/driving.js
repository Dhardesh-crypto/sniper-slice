// Driving. Any parked truck, car or motorcycle on the map can be taken (E by it), and so can the
// patrol car once its crew are out of it, or the reinforcements' truck once they've jumped down.
// W and S for throttle, brake and reverse, A and D to steer, Space for the handbrake, E to get out;
// the mouse looks round the chase camera. It's loud: every guard in earshot hears the engine and
// comes to see, and in your own clothes a passing guard who sees you at the wheel knows you. Hit
// a wall or a tree and you stop dead (hard enough and it hurts); run a man down and he's thrown.
// A shot engine dies under you.
import * as THREE from 'three';
import { DRIVABLE } from '../world/props.js';

const KINDS = {
  car: { name: 'THE CAR', top: 17, accel: 5.5, brake: 10, steer: 0.62, base: 2.4, radius: 1.7, half: [0.8, 1.8], seat: [0.36, 0.55, 0.15], cam: [3.2, 7.5], engine: 'army_truck', rate: 1.25 },
  truck: { name: 'THE TRUCK', top: 13, accel: 3.2, brake: 8, steer: 0.5, base: 3.6, radius: 2.6, half: [1.15, 3.0], seat: [0.5, 1.4, 1.8], cam: [4.2, 10], engine: 'army_truck', rate: 0.95 },
  motorcycle: { name: 'THE MOTORCYCLE', top: 20, accel: 6.5, brake: 11, steer: 0.7, base: 2.2, radius: 1.1, half: [0.8, 1.2], seat: [0.4, 0.75, 0], cam: [2.6, 5.5], engine: 'army_truck', rate: 1.7 },
};
const REACH = 3.2;

export class Driving {
  constructor({ world, player, avatar, input, audio, hud, stealth, camera, patrol, ai, disguise }) {
    Object.assign(this, { world, player, avatar, input, audio, hud, stealth, camera, patrol, ai, disguise });
    this.vehicle = null;
    this.noiseT = 0;
  }

  // Everything that can be driven right now: { kind, model, box, solid, heading offset, … }.
  candidates() {
    const list = DRIVABLE.filter(v => !v.wrecked).map(v => ({ ...v, ref: v, off: v.kind === 'motorcycle' ? -Math.PI / 2 : 0 }));
    const c = this.patrol?.car;
    if (c && !c.stalled && !c.hotspot?.exploded && c.crew.every(s => !s.riding)) list.push({ kind: c.kind.title.startsWith('MOTOR') ? 'motorcycle' : 'car', model: c.model, ref: c, off: 0, patrol: c });
    const t = this.ai?.truck;
    if (t && t.unloaded && !t.stalled && !t.lost) list.push({ kind: 'truck', model: t.model, ref: t, off: 0, truck: t });
    return list;
  }

  near() {
    if (this.vehicle || this.player.dead || this.player.climb || this.player.carrying) return null;
    const p = this.player.pos;
    let best = null, bestD = REACH;
    for (const v of this.candidates()) {
      const m = v.model.position, d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d < bestD && Math.abs(m.y - p.y) < 2) { best = v; bestD = d; }
    }
    return best;
  }

  state() {
    if (this.vehicle) return { label: 'E · GET OUT   ·   W/S DRIVE · A/D STEER · SPACE HANDBRAKE', progress: 0 };
    const v = this.near();
    return v ? { label: `E · DRIVE ${KINDS[v.kind].name}`, progress: 0 } : null;
  }

  enter(v) {
    const k = KINDS[v.kind];
    this.vehicle = { ...v, k, yaw: v.model.rotation.y + v.off, speed: 0, steer: 0, damage: 0 };
    if (v.patrol) v.patrol.stolen = true;
    if (v.truck) v.truck.stolen = true;
    const p = this.player;
    p.locked = true;
    p.driving = this.vehicle;
    p.setStance?.('crouch');                                     // (sat: your body low in the seat)
    p.yaw = this.vehicle.yaw + Math.PI;                         // (the camera looks the way it faces; yaw 0 looks −z)
    this.audio.truckStart?.(0);
    this.hud.message(`AT THE WHEEL · ${k.name.replace('THE ', '')} · E TO GET OUT`, '');
  }

  exit() {
    const v = this.vehicle;
    if (!v) return;
    const p = this.player, side = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));   // (the driver's side: its left)
    // Out on the driver's side, or the other if that's walled in.
    for (const s of [1, -1, 0]) {
      const at = v.model.position.clone().addScaledVector(side, s * (v.k.half[0] + 0.9)).addScaledVector(new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw)), s === 0 ? -(v.k.half[1] + 1) : 0);
      at.y = this.world.floorAt(at.x, at.z, at.y + 1.5);
      const t = at.clone();
      this.world.collideCircle(t, 0.4, at.y, at.y + 1.7);
      if (t.distanceToSquared(at) < 1e-4 || s === 0) { p.pos.copy(at); break; }
    }
    p.prevPos?.copy(p.pos);
    p.vel?.set(0, 0, 0);
    p.locked = false;
    p.driving = null;
    p.setStance?.('stand');
    this.audio.loopSample('drive', v.k.engine, 0);
    this.vehicle = null;
  }

  tick(dt) {
    if (this.input.wasPressed('KeyE')) {
      if (this.vehicle) { this.exit(); this.input.pressed.delete('KeyE'); return; }
      const v = this.near();
      if (v) { this.enter(v); this.input.pressed.delete('KeyE'); }
    }
    const v = this.vehicle;
    if (!v) return;
    if (this.player.dead) { this.exit(); return; }
    // The engine shot out from under you (the patrol car's weak spot).
    const dead = v.patrol ? v.patrol.stalled : v.truck ? v.truck.stalled : false;
    const inp = this.input, k = v.k;
    const throttle = dead ? 0 : (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0);
    const steerIn = (inp.down('KeyA') ? 1 : 0) - (inp.down('KeyD') ? 1 : 0);
    const hand = inp.down('Space');
    // Speed: throttle forward, S brakes then reverses, rolling resistance and drag always.
    if (throttle > 0) v.speed += (v.speed < 0 ? k.brake : k.accel * (1 - Math.max(0, v.speed) / k.top)) * dt;
    else if (throttle < 0) v.speed -= (v.speed > 0 ? k.brake : k.accel * 0.6 * (1 + v.speed / (k.top * 0.35))) * dt;
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 1.4 * dt);
    if (hand) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), k.brake * 1.3 * dt);
    // Uphill slows you, downhill pushes.
    const fwd = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
    const pos = v.model.position;
    const gF = this.world.groundAt(pos.x + fwd.x * 1.5, pos.z + fwd.z * 1.5), gB = this.world.groundAt(pos.x - fwd.x * 1.5, pos.z - fwd.z * 1.5);
    const slope = Number.isFinite(gF) && Number.isFinite(gB) ? (gF - gB) / 3 : 0;
    v.speed -= slope * 6 * dt;
    // Steering: a bicycle's geometry, tighter at low speed.
    v.steer += (steerIn * k.steer / (1 + Math.abs(v.speed) / 7) - v.steer) * Math.min(1, dt * 6);
    v.yaw += v.speed / k.base * Math.tan(v.steer) * dt;
    // Move, then test what it ran into.
    const next = pos.clone().addScaledVector(new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw)), v.speed * dt);
    const g = this.world.groundAt(next.x, next.z);
    if (!Number.isFinite(g) || this.world.water?.position && g < this.world.water.position.y - 0.3) { v.speed = 0; }
    else {
      if (v.box) v.box.min.y = v.box.max.y = -1e6;               // (not into its own block)
      const probe = next.clone(); probe.y = g;
      this.world.collideCircle(probe, k.radius, g + 0.3, g + 1.6);
      const pushed = Math.hypot(probe.x - next.x, probe.z - next.z);
      if (pushed > 0.02 && Math.abs(v.speed) > 0.5) this.crash(v);
      next.x = probe.x; next.z = probe.z; next.y = this.world.groundAt(next.x, next.z);
      pos.copy(next);
    }
    this.place(v, fwd);
    this.runOver(v);
    // The player rides in the seat (the world sees you where you sit).
    const seat = new THREE.Vector3(...k.seat);
    if (v.off) seat.applyAxisAngle(new THREE.Vector3(0, 1, 0), v.off);   // (into the model's own frame: a parked motorcycle lies nose toward −x)
    const p = this.player;
    p.prevPos?.copy(p.pos);
    p.pos.copy(v.model.localToWorld(seat));
    p.pos.y -= 0.6;                                               // (sat: the hips on the seat, feet below)
    p.moving = Math.abs(v.speed) > 0.5; p.speed = Math.abs(v.speed); p.sprinting = false;
    // The engine: loud, and heard.
    const level = dead ? 0 : 0.35 + 0.65 * Math.min(1, Math.abs(v.speed) / k.top);
    this.audio.loopSample('drive', k.engine, level * 0.8, { rate: k.rate * (0.8 + 0.5 * Math.min(1, Math.abs(v.speed) / k.top)) });
    if (!dead && (this.noiseT -= dt) <= 0) { this.noiseT = 0.5; this.stealth.noise(pos.clone(), 28 + 3 * Math.abs(v.speed), 'engine'); }
  }

  // The model on the ground: turned to its heading, pitched and rolled to the slope; its block and
  // bullet stop moved with it.
  place(v, fwd) {
    const m = v.model, p = m.position;
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const h = (dx, dz) => { const y = this.world.groundAt(p.x + dx, p.z + dz); return Number.isFinite(y) ? y : p.y; };
    const L = v.k.half[1], W = v.k.half[0];
    const pitch = Math.atan2(h(fwd.x * L, fwd.z * L) - h(-fwd.x * L, -fwd.z * L), 2 * L);
    const roll = Math.atan2(h(side.x * W, side.z * W) - h(-side.x * W, -side.z * W), 2 * W);
    m.rotation.order = 'YXZ';
    m.rotation.set(0, v.yaw - v.off, 0);
    if (v.off) m.rotateZ(-pitch); else m.rotateX(-pitch);
    if (v.off) m.rotateX(-roll); else m.rotateZ(roll);
    m.updateMatrixWorld(true);
    if (v.solid) { v.solid.position.set(p.x, p.y + v.size[1] / 2, p.z); v.solid.rotation.set(0, v.yaw - v.off, 0); v.solid.updateMatrixWorld(true); }
    if (v.box) {                                                  // (a square block around it: guards and you walk round it)
      const r = Math.max(W, L) * 0.8;
      v.box.min.set(p.x - r, p.y, p.z - r); v.box.max.set(p.x + r, p.y + (v.size?.[1] ?? 1.5), p.z + r);
    }
    if (v.patrol) { v.patrol.yaw = v.yaw; v.patrol.v = Math.abs(v.speed); }
  }

  crash(v) {
    const hit = Math.abs(v.speed);
    if (hit > 3) this.audio.metalHit?.(0);
    if (hit > 9) { this.player.damage?.(Math.min(60, (hit - 9) * 9), v.model.position.clone().addScaledVector(new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw)), 3)); this.hud.message('CRASHED', 'wound'); }
    v.speed *= -0.25;
  }

  runOver(v) {
    if (Math.abs(v.speed) < 3) return;
    const p = v.model.position, fwd = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw)).multiplyScalar(Math.sign(v.speed));
    for (const s of this.world.soldiers) {
      if (!s.alive || s.range || s.riding) continue;
      const b = s.root.position, d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d > v.k.radius + 0.4 || Math.abs(b.y - p.y) > 1.5) continue;
      s.applyHit('torso', { damage: { torso: 999 } }, fwd.clone(), { blast: Math.min(1.2, Math.abs(v.speed) / 16) });
      v.speed *= 0.85;
      this.hud.message('RUN DOWN', 'head');
    }
  }

  // Which way your body faces in the seat (the avatar's yaw: 0 faces −z).
  bodyYaw() { return this.vehicle ? this.vehicle.yaw + Math.PI : null; }

  // The chase camera, after the rig has had its say: behind and above, looking where the mouse turns it.
  frame(camera) {
    const v = this.vehicle;
    if (!v) return;
    const [hgt, dist] = v.k.cam, p = v.model.position, yaw = this.player.yaw;
    const look = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const want = p.clone().addScaledVector(look, -dist).add(new THREE.Vector3(0, hgt, 0));
    const g = this.world.groundAt(want.x, want.z);
    if (Number.isFinite(g)) want.y = Math.max(want.y, g + 1.2);
    this.camPos = this.camPos ? this.camPos.lerp(want, 0.25) : want;
    camera.position.copy(this.camPos);
    camera.lookAt(p.x, p.y + 1.4 + Math.max(-0.5, this.player.pitch) * 3, p.z);
    camera.updateMatrixWorld();
  }
}
