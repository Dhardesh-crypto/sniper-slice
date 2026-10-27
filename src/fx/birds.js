// Birds put up by a gunshot or a blast: from the trees nearest it a few small flocks burst out,
// wings beating hard, climb away from the noise and are gone over the hills. Each tree gives up
// its birds once (they don't come back to a place that's being shot up). One instanced mesh of
// little dark shapes, the wings flapping in the vertex shader; a flurry of wingbeats and alarm calls.
import * as THREE from 'three';

const N = 96;                    // birds in the air at once, at most
const REACH = 70;                // m from the noise: trees farther off keep their birds
const LIFE = 9;                  // s before a bird is gone over the horizon

function birdGeometry() {
  // A body and two wings, spanning ±1 in x (the wingtips), nose toward -z; scaled per bird.
  const v = [
    0, 0, -0.35, -1, 0.05, 0.1, 0, 0, 0.25,      // left wing
    0, 0, -0.35, 0, 0, 0.25, 1, 0.05, 0.1,       // right wing
    0, 0, -0.45, -0.12, 0, 0.3, 0.12, 0, 0.3,    // body and tail
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class Birds {
  constructor({ scene, world, audio, player }) {
    Object.assign(this, { world, audio, player });
    const geo = birdGeometry();
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    geo.setAttribute('phase', this.phase);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1c1a18, side: THREE.DoubleSide, fog: true });
    this.time = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.time;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float phase;\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  float flap = sin(phase);\n  transformed.y += abs(transformed.x) * flap * 0.9;\n  transformed.x *= 1.0 - 0.25 * abs(flap);');
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, N);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.birds = [];
    this.spent = new Set();      // trees that have given up their birds
    this.next = 0;
  }

  // A loud noise at `at`: `loud` scales how far it carries (1: a rifle shot).
  flush(at, loud = 1) {
    const reach = REACH * loud, near = [];
    for (const t of this.world.trees ?? []) {
      if (this.spent.has(t)) continue;
      const d = Math.hypot(t.x - at.x, t.z - at.z);
      if (d < reach) near.push([t, d]);
    }
    near.sort((a, b) => a[1] - b[1]);
    let flushed = 0;
    for (const [t] of near.slice(0, 3)) {
      if (Math.random() < 0.35) { this.spent.add(t); continue; }   // (not every tree had birds in it)
      this.spent.add(t);
      const ground = this.world.groundAt(t.x, t.z), n = 3 + Math.floor(Math.random() * 6);
      const away = new THREE.Vector3(t.x - at.x, 0, t.z - at.z);
      if (away.lengthSq() < 1) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      away.normalize();
      for (let i = 0; i < n; i++) {
        const dir = away.clone().applyAxisAngle(UP, (Math.random() - 0.5) * 1.4);
        this.birds[this.next] = {
          pos: new THREE.Vector3(t.x + (Math.random() - 0.5) * 3, ground + 5 + Math.random() * 5, t.z + (Math.random() - 0.5) * 3),
          vel: dir.multiplyScalar(7 + Math.random() * 5).setY(3 + Math.random() * 3),
          t: -Math.random() * 0.4,                    // (not all in the same instant)
          flap: 22 + Math.random() * 8, phase: Math.random() * 6.3, size: 0.16 + Math.random() * 0.08,
        };
        this.next = (this.next + 1) % N;
        flushed++;
      }
    }
    if (flushed && this.audio) this.audio.birdFlush?.(this.player.pos.distanceTo(at), flushed);
  }

  tick(dt) {
    this.time.value += dt;
    let n = 0;
    for (let i = 0; i < N; i++) {
      const b = this.birds[i];
      if (!b) continue;
      b.t += dt;
      if (b.t < 0) continue;
      if (b.t > LIFE) { this.birds[i] = null; continue; }
      // Climbing hard at first, beating fast; then levelling off, now and then a glide.
      b.vel.y += (0.6 - b.vel.y) * Math.min(1, dt * 0.8);
      b.pos.addScaledVector(b.vel, dt);
      const gliding = b.t > 2.5 && Math.sin(b.t * 1.7 + b.phase) > 0.6;
      b.phase += dt * (gliding ? 0 : b.flap * (b.t < 1.5 ? 1 : 0.7));
      _m.lookAt(_o.copy(b.pos), _o2.copy(b.pos).add(b.vel), UP);
      _q.setFromRotationMatrix(_m);
      _mat.compose(b.pos, _q, _s.setScalar(b.size));
      this.mesh.setMatrixAt(n, _mat);
      this.phase.array[n] = gliding ? 0.25 : b.phase;
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.phase.needsUpdate = true;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _mat = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _o = new THREE.Vector3(), _o2 = new THREE.Vector3();
