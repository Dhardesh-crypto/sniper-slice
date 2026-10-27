// Flashlights, at dusk (map.dusk: conditions.js). Every guard on his feet carries a torch clipped to
// his tunic, as the Wehrmacht did, lit and pointing where he faces, a little down at the ground in
// front of him; wary, he takes it in his hand and sweeps it about whatever he's looking for. A
// bright point you see from far off and a faint cone in the haze. The nearest few light the ground
// for real (a small pool of spotlights handed round, so the shaders never change); the rest show
// only the lamp and the cone. Caught in a guard's beam you are lit up: he makes you out fast, and
// tall grass doesn't hide you from him (stealth.js asks `inBeam`). A dead or downed man's torch
// goes out; so does a gunner's (both hands on the gun) and a man riding in a vehicle (the
// vehicle's lamps are blacked out).
import * as THREE from 'three';
import { activeMap } from './terrain.js';

const REACH = 16, ANGLE = 0.26;          // m the beam shows; its half-angle (rad)
const DIP = 0.2;                         // rad down from level, walking about
const LIT = 3;                           // real spotlights, given to the nearest torches
const NEAR = 140;                        // m: farther than this, no real light

export class Flashlights {
  constructor({ scene, world, player }) {
    Object.assign(this, { scene, world, player });
    this.torches = [];
    this.lights = [];
    if (!activeMap().dusk) return;
    const geo = new THREE.ConeGeometry(Math.tan(ANGLE) * REACH, REACH, 16, 1, true);
    geo.translate(0, -REACH / 2, 0);
    const pos = geo.attributes.position, fade = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) fade[i] = 1 - Math.min(1, -pos.getY(i) / REACH);
    geo.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0xffeccb) }, strength: { value: 0.07 } },
      vertexShader: 'attribute float fade; varying float vF; void main() { vF = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float strength; varying float vF; void main() { gl_FragColor = vec4(color * strength * vF * vF, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.geo = geo; this.mat = mat;
    this.glass = new THREE.SphereGeometry(0.035, 8, 6);
    this.bulb = new THREE.MeshBasicMaterial({ color: 0xfff1c8 });
    this.armed = new Set();
    for (let i = 0; i < LIT; i++) {
      const spot = new THREE.SpotLight(0xffe6c0, 0, REACH * 1.6, ANGLE * 1.15, 0.5, 1.4);
      spot.castShadow = false;
      scene.add(spot, spot.target);
      this.lights.push(spot);
    }
    this.handT = 0;
  }

  // A torch for a man who hasn't one (the guards at the start, and any who come later: the patrol, the reinforcements).
  arm(s) {
    this.armed.add(s);
    if (s.stance === 'officer' || s.range) return;            // (the officers keep indoors; the range's dummies aren't men)
    const beam = new THREE.Mesh(this.geo, this.mat);
    beam.frustumCulled = false;
    beam.userData.noAO = true;
    const lamp = new THREE.Mesh(this.glass, this.bulb);
    lamp.userData.noAO = true;
    this.scene.add(beam, lamp);
    const torch = { s, beam, lamp, at: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), on: true, light: null };
    this.torches.push(torch);
    s.torch = torch;
  }

  tick(dt) {
    if (!this.lights.length) return;
    if (this.armed.size !== this.world.soldiers.length) for (const s of this.world.soldiers) if (!this.armed.has(s)) this.arm(s);
    const fwd = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const t of this.torches) {
      const s = t.s;
      t.on = s.alive && !s.riding && !s.manning && !s.downed;
      t.beam.visible = t.lamp.visible = t.on;
      if (!t.on) { if (t.light) t.light.intensity = 0; continue; }
      // On his chest, a hand's breadth out in front; swinging a little with his stride.
      const chest = s.char.bones.Spine02;
      if (chest) chest.getWorldPosition(t.at); else s.bodyPosition(t.at);
      fwd.set(0, 0, 1).applyQuaternion(s.root.quaternion);
      t.at.addScaledVector(fwd, 0.17).y += 0.04;
      if (s.aimDir) fwd.copy(s.aimDir);
      else if (s.aware && s.aware.state !== 'calm') {
        // Wary: he takes it in his hand and sweeps it to and fro, about whatever he's looking for.
        const st = s.aware.stimulus;
        let dip = 0.12;
        if (st) {
          const to = _st.copy(st).sub(t.at), dd = Math.hypot(to.x, to.z);
          if (dd > 1.5 && dd < REACH * 2.5) { fwd.set(to.x, 0, to.z).normalize(); dip = THREE.MathUtils.clamp(Math.atan2(t.at.y - st.y - 0.3, dd), 0.03, 0.6); }
        }
        fwd.applyAxisAngle(up, 0.55 * Math.sin(this.world.time * 1.9 + s.root.id)).normalize();
        fwd.y = -Math.tan(dip);
      } else {
        const sway = s.gait === 'stand' ? 0 : 0.05 * Math.sin(this.world.time * 5.5 + s.root.id);
        fwd.applyAxisAngle(up, sway).normalize();
        fwd.y = -Math.tan(DIP);
      }
      t.dir.lerp(fwd.normalize(), Math.min(1, dt * 6)).normalize();
      t.lamp.position.copy(t.at);
      t.beam.position.copy(t.at);
      t.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), t.dir);
    }
    // The real light goes to the torches nearest you, re-dealt a few times a second.
    if ((this.handT -= dt) <= 0) {
      this.handT = 0.25;
      const me = this.player.pos;
      const near = this.torches.filter(t => t.on && t.at.distanceTo(me) < NEAR).sort((a, b) => a.at.distanceToSquared(me) - b.at.distanceToSquared(me)).slice(0, LIT);
      for (const t of this.torches) t.light = null;
      near.forEach((t, i) => { t.light = this.lights[i]; });
      this.lights.forEach((l, i) => { l.intensity = i < near.length ? 40 : 0; });
    }
    for (const t of this.torches) {
      if (!t.light || !t.on) continue;
      t.light.position.copy(t.at);
      t.light.target.position.copy(t.at).addScaledVector(t.dir, 8);
      t.light.target.updateMatrixWorld();
    }
  }
}

// Is `p` in this torch's beam (lit, near enough, inside the cone)? The line of sight is the caller's.
const _to = new THREE.Vector3(), _st = new THREE.Vector3();
export function inBeam(torch, p) {
  if (!torch?.on) return false;
  _to.copy(p).sub(torch.at);
  const d = _to.length();
  return d < REACH * 1.1 && d > 0.1 && _to.angleTo(torch.dir) < ANGLE * 1.2;
}
