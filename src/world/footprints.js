// Boot prints in the snow (winter only). Everyone on foot leaves them, you and the guards: a
// left and a right print each stride, dented into the snow, sharp and dark when fresh and filling
// in as they age (sooner while it snows). Theirs show you where a patrol walks; yours give you
// away: a guard who comes on a fresh trail of yours grows wary and follows it, print by print,
// towards wherever it leads.
import * as THREE from 'three';
import { heightAt, activeMap } from './terrain.js';

const MAX = 5000;
const STRIDE = 0.75;             // m between prints (one foot, then the other)
const NOTICE = 1.8;              // m: a guard this close to a print of yours sees it
const AHEAD = 14;                // prints further along the trail he walks to next
const SNOW = new THREE.Color(0xe9edf3);

function soleTexture() {
  const c = document.createElement('canvas'); c.width = 32; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath(); g.ellipse(16, 20, 10, 15, 0, 0, Math.PI * 2); g.fill();     // the sole
  g.beginPath(); g.ellipse(16, 50, 8, 9, 0, 0, Math.PI * 2); g.fill();       // the heel
  g.globalCompositeOperation = 'destination-out';                            // hobnail rows
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 10; y < 34; y += 6) for (let x = 9; x < 25; x += 5) { g.beginPath(); g.arc(x, y, 1.2, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Footprints {
  constructor({ scene, world, player, stealth, hud }) {
    Object.assign(this, { world, player, stealth, hud });
    this.on = !!activeMap().winter;
    if (!this.on) return;
    // How long a print lasts: snow falling fills them in.
    const snow = activeMap().weather?.snow ?? 0;
    this.life = snow > 0 ? 220 - 150 * snow : 420;
    const mat = new THREE.MeshLambertMaterial({ map: soleTexture(), transparent: true, depthWrite: false, opacity: 0.8,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.userData.snowed = true;                                   // (winter.js: no snow on the prints themselves)
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.17, 0.36).rotateX(-Math.PI / 2), mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.userData.noAO = this.mesh.userData.noSnow = true;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    scene.add(this.mesh);
    this.born = new Float32Array(MAX);
    this.next = 0;
    this.time = 0;
    this.walkers = new Map();                                     // walker → { x, z, foot }
    this.trail = [];                                              // your prints: { x, z, t }, oldest first
    this.fadeT = 0; this.lookT = 0;
    this.found = false;
  }

  tick(dt) {
    if (!this.on) return;
    this.time += dt;
    const p = this.player;
    if (p.grounded && !p.climb && !p.dead && !p.locked) this.walk(p, p.pos, p.stance === 'prone' ? 0.24 : 0.14, true);
    for (const s of this.world.soldiers) {
      if (!s.alive || s.riding || s.manning || s.downed || s.takenDown) { this.walkers.delete(s); continue; }
      this.walk(s, s.root.position, 0.14, false);
    }
    // Old prints fill in: their colour drifts to the snow's, all at once now and then.
    if ((this.fadeT -= dt) <= 0) { this.fadeT = 1; this.fade(); }
    while (this.trail.length && this.time - this.trail[0].t > this.life) this.trail.shift();
    if ((this.lookT -= dt) <= 0) { this.lookT = 0.5; this.guardsLook(); }
  }

  walk(who, pos, spread, mine) {
    let w = this.walkers.get(who);
    if (!w) { this.walkers.set(who, { x: pos.x, z: pos.z, foot: 1 }); return; }
    const dx = pos.x - w.x, dz = pos.z - w.z, d = Math.hypot(dx, dz);
    if (d < STRIDE) return;
    w.x = pos.x; w.z = pos.z;
    if (d > 4) return;                                            // (a teleport: a tunnel, a load)
    const y = heightAt(pos.x, pos.z);
    if (pos.y - y > 0.35) return;                                 // on a floor, a deck, a roof: no snow
    w.foot = -w.foot;
    const yaw = Math.atan2(dx, dz), x = pos.x + Math.cos(yaw) * spread * w.foot, z = pos.z - Math.sin(yaw) * spread * w.foot;
    this.stamp(x, z, yaw);
    if (mine) this.trail.push({ x, z, t: this.time });
  }

  stamp(x, z, yaw) {
    const e = 0.4, y = heightAt(x, z);
    const n = new THREE.Vector3(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI));   // (the sole's toe is drawn at the texture's top, which the laid-down plane points at −z)
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.02, z), q, new THREE.Vector3(1, 1, 1));
    const i = this.next;
    this.mesh.setMatrixAt(i, m);
    this.born[i] = this.time;
    this.mesh.setColorAt(i, this.shade(0));
    this.next = (i + 1) % MAX;
    this.mesh.count = Math.max(this.mesh.count, this.next === 0 ? MAX : this.next);
    this.mesh.instanceMatrix.needsUpdate = this.mesh.instanceColor.needsUpdate = true;
  }

  // Fresh: a blue-grey dent. Old: hardly darker than the snow round it.
  shade(age) {
    return (this._c ??= new THREE.Color()).setHex(0x4c5a72).lerp(SNOW, Math.min(1, age / this.life));
  }

  fade() {
    for (let i = 0; i < this.mesh.count; i++) this.mesh.setColorAt(i, this.shade(this.time - this.born[i]));
    this.mesh.instanceColor.needsUpdate = true;
  }

  // Guards on their rounds (or already wary) who come on your fresh trail follow it: walk a
  // stretch along it, and from there on to the next, until it ends or goes cold.
  guardsLook() {
    if (!this.trail.length) return;
    const T = this.trail;
    const nearest = (x, z) => { let best = Infinity, bi = -1; for (let i = T.length - 1; i >= 0; i--) { const d = Math.hypot(T[i].x - x, T[i].z - z); if (d < best) { best = d; bi = i; } } return [bi, best]; };
    for (const s of this.stealth.guards()) {
      const a = s.aware;
      if (!a || a.state === 'alerted' || s.officer || s.manning || s.riding || s.brain?.fixed) { s.trackAt = null; continue; }
      const at = s.root.position;
      if (s.trackAt && (a.state !== 'suspicious' || a.stimulus !== s.trackAt)) s.trackAt = null;   // (something else took his mind off it)
      let from;
      if (s.trackAt) {
        // Following: near the stretch's end, he looks for where it goes on.
        if (Math.hypot(s.trackAt.x - at.x, s.trackAt.z - at.z) > 4.5) continue;
        const [i, d] = nearest(s.trackAt.x, s.trackAt.z);
        if (i < 0 || d > 3 || i >= T.length - 1) { s.trackAt = null; continue; }   // (the trail ends, or has filled in)
        from = i;
      } else {
        const [i, d] = nearest(at.x, at.z);
        if (i < 0 || d > NOTICE) continue;
        // A calm man doesn't always look down. Old prints that have half filled in are easier to miss.
        const fresh = 1 - (this.time - T[i].t) / this.life;
        if (a.state === 'calm' && Math.random() > 0.5 * fresh) continue;
        from = i;
      }
      const ahead = T[Math.min(T.length - 1, from + AHEAD)];
      const to = new THREE.Vector3(ahead.x, heightAt(ahead.x, ahead.z), ahead.z);
      if (a.state === 'calm') {
        this.stealth.raise(s, 'suspicious', to, 'tracks');
        if (!this.found) { this.found = true; this.hud.message('A GUARD HAS FOUND YOUR TRACKS', 'wound'); }
      }
      a.stimulus = s.trackAt = to;
      a.lastNews = this.stealth.time;
      if (s.brain) { s.brain.lookT = 0; s.brain.path = null; }  // (on along the trail)
    }
  }
}
