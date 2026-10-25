// Your kit, SE5 style. Hold Q for the item wheel (time slows while it's open), pick an item,
// then G uses it:
//   grenade, bottle   hold G to aim (a dotted arc shows where it lands), release to throw
//   whistle           a sharp whistle: nearby guards come to look (a lure)
//   mine              placed at your feet; a guard or a vehicle stepping on it sets it off
//   TNT               placed anywhere; K detonates it (all of it), and a bullet sets it off
//   satchel charge    placed on a vehicle in reach (or the ground); goes off 10 s later or on K;
//                     it's the one thing besides AP rounds that kills the Panzer
//   bandage, medkit   heal (H heals without the wheel: a medkit when you're badly hurt)
import * as THREE from 'three';
import { ICONS } from '../ui/item-icons.js';

export const ITEMS = [
  { id: 'grenade', name: 'Grenade', kind: 'throw' },
  { id: 'bottle', name: 'Bottle', kind: 'throw' },
  { id: 'whistle', name: 'Whistle', kind: 'use' },
  { id: 'mine', name: 'Mine', kind: 'place' },
  { id: 'tnt', name: 'TNT', kind: 'place' },
  { id: 'satchel', name: 'Satchel charge', kind: 'place' },
  { id: 'bandage', name: 'Bandage', kind: 'heal' },
  { id: 'medkit', name: 'Medkit', kind: 'heal' },
];
export const START_KIT = { grenade: 2, bottle: 3, whistle: Infinity, mine: 2, tnt: 1, satchel: 2, bandage: 3, medkit: 1 };
const HEAL = { bandage: { amount: 35, time: 1.5 }, medkit: { amount: 100, time: 3 } };
const THROW_SPEED = 15, THROW_LIFT = 4.5;
const FUSE = { grenade: 4, satchel: 10 };
const BLAST = {
  grenade: { radius: 5, hurt: 9, size: 0.8, noise: 200, label: 'GRENADE' },
  mine: { radius: 4.5, hurt: 8, size: 0.9, noise: 200, label: 'MINE' },
  tnt: { radius: 7, hurt: 13, size: 1.3, noise: 300, label: 'TNT', heavy: true },
  satchel: { radius: 6, hurt: 12, size: 1.3, noise: 300, label: 'SATCHEL CHARGE', heavy: true },
};

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
function model(id) {
  const g = new THREE.Group();
  const add = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  if (id === 'grenade') { add(new THREE.SphereGeometry(0.045, 10, 8).scale(1, 1.3, 1), mat(0x3d4630)); add(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), mat(0x777770, { metalness: 0.6 }), 0, 0.065, 0); }
  if (id === 'bottle') { add(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), mat(0x2f5a2a, { roughness: 0.15, transparent: true, opacity: 0.85 })); add(new THREE.CylinderGeometry(0.012, 0.02, 0.07, 8), mat(0x2f5a2a, { roughness: 0.15 }), 0, 0.13, 0); }
  if (id === 'mine') { add(new THREE.CylinderGeometry(0.16, 0.18, 0.07, 18), mat(0x4a5038, { metalness: 0.3 }), 0, 0.03, 0); add(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10), mat(0x2a2c24), 0, 0.075, 0); }
  if (id === 'tnt') {
    for (const [y, z] of [[0.03, -0.032], [0.03, 0.032], [0.085, 0]]) add(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10).rotateZ(Math.PI / 2), mat(0xa8281e), 0, y, z); // three sticks
    add(new THREE.BoxGeometry(0.07, 0.05, 0.05), mat(0x3a3a34), 0, 0.12, 0.02);
  }
  if (id === 'satchel') { add(new THREE.BoxGeometry(0.34, 0.2, 0.12), mat(0x8a7d55), 0, 0.1, 0); add(new THREE.BoxGeometry(0.36, 0.03, 0.03), mat(0x5a4f34), 0, 0.21, 0); }
  return g;
}

export class Items {
  constructor({ scene, world, player, arsenal, camera, stealth, explosions, hotspots, input, audio, fx, hud }) {
    Object.assign(this, { scene, world, player, arsenal, camera, stealth, explosions, hotspots, input, audio, fx, hud });
    this.count = { ...START_KIT };
    this.selected = 'grenade';
    this.wheelOpen = false;
    this.hover = null;
    this.cursor = new THREE.Vector2();
    this.aimingThrow = false;
    this.healing = null;          // { id, t, total, from }
    this.thrown = [];             // grenades and bottles in flight or rolling
    this.placed = [];             // mines, TNT and satchels in the world
    this.arc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.8, depthTest: false }));
    this.arc.renderOrder = 998; this.arc.frustumCulled = false; this.arc.visible = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false }));
    this.ring.renderOrder = 998; this.ring.visible = false;
    this.ring.userData.noAO = this.arc.userData.noAO = true;
    scene.add(this.arc, this.ring);
    this.buildWheel();
    this.onKill = null;
  }

  get item() { return ITEMS.find(i => i.id === this.selected); }

  // ---- the item wheel ----
  buildWheel() {
    const el = document.createElement('div');
    el.id = 'wheel';
    el.innerHTML = '<div class="hub"><b></b><span></span></div>' + ITEMS.map((it, i) => {
      const a = (i / ITEMS.length) * Math.PI * 2 - Math.PI / 2;
      return `<div class="slot" data-id="${it.id}" style="left:${50 + Math.cos(a) * 38}%;top:${50 + Math.sin(a) * 38}%">${ICONS[it.id] ?? ''}<b>${it.name}</b><span></span></div>`;
    }).join('');
    document.body.appendChild(el);
    this.wheelEl = el;
  }

  drawWheel() {
    this.wheelEl.classList.toggle('on', this.wheelOpen);
    if (!this.wheelOpen) return;
    for (const slot of this.wheelEl.querySelectorAll('.slot')) {
      const id = slot.dataset.id, n = this.count[id];
      slot.querySelector('span').textContent = n === Infinity ? '' : `×${n}`;
      slot.classList.toggle('hover', id === this.hover);
      slot.classList.toggle('empty', !n);
      slot.classList.toggle('sel', id === this.selected);
    }
    const it = ITEMS.find(i => i.id === (this.hover ?? this.selected));
    this.wheelEl.querySelector('.hub b').textContent = it.name;
    this.wheelEl.querySelector('.hub span').textContent = { throw: 'G: hold to aim, release to throw', use: 'G: whistle to lure a guard', place: it.id === 'tnt' ? 'G: place · K: detonate' : it.id === 'satchel' ? 'G: place on a vehicle · 10 s or K' : 'G: place at your feet', heal: 'G or H: heal' }[it.kind];
  }

  // Mouse movement while the wheel is open picks a slot instead of turning you.
  wheelMouse(m) {
    this.cursor.x += m.x; this.cursor.y += m.y;
    if (this.cursor.length() > 140) this.cursor.setLength(140);
    if (this.cursor.length() < 25) return;
    const a = Math.atan2(this.cursor.y, this.cursor.x) + Math.PI / 2;
    const i = ((Math.round(a / (Math.PI * 2 / ITEMS.length)) % ITEMS.length) + ITEMS.length) % ITEMS.length;
    this.hover = ITEMS[i].id;
  }

  // ---- per tick ----
  tick(dt) {
    const inp = this.input, p = this.player;
    // Wheel: hold Q.
    if (inp.down('KeyQ') && !p.dead) {
      if (!this.wheelOpen) { this.wheelOpen = true; this.cursor.set(0, 0); this.hover = null; this.cancelThrow(); }
    } else if (this.wheelOpen) {
      this.wheelOpen = false;
      if (this.hover && this.count[this.hover]) { this.selected = this.hover; this.audio.click(0, 1100, 0.15); }
    }
    const free = !p.dead && !p.climb && !p.carrying && !p.locked && !this.healing && !this.wheelOpen;
    // Heal: H, or G with a bandage/medkit selected.
    const hurt = p.health < 99.5;
    if (free && hurt && (inp.wasPressed('KeyH') || (inp.wasPressed('KeyG') && this.item.kind === 'heal'))) {
      const id = this.item.kind === 'heal' && inp.wasPressed('KeyG') ? this.selected
        : (p.health < 50 && this.count.medkit) || !this.count.bandage ? 'medkit' : 'bandage';
      if (this.count[id]) this.startHeal(id);
      else this.hud.message('NO BANDAGES OR MEDKITS LEFT', 'wound');
    }
    this.tickHeal(dt);
    // Use the selected item: G.
    const it = this.item;
    if (free && this.count[it.id] > 0) {
      if (it.kind === 'throw') {
        if (inp.down('KeyG') && !this.arsenal.aiming) this.aimingThrow = true;
        else if (this.aimingThrow) this.throw(it.id);
      } else if (inp.wasPressed('KeyG')) {
        if (it.kind === 'use') this.whistle();
        if (it.kind === 'place') this.place(it.id);
      }
    } else if (!inp.down('KeyG')) this.aimingThrow = false;
    if (inp.wasPressed('KeyK')) this.detonateAll();
    p.busyHands = this.aimingThrow || !!this.healing;
    this.updateArc();
    this.tickThrown(dt);
    this.tickPlaced(dt);
  }

  // ---- healing ----
  startHeal(id) {
    this.healing = { id, t: 0, total: HEAL[id].time, hurtT: this.player.hurtT };
    this.audio.rustle();
  }

  tickHeal(dt) {
    const h = this.healing;
    if (!h) return;
    if (this.player.hurtT < h.hurtT || this.player.dead) { this.healing = null; this.hud.message('HEALING INTERRUPTED', 'wound'); return; }
    h.hurtT = this.player.hurtT + dt;
    h.t += dt;
    if (h.t >= h.total) {
      this.count[h.id]--;
      this.player.health = Math.min(100, this.player.health + HEAL[h.id].amount);
      this.audio.pickup();
      this.hud.message(h.id === 'medkit' ? 'MEDKIT USED · FULLY HEALED' : 'BANDAGED', '');
      this.healing = null;
    }
  }

  // ---- throwing ----
  throwStart(out = {}) {
    const cam = this.camera, p = this.player;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
    out.pos = p.pos.clone().setY(p.pos.y + Math.max(0.6, p.eye) + 0.1).addScaledVector(right, 0.25).addScaledVector(fwd.clone().setY(0).normalize(), 0.3);
    out.vel = fwd.multiplyScalar(THROW_SPEED).add(new THREE.Vector3(0, THROW_LIFT, 0));
    return out;
  }

  // Where a throw would go: the arc up to its first landing.
  traceArc() {
    const { pos, vel } = this.throwStart();
    const pts = [pos.clone()], prev = new THREE.Vector3(), h = 1 / 30;
    for (let t = 0; t < 4; t += h) {
      prev.copy(pos);
      vel.y -= 9.8 * h;
      pos.addScaledVector(vel, h);
      const hit = this.world.raycastSegment(prev, pos);
      if (hit) { pts.push(hit.point.clone()); return { pts, end: hit.point.clone(), normal: hit.normal }; }
      pts.push(pos.clone());
    }
    return { pts, end: pos.clone(), normal: new THREE.Vector3(0, 1, 0) };
  }

  updateArc() {
    const show = this.aimingThrow;
    this.arc.visible = this.ring.visible = show;
    if (!show) return;
    const { pts, end } = this.traceArc();
    this.arc.geometry.dispose();
    this.arc.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.arc.computeLineDistances();
    this.ring.position.copy(end).add(new THREE.Vector3(0, 0.05, 0));
  }

  cancelThrow() { this.aimingThrow = false; }

  throw(id) {
    this.aimingThrow = false;
    this.count[id]--;
    const { pos, vel } = this.throwStart();
    const mesh = model(id);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.thrown.push({ id, mesh, pos, vel, fuse: FUSE[id] ?? 0, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0) });
    this.audio.throwWhoosh?.();
  }

  tickThrown(dt) {
    const prev = new THREE.Vector3();
    for (const o of this.thrown) {
      prev.copy(o.pos);
      o.vel.y -= 9.8 * dt;
      o.pos.addScaledVector(o.vel, dt);
      const hit = this.world.raycastSegment(prev, o.pos);
      if (hit) {
        if (o.id === 'bottle') { this.smashBottle(o, hit.point); continue; }
        // Bounce, losing most of the speed, and settle.
        const n = hit.normal;
        o.vel.reflect(n).multiplyScalar(0.35);
        o.pos.copy(hit.point).addScaledVector(n, 0.05);
        if (o.vel.length() < 0.8) { o.vel.set(0, 0, 0); o.rest = true; }
        this.audio.impact?.(this.player.pos.distanceTo(o.pos) + 40);
      }
      if (o.rest) { o.vel.set(0, 0, 0); o.pos.y = this.world.floorAt(o.pos.x, o.pos.z, o.pos.y + 0.3) + 0.05; }
      o.mesh.position.copy(o.pos);
      if (!o.rest) { o.mesh.rotation.x += o.spin.x * dt; o.mesh.rotation.y += o.spin.y * dt; }
      if (o.id === 'grenade') {
        o.fuse -= dt;
        if (o.fuse <= 0) { o.done = true; this.blast('grenade', o.pos.clone()); }
      }
    }
    for (const o of this.thrown.filter(o => o.done)) this.scene.remove(o.mesh);
    this.thrown = this.thrown.filter(o => !o.done);
  }

  smashBottle(o, at) {
    o.done = true;
    this.fx.emit(at, new THREE.Vector3(0, 1, 0), { color: 0x6fae66, count: 10, speed: 3, size: 0.05, life: 0.6, grow: 1, gravity: -9 });
    this.audio.bottleSmash?.(this.player.pos.distanceTo(at));
    this.stealth.noise(at.clone(), 25, 'bottle');   // they come to look where it broke, not at you
  }

  // ---- whistle ----
  whistle() {
    this.audio.whistle?.();
    this.stealth.noise(this.player.pos.clone(), 28, 'whistle');
    this.hud.message('WHISTLE · NEARBY GUARDS WILL COME TO LOOK', '');
  }

  // ---- traps ----
  place(id) {
    const p = this.player;
    if (!p.grounded) return;
    let at = p.pos.clone(), parent = null;
    if (id === 'satchel') {
      // On a vehicle in reach: on its engine (the bonnet, the deck, the grille).
      let best = null, bestD = 3.2;
      for (const h of this.hotspots.list) {
        if (!h.explosive || h.exploded) continue;
        const d = h.center().distanceTo(p.pos.clone().setY(p.pos.y + 1));
        if (d < bestD) { best = h; bestD = d; }
      }
      if (best) { at = best.center().add(new THREE.Vector3(0, 0.15, 0)); parent = best.meshes[0]; }
    } else {
      const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      at.addScaledVector(fwd, 0.6);
      at.y = this.world.floorAt(at.x, at.z, p.pos.y + 0.3) + (id === 'mine' ? -0.02 : 0);
    }
    this.count[id]--;
    this.spawnTrap(id, at, p.yaw, parent);
    this.audio.rustle();
    this.hud.message({ mine: 'MINE PLACED · IT ARMS IN A MOMENT', tnt: 'TNT PLACED · PRESS K TO DETONATE', satchel: parent ? 'SATCHEL ON THE VEHICLE · 10 SECONDS · K TO BLOW IT NOW' : 'SATCHEL PLACED · 10 SECONDS · K TO BLOW IT NOW' }[id], '');
  }

  // Put a mine, TNT or satchel in the world (from placing it, or from a loaded save).
  spawnTrap(id, at, yaw, parent = null, { fuse = FUSE[id] ?? null, arm = id === 'mine' ? 1.5 : 0 } = {}) {
    const mesh = model(id);
    mesh.position.copy(at);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);
    if (parent) parent.parent.attach(mesh);   // rides along with the vehicle
    const trap = { id, mesh, arm, fuse, on: parent ? 'vehicle' : 'ground' };
    // A bullet sets off TNT and satchels.
    if (id !== 'mine') mesh.traverse(o => { if (o.isMesh) { o.userData.trap = trap; this.world.raycastTargets.push(o); } });
    this.placed.push(trap);
    return trap;
  }

  restorePlaced(t) {
    const h = t.on && this.hotspots.list.find(x => x.title === t.on);
    this.spawnTrap(t.id, new THREE.Vector3().fromArray(t.pos), t.yaw, h ? h.meshes[0] : null, { fuse: t.fuse, arm: t.arm ?? 0 });
  }

  tickPlaced(dt) {
    for (const t of this.placed) {
      if (t.done) continue;
      if (t.fuse != null) { t.fuse -= dt; if (t.fuse <= 0) { this.detonate(t); continue; } }
      if (t.id !== 'mine') continue;
      if (t.arm > 0) { t.arm -= dt; continue; }
      const at = t.mesh.position;
      // A guard stepping on it, or a vehicle rolling over it (not you: you know where it is).
      const victim = this.world.soldiers.some(s => s.alive && !s.range && Math.hypot(s.root.position.x - at.x, s.root.position.z - at.z) < 0.9 && Math.abs(s.root.position.y - at.y) < 1);
      const vehicle = this.hotspots.list.some(h => h.explosive && !h.exploded && h.kind === 'engine' && h.center().setY(at.y).distanceTo(at) < 2.6);
      if (victim || vehicle) { this.audio.click(0, 2600, 0.3); t.fuse = 0.2; } // click… then it goes
    }
    this.placed = this.placed.filter(t => !t.done);
  }

  detonate(t) {
    if (t.done) return;
    t.done = true;
    const at = t.mesh.getWorldPosition(new THREE.Vector3());
    this.scene.remove(t.mesh);
    t.mesh.removeFromParent();
    t.mesh.traverse(o => { const i = this.world.raycastTargets.indexOf(o); if (i >= 0) this.world.raycastTargets.splice(i, 1); });
    this.blast(t.id, at);
  }

  detonateAll() {
    const charges = this.placed.filter(t => !t.done && (t.id === 'tnt' || t.id === 'satchel'));
    if (!charges.length) return;
    this.audio.click(0, 1800, 0.25);
    for (const t of charges) this.detonate(t);
  }

  blast(id, at) {
    const b = BLAST[id];
    this.explosions.explode(at, b);
  }

  // An explosion nearby sets off placed charges and mines (explosions.js asks).
  caughtIn(at, radius, pending) {
    for (const t of this.placed) {
      if (t.done || t.chain) continue;
      if (t.mesh.getWorldPosition(new THREE.Vector3()).distanceTo(at) < Math.min(radius, 5)) {
        t.chain = true;
        pending.push({ t: 0.2, run: () => this.detonate(t) });
      }
    }
  }

  // A bullet hit a placed charge.
  shot(trap) { if (trap.detonate) trap.detonate(); else this.detonate(trap); }   // (an explosives crate brings its own)

  // For the HUD.
  state() {
    const it = this.item, n = this.count[it.id];
    return {
      name: it.name, count: n === Infinity ? null : n, kind: it.kind,
      healing: this.healing ? { id: this.healing.id, progress: this.healing.t / this.healing.total } : null,
      charges: this.placed.filter(t => t.id !== 'mine' && !t.done).length,
    };
  }
}
