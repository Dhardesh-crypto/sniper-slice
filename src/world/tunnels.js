// Tunnels under the lines: a wooden hatch in the ground at each end (a frame, a lid with an iron
// ring). Hold E at one to lift it and climb down; your torch clicks on and you crawl through (a
// few seconds down a timbered drain, the earth close round you, daylight at the far end), and you
// come up out of the other hatch. Both ways, as often as you like; the guards don't use them, and
// nobody hears you down there.
import * as THREE from 'three';
import { textures, worldUVs } from './textures.js';

const DOWN_TIME = 0.8;
const FADE = 0.45;               // s to black, and back
const PER_METRE = 0.035;         // s of crawling per metre of tunnel (a 100 m tunnel: about 4 s)
const MIN_CRAWL = 1.6;           // s in the tunnel, at least
const LEN = 30, W = 1.1, H = 1.05, EYE = 0.42;   // the stretch of tunnel you see crawling (m)

// The tunnel you crawl through, its own little scene: earth walls, floor and roof, a timber frame
// every 1.4 m, your torch, and the light of the far hatch.
function tunnelView() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const T = textures();
  const earth = new THREE.MeshStandardMaterial({ ...T.ground, color: 0x7a6650, roughness: 1, side: THREE.BackSide });
  const shell = new THREE.Mesh(worldUVs(new THREE.BoxGeometry(W, H, LEN + 4), 1.2), earth);
  shell.position.set(0, H / 2, -LEN / 2);
  shell.receiveShadow = true;
  scene.add(shell);
  const wood = new THREE.MeshStandardMaterial({ ...T.darkWood, roughness: 0.9 });
  const post = new THREE.BoxGeometry(0.1, H, 0.1), cap = new THREE.BoxGeometry(W, 0.1, 0.14), sill = new THREE.BoxGeometry(W, 0.04, 0.2);
  for (let z = -1, i = 0; z > -LEN - 1; z -= 1.4, i++) {
    const lean = Math.sin(i * 2.3) * 0.03;   // (old props, none quite straight)
    for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) {
      const m = new THREE.Mesh(post, wood); m.position.set(x, H / 2, z); m.rotation.z = lean; m.castShadow = m.receiveShadow = true; scene.add(m);
    }
    const c = new THREE.Mesh(cap, wood); c.position.set(0, H - 0.05, z); c.rotation.z = lean * 0.5; c.castShadow = c.receiveShadow = true; scene.add(c);
    if (i % 2) { const s = new THREE.Mesh(sill, wood); s.position.set(0, 0.02, z - 0.7); s.receiveShadow = true; scene.add(s); }   // boards over the wet
  }
  scene.add(new THREE.AmbientLight(0x30343c, 0.04));
  const torch = new THREE.SpotLight(0xffe4b8, 10, 16, 0.5, 0.65, 1.6);
  torch.castShadow = true;
  torch.shadow.mapSize.set(512, 512);
  torch.shadow.bias = -0.002;
  scene.add(torch, torch.target);
  const daylight = new THREE.PointLight(0xcfdcff, 0, 6, 1.5);   // down through the far hatch
  daylight.position.set(0, H - 0.1, -LEN + 0.4);
  scene.add(daylight);
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 60);
  return { scene, camera, torch, daylight };
}

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
    this.trip = { from, to: from.other, t: 0, crawl: Math.max(MIN_CRAWL, from.length * PER_METRE), moved: false };
    this.audio.rustle?.();
    this.hud?.message('DOWN THE HATCH · CRAWLING THROUGH THE TUNNEL', '');
  }

  // The tunnel is on screen (main.js draws it instead of the world).
  get viewing() { return !!this.trip?.inside; }

  render(renderer) {
    renderer.shadowMap.needsUpdate = true;   // (its torch's shadow is drawn every frame)
    renderer.render(this.view.scene, this.view.camera);
  }

  tick(dt) {
    const tr = this.trip;
    if (!tr) return;
    tr.t += dt;
    const p = this.player, F = FADE;
    // To black; the tunnel fades up and you crawl it by torchlight; to black; up into the world.
    const inEnd = 2 * F + tr.crawl, end = inEnd + 2 * F;
    const k = tr.t < F ? tr.t / F : tr.t < 2 * F ? 1 - (tr.t - F) / F : tr.t < inEnd ? 0
      : tr.t < inEnd + F ? (tr.t - inEnd) / F : Math.max(0, 1 - (tr.t - inEnd - F) / F);
    this.fade.style.opacity = String(k);
    tr.inside = tr.t >= F && tr.t < inEnd + F;
    for (const id of ['markers', 'crosshair']) { const el = document.getElementById(id); if (el) el.style.visibility = tr.inside ? 'hidden' : ''; }   // (the world's marks, not down here)
    if (tr.inside) this.crawl(tr, (tr.t - F) / (tr.crawl + 2 * F));
    if ((tr.stepT = (tr.stepT ?? 0) - dt) <= 0 && tr.inside) { tr.stepT = 0.55; this.audio.step?.('prone'); }
    if (!tr.moved && tr.t >= F) {
      tr.moved = true;
      this.audio.click?.(0.1, 1700, 0.22);   // the torch on
      const to = tr.to.at, off = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(0.9);
      p.pos.set(to.x + off.x, to.y, to.z + off.z);
      p.prevPos?.copy(p.pos);
      p.vel?.set(0, 0, 0);
      if (p.stance !== 'crouch') p.setStance?.('crouch');   // (you come up out of it low)
    }
    if (tr.t >= end) { this.trip = null; p.locked = false; this.fade.style.opacity = '0'; }
  }

  // Crawling: elbows and knees, the head bobbing and rolling with each pull, the torch a step behind.
  crawl(tr, u) {
    const v = this.view ??= tunnelView();
    const cam = v.camera, ph = tr.t * Math.PI / 0.55;
    if (Math.abs(cam.aspect - innerWidth / innerHeight) > 1e-3) { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
    const z = -0.6 - (LEN - 4.5) * (u * u * (3 - 2 * u) * 0.25 + u * 0.75);   // (eased in from the ladder)
    cam.position.set(Math.sin(ph * 0.5) * 0.04, EYE + Math.abs(Math.sin(ph)) * 0.035, z);
    cam.rotation.set(-0.06 + Math.sin(ph) * 0.015, Math.sin(ph * 0.5) * 0.03, Math.sin(ph * 0.5) * 0.035, 'YXZ');
    cam.updateMatrixWorld();
    v.torch.position.set(cam.position.x + 0.12, cam.position.y - 0.12, z + 0.1);
    v.torch.target.position.set(Math.sin(ph * 0.5 - 0.6) * 0.15, EYE - 0.15, z - 5);
    v.torch.target.updateMatrixWorld();
    v.daylight.intensity = 2.5 * THREE.MathUtils.smoothstep(u, 0.45, 1);
  }
}
