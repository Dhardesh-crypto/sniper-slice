// The country beyond the playable valley. Each mission has its own panorama, rendered in Blender
// (tools/blender/horizon.py): its region's hills, fields, woods, villages, sea or Alps out to 20 km,
// under the mission's sun and washed into its haze, as a 360° strip over latitudes LAT; the sky is
// left clear. It's wrapped round a cylinder that keeps centred on the camera, like the sky, so the
// far country never slides as you walk. Until it has loaded (or if a mission has none), three
// rings of drawn ridgelines stand in: each further away, taller and more washed into the haze.
import * as THREE from 'three';
import { activeMap } from './terrain.js';
import { fbm } from './noise.js';

const LAT = [-3, 16];          // degrees: the panorama's band (horizon.py's LAT_MIN, LAT_MAX)
const R = 2600;                // inside the camera's far plane (3000)

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

// The panorama's cylinder: u runs clockwise from south through north (u = 0.5) as horizon.py renders
// it; rows are spaced by latitude so the strip isn't stretched.
function panorama(tex, k) {
  const SEG = 256, ROWS = 19, pos = [], uv = [], index = [];
  for (let r = 0; r <= ROWS; r++) {
    const lat = THREE.MathUtils.degToRad(LAT[0] + (LAT[1] - LAT[0]) * r / ROWS), y = R * Math.tan(lat);
    for (let i = 0; i <= SEG; i++) {
      const bearing = (i / SEG - 0.5) * Math.PI * 2;        // clockwise from north (−z)
      pos.push(R * Math.sin(bearing), y, -R * Math.cos(bearing));
      uv.push(i / SEG, r / ROWS);
    }
  }
  for (let r = 0; r < ROWS; r++) for (let i = 0; i < SEG; i++) {
    const a = r * (SEG + 1) + i, b = a + SEG + 1;
    index.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // Unlit: the render already has the mission's light and haze in it, as radiance / k (the sky near
  // the horizon is many times brighter than a texture holds), and it's tone-mapped with the rest.
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
  mat.color.setScalar(k);
  mat.opacity = 1 - (activeMap().horizonFade ?? 0);   // (under cloud, rain or mist the far country fades)
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.renderOrder = -5;
  m.userData.noAO = true;
  // Centred on whichever camera draws it (the player's, the kill cam's).
  m.onBeforeRender = (renderer, scene, camera) => { m.position.copy(camera.position); m.updateMatrixWorld(); };
  return m;
}

export function buildHorizon(scene, id = null) {
  const group = new THREE.Group();
  if (id) (async () => {
    try {
      const k = (await (await fetch(`${import.meta.env.BASE_URL}textures/horizons.json`)).json())[id];
      if (!k) return;                    // no panorama for this mission: the ridgelines stay
      const tex = await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}textures/horizon_${id}.webp`);
      group.clear();                     // the drawn ridgelines give way
      group.add(panorama(tex, k));
    } catch { /* missing: the ridgelines stay */ }
  })();
  // Farthest first, so nearer ridges are drawn over them.
  for (const L of [...LAYERS].reverse()) {
    const m = ring(L);
    m.renderOrder = -10 + LAYERS.indexOf(L);
    group.add(m);
  }
  scene.add(group);
  return group;
}
