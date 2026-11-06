// What the garrison leaves out for you on the ways in: tin cans on a wire at shin height, and broken
// glass spread on the ground, on open ground, never hidden in the tall grass. Walk through a can line and it rattles for all to hear: step over it
// crouched, or hold E to cut it. On glass your footsteps carry more than twice as far. Both can be
// seen if you look. Placed from the run's seed, so a save finds them where it left them.
import * as THREE from 'three';
import { seeded } from '../core/run.js';
import { activeMap, keepClear, roadCenterZ } from './terrain.js';
import { inTallGrass } from './vegetation.js';

const RATTLE = 34;           // m the cans are heard
const LINE = 5;              // m of wire
const GLASS_R = 2.2;         // m

const STAKE = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.9 });
const WIRE = new THREE.MeshStandardMaterial({ color: 0x35332f, roughness: 0.6, metalness: 0.5 });
const CAN = new THREE.MeshStandardMaterial({ color: 0xb9b4a4, roughness: 0.4, metalness: 0.55 });
const GLASS = new THREE.MeshStandardMaterial({ color: 0xe4f2ee, emissive: 0x3a4a46, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85, side: THREE.DoubleSide });

export class Alarms {
  constructor({ scene, world, player, stealth, ai, interactions, audio, hud, seed, extra = 0 }) {
    Object.assign(this, { scene, world, player, stealth, ai, audio, hud });
    this.lines = [];
    this.glass = [];
    const rnd = seeded(seed ^ 0xca75), men = stealth.guards();
    if (!men.length) return;
    const c = new THREE.Vector3();
    for (const s of men) c.add(s.root.position);
    c.multiplyScalar(1 / men.length);
    // (a map that's nearly all yard and apron: on the second try its open ground will do)
    let strict = true;
    const clear = (x, z, m) => ai.nav.walkable(x, z) && !(strict && keepClear(x, z, m)) && !inTallGrass(world.grassPatches, x, z)   // (they're fair: you can see them)
       && !(Math.abs(z - roadCenterZ(x)) < 6) && world.spawn.distanceTo(new THREE.Vector3(x, world.spawn.y, z)) > 55
      && men.every(s => Math.hypot(s.root.position.x - x, s.root.position.z - z) > 7);
    // Can lines: across the ways in, at right angles to the road to the middle of the place.
    for (let i = 0, want = 5 + extra; i < 400 && this.lines.length < want; i++) {
      strict = i < 200;
      const ang = rnd() * Math.PI * 2, r = 28 + rnd() * 60, x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
      const ax = -Math.sin(ang) * LINE / 2, az = Math.cos(ang) * LINE / 2;
      if (!clear(x, z, 1) || !clear(x + ax, z + az, 0.5) || !clear(x - ax, z - az, 0.5)) continue;
      if (this.lines.some(l => Math.hypot(l.mid.x - x, l.mid.z - z) < 22)) continue;
      const a = this.ground(x - ax, z - az), b = this.ground(x + ax, z + az);
      if (Math.abs(a.y - b.y) > 0.7 || world.raycastSegment(a.clone().setY(a.y + 0.4), b.clone().setY(b.y + 0.4))) continue;
      this.lines.push(this.buildLine(a, b, interactions));
    }
    // Glass: closer in, and not under snow.
    if (!activeMap().winter) {
      for (let i = 0, want = 3 + extra; i < 240 && this.glass.length < want; i++) {
        strict = i < 120;
        const ang = rnd() * Math.PI * 2, r = 12 + rnd() * 40, x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
        if (!clear(x, z, 1) || this.glass.some(g => Math.hypot(g.x - x, g.z - z) < 18)) continue;
        this.glass.push({ x, z });
      }
      this.buildGlass(rnd);
    }
  }

  ground(x, z) { return new THREE.Vector3(x, this.world.groundAt(x, z), z); }

  buildLine(a, b, interactions) {
    const g = new THREE.Group(), cans = [], mid = a.clone().lerp(b, 0.5);
    for (const p of [a, b]) {
      const stake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.06), STAKE);
      stake.position.copy(p).setY(p.y + 0.4); stake.castShadow = true;
      g.add(stake);
    }
    const len = a.distanceTo(b), wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 4), WIRE);
    wire.position.copy(mid).setY(mid.y + 0.72);
    wire.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(wire);
    for (const k of [0.2, 0.42, 0.6, 0.83]) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.15, 8), CAN);
      can.position.copy(a).lerp(b, k); can.position.y += 0.6; can.castShadow = true;
      g.add(can); cans.push(can);
    }
    this.scene.add(g);
    const line = { a, b, mid, g, wire, cans, armed: true, shake: 0 };
    // (added after every other lever, so saves keep their order; a used one is disarmed on load: tick)
    interactions.addLever({ at: mid.clone(), label: 'CUT THE CAN LINE', busy: 'CUTTING THE WIRE…', time: 1, onUse: () => this.disarm(line) });
    line.lever = interactions.levers.at(-1);
    return line;
  }

  disarm(l) {
    l.armed = false;
    l.wire.visible = false;
    for (const c of l.cans) { c.position.y = this.world.groundAt(c.position.x, c.position.z) + 0.05; c.rotation.z = Math.PI / 2; }
  }

  buildGlass(rnd) {
    const n = 70, shard = new THREE.BufferGeometry();
    shard.setAttribute('position', new THREE.Float32BufferAttribute([-0.05, 0, -0.03, 0.06, 0, -0.02, 0, 0, 0.07], 3));
    shard.computeVertexNormals();
    const mesh = new THREE.InstancedMesh(shard, GLASS, Math.max(1, n * this.glass.length));
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), at = new THREE.Vector3(), s = new THREE.Vector3();
    let i = 0;
    for (const g of this.glass) for (let k = 0; k < n; k++) {
      const a = rnd() * 6.3, r = Math.sqrt(rnd()) * GLASS_R, x = g.x + Math.cos(a) * r, z = g.z + Math.sin(a) * r;
      M.compose(at.set(x, this.world.groundAt(x, z) + 0.025, z), q.setFromEuler(e.set((rnd() - 0.5) * 0.3, rnd() * 6.3, (rnd() - 0.5) * 0.3)), s.setScalar(1.1 + rnd() * 1.6));
      mesh.setMatrixAt(i++, M);
    }
    mesh.count = i;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.userData.noAO = true;
    this.scene.add(mesh);
  }

  glassAt(p) { return this.glass.some(g => Math.hypot(g.x - p.x, g.z - p.z) < GLASS_R) && p.y - this.world.groundAt(p.x, p.z) < 0.5; }

  // Did this step go through the wire? (Segments crossing, on the ground, on your feet.)
  crossed(l, p, q) {
    const side = (o, u) => (l.b.x - l.a.x) * (u.z - l.a.z) - (l.b.z - l.a.z) * (u.x - l.a.x);
    const s1 = side(0, p), s2 = side(0, q);
    if (s1 * s2 >= 0) return false;
    const t1 = (q.x - p.x) * (l.a.z - p.z) - (q.z - p.z) * (l.a.x - p.x), t2 = (q.x - p.x) * (l.b.z - p.z) - (q.z - p.z) * (l.b.x - p.x);
    return t1 * t2 < 0;
  }

  tick(dt) {
    const pl = this.player, step = this.last ?? pl.pos;
    const low = !pl.climb && pl.pos.y - this.world.groundAt(pl.pos.x, pl.pos.z) < 0.5;
    for (const l of this.lines) {
      if (l.armed && l.lever.used) this.disarm(l);       // (cut, in a loaded game)
      if (l.armed && low && pl.stance === 'stand' && this.crossed(l, step, pl.pos)) {
        this.disarm(l);
        l.lever.used = true;
        l.wire.visible = true;
        l.shake = 1.2;
        this.audio.metalHit(2); this.audio.click(0, 900, 0.3);
        this.stealth.noise(l.mid.clone(), RATTLE, 'trap');
        this.hud.message('TIN CANS · THEY HEARD THAT', 'wound');
      }
      if (l.shake > 0) { l.shake -= dt; for (const c of l.cans) c.rotation.y += 20 * dt; if (l.shake <= 0) l.wire.visible = false; }
    }
    (this.last ??= new THREE.Vector3()).copy(pl.pos);
    const on = this.glassAt(pl.pos);
    if (on && !this.onGlass) this.hud.message('BROKEN GLASS', '');
    this.onGlass = on;
  }
}
