// Distant hills beyond the playable valley: three rings of ridgelines, each further
// away, taller and more washed into the sky haze (aerial perspective), so the world
// reads as a landscape that goes on rather than a walled box.
import * as THREE from 'three';
import { fbm } from './noise.js';

const LAYERS = [
  { radius: 900, base: 10, height: 110, color: 0x6f8361, top: 0x86977a, seed: 1 },
  { radius: 1500, base: 30, height: 220, color: 0x8698a0, top: 0x99a9b0, seed: 2 },
  { radius: 2300, base: 60, height: 380, color: 0xa3b3bd, top: 0xb4c2ca, seed: 3 },
];

function ring({ radius, base, height, color, top, seed }) {
  const SEG = 360;
  const positions = [], colors = [];
  const lo = new THREE.Color(color), hi = new THREE.Color(top), c = new THREE.Color();
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    // Ridgeline: broad swells plus finer peaks, wrapping seamlessly around the circle.
    const u = Math.cos(a) * 3 + seed * 10, v = Math.sin(a) * 3 - seed * 7;
    const h = base + height * (0.35 + 0.65 * fbm(u, v, 5));
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    positions.push(x, -60, z, x, h, z);
    c.copy(lo);
    colors.push(c.r, c.g, c.b);
    c.copy(lo).lerp(hi, 0.8);
    colors.push(c.r, c.g, c.b);
  }
  const index = [];
  for (let i = 0; i < SEG; i++) {
    const k = i * 2;
    index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  m.userData.noAO = true;
  m.frustumCulled = false;
  return m;
}

export function buildHorizon(scene) {
  const group = new THREE.Group();
  // Farthest first, so nearer ridges are drawn over them.
  for (const L of [...LAYERS].reverse()) {
    const m = ring(L);
    m.renderOrder = -10 + LAYERS.indexOf(L);
    group.add(m);
  }
  scene.add(group);
  return group;
}
