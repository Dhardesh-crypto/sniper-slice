// Things you use with E inside buildings:
//   doors      press E to open or shut; guards open them as they walk through
//   documents  press E to pick up and read (letters, orders, maps); kept in your intel
//   levers     hold E to pull (a signal lever): { at, label, time, onUse }; once only
//   safes      hold E: with the combination (found in a document or on a body) it opens in a
//              moment; without it you crack it by ear, slowly, and the dial clicks carry
// The mission module places them; this keeps the prompt, the progress and the reading view.
import * as THREE from 'three';
import { M } from './kit.js';

const REACH = 1.6;
const CRACK_TIME = 9, DIAL_TIME = 1.4;

export class Interactions {
  constructor({ scene, world, player, input, hud, audio, stealth, profile, missionId }) {
    Object.assign(this, { scene, world, player, input, hud, audio, stealth, profile, missionId });
    this.doors = [];
    this.documents = [];
    this.safes = [];
    this.levers = [];
    this.known = new Set();       // combinations you've read: safe ids
    this.found = new Set();       // documents read this mission
    this.target = null;
    this.progress = 0;
    this.reading = null;
    this.onDocument = null;       // (doc) => void
    this.onSafe = null;           // (safe) => void
    this.buildReader();
  }

  addDoors(doors) { this.doors.push(...doors); }

  // A document lying somewhere: { id, title, text, at, reveals?: safeId, onRead? }.
  addDocument(doc) {
    const mesh = paper();
    mesh.position.copy(doc.at);
    mesh.rotation.y = Math.random() * Math.PI;
    this.scene.add(mesh);
    this.documents.push({ ...doc, mesh, taken: false });
  }

  // A safe: { id, at (floor point in front of it), yaw (which way its door faces), combination, contents(): labels, docs: [doc] }.
  addSafe(safe) {
    const g = safeModel();
    g.position.copy(safe.at);
    g.rotation.y = safe.yaw ?? 0;
    this.scene.add(g);
    g.updateMatrixWorld(true);
    const body = g.userData.body;
    this.world.solids?.push(body);
    this.world.boxes.push(new THREE.Box3().setFromObject(body));
    this.world.raycastTargets.push(body);
    // Where you kneel to work the dial: in front of its door.
    const front = new THREE.Vector3(0, 0, 0.75).applyAxisAngle(new THREE.Vector3(0, 1, 0), safe.yaw ?? 0).add(safe.at);
    this.safes.push({ ...safe, model: g, front, open: false });
  }

  // A lever (or any one-off thing you hold E to work): { at, label, busy, time = 1.5, onUse(lever) }.
  addLever(lever) { this.levers.push({ time: 1.5, ...lever, used: false }); }

  // A document found on a body or in a safe: read it now.
  give(doc) { this.read(doc); }

  near() {
    const p = this.player.pos;
    let best = null, bestD = REACH;
    const consider = (kind, item, pos, dy = 1.6) => {
      const d = Math.hypot(pos.x - p.x, pos.z - p.z);
      if (d < bestD && Math.abs(pos.y - p.y) < dy) { best = { kind, item }; bestD = d; }
    };
    for (const d of this.documents) if (!d.taken) consider('doc', d, d.at);
    for (const s of this.safes) if (!s.open) consider('safe', s, s.front);
    for (const l of this.levers) if (!l.used) consider('lever', l, l.at);
    for (const d of this.doors) consider('door', d, d.centre, 1.3);
    return best;
  }

  tick(dt) {
    for (const d of this.doors) d.tick(dt);
    // Guards open doors as they come to them (and leave them open).
    for (const s of this.world.soldiers) {
      if (!s.alive || s.range || s.gait === 'stand') continue;
      for (const d of this.doors) if (!d.open && s.root.position.distanceToSquared(d.centre) < 1.3) d.setOpen(this.world, true);
    }
    if (this.reading) {
      if (this.input.wasPressed('KeyE') || this.input.wasPressed('Escape') || this.player.moving) this.closeReader();
      return;
    }
    const p = this.player;
    const t = p.dead || p.climb || p.carrying || p.locked ? null : this.near();
    if (t?.item !== this.target?.item) { this.target = t; this.progress = 0; }
    if (!t) return;
    if (t.kind === 'door' && this.input.wasPressed('KeyE')) { t.item.toggle(this.world); this.audio.click(0, 600, 0.25); return; }
    if (t.kind === 'doc' && this.input.wasPressed('KeyE')) { this.take(t.item); return; }
    if (t.kind === 'lever') {
      if (!this.input.down('KeyE') || p.moving) { this.progress = 0; return; }
      this.progress += dt / t.item.time;
      if (this.progress >= 1) { t.item.used = true; this.progress = 0; this.audio.thump?.({ freq: 90, dur: 0.25, gain: 0.5 }); t.item.onUse?.(t.item); }
      return;
    }
    if (t.kind === 'safe') {
      if (!this.input.down('KeyE') || p.moving) { this.progress = 0; return; }
      const known = this.known.has(t.item.id);
      this.progress += dt / (known ? DIAL_TIME : CRACK_TIME);
      // The dial's clicks; cracking by ear is slow and carries a little.
      this.clickT = (this.clickT ?? 0) - dt;
      if (this.clickT <= 0) {
        this.clickT = known ? 0.35 : 0.6;
        this.audio.click(0, known ? 1700 : 1300, 0.2);
        if (!known) this.stealth.noise(p.pos.clone(), 7, 'sabotage');
      }
      if (this.progress >= 1) this.openSafe(t.item);
    }
  }

  take(doc) {
    doc.taken = true;
    doc.mesh.removeFromParent();
    this.audio.rustle?.();
    this.read(doc);
  }

  read(doc) {
    this.found.add(doc.id);
    if (doc.reveals) {
      this.known.add(doc.reveals);
      const safe = this.safes.find(s => s.id === doc.reveals);
      this.hud.message(`COMBINATION FOUND · ${safe?.name ?? 'SAFE'} · ${safe?.combination ?? ''}`, 'head');
    }
    this.profile?.addIntel?.(this.missionId, doc.id);
    doc.onRead?.();
    this.onDocument?.(doc);
    this.reading = doc;
    this.reader.querySelector('h2').textContent = doc.title;
    this.reader.querySelector('.doc-body').textContent = doc.text;
    this.reader.querySelector('.doc-meta').textContent = `Intel · ${this.found.size} document${this.found.size === 1 ? '' : 's'} found this mission · E to close`;
    this.reader.classList.add('on');
  }

  closeReader() { this.reading = null; this.reader.classList.remove('on'); }

  openSafe(safe) {
    safe.open = true;
    this.progress = 0;
    safe.model.userData.door.rotation.y = -1.9;
    this.audio.click(0, 900, 0.4);
    const got = safe.contents?.() ?? [];
    if (got.length) this.hud.message(`${safe.name ?? 'SAFE'} OPEN · ${got.join(' · ').toUpperCase()}`, 'head');
    this.onSafe?.(safe);
    for (const doc of safe.docs ?? []) this.read(doc);
  }

  // For the HUD prompt.
  state() {
    const t = this.target;
    if (!t || this.reading) return null;
    if (t.kind === 'door') return { label: t.item.open ? 'E · CLOSE THE DOOR' : 'E · OPEN THE DOOR', progress: 0 };
    if (t.kind === 'doc') return { label: `E · READ: ${t.item.title.toUpperCase()}`, progress: 0 };
    if (t.kind === 'lever') return { label: this.progress > 0 ? t.item.busy : `HOLD E · ${t.item.label}`, progress: this.progress };
    const known = this.known.has(t.item.id);
    return { label: this.progress > 0 ? (known ? 'DIALLING THE COMBINATION…' : 'CRACKING THE SAFE BY EAR… (NOISY)') : known ? `HOLD E · OPEN THE SAFE (${t.item.combination})` : 'HOLD E · CRACK THE SAFE (SLOW, NOISY: OR FIND THE COMBINATION)', progress: this.progress };
  }

  // Saves.
  snapshot() {
    return { doors: this.doors.map(d => d.open), docs: this.documents.map(d => d.taken), safes: this.safes.map(s => s.open), levers: this.levers.map(l => l.used), known: [...this.known], found: [...this.found] };
  }
  restore(d) {
    if (!d) return;
    d.doors?.forEach((o, i) => { if (o && this.doors[i]) { this.doors[i].setOpen(this.world, true); this.doors[i].swing = this.doors[i].target; this.doors[i].pivot.rotation.y = this.doors[i].swing; } });
    d.docs?.forEach((t, i) => { const doc = this.documents[i]; if (t && doc && !doc.taken) { doc.taken = true; doc.mesh.removeFromParent(); } });
    d.safes?.forEach((o, i) => { const s = this.safes[i]; if (o && s && !s.open) { s.open = true; s.model.userData.door.rotation.y = -1.9; } });
    d.levers?.forEach((u, i) => { if (u && this.levers[i]) this.levers[i].used = true; });     // (the module restores what it did)
    for (const k of d.known ?? []) this.known.add(k);
    for (const f of d.found ?? []) this.found.add(f);
  }

  buildReader() {
    const el = document.createElement('div');
    el.id = 'doc-reader';
    el.innerHTML = '<div class="doc-paper"><h2></h2><div class="doc-body"></div><p class="doc-meta"></p></div>';
    document.body.appendChild(el);
    el.addEventListener('click', () => this.closeReader());
    this.reader = el;
  }
}

function paper() {
  const g = new THREE.Group();
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.3), new THREE.MeshStandardMaterial({ color: 0xe9e2cc, roughness: 0.9 }));
  sheet.position.y = 0.006;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.014, 0.05), new THREE.MeshStandardMaterial({ color: 0x8a2a1e, roughness: 0.8 }));
  band.position.set(0, 0.007, -0.08);
  g.add(sheet, band);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// A squat steel safe with a dial and a handle; its door swings open on the left.
function safeModel() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x2f3430, roughness: 0.45, metalness: 0.7 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d48, roughness: 0.35, metalness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 0.65), steel);
  body.position.y = 0.425;
  const pivot = new THREE.Group();
  pivot.position.set(-0.32, 0.425, 0.33);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.74, 0.05), steel);
  door.position.set(0.31, 0, 0);
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 20).rotateX(Math.PI / 2), brass);
  dial.position.set(0.31, 0.12, 0.035);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), brass);
  handle.position.set(0.31, -0.08, 0.04);
  door.add(dial, handle);
  pivot.add(door);
  // A shelf of papers inside.
  const inside = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: 0xe0d6b8, roughness: 0.9 }));
  inside.position.set(0, 0.3, 0.05);
  g.add(body, pivot, inside);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { body, door: pivot };
  return g;
}
