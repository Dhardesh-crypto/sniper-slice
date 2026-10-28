// Scope glint. With the sun ahead of you, the front lens of your scope throws a flash of sunlight
// back down the line you're looking along: a guard close to that line who happens to be facing
// your way sees a wink of light on the hillside, from much further off than he'd make you out,
// and through grass. Worst with a low sun in front; nothing on an overcast day, in mist or at
// dusk's end. It works the other way too: an enemy sniper or a lookout with field glasses looking
// your way, with the sun behind you, shows a wink of light, the one thing that gives a good one away.
import * as THREE from 'three';
import { activeMap } from '../world/terrain.js';

const smooth = THREE.MathUtils.smoothstep;
const MARKSMEN = /sniper|spotter|lookout/i;            // (a scope, or field glasses)

function flareTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.15, 'rgba(255,246,220,0.9)'); r.addColorStop(0.5, 'rgba(255,230,180,0.15)'); r.addColorStop(1, 'rgba(255,230,180,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,250,235,0.7)';                          // the four-pointed star
  g.fillRect(2, 31, 60, 2); g.fillRect(31, 2, 2, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Glint {
  constructor({ scene, world, player, arsenal, camera }) {
    Object.assign(this, { world, player, arsenal, camera });
    this.view = new THREE.Vector3();
    this.lens = 0;               // 0–1: how much sun your lens is catching now
    // How strong the sun is: none under cloud, little in mist, most with a low sun.
    const L = activeMap().light ?? {}, w = activeMap().weather ?? {};
    this.daylight = (L.clouds ?? 0) > 0.9 ? 0 : w.mist ? 0.3 : 1;
    this.flares = new Map();     // marksman → sprite
    this.tex = this.daylight ? flareTexture() : null;
    this.scene = scene;
  }

  tick(dt) {
    const sun = this.world.sunDir;
    this.lens = 0;
    if (!this.daylight || !sun) return;
    this.camera.getWorldDirection(this.view);
    if (this.arsenal.scoped) this.lens = this.daylight * smooth(this.view.dot(sun), 0.15, 0.75);
    this.marksmen(dt, sun);
  }

  // How much of your glint a man with his eyes at `eye` sees (0–1): he must be near the line
  // you're looking along.
  toward(eye) {
    if (this.lens <= 0) return 0;
    const to = eye.clone().sub(this.camera.position).normalize();
    return this.lens * smooth(to.dot(this.view), 0.985, 0.998);
  }

  // Enemy marksmen looking your way with the sun at your back: a wink at the scope.
  marksmen(dt, sun) {
    this.t = (this.t ?? 0) + dt;
    for (const s of this.world.soldiers) {
      if (!MARKSMEN.test(s.name)) continue;
      let f = this.flares.get(s);
      if (!f) {
        f = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false, toneMapped: false, fog: false }));
        f.userData.noSnow = true;
        f.phase = Math.random() * 6;
        this.scene.add(f);
        this.flares.set(s, f);
      }
      const head = s.headPosition(new THREE.Vector3());
      const to = this.camera.position.clone().sub(head), d = to.length();
      to.normalize();
      const facing = new THREE.Vector3(Math.sin(s.root.rotation.y), 0, Math.cos(s.root.rotation.y));
      const looking = smooth(facing.dot(new THREE.Vector3(to.x, 0, to.z).normalize()), 0.93, 0.99);
      const k = s.alive && !s.downed && d > 25 ? this.daylight * looking * smooth(to.dot(sun), 0.05, 0.5) : 0;
      // (his rifle sways: the wink comes and goes)
      const wink = k * (0.55 + 0.45 * Math.sin(this.t * 1.7 + f.phase) * Math.sin(this.t * 0.63 + f.phase * 2));
      f.visible = wink > 0.05;
      if (!f.visible) continue;
      f.position.copy(head).addScaledVector(to, 0.35).addScaledVector(facing, 0.1);
      f.material.opacity = Math.min(1, wink * 1.3);
      f.scale.setScalar(0.02 + 0.05 * wink);
    }
  }
}
