// The sound of the sea, and the gulls over it (maps with a sea; not the river in the gorge).
// The shoreline is found once from the terrain; how far you are from it sets the waves: close by,
// the wash and break of each wave on the beach; up on the cliffs, a far soft roar from below.
// A handful of gulls soar in slow circles over the water near you, now and then a few lazy wingbeats,
// and one of them cries now and then (the nearer, the louder).
import * as THREE from 'three';
import { heightAt, MAP_HALF, activeMap } from './terrain.js';

const STEP = 4;                  // m between samples when finding the shore
const CELL = 32;                 // m: shore points bucketed for the nearest-point search
const GULLS = 8;
const CALLS = ['gull_1', 'gull_2', 'gull_3'];

function gullGeometry() {
  // Long, narrow, slightly bent wings (±1 in x at the tips), a body and a short tail; nose toward −z.
  const v = [
    0, 0, -0.18, -0.45, 0.08, -0.05, 0, 0, 0.12,  -0.45, 0.08, -0.05, -1, -0.04, 0.05, 0, 0, 0.12,   // left wing
    0, 0, -0.18, 0, 0, 0.12, 0.45, 0.08, -0.05,   0.45, 0.08, -0.05, 0, 0, 0.12, 1, -0.04, 0.05,    // right wing
    0, 0, -0.32, -0.07, 0, 0.3, 0.07, 0, 0.3,                                                       // body and tail
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class SeaShore {
  constructor({ scene, world, audio, player }) {
    Object.assign(this, { world, audio, player });
    const level = world.waterLevel;
    this.on = level != null && (activeMap().waterCalm ?? 1) >= 1;
    if (!this.on) return;
    // The shore: water samples with land beside them.
    this.cells = new Map();
    const half = MAP_HALF, wet = (x, z) => heightAt(x, z) < level;
    for (let z = -half; z <= half; z += STEP) for (let x = -half; x <= half; x += STEP) {
      if (!wet(x, z) || (wet(x + STEP, z) && wet(x - STEP, z) && wet(x, z + STEP) && wet(x, z - STEP))) continue;
      const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
      if (!this.cells.has(k)) this.cells.set(k, []);
      this.cells.get(k).push(x, z);
    }
    this.shoreT = 0; this.callT = 6; this.d = Infinity;
    // The gulls: one instanced mesh, pale grey, wings beating in the vertex shader.
    const geo = gullGeometry();
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(GULLS), 1);
    geo.setAttribute('phase', this.phase);
    const mat = new THREE.MeshLambertMaterial({ color: 0xe4e2dc, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float phase;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  float flap = sin(phase);\n  transformed.y += abs(transformed.x) * flap * 0.55;');
    };
    mat.userData.snowed = true;
    this.mesh = new THREE.InstancedMesh(geo, mat, GULLS);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.userData.noSnow = true;
    scene.add(this.mesh);
    this.gulls = Array.from({ length: GULLS }, (_, i) => ({ c: null, r: 20 + Math.random() * 30, a: Math.random() * 6.3, h: 14 + Math.random() * 26, w: (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.1), ph: Math.random() * 6, flapT: Math.random() * 5, pos: new THREE.Vector3() }));
  }

  // The nearest bit of shore to (x, z), searched ring by ring out to `max` m.
  nearestShore(x, z, max = 600) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = Infinity, bx = 0, bz = 0;
    for (let r = 0; r * CELL < max + CELL; r++) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const pts = this.cells.get(`${cx + i},${cz + j}`);
        if (!pts) continue;
        for (let k = 0; k < pts.length; k += 2) { const d = Math.hypot(pts[k] - x, pts[k + 1] - z); if (d < best) { best = d; bx = pts[k]; bz = pts[k + 1]; } }
      }
      if (best < (r - 1) * CELL) break;                         // (nothing nearer can be further out)
    }
    return { d: best, x: bx, z: bz };
  }

  tick(dt) {
    if (!this.on) return;
    const p = this.player.pos;
    if ((this.shoreT -= dt) <= 0) {
      this.shoreT = 0.3;
      const s = this.nearestShore(p.x, p.z);
      this.d = s.d; this.shore = s;
      // The waves: close, the break and the wash; higher up and further off, the far roar.
      const up = Math.max(0, p.y - this.world.waterLevel), d = Math.hypot(s.d, up * 0.8);
      this.audio.loopSample('seaNear', 'sea_waves', Math.pow(THREE.MathUtils.clamp(1 - d / 90, 0, 1), 1.4) * 0.85);
      this.audio.loopSample('seaFar', 'sea_distant', THREE.MathUtils.clamp(1 - d / 450, 0, 1) * 0.45, { dull: THREE.MathUtils.clamp(d / 500, 0, 0.6) });
    }
    this.tickGulls(dt);
  }

  tickGulls(dt) {
    const p = this.player.pos, level = this.world.waterLevel;
    let n = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(0.7, 0.7, 0.7);
    for (const g of this.gulls) {
      // Each circles over the water near the shore close to you; it drifts on to a new spot when you've moved off.
      if (!g.c || Math.hypot(g.c.x - p.x, g.c.z - p.z) > 260) {
        if (!this.shore || this.d > 400) { g.c = null; continue; }
        const a = Math.random() * 6.3, r = 30 + Math.random() * 120;
        const c = this.nearestShore(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
        if (!Number.isFinite(c.d)) continue;
        g.c = new THREE.Vector3(c.x, level, c.z);
      }
      g.a += g.w * dt;
      const prev = g.pos.clone();
      g.pos.set(g.c.x + Math.cos(g.a) * g.r, level + g.h + Math.sin(g.a * 2.3 + g.ph) * 2, g.c.z + Math.sin(g.a) * g.r);
      // Mostly soaring; a few lazy wingbeats now and then.
      if ((g.flapT -= dt) < 0) { g.ph += dt * 9; if (g.flapT < -1.2) g.flapT = 3 + Math.random() * 6; }
      const vel = g.pos.clone().sub(prev);
      if (vel.lengthSq() > 1e-8) {
        m.lookAt(g.pos, g.pos.clone().add(vel), new THREE.Vector3(0, 1, 0));
        q.setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.sign(g.w) * 0.35));   // (banked into the turn)
      }
      m.compose(g.pos, q, s);
      this.mesh.setMatrixAt(n, m);
      this.phase.array[n] = g.flapT < 0 ? g.ph : 0.35;
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.phase.needsUpdate = true;
    // A cry now and then from one of them.
    if (n && (this.callT -= dt) <= 0) {
      this.callT = 5 + Math.random() * 14;
      const g = this.gulls.filter(g => g.c)[Math.floor(Math.random() * n)];
      const d = g ? g.pos.distanceTo(p) : 999;
      if (d < 300) this.audio.sample(CALLS[Math.floor(Math.random() * CALLS.length)], { at: d / 343, gain: THREE.MathUtils.clamp(1.1 - d / 260, 0.08, 0.7), filter: d > 120 ? 3500 : null, wet: 0.3 });
    }
  }
}

