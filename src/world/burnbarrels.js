// Burn barrels: a rusted oil drum with its top cut out and holes knocked in its side, a fire of
// scrap wood in it, set down in the open by a few of the guard posts. Flames lick over the rim,
// smoke goes up, sparks now and then, the holes glow; at dusk (and in winter) the fire lights the
// ground round it, flickering, and anyone standing close is lit up too (stealth.js asks `litAt`).
// A calm guard at a post nearby wanders over now and then and warms his hands at it (guards.js).
import * as THREE from 'three';
import { activeMap } from './terrain.js';
import { seeded } from '../core/run.js';

const R = 0.29, H = 0.88;        // a 200-litre drum
const LIGHTS = 2;                // real lights, handed to the barrels nearest you
const SPREAD = 25;               // m between barrels at least

function holesTexture() {
  // Rust, darker streaks, and a ring of holes near the bottom that glow (the emissive map).
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 9; i++) {
    const x = 7 + i * 14 + (Math.random() - 0.5) * 3, y = 50 + (Math.random() - 0.5) * 4;
    const grd = g.createRadialGradient(x, y, 0, x, y, 4);
    grd.addColorStop(0, '#ffd27a'); grd.addColorStop(0.5, '#ff6a14'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}
function rustTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#5a3a24'; g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${60 + Math.random() * 90 | 0},${30 + Math.random() * 40 | 0},${15 + Math.random() * 20 | 0},${0.3 + Math.random() * 0.5})`;
    g.fillRect(Math.random() * 128, Math.random() * 64, 1 + Math.random() * 6, 1 + Math.random() * 3);
  }
  for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(20,12,8,0.35)'; g.fillRect(Math.random() * 128, 0, 1 + Math.random() * 2, 64); }   // streaks down it
  g.fillStyle = 'rgba(30,20,12,0.6)'; g.fillRect(0, 10, 128, 3); g.fillRect(0, 40, 128, 3);   // the rolling hoops
  for (let i = 0; i < 9; i++) { g.fillStyle = '#0c0806'; g.beginPath(); g.arc(7 + i * 14, 50, 3, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

export class BurnBarrels {
  constructor({ scene, world, fx, seed = 1, count = null }) {
    Object.assign(this, { scene, world, fx });
    const rnd = this.rnd = seeded(seed ^ 0xba44e1);          // (the run's seed: a loaded game has them where they were)
    this.list = [];
    this.lights = [];
    const cold = !!activeMap().winter, n = count ?? (cold ? 6 : 4);
    const mat = new THREE.MeshStandardMaterial({ map: rustTexture(), emissiveMap: holesTexture(), emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.9, metalness: 0.3, side: THREE.DoubleSide });
    const glow = new THREE.MeshBasicMaterial({ color: 0xff8a2a });
    const geo = new THREE.CylinderGeometry(R, R * 0.98, H, 18, 1, true).translate(0, H / 2, 0);
    // By the guard posts on open ground (not up a tower, not indoors), spread apart.
    const posts = world.soldiers.filter(s => !s.range && s.stance !== 'officer' && Math.abs(s.root.position.y - world.groundAt(s.root.position.x, s.root.position.z)) < 0.5);
    for (let i = posts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [posts[i], posts[j]] = [posts[j], posts[i]]; }
    for (const s of posts) {
      if (this.list.length >= n) break;
      const p = s.root.position;
      if (this.list.some(b => b.at.distanceTo(p) < SPREAD)) continue;
      const at = this.spot(p);
      if (!at) continue;
      const drum = new THREE.Mesh(geo, mat);
      drum.position.copy(at);
      drum.rotation.y = rnd() * 6.3;
      drum.castShadow = drum.receiveShadow = true;
      const embers = new THREE.Mesh(new THREE.CircleGeometry(R * 0.95, 16).rotateX(-Math.PI / 2), glow);
      embers.position.y = H * 0.82;
      drum.add(embers);
      scene.add(drum);
      world.raycastTargets.push(drum);
      world.boxes.push(new THREE.Box3(new THREE.Vector3(at.x - R, at.y, at.z - R), new THREE.Vector3(at.x + R, at.y + H, at.z + R)));
      this.list.push({ at, top: at.clone().setY(at.y + H), drum, embers, post: s, flameT: 0, smokeT: Math.random(), sparkT: 2 + Math.random() * 4, phase: Math.random() * 10 });
    }
    for (let i = 0; i < LIGHTS; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 14, 1.6);
      scene.add(l);
      this.lights.push(l);
    }
    this.handT = 0;
    this.time = 0;
  }

  // A clear patch of level ground a couple of metres from a post.
  spot(p) {
    const w = this.world;
    for (let k = 0; k < 10; k++) {
      const a = this.rnd() * Math.PI * 2, d = 2 + this.rnd() * 1.5;
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const g = w.groundAt(x, z);
      if (Math.abs(w.floorAt(x, z, g + 1) - g) > 0.05) continue;                 // (something stands there)
      if (Math.max(...[[R, 0], [-R, 0], [0, R], [0, -R]].map(([dx, dz]) => Math.abs(w.groundAt(x + dx, z + dz) - g))) > 0.12) continue;   // (too steep)
      const up = new THREE.Vector3(x, g + 0.3, z);
      if (w.boxAlong(up, up.clone().setY(g + 6)) !== null) continue;          // (under a roof)
      if (w.boxAlong(up.clone().setY(g + 0.5), new THREE.Vector3(p.x, g + 0.5, p.z)) !== null) continue;   // (the far side of a wall from him)
      return new THREE.Vector3(x, g, z);
    }
    return null;
  }

  // How strongly the fires light the spot `p` (0 by day or far off): stealth.js.
  litAt(p) {
    if (!activeMap().dusk) return 0;
    let k = 0;
    for (const b of this.list) k = Math.max(k, 1 - b.at.distanceTo(p) / 6);
    return Math.max(0, k);
  }

  // A calm guard looking for somewhere to warm his hands: the barrel nearest him, if close.
  near(p, within = 14) {
    let best = null, bd = within;
    for (const b of this.list) { const d = b.at.distanceTo(p); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  tick(dt, viewer) {
    if (!this.list.length) return;
    this.time += dt;
    const dark = !!activeMap().dusk, up = _up;
    for (const b of this.list) {
      if (viewer && b.at.distanceTo(viewer) > 220) continue;            // (out of sight: no smoke made)
      if ((b.flameT -= dt) <= 0) {
        b.flameT = 0.07;
        _p.copy(b.top).add(_o.set((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3));
        this.fx.emit(_p, up, { color: Math.random() < 0.5 ? 0xff7a1e : 0xffb040, count: 1, speed: 0.9, size: 0.32, life: 0.45, grow: 1.2, gravity: -1.5, glow: true, heat: 3 });
      }
      if ((b.smokeT -= dt) <= 0) {
        b.smokeT = 0.35;
        this.fx.emit(_p.copy(b.top).setY(b.top.y + 0.6), up, { color: 0x2e2a26, count: 1, speed: 0.9, size: 0.5, life: 5, grow: 4, gravity: 0.5 });
      }
      if ((b.sparkT -= dt) <= 0) {
        b.sparkT = 1.5 + Math.random() * 4;
        this.fx.emit(b.top, up, { color: 0xffd27a, count: 3 + Math.floor(Math.random() * 4), speed: 2.5, size: 0.04, life: 1.4, grow: 0.3, gravity: -1.2, glow: true, heat: 6 });
      }
      b.embers.material.color.setHSL(0.06, 1, 0.45 + 0.1 * Math.sin(this.time * 7 + b.phase));
    }
    // The real light goes to the fires nearest you.
    if ((this.handT -= dt) <= 0 && viewer) {
      this.handT = 0.5;
      this.lit = [...this.list].sort((a, b) => a.at.distanceToSquared(viewer) - b.at.distanceToSquared(viewer)).slice(0, LIGHTS);
    }
    this.lights.forEach((l, i) => {
      const b = this.lit?.[i];
      if (!b) { l.intensity = 0; return; }
      const w = this.time * 12 + b.phase;
      l.position.copy(b.top).y += 0.35 + 0.08 * Math.sin(w * 0.6);
      l.intensity = (dark ? 9 : 1.2) * (0.75 + 0.15 * Math.sin(w) * Math.sin(w * 1.7) + 0.1 * Math.random());
    });
  }
}

const _up = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3(), _o = new THREE.Vector3();
