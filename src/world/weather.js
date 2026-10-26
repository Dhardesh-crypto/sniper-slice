// Weather, per mission (the map's `weather`): rain (streaks falling round you, its hiss, and it
// covers a little of your noise), low ground mist drifting at dawn, and sea spray thrown up where
// the waves meet the shore.
import * as THREE from 'three';
import { heightAt, activeMap } from './terrain.js';

const RAIN_DROPS = 2200;
const RAIN_BOX = { x: 44, y: 26, z: 44 };   // m round the camera
const MIST_PUFFS = 46;
const MIST_REACH = 170;                     // m: puffs further off than this drift back in front of you

function softCloud() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 64 + (Math.random() - 0.5) * 60, y = 64 + (Math.random() - 0.5) * 26, r = 20 + Math.random() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

export class Weather {
  constructor({ scene, camera, fx, audio, player, world }) {
    Object.assign(this, { scene, camera, fx, audio, player, world });
    const w = activeMap().weather ?? {};
    this.kind = w;
    if (w.rain) this.makeRain(w.rain);
    if (w.mist) this.makeMist(w.mist);
    this.sprayT = 0;
  }

  // ---- rain: thin streaks in a box that follows the camera ----
  makeRain(level) {
    this.rainLevel = level;
    const pos = new Float32Array(RAIN_DROPS * 6);
    this.drops = new Float32Array(RAIN_DROPS * 3);
    for (let i = 0; i < RAIN_DROPS; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * RAIN_BOX.x;
      this.drops[i * 3 + 1] = Math.random() * RAIN_BOX.y;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xb4bec8, transparent: true, opacity: 0.45 * level, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.userData.noAO = true;
    this.scene.add(this.rain);
    // It drums on everything: you're a little harder to hear.
    (this.world.soundSources ??= []).push({ name: 'rain', at: () => 0.3 * level });
  }

  tickRain(dt) {
    const c = this.camera.position, pos = this.rain.geometry.attributes.position.array, d = this.drops;
    const wind = this.world.wind ?? new THREE.Vector3(), fall = 9 * dt, len = 0.8;
    const sx = (wind.x * 0.35) * dt, sz = (wind.z * 0.35) * dt, lx = wind.x * 0.03, lz = wind.z * 0.03;
    for (let i = 0; i < RAIN_DROPS; i++) {
      const k = i * 3;
      d[k] += sx; d[k + 1] -= fall; d[k + 2] += sz;
      if (d[k + 1] < 0) { d[k + 1] += RAIN_BOX.y; d[k] = (Math.random() - 0.5) * RAIN_BOX.x; d[k + 2] = (Math.random() - 0.5) * RAIN_BOX.z; }
      const x = c.x + d[k], y = c.y - RAIN_BOX.y * 0.4 + d[k + 1], z = c.z + d[k + 2];
      pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x - lx; pos[i * 6 + 4] = y + len; pos[i * 6 + 5] = z - lz;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.audio.setRain?.(this.rainLevel);
  }

  // ---- mist: big soft clouds lying low over the ground, drifting with the wind ----
  makeMist(level) {
    const tex = softCloud();
    this.mist = [];
    for (let i = 0; i < MIST_PUFFS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xe6e9ec, transparent: true, opacity: 0.55 * level, depthWrite: false, fog: true }));
      s.userData.noAO = true;
      s.scale.set(34 + Math.random() * 26, 9 + Math.random() * 5, 1);
      this.place(s, true);
      this.scene.add(s);
      this.mist.push(s);
    }
  }

  // Somewhere round you (anywhere at first; later out ahead, up the wind), low over the ground.
  place(s, anywhere) {
    const p = this.player.pos, a = Math.random() * Math.PI * 2, r = anywhere ? 15 + Math.random() * MIST_REACH : MIST_REACH * (0.8 + Math.random() * 0.2);
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    s.position.set(x, heightAt(x, z) + 2 + Math.random() * 2.5, z);
  }

  tickMist(dt) {
    const wind = this.world.wind ?? new THREE.Vector3(), p = this.player.pos;
    for (const s of this.mist) {
      s.position.x += wind.x * 0.25 * dt;
      s.position.z += wind.z * 0.25 * dt;
      s.position.y += (heightAt(s.position.x, s.position.z) + 3 - s.position.y) * Math.min(1, dt * 0.5);
      if (Math.hypot(s.position.x - p.x, s.position.z - p.z) > MIST_REACH * 1.05) this.place(s, false);
    }
  }

  // ---- spray: white water thrown up where the waves break on the shore near you ----
  tickSpray(dt) {
    const water = this.world.waterLevel;
    if (water == null || (this.sprayT -= dt) > 0) return;
    this.sprayT = 0.25;
    const p = this.player.pos;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = 15 + Math.random() * 160;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, h = heightAt(x, z);
      if (Math.abs(h - water) > 0.35) continue;
      const at = new THREE.Vector3(x, water + 0.2, z);
      this.fx.emit(at, new THREE.Vector3(0, 1, 0), { color: 0xf3f6f7, count: 3, speed: 2.6, size: 0.9 + r / 120, life: 1.8, grow: 3, gravity: -1.5 });
      return;
    }
  }

  tick(dt) {
    if (this.rain) this.tickRain(dt);
    if (this.mist) this.tickMist(dt);
    if (this.kind.spray) this.tickSpray(dt);
  }
}
