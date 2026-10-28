// The air war overhead. Every few minutes a stream of Allied medium bombers (B-25s, in vics of
// three) drones across the sky on its way north; the flak opens up on it: black bursts blossom
// round the formation, the map's own flak guns fire (every 8.8 or 2 cm gun still standing), and
// now and then a bomber is hit, trails smoke, rolls over and goes down, its crew baling out under
// white parachutes, and crashes far off. While they're overhead the drone and the guns cover the
// sound of your shots.
//
// And you can call the planes in yourself: through the binoculars, G marks the spot you're looking
// at (twice a mission). Half a minute later two P-47 Thunderbolts dive on it out of the sun's
// side, strafing the ground on the way in, drop their bombs on the mark and pull away. Live flak
// near the mark may bring one of them down.
import * as THREE from 'three';
import { propModel, hasProp } from './props.js';
import { activeMap, COMPOUND } from './terrain.js';
import { seeded } from '../core/run.js';

const BOMBER = { speed: 85, alt: 620, length: 16, span: 20.6, first: [45, 80], every: [150, 230], flakEvery: [95, 130], half: 2600 };
const FIGHTER = { speed: 125, length: 11, cruise: 520, delay: 28, release: 300, strafe: [800, 330] };
const STRIKES = 2;
const BOMB = { radius: 11, hurt: 24 };
const PUFFS = 160;

function plainPlane(length, span, color) {
  // (no model loaded: a fuselage, wings and a tail in olive drab)
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(length * 0.06, length * 0.04, length, 8).rotateX(Math.PI / 2), m); g.add(body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(span, length * 0.02, length * 0.16), m); wing.position.z = length * 0.08; g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(span * 0.35, length * 0.015, length * 0.09), m); tail.position.z = -length * 0.44; g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(length * 0.015, length * 0.12, length * 0.1), m); fin.position.set(0, length * 0.06, -length * 0.44); g.add(fin);
  return g;
}

// A plane model with its nose toward +z (these two models came out lying that way, wings along x:
// measured, the B-25's twin-finned tail and the P-47's tail at −z, the propeller at +z).
function planeModel(key, length, span) {
  const g = new THREE.Group();
  const m = hasProp(key) ? propModel(key, { z: length }, { own: false }) : null;
  if (m) {
    m.position.y = -(m.userData.dims?.y ?? 0) / 2;
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    g.add(m);
  } else g.add(plainPlane(length, span, 0x4f5537));
  g.traverse(o => { o.userData.noSnow = true; });
  return g;
}

function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 7; i++) {
    const x = 32 + (Math.random() - 0.5) * 22, y = 32 + (Math.random() - 0.5) * 22, r = 12 + Math.random() * 10;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class AirWar {
  constructor({ scene, world, player, stealth, audio, fx, hud, explosions, hotspots, camera, arsenal, input, seed = 1 }) {
    Object.assign(this, { scene, world, player, stealth, audio, fx, hud, explosions, hotspots, camera, arsenal, input });
    this.rnd = seeded(seed ^ 0xa1e3);
    this.time = 0;
    this.strikesLeft = STRIKES;
    this.waves = [];
    this.fighters = [];
    this.bombs = [];
    this.chutes = [];
    this.tracers = [];
    this.calls = [];
    const flakMap = this.flakGuns().length > 0;
    this.every = flakMap && activeMap().id === 'flak' ? BOMBER.flakEvery : BOMBER.every;
    this.nextWave = this.between(BOMBER.first);
    // Flak bursts and smoke trails: big dark puffs, slow to thin away.
    const tex = puffTexture();
    this.puffs = Array.from({ length: PUFFS }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true }));
      s.visible = false; s.userData = { life: 0, max: 1, size: 1, grow: 1, vel: new THREE.Vector3() };
      scene.add(s);
      return s;
    });
    this.nextPuff = 0;
    // The flash of a burst (additive, brief).
    this.flashMat = new THREE.SpriteMaterial({ map: tex, color: 0xffb060, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false });
    this.flashes = Array.from({ length: 12 }, () => { const s = new THREE.Sprite(this.flashMat.clone()); s.visible = false; scene.add(s); return s; });
    this.nextFlash = 0;
    // Tracer streaks (strafing, the 2 cm guns): thin bright lines, reused.
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.9, fog: false, toneMapped: false });
    // The mark: red smoke where you called the strike.
    this.markSmokeT = 0;
    // The drone and the guns hide your shots while the bombers are over.
    world.soundSources ??= [];
    world.soundSources.push({ name: 'bombers', at: () => this.cover });
    this.cover = 0;
  }

  between([a, b]) { return a + (b - a) * this.rnd(); }

  flakGuns() {
    return (this.hotspots?.list ?? []).filter(h => (h.kind === 'flak' || h.kind === 'flak20') && !h.exploded);
  }

  gunPos(h) {
    const v = new THREE.Vector3();
    (h.meshes?.[0] ?? h.parts?.[0])?.getWorldPosition(v);
    return v;
  }

  // ---------------------------------------------------------------- the bomber stream
  startWave() {
    const a = this.rnd() * Math.PI * 2, dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const centre = new THREE.Vector3(COMPOUND.x, 0, COMPOUND.z).addScaledVector(side, (this.rnd() - 0.5) * 700);
    const ground = this.world.groundAt(COMPOUND.x, COMPOUND.z);
    const n = 2 + Math.floor(this.rnd() * 2);                 // vics of three
    const planes = [];
    for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) {
      const off = new THREE.Vector3().addScaledVector(dir, -v * 90 - (k ? 28 : 0)).addScaledVector(side, (k === 0 ? 0 : k === 1 ? -26 : 26) + (v % 2 ? 60 : -40)).setY((v % 2) * 30 + (k ? -6 : 0));
      const model = planeModel('b25', BOMBER.length, BOMBER.span);
      this.scene.add(model);
      planes.push({ model, off, alive: true, hit: 0, smokeT: 0, fall: null, bobble: this.rnd() * 6 });
    }
    const w = { dir, side, start: centre.clone().addScaledVector(dir, -BOMBER.half).setY(ground + BOMBER.alt), t: 0, planes, len: BOMBER.half * 2 / BOMBER.speed + 12,
      flakT: 1, gunT: new Map(), downed: 0 };
    this.waves.push(w);
    this.nextWave = this.time + this.between(this.every);
    const guns = this.flakGuns();
    if (activeMap().id === 'flak' && !guns.some(h => h.kind === 'flak') && !this.toldClear) { this.toldClear = true; this.hud.message('THE BOMBERS ARE GETTING THROUGH', ''); }
  }

  tickWaves(dt) {
    let cover = 0, near = Infinity;
    const guns = this.flakGuns();
    for (const w of this.waves) {
      w.t += dt;
      const lead = w.start.clone().addScaledVector(w.dir, BOMBER.speed * w.t);
      const yaw = Math.atan2(w.dir.x, w.dir.z);
      for (const p of w.planes) {
        if (p.fall) { this.tickFalling(p, dt); continue; }
        p.model.position.copy(lead).add(p.off);
        p.model.position.y += Math.sin(w.t * 0.4 + p.bobble) * 2;
        p.model.rotation.set(0, yaw, Math.sin(w.t * 0.3 + p.bobble) * 0.02);
        const d = p.model.position.distanceTo(this.player.pos);
        near = Math.min(near, d);
        if (p.hit > 0) {                                     // an engine on fire, and before long it goes down
          if ((p.smokeT -= dt) <= 0) { p.smokeT = 0.12; this.puff(p.model.localToWorld(new THREE.Vector3(3.2, 0.5, 1)), { color: 0x2a2826, size: 3, grow: 4, life: 6 }); }
          if ((p.hit += dt) > 4 + p.bobble) this.startFall(p, w);
        }
      }
      // The flak: the map's guns and the unseen batteries beyond. Fewer bursts with fewer guns.
      const over = Math.hypot(lead.x - COMPOUND.x, lead.z - COMPOUND.z) < 2200;
      if (over) {
        const rate = 0.6 + guns.reduce((s, h) => s + (h.kind === 'flak' ? 1.2 : 0.5), 0);
        if ((w.flakT -= dt * rate) <= 0) {
          w.flakT = 0.7 + this.rnd() * 0.9;
          const alive = w.planes.filter(p => p.alive && !p.fall);
          if (alive.length) {
            const target = alive[Math.floor(this.rnd() * alive.length)];
            const at = target.model.position.clone().add(new THREE.Vector3((this.rnd() - 0.5) * 140, (this.rnd() - 0.5) * 80, (this.rnd() - 0.5) * 140));
            this.burst(at);
            // A close one may set an engine burning (one or two a wave at most, fewer once the guns are down).
            if (at.distanceTo(target.model.position) < 38 && !target.hit && w.downed < 2 && this.rnd() < 0.25 * Math.min(1, 0.2 + guns.length * 0.3)) { target.hit = 0.01; w.downed++; }
          }
        }
        for (const h of guns) this.fireGun(h, w, dt);
      }
      if (!w.passed) {                                       // the stream's pass, loudest overhead (the recording peaks 7 s in)
        const k = this.pass(lead.clone().addScaledVector(w.dir, -90), w.dir.clone().multiplyScalar(BOMBER.speed), 7.08);
        if (k != null) { w.passed = true; this.audio.sample('plane_flyover', { gain: THREE.MathUtils.clamp(1.25 - k / 1800, 0.2, 0.9), rate: 0.85, filter: k > 900 ? 1600 : null, wet: 0.5 }); }
      }
      cover = Math.max(cover, THREE.MathUtils.clamp(1.3 - near / 1400, 0, 1) * 0.85);
    }
    this.waves = this.waves.filter(w => {
      if (w.t < w.len || w.planes.some(p => p.fall)) return true;
      for (const p of w.planes) this.scene.remove(p.model);
      return false;
    });
    this.cover = cover;
    this.audio.loopSample('bombers', 'bombers_drone', Number.isFinite(near) ? THREE.MathUtils.clamp(1.15 - near / 2600, 0, 1) * 0.9 : 0, { dull: Number.isFinite(near) ? THREE.MathUtils.clamp(near / 2500, 0, 0.7) : 0 });
  }

  // A gun on the map firing at the stream: the 8.8 cm every few seconds, the 2 cm in bursts.
  fireGun(h, w, dt) {
    let t = w.gunT.get(h) ?? this.rnd() * 2;
    if ((t -= dt) > 0) { w.gunT.set(h, t); return; }
    const big = h.kind === 'flak';
    w.gunT.set(h, big ? 3.5 + this.rnd() * 2.5 : 2 + this.rnd() * 2);
    const at = this.gunPos(h), d = at.distanceTo(this.player.pos);
    const muzzle = at.clone().add(new THREE.Vector3(0, big ? 3.2 : 1.6, 0));
    this.flash(muzzle, big ? 3.5 : 1.4);
    this.fx.emit(muzzle, new THREE.Vector3(0, 1, 0), { color: 0x9a948a, count: big ? 6 : 2, speed: 2, size: big ? 1.6 : 0.6, life: 2.5, grow: 3, gravity: 0.2 });
    if (big) this.audio.sample('flak88_fire', { at: d / 343, gain: THREE.MathUtils.clamp(1.2 - d / 900, 0.15, 1), filter: d > 300 ? 2500 : null, wet: 0.4 });
    else this.audio.sample('flak20_fire', { at: d / 343, gain: THREE.MathUtils.clamp(1.2 - d / 700, 0.12, 1), filter: d > 250 ? 3000 : null, wet: 0.35 });
    // Where its shell goes: a burst near the formation a few seconds later; the 2 cm, a string of tracer.
    const alive = w.planes.filter(p => p.alive && !p.fall);
    if (!alive.length) return;
    const target = alive[Math.floor(this.rnd() * alive.length)].model.position;
    if (big) this.calls.push({ t: 2 + this.rnd() * 1.5, run: () => this.burst(target.clone().add(new THREE.Vector3((this.rnd() - 0.5) * 120, (this.rnd() - 0.5) * 60, (this.rnd() - 0.5) * 120))) });
    else for (let i = 0; i < 5; i++) this.calls.push({ t: i * 0.12, run: () => this.tracer(muzzle, target.clone().sub(muzzle).normalize().add(new THREE.Vector3((this.rnd() - 0.5) * 0.04, 0, (this.rnd() - 0.5) * 0.04)).normalize(), 900, 1.4) });
  }

  // Something flying straight at `vel`: when it's `peak` seconds from its nearest to you, the
  // distance it will pass at (start a recording that peaks `peak` s in); otherwise null.
  pass(pos, vel, peak) {
    const rel = pos.clone().sub(this.player.pos), v2 = vel.lengthSq();
    if (v2 < 1) return null;
    const tca = -rel.dot(vel) / v2;
    return tca <= peak ? rel.addScaledVector(vel, Math.max(0, tca)).length() : null;
  }

  burst(at) {
    this.flash(at, 14);
    this.puff(at, { color: 0x1c1b1a, size: 9, grow: 2.2, life: 9 });
    this.puff(at.clone().add(new THREE.Vector3(3, 2, -2)), { color: 0x262422, size: 6, grow: 2.6, life: 8 });
    const d = at.distanceTo(this.player.pos);
    this.audio.sample('flak_burst', { at: d / 343, gain: THREE.MathUtils.clamp(1.1 - d / 2500, 0.12, 0.8), filter: 1800, wet: 0.6 });
  }

  // Hit: it rolls over and goes down, the crew baling out; it crashes far off.
  startFall(p, w) {
    p.alive = false;
    p.fall = { v: w.dir.clone().multiplyScalar(BOMBER.speed), roll: (this.rnd() < 0.5 ? -1 : 1) * (0.4 + this.rnd() * 0.5), t: 0, chutes: 2 + Math.floor(this.rnd() * 3) };
    if (p.model.position.distanceTo(this.player.pos) < 2500) this.hud.message('A BOMBER IS HIT', '');
  }

  tickFalling(p, dt) {
    const f = p.fall, m = p.model;
    f.t += dt;
    f.v.y -= 9.8 * dt * 0.55;
    f.v.multiplyScalar(1 - 0.04 * dt);
    m.position.addScaledVector(f.v, dt);
    m.rotation.z += f.roll * dt;
    m.rotation.x = Math.min(0.9, Math.atan2(-f.v.y, Math.hypot(f.v.x, f.v.z)));
    m.rotation.order = 'YXZ';
    if ((p.smokeT -= dt) <= 0) {
      p.smokeT = 0.09;
      this.puff(m.position.clone(), { color: 0x1d1c1b, size: 4, grow: 4, life: 10 });
      if (this.rnd() < 0.5) this.fx.emit(m.position.clone(), new THREE.Vector3(0, 1, 0), { color: 0xff7a2a, count: 1, speed: 1, size: 2.5, life: 0.4, grow: 1.5, glow: true, heat: 2 });
    }
    if (f.chutes > 0 && f.t > 1.5 && this.rnd() < dt * 1.2) { f.chutes--; this.chute(m.position.clone()); }
    const g = this.floor(m.position);
    if (m.position.y < g + 2 || f.t > 60) {
      this.scene.remove(m);
      p.fall = null;
      const at = m.position.clone().setY(g), far = at.distanceTo(this.player.pos) > 900;
      this.explosions.visuals(at, far ? 9 : 3.2);                // (far off over the hills: a fireball you can see from here)
      this.explosions.fires.push({ at: at.clone(), t: 120, emitT: 0 });
      const d = at.distanceTo(this.player.pos);
      this.audio.sample('plane_crash', { at: Math.max(0, d / 343 - 4.5), gain: THREE.MathUtils.clamp(1.2 - d / 3000, 0.25, 1), wet: 0.5 });
      if (d < 260) this.explosions.explode(at, { radius: 10, hurt: 20, size: 2.5, noise: 400, burn: true, heavy: true, by: 'plane' });
    }
  }

  // The ground under something in the air; beyond the edge of the map, the far country's (about
  // the height of the map's middle, a little lower).
  floor(p) {
    const g = this.world.groundAt(p.x, p.z);
    return Number.isFinite(g) ? g : (this.farGround ??= this.world.groundAt(COMPOUND.x, COMPOUND.z) - 25);
  }

  // A parachute: a white canopy, a man hanging under it, drifting down with the wind.
  chute(at) {
    const g = new THREE.Group();
    const silk = new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xe8e4d8, side: THREE.DoubleSide }));
    silk.scale.y = 0.55; silk.position.y = 6; g.add(silk);
    const man = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.1, 3, 6), new THREE.MeshLambertMaterial({ color: 0x5a4a32 }));
    g.add(man);
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([0, 1, 2, 3].flatMap(i => { const a = i * Math.PI / 2; return [new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(Math.cos(a) * 3, 6, Math.sin(a) * 3)]; })), new THREE.LineBasicMaterial({ color: 0x777066 }));
    g.add(lines);
    g.position.copy(at);
    g.traverse(o => { o.userData.noSnow = true; });
    this.scene.add(g);
    this.chutes.push({ g, sway: this.rnd() * 6, t: 0 });
  }

  tickChutes(dt) {
    const w = this.world.wind;
    this.chutes = this.chutes.filter(c => {
      c.t += dt;
      c.g.position.y -= 5.5 * dt;
      c.g.position.addScaledVector(w, dt);
      c.g.rotation.z = Math.sin(c.t * 0.8 + c.sway) * 0.12;
      if (c.g.position.y > this.floor(c.g.position) + 0.5 && c.t < 300) return true;
      this.scene.remove(c.g);
      return false;
    });
  }

  // ---------------------------------------------------------------- strikes you call in
  // Through the binoculars: G marks the spot under the crosshair.
  tickCall() {
    if (!this.arsenal.binoculars || !this.input.wasPressed('KeyG')) return;
    this.input.pressed.delete('KeyG');                         // (not a throw as well)
    if (this.strikesLeft <= 0) { this.hud.message('NO MORE STRIKES THIS MISSION', ''); return; }
    if (this.fighters.length || this.pendingStrike) { this.hud.message('A STRIKE IS ALREADY ON ITS WAY', ''); return; }
    const from = this.camera.position.clone(), dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    const hit = this.world.raycastSegment(from, from.clone().addScaledVector(dir, 1800));
    if (!hit || hit.point.distanceTo(from) < 60) { this.hud.message(hit ? 'TOO CLOSE TO CALL IN' : 'NO TARGET THERE', ''); return; }
    this.strikesLeft--;
    const at = hit.point.clone();
    at.y = this.world.groundAt(at.x, at.z);
    this.pendingStrike = { at, t: FIGHTER.delay, smoked: false };
    this.audio.sample('radio_static', { gain: 0.6 });
    this.hud.message(`STRIKE CALLED · TWO THUNDERBOLTS IN ${FIGHTER.delay} SECONDS · ${Math.round(hit.point.distanceTo(from))} M`, '');
  }

  // Two fighters, one behind the other: in over your head (you hear them come and watch them dive), on to the mark.
  launchStrike(at) {
    const away = new THREE.Vector3(at.x - this.player.pos.x, 0, at.z - this.player.pos.z).normalize();
    const turn = (this.rnd() - 0.5) * 1.6;
    const dir = away.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn * 0.5);   // (heading: from behind you toward the mark, give or take)
    const flak = this.flakGuns().filter(h => h.kind === 'flak20' && this.gunPos(h).distanceTo(at) < 650);
    for (let i = 0; i < 2; i++) {
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(i ? 22 : 0);
      const aim = at.clone().addScaledVector(dir, i ? 12 : 0).add(side.clone().multiplyScalar(0.4));
      const model = planeModel('p47', FIGHTER.length, 12.4);
      this.scene.add(model);
      this.fighters.push({ model, dir, aim, along: -2600 - i * 220, side, bombs: 2, strafing: false, sounded: false, fireT: 0, doomed: i === 1 && flak.length && this.rnd() < 0.35, smokeT: 0, roll: 0, fall: null });
    }
    this.hud.message('THUNDERBOLTS INBOUND', '');
  }

  // Its path: level at cruise height, a dive onto the mark, bombs away, and a climb out.
  fighterPos(f) {
    const s = f.along;
    const g = f.aim.y;
    let y;
    if (s < -1500) y = g + FIGHTER.cruise;
    else if (s < -FIGHTER.release) y = g + FIGHTER.cruise - (FIGHTER.cruise - 95) * (s + 1500) / (1500 - FIGHTER.release);
    else if (s < 200) y = g + 95 - 25 * Math.sin(Math.PI * (s + FIGHTER.release) / (200 + FIGHTER.release));
    else y = g + 95 + (s - 200) * 0.45;
    return f.aim.clone().addScaledVector(f.dir, s).add(f.side).setY(y);
  }

  tickFighters(dt) {
    for (const f of this.fighters) {
      if (f.fall) { this.tickFalling(f, dt); continue; }
      const prev = this.fighterPos(f);
      f.along += FIGHTER.speed * dt;
      const pos = this.fighterPos(f);
      f.model.position.copy(pos);
      const v = pos.clone().sub(prev);
      f.model.rotation.order = 'YXZ';
      f.model.rotation.set(Math.atan2(-v.y, Math.hypot(v.x, v.z)), Math.atan2(v.x, v.z), f.along > 200 ? Math.min(0.6, (f.along - 200) / 400) * (f.side.length() ? 1 : -1) : 0);
      const d = pos.distanceTo(this.player.pos);
      // The engine: a roaring pass when it comes close.
      if (!f.sounded) {
        const vel = v.clone().divideScalar(Math.max(dt, 1e-3)), k = this.pass(pos, vel, 7.28);   // (the recording peaks 7.3 s in)
        if (k != null) { f.sounded = true; this.audio.sample('plane_lowpass', { gain: THREE.MathUtils.clamp(1.4 - k / 900, 0.2, 1) * (this.fighters.indexOf(f) ? 0.7 : 1), wet: 0.3 }); }
      }
      // Strafing on the way in: eight .50s walking a line of hits toward the mark.
      const [s0, s1] = FIGHTER.strafe;
      if (f.along > -s0 && f.along < -s1) {
        if (!f.strafing) { f.strafing = true; this.audio.sample('strafe_50cal', { at: d / 343, gain: THREE.MathUtils.clamp(1.3 - d / 1200, 0.25, 1) }); }
        if ((f.fireT -= dt) <= 0) {
          f.fireT = 0.07;
          const k = (f.along + s0) / (s0 - s1);                  // 0 → 1 along the run
          const hitAt = f.aim.clone().addScaledVector(f.dir, -70 * (1 - k) - 5).add(f.side.clone().multiplyScalar(0.4)).add(new THREE.Vector3((this.rnd() - 0.5) * 3, 0, (this.rnd() - 0.5) * 3));
          hitAt.y = this.world.groundAt(hitAt.x, hitAt.z);
          this.tracer(pos, hitAt.clone().sub(pos).normalize(), pos.distanceTo(hitAt), 2.2);
          this.calls.push({ t: 0.08, run: () => this.strafeHit(hitAt) });
        }
      }
      // Bombs away.
      if (f.bombs > 0 && f.along > -FIGHTER.release) {
        f.bombs--;
        const vel = v.clone().divideScalar(Math.max(dt, 1e-3));
        // (aimed: the drop's forward speed puts it on the mark)
        this.dropBomb(pos.clone().add(new THREE.Vector3(0, -1.2, 0)).addScaledVector(f.side, f.bombs ? 0.25 : -0.25), vel, f.aim);
      }
      if (f.doomed && f.along > -FIGHTER.release + 60) {         // the flak finds him
        f.doomed = false;
        this.burst(pos.clone().add(new THREE.Vector3(4, 2, 0)));
        this.hud.message('A THUNDERBOLT IS HIT', 'wound');
        f.fall = { v: v.clone().divideScalar(Math.max(dt, 1e-3)).setY(-6), roll: 1.6, t: 0, chutes: 1 };
        f.smokeT = 0;
      }
    }
    this.fighters = this.fighters.filter(f => {
      if (f.model.parent && (f.fall || f.along < 3200)) return true;
      this.scene.remove(f.model);
      return false;
    });
  }

  strafeHit(at) {
    const d = at.distanceTo(this.player.pos);
    this.fx.dust(at, new THREE.Vector3(0, 1, 0), d);
    // .50 calibre: anyone within a pace of the line of hits.
    for (const s of this.world.soldiers) {
      if (!s.alive || s.range) continue;
      const b = s.bodyPosition(new THREE.Vector3());
      if (Math.hypot(b.x - at.x, b.z - at.z) < 1.6 && Math.abs(b.y - at.y) < 3) s.applyHit('torso', { damage: { torso: 999 } }, new THREE.Vector3(at.x - b.x, 0, at.z - b.z).normalize().negate(), {});
    }
    if (d < 1.8) this.player.damage(60, at);
    for (const h of this.hotspots?.list ?? []) if (h.explosive && !h.exploded && !h.armored && h.distanceTo(at) < 2.2) this.hotspots.blastDamage(h);
    if (d < 120) this.stealth.noise(at, 90, 'shot');
  }

  dropBomb(at, vel, aim) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.4, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3d4030, roughness: 0.7 }));
    m.position.copy(at);
    this.scene.add(m);
    // Steer the throw so it lands on the mark: it keeps the dive's downward speed, so the fall
    // takes t (drop = u·t + g·t²/2); the forward speed is whatever covers the ground in that time.
    const u = Math.max(0, -vel.y), drop = Math.max(5, at.y - aim.y);
    const tFall = (-u + Math.sqrt(u * u + 2 * 9.8 * drop)) / 9.8;
    const v = new THREE.Vector3(aim.x - at.x, 0, aim.z - at.z).divideScalar(tFall);
    v.y = -u;
    this.bombs.push({ m, v });
    // The whistle of it coming down, timed to end as it lands (heard near the mark).
    const d = aim.distanceTo(this.player.pos);
    if (d < 450 && !this.bombs.some(b => b.whistled && b !== this.bombs.at(-1))) {
      this.bombs.at(-1).whistled = true;
      this.audio.sample('bomb_fall', { at: Math.max(0, tFall - 2.85), gain: THREE.MathUtils.clamp(1.1 - d / 500, 0.2, 1) });
    }
  }

  tickBombs(dt) {
    this.bombs = this.bombs.filter(b => {
      b.v.y -= 9.8 * dt;
      b.m.position.addScaledVector(b.v, dt);
      b.m.lookAt(b.m.position.clone().add(b.v));
      const g = this.world.groundAt(b.m.position.x, b.m.position.z);
      if (b.m.position.y > g) return true;
      this.scene.remove(b.m);
      const at = b.m.position.clone().setY(g);
      this.explosions.explode(at, { radius: BOMB.radius, hurt: BOMB.hurt, size: 2.6, noise: 600, burn: true, heavy: true, label: 'AIR STRIKE', chain: 7 });
      return false;
    });
  }

  // ---------------------------------------------------------------- effects
  puff(at, { color, size, grow, life }) {
    const s = this.puffs[this.nextPuff++ % PUFFS];
    s.visible = true;
    s.position.copy(at);
    s.material.color.setHex(color);
    s.material.opacity = 0.85;
    s.material.rotation = this.rnd() * 6.3;
    Object.assign(s.userData, { life: 0, max: life * (0.8 + this.rnd() * 0.4), size, grow });
    s.scale.setScalar(size);
  }

  flash(at, size) {
    const s = this.flashes[this.nextFlash++ % this.flashes.length];
    s.visible = true; s.position.copy(at); s.scale.setScalar(size); s.userData.t = 0.12; s.material.opacity = 1;
  }

  tracer(from, dir, len, width) {
    const seg = Math.min(len, 22);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(seg)]), this.tracerMat);
    line.position.copy(from);
    this.scene.add(line);
    this.tracers.push({ line, dir: dir.clone(), speed: 600, left: Math.max(0, len - seg), t: 0 });
  }

  tickEffects(dt) {
    const w = this.world.wind;
    for (const s of this.puffs) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life += dt;
      if (u.life >= u.max) { s.visible = false; continue; }
      const t = u.life / u.max;
      s.scale.setScalar(u.size * (1 + (u.grow - 1) * Math.sqrt(t)));
      s.material.opacity = 0.85 * (1 - t) ** 1.2;
      s.position.addScaledVector(w, dt * 0.8);
    }
    for (const s of this.flashes) if (s.visible && (s.userData.t -= dt) <= 0) s.visible = false; else if (s.visible) s.material.opacity = s.userData.t / 0.12;
    this.tracers = this.tracers.filter(tr => {
      tr.t += dt;
      const step = tr.speed * dt;
      tr.line.position.addScaledVector(tr.dir, step);
      tr.left -= step;
      if (tr.left > 0 && tr.t < 3) return true;
      this.scene.remove(tr.line); tr.line.geometry.dispose();
      return false;
    });
    // Red smoke on the mark while the strike comes in.
    const ps = this.pendingStrike;
    if (ps && ps.t < FIGHTER.delay - 6 && (this.markSmokeT -= dt) <= 0) {
      this.markSmokeT = 0.25;
      this.fx.emit(ps.at.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(0, 1, 0), { color: 0xc8402e, count: 3, speed: 1.4, size: 2.6, life: 9, grow: 5, gravity: 0.3 });
    }
  }

  tick(dt) {
    this.time += dt;
    if (this.time >= this.nextWave) this.startWave();
    this.tickCall();
    if (this.pendingStrike && (this.pendingStrike.t -= dt) <= 0) { this.launchStrike(this.pendingStrike.at); this.pendingStrike = null; }
    this.tickWaves(dt);
    this.tickFighters(dt);
    this.tickBombs(dt);
    this.tickChutes(dt);
    this.calls = this.calls.filter(c => ((c.t -= dt) > 0 ? true : (c.run(), false)));
    this.tickEffects(dt);
  }
}
