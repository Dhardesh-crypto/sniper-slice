// A thunderstorm (a run's conditions: world/conditions.js 'storm'; the rain, dark sky and wind come
// from there and weather.js). Every so often lightning: the whole scene goes white for a moment in two
// or three strokes, a bolt shows when it's near enough to see, and now and then one comes down close
// by: a ground strike, its own white light on the spot, sparks, smoke, and a scorch left in the
// grass. The thunder follows a second for every 343 m, over a low rumble and the wind gusting.
//
// How it plays:
// - Thunder covers a shot. While a roll is overhead (STORM.mask seconds, the nearer the louder) your
//   shots are masked as under a plane (stealth/masking.js, via world.soundSources: the HUD names it).
//   The flash comes first, so you can count from it and fire on the thunder.
// - A flash shows you up. For its moment the guards see further (world.flashSight, in stealth.js),
//   as far as on a clear day; lie low when the sky goes white. It shows them to you as well.
// - Reduced flashes (Settings, settings.flashes): one soft glow a quarter as bright, no flicker, and
//   no strike nearer than a field away; the thunder and its cover are the same.
import * as THREE from 'three';
import { heightAt } from './terrain.js';

export const STORM = {
  every: [7, 18],       // s between strikes
  first: 4,             // s to the first (so you know what the sky's doing)
  closeShare: 0.3,      // of strikes within CLOSE m
  groundShare: 0.55,    // of close strikes that come down where you can see them hit
  flash: 1,             // how bright the flash lights the scene (×)
  reveal: 0.5,          // the guards see this much further at the flash's height (0.5: half again)
  mask: 2.8,            // s a close roll covers a shot (a far one less)
  rumble: 0.55,         // the rumble bed's level
};
const CLOSE = 420, SAFE = 45;   // m: a close strike; never nearer than this to you
const _v = new THREE.Vector3();
const FLASH_SKY = new THREE.Color(0xd8e0f4);

// The thunderhead: a dome inside the sky (the Sky shader only draws fair-weather clouds on blue), slate
// overhead, the haze's own colour at the horizon so the far hills fade into it, heavy masses drifting
// with the wind; a flash lights it from inside, brightest toward the strike. 1900 m: inside the sky's
// box (±2000 m), drawn just after it (renderOrder 1) without writing depth, so it shows only where
// nothing nearer was drawn, and the far hills (transparent, drawn later) still go over it.
const DOME_VERT = `varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DOME_FRAG = `uniform float uTime, uFlash; uniform vec3 uFlashDir, uLow, uHigh, uLit; uniform vec2 uWind;
varying vec3 vDir;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir); float h = d.y;
  vec2 uv = d.xz / (max(h, 0.0) + 0.12) * 1.3 + uWind * uTime;
  float n = fbm(uv * 1.4 + 0.3 * fbm(uv * 3.1 - uWind * uTime * 2.0));
  float cl = smoothstep(0.32, 0.78, n);
  vec3 col = mix(uLow, uHigh, smoothstep(0.0, 0.45, h)) * mix(0.62, 1.12, cl);
  float toward = pow(max(dot(d, uFlashDir), 0.0), 4.0);
  col += uLit * uFlash * (0.18 + 2.2 * toward) * (0.35 + 0.9 * cl);
  col = mix(col, uLow, smoothstep(0.02, -0.06, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// The bolt: a jagged path down from the cloud with a few forks (boltPaths), drawn as two crossed
// ribbons along each step so it reads from any side (ribbons): a white-hot core, and a wide faint glow
// round it; additive, unlit, past the fog.
function boltPaths(from, to) {
  const path = (a, b, steps, jag) => {
    const pts = [a.clone()];
    for (let i = 1; i < steps; i++) {
      const p = a.clone().lerp(b, i / steps);
      p.x += (Math.random() - 0.5) * jag; p.z += (Math.random() - 0.5) * jag; p.y += (Math.random() - 0.5) * jag * 0.3;
      pts.push(p);
    }
    pts.push(b.clone());
    return pts;
  };
  const len = from.distanceTo(to), main = path(from, to, 18, len * 0.09), out = [[main, 1]];
  for (let k = 0, n = 2 + Math.floor(Math.random() * 3); k < n; k++) {
    const a = main[2 + Math.floor(Math.random() * 11)];
    const end = a.clone().add(new THREE.Vector3((Math.random() - 0.5) * len * 0.35, -len * (0.12 + Math.random() * 0.2), (Math.random() - 0.5) * len * 0.35));
    out.push([path(a, end, 6, len * 0.05), 0.45]);
  }
  return out;
}

function ribbons(paths, width) {
  const pos = [], uv = [], idx = [];
  for (const [pts, k] of paths) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], w = width * k * (1 - 0.6 * i / pts.length);
      for (const [sx, sz] of [[w, 0], [0, w]]) {
        const n = pos.length / 3;
        pos.push(a.x - sx, a.y, a.z - sz, a.x + sx, a.y, a.z + sz, b.x + sx, b.y, b.z + sz, b.x - sx, b.y, b.z - sz);
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);   // (u across: the alpha map fades both edges)
        idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Across a ribbon: bright in the middle, nothing at the edges (so the glow is a haze, not a slab).
function edgeFade() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 1;
  const x = c.getContext('2d'), grd = x.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, '#000'); grd.addColorStop(0.5, '#fff'); grd.addColorStop(1, '#000');
  x.fillStyle = grd; x.fillRect(0, 0, 64, 1);
  return new THREE.CanvasTexture(c);
}

export class Storm {
  constructor({ scene, world, renderer, camera, audio, player, fx, explosions, settings }) {
    Object.assign(this, { scene, world, renderer, camera, audio, player, fx, explosions, settings });
    this.time = 0;
    this.next = STORM.first;
    this.pulses = [];          // the flash: strokes { t0, peak, rise, fall }
    this.thunders = [];        // rolls on their way: { at, d, ground }
    this.maskK = 0; this.maskLeft = 0;
    this.expAdd = 0; this.fogBase = null;
    // The flash's light: the sky going white over everything, and a key from the strike's side.
    this.sky = new THREE.HemisphereLight(0xdfe7ff, 0x4a505c, 0);
    this.key = new THREE.DirectionalLight(0xe8eeff, 0);
    scene.add(this.sky, this.key, this.key.target);
    // A ground strike's own light on the spot.
    this.spot = new THREE.PointLight(0xe8eeff, 0, 90, 1.6);
    scene.add(this.spot);
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.5, 3), alphaMap: edgeFade(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
    this.glowMat = this.boltMat.clone(); this.glowMat.color = new THREE.Color(0.35, 0.42, 0.75);
    this.bolt = new THREE.Group();
    this.core = new THREE.Mesh(new THREE.BufferGeometry(), this.boltMat);
    this.glow = new THREE.Mesh(new THREE.BufferGeometry(), this.glowMat);
    for (const m of [this.core, this.glow]) { m.frustumCulled = false; m.userData.noAO = true; m.userData.noSnow = true; this.bolt.add(m); }
    this.bolt.visible = false;
    scene.add(this.bolt);
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1900, 48, 24), new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(0, 1, 0) }, uWind: { value: new THREE.Vector2() },
        uLow: { value: new THREE.Color() }, uHigh: { value: new THREE.Color(0x30363e) }, uLit: { value: new THREE.Color(0.75, 0.8, 1) } } }));
    this.dome.renderOrder = 1;
    this.dome.frustumCulled = false;
    this.dome.userData.noAO = true; this.dome.userData.noSnow = true;
    scene.add(this.dome);
    // Its thunder covers your shots while it rolls (stealth/masking.js reads soundSources).
    (world.soundSources ??= []).push({ name: 'thunder', at: () => this.maskK });
    world.flashSight = 0;
  }

  get reduced() { return this.settings?.flashes === 'reduced'; }

  // One strike, `d` m off (a random distance when not given); `ground`: make it a ground strike if
  // it's close enough to see hit; `a`: its bearing (dev panel: "Strike near", in front of the camera).
  strike(d = null, ground = null, a = Math.random() * Math.PI * 2) {
    const close = d != null ? d < CLOSE : Math.random() < STORM.closeShare;
    d ??= close ? SAFE + Math.random() * (CLOSE - SAFE) : CLOSE + Math.random() * 3600;
    if (this.reduced) d = Math.max(d, 160);          // (no strike right on top of you with reduced flashes)
    const p = this.player.pos;
    const at = new THREE.Vector3(p.x + Math.cos(a) * d, 0, p.z + Math.sin(a) * d);
    at.y = d < 1500 ? heightAt(at.x, at.z) : p.y;
    ground ??= close && Math.random() < STORM.groundShare;
    ground = ground && d < CLOSE;
    // The flash: brighter the nearer, two to four strokes in half a second (one soft glow when reduced).
    const k = STORM.flash * (d < CLOSE ? 1 : THREE.MathUtils.clamp(1.25 - d / 3200, 0.2, 0.9));
    if (this.reduced) this.pulses.push({ t0: this.time, peak: 0.25 * k, rise: 0.15, fall: 0.6 });
    else for (let i = 0, n = 2 + Math.floor(Math.random() * 3), t = 0; i < n; i++, t += 0.06 + Math.random() * 0.12)
      this.pulses.push({ t0: this.time + t, peak: k * (i === 0 ? 1 : 0.5 + Math.random() * 0.5), rise: 0.015, fall: 0.08 + Math.random() * 0.06 });
    this.key.position.set(at.x, at.y + 400, at.z); this.key.target.position.copy(p);
    this.dome.material.uniforms.uFlashDir.value.set(at.x - p.x, Math.min(900, d) * 0.35 + 150, at.z - p.z).normalize();
    this.key.target.updateMatrixWorld();
    // The bolt, when it's near enough to see: from the cloud base down to the ground.
    if (d < 2600) {
      const top = at.clone(); top.y += 260 + Math.random() * 180; top.x += (Math.random() - 0.5) * 120; top.z += (Math.random() - 0.5) * 120;
      const paths = boltPaths(top, at), w = Math.max(1, d * 0.006);
      this.core.geometry.dispose(); this.core.geometry = ribbons(paths, w);
      this.glow.geometry.dispose(); this.glow.geometry = ribbons(paths, w * 5);
      this.boltT = { t0: this.time, life: this.reduced ? 0.6 : 0.35 + Math.random() * 0.2 };
      this.bolt.visible = true;
    }
    if (ground) this.groundStrike(at, d);
    this.thunders.push({ at: this.time + d / 343, d, ground });
    return { at, d, ground };
  }

  // A bolt into the ground near you: white light on the spot, sparks and smoke, the grass scorched.
  // A man close by ducks; right next to it he's knocked off his feet.
  groundStrike(at, d) {
    this.spot.position.copy(at).y += 3;
    this.spotT = 0;
    this.fx.emit(at, _v.set(0, 1, 0), { color: 0xfff1c4, count: 18, speed: 7, size: 0.07, life: 0.7, grow: 1, gravity: 9, glow: true });
    this.fx.emit(at, _v.set(0, 1, 0), { color: 0xfff8e0, count: 6, speed: 3, size: 0.25, life: 0.25, grow: 2, gravity: 0, glow: true });
    this.fx.emit(at, _v.set(0, 1, 0), { color: 0x5e5c58, count: 5, speed: 1.1, size: 1.4, life: 4, grow: 3, gravity: -0.35 });
    this.explosions?.scorch(at.clone().setY(at.y + 0.27), 0.65);   // (scorch() sinks it 0.3 m: on the ground at 0.03 above)
    for (const s of this.world.soldiers) {
      if (!s.alive || s.range || s.riding) continue;
      const r = Math.hypot(s.root.position.x - at.x, s.root.position.z - at.z);
      if (r < 4) s.blastStun?.(_v.set(s.root.position.x - at.x, 0, s.root.position.z - at.z).normalize().clone(), 0.6);
      else if (r < 14) s.nearMiss?.();
    }
    this.lastGround = { at: at.clone(), d, t: this.time };
  }

  tick(dt) {
    this.time += dt;
    if ((this.next -= dt) <= 0) { this.next = STORM.every[0] + Math.random() * (STORM.every[1] - STORM.every[0]); this.strike(); }
    // The flash: each stroke up in its rise, down in its fall.
    let f = 0;
    for (const s of this.pulses) {
      const t = this.time - s.t0;
      if (t < 0) continue;
      f = Math.max(f, s.peak * (t < s.rise ? t / s.rise : Math.exp(-(t - s.rise) / s.fall)));
    }
    this.pulses = this.pulses.filter(s => this.time - s.t0 < s.rise + s.fall * 7);
    this.flash = f;
    this.sky.intensity = 3.2 * f;
    this.key.intensity = 4 * f;
    // The exposure lifted with it (added and taken off again: whatever else sets it stays as it was),
    // and the haze goes white.
    const r = this.renderer, add = 0.45 * f;
    r.toneMappingExposure += add - this.expAdd; this.expAdd = add;
    const fog = this.scene.fog;
    if (fog) {
      if (f > 0.002 && !this.fogBase) this.fogBase = fog.color.clone();
      if (this.fogBase) {
        fog.color.copy(this.fogBase).lerp(FLASH_SKY, Math.min(0.7, 0.6 * f));
        if (f <= 0.002) { fog.color.copy(this.fogBase); this.fogBase = null; }
      }
    }
    this.world.flashSight = STORM.reveal * Math.min(1, f / 0.6);
    const du = this.dome.material.uniforms, w = this.world.wind;
    this.dome.position.copy(this.camera.position);
    du.uTime.value = this.time; du.uFlash.value = f;
    if (w) du.uWind.value.set(w.x, w.z).multiplyScalar(0.0025);
    if (fog) du.uLow.value.copy(this.fogBase ?? fog.color);   // (the haze's colour before the flash whitened it: the dome brightens on its own)
    if (this.bolt.visible) {
      const t = this.time - this.boltT.t0, life = this.boltT.life;
      this.boltMat.opacity = t > life ? 0 : (this.reduced ? 0.35 * Math.sin(Math.PI * t / life) : (0.55 + 0.45 * Math.random()) * (1 - t / life));
      this.glowMat.opacity = this.boltMat.opacity * 0.5;
      if (t > life) this.bolt.visible = false;
    }
    if (this.spotT != null) {
      this.spotT += dt;
      this.spot.intensity = (this.reduced ? 0.25 : 1) * 1500 * Math.exp(-this.spotT / 0.06);
      if (this.spotT > 0.6) { this.spot.intensity = 0; this.spotT = null; }
    }
    // The thunder when it gets here; while it rolls, your shots are covered.
    for (const th of this.thunders) {
      if (this.time < th.at) continue;
      th.done = true;
      this.audio.thunder?.(th.d, th.ground);
      const k = th.d < 1200 ? 1 : th.d < 2600 ? 0.75 : 0.45;   // (a far roll covers a shot only partly)
      if (k >= this.maskK || this.maskLeft <= 0) { this.maskK = k; this.maskLeft = STORM.mask * (th.d < 1200 ? 1 : 0.7); }
    }
    this.thunders = this.thunders.filter(th => !th.done);
    if (this.maskLeft > 0 && (this.maskLeft -= dt) <= 0) this.maskK = 0;
    this.audio.setStorm?.(STORM.rumble);
  }
}
