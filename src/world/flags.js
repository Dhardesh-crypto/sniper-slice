// Pennants on poles by a few of the guard posts: a long red-and-white streamer that shows the
// wind the way a sniper reads it. In a breeze it hangs and stirs; as the wind freshens it lifts
// and stands out straight, fluttering faster, always streaming the way the wind blows. The cloth
// is bent in its vertex shader (one material for all of them; each flutters out of step).
import * as THREE from 'three';
import { seeded } from '../core/run.js';

const L = 1.9, H = 0.55, POLE = 6.5;
const MAX = 3, APART = 45;

function stripes() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#e8e2d4' : '#a3231c'; g.fillRect(i * 32, 0, 32, 16); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Flags {
  constructor({ scene, world, seed = 1 }) {
    this.world = world;
    this.list = [];
    this.uniforms = { uTime: { value: 0 }, uSpeed: { value: 0 } };
    const cloth = new THREE.MeshLambertMaterial({ map: stripes(), side: THREE.DoubleSide });
    cloth.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = 'uniform float uTime;\nuniform float uSpeed;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        float u = clamp(position.x / ${L.toFixed(2)}, 0.0, 1.0);
        float y0 = -${(H / 2).toFixed(3)} + (position.y + ${(H / 2).toFixed(3)}) * (1.0 - 0.8 * u);   // the pennant tapers
        float ext = clamp(uSpeed / 7.0, 0.12, 1.0);                       // how far it stands out
        float th = (1.0 - ext) * 1.35;                                     // the rest of the way it droops
        float ph = modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.21;
        float wave = sin(u * 7.0 - uTime * (3.5 + uSpeed * 1.3) + ph) * 0.14 * u * (0.35 + ext)
                   + sin(u * 15.0 - uTime * (6.0 + uSpeed) + ph * 1.7) * 0.035 * u;
        vec3 transformed = vec3(position.x * cos(th) + y0 * sin(th), -position.x * sin(th) + y0 * cos(th), wave);`);
    };
    cloth.customProgramCacheKey = () => 'pennant';
    const steel = new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.5, metalness: 0.7 });
    const poleGeo = new THREE.CylinderGeometry(0.035, 0.05, POLE, 8).translate(0, POLE / 2, 0);
    const clothGeo = new THREE.PlaneGeometry(L, H, 18, 3).translate(L / 2, -H / 2, 0);
    const knob = new THREE.SphereGeometry(0.07, 8, 6);

    // By the guard posts on open ground, a few paces off, clear of walls, apart from each other.
    const rnd = seeded(seed ^ 0xf1a6);
    const posts = world.soldiers.filter(s => !s.range && Math.abs(s.root.position.y - world.groundAt(s.root.position.x, s.root.position.z)) < 0.5);
    for (let i = posts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [posts[i], posts[j]] = [posts[j], posts[i]]; }
    for (const s of posts) {
      if (this.list.length >= MAX) break;
      const at = this.spot(s.root.position, rnd);
      if (!at || this.list.some(f => f.at.distanceTo(at) < APART)) continue;
      const g = new THREE.Group();
      g.position.copy(at);
      const pole = new THREE.Mesh(poleGeo, steel); pole.castShadow = true; g.add(pole);
      const top = new THREE.Mesh(knob, steel); top.position.y = POLE + 0.05; g.add(top);
      const fly = new THREE.Group(); fly.position.y = POLE - 0.08; g.add(fly);
      const c = new THREE.Mesh(clothGeo, cloth); c.frustumCulled = false; c.userData.noSnow = true; fly.add(c);
      scene.add(g);
      world.boxes.push(new THREE.Box3(new THREE.Vector3(at.x - 0.06, at.y, at.z - 0.06), new THREE.Vector3(at.x + 0.06, at.y + POLE, at.z + 0.06)));
      this.list.push({ at, group: g, fly });
    }
  }

  // A spot 6–9 m from (x, z) on level open ground, out of any building or tree; null if none.
  spot(p, rnd) {
    const w = this.world;
    for (let k = 0; k < 10; k++) {
      const a = rnd() * Math.PI * 2, r = 6 + rnd() * 3;
      const q = new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
      q.y = w.groundAt(q.x, q.z);
      if (!Number.isFinite(q.y) || Math.abs(q.y - p.y) > 0.6) continue;
      const t = q.clone();
      w.collideCircle(t, 0.8, q.y, q.y + 6);
      if (t.distanceToSquared(q) > 1e-6) continue;                 // (something solid in the way)
      if (w.barrels?.list.some(b => b.at.distanceTo(q) < 2.5)) continue;
      return q;
    }
    return null;
  }

  tick(dt) {
    if (!this.list.length) return;
    const w = this.world.wind;
    this.uniforms.uTime.value += dt;
    this.uniforms.uSpeed.value = this.world.windSpeed ?? w.length();
    const yaw = Math.atan2(-w.z, w.x);                             // (the cloth's +x streams downwind)
    for (const f of this.list) f.fly.rotation.y = yaw;
  }
}
