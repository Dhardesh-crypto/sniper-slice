// Tunnels under the lines: a wooden hatch in the ground at each end (a frame, a lid with an iron
// ring). Hold E at one to lift it and climb down; the world goes dark while you crawl through
// (a few seconds, the earth close round you), and you come up out of the other hatch. Both ways,
// as often as you like; the guards don't use them, and nobody hears you down there.
import * as THREE from 'three';

const DOWN_TIME = 0.8;
const FADE = 0.45;               // s to black, and back
const PER_METRE = 0.035;         // s of crawling per metre of tunnel (a 100 m tunnel: about 4 s)

function hatchModel() {
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2a27, roughness: 0.6, metalness: 0.7 });
  for (const [w, d, x, z] of [[1.1, 0.12, 0, 0.5], [1.1, 0.12, 0, -0.5], [0.12, 0.9, 0.5, 0], [0.12, 0.9, -0.5, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), wood); m.position.set(x, 0.03, z); g.add(m);
  }
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.9), wood); lid.position.y = 0.04; g.add(lid);
  for (const z of [-0.25, 0, 0.25]) { const slat = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.015, 0.03), iron); slat.position.set(0, 0.075, z); g.add(slat); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 12).rotateX(Math.PI / 2), iron); ring.position.set(0.25, 0.085, 0); g.add(ring);
  g.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  return g;
}

export class Tunnels {
  // pairs: [[{ x, z, y? }, { x, z, y? }], ...]
  constructor({ scene, world, player, interactions, audio, hud, pairs = [] }) {
    Object.assign(this, { scene, world, player, audio, hud });
    this.trip = null;
    this.ends = [];
    for (const [a, b] of pairs) {
      const A = this.end(scene, a), B = this.end(scene, b);
      A.other = B; B.other = A;
      A.length = B.length = Math.hypot(a.x - b.x, a.z - b.z);
      for (const e of [A, B]) {
        interactions.addLever({ at: e.at.clone(), label: 'CLIMB DOWN THE HATCH', busy: 'LIFTING THE HATCH…', time: DOWN_TIME, onUse: (l) => { l.used = false; this.go(e); } });
      }
    }
    this.fade = document.createElement('div');
    this.fade.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:7;transition:none';
    document.body.appendChild(this.fade);
  }

  end(scene, p) {
    const y = p.y ?? this.world.floorAt(p.x, p.z, this.world.groundAt(p.x, p.z) + 1);
    const m = hatchModel();
    m.position.set(p.x, y, p.z);
    m.rotation.y = p.yaw ?? 0;
    scene.add(m);
    const e = { at: new THREE.Vector3(p.x, y, p.z), model: m };
    this.ends.push(e);
    return e;
  }

  go(from) {
    if (this.trip) return;
    const p = this.player;
    p.locked = true;
    this.trip = { from, to: from.other, t: 0, crawl: FADE * 2 + from.length * PER_METRE, moved: false };
    this.audio.rustle?.();
    this.hud?.message('DOWN THE HATCH · CRAWLING THROUGH THE TUNNEL', '');
  }

  tick(dt) {
    const tr = this.trip;
    if (!tr) return;
    tr.t += dt;
    const p = this.player, end = tr.crawl + FADE;
    // Fade out, crawl in the dark, come up at the far end and fade back in.
    const k = tr.t < FADE ? tr.t / FADE : tr.t < tr.crawl ? 1 : Math.max(0, 1 - (tr.t - tr.crawl) / FADE);
    this.fade.style.opacity = String(k);
    if ((tr.stepT = (tr.stepT ?? 0) - dt) <= 0 && tr.t > FADE && tr.t < tr.crawl) { tr.stepT = 0.55; this.audio.step?.('prone'); }
    if (!tr.moved && tr.t >= FADE) {
      tr.moved = true;
      const to = tr.to.at, off = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(0.9);
      p.pos.set(to.x + off.x, to.y, to.z + off.z);
      p.prevPos?.copy(p.pos);
      p.vel?.set(0, 0, 0);
      if (p.stance !== 'crouch') p.setStance?.('crouch');   // (you come up out of it low)
    }
    if (tr.t >= end) { this.trip = null; p.locked = false; this.fade.style.opacity = '0'; }
  }
}
