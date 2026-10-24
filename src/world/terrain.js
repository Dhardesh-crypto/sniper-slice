// The map: an 800 × 800 m valley with a hill for the player, a flattened farm compound,
// a flattened shooting-range lane and mountains closing the edges.
import * as THREE from 'three';
import { fbm, lerp, smoothstep, clamp } from './noise.js';
import { textures } from './textures.js';

export const MAP_HALF = 400;
export const PLAY_HALF = 375;
export const COMPOUND = { x: 20, z: -30, r: 70 };
export const START_HILL = { x: -210, z: 170 };
export const RANGE_LANE = { z: 240, x0: -215, x1: 315, half: 10 };
export const FIRING_LINE = { x: -200, z: 240 };

function baseHeight(x, z) {
  let h = (fbm(x * 0.0035 + 3.1, z * 0.0035 - 7.7, 4) - 0.5) * 46;
  h += (fbm(x * 0.03, z * 0.03, 2) - 0.5) * 2.5;
  h += 16 * Math.exp(-((x - START_HILL.x) ** 2 + (z - START_HILL.z) ** 2) / (2 * 50 * 50));
  // The edge rises into rolling, uneven hills (not a uniform wall) that close the valley.
  const r = Math.max(Math.abs(x), Math.abs(z));
  if (r > 290) {
    const t = (r - 290) / 110;
    const ridge = 26 + 46 * fbm(x * 0.006 + 9.3, z * 0.006 - 2.1, 3);
    h += t * t * ridge + t * (fbm(x * 0.025, z * 0.025, 2) - 0.5) * 10;
  }
  return h;
}

export const H_COMPOUND = baseHeight(COMPOUND.x, COMPOUND.z);
export const H_LANE = baseHeight(FIRING_LINE.x, FIRING_LINE.z);

// Winding dirt road from the compound's west gate to the map edge.
export function roadCenterZ(x) {
  return COMPOUND.z + Math.sin((x - COMPOUND.x) * 0.012) * 18 * smoothstep(-40, -120, x - COMPOUND.x);
}

export function laneDistance(x, z) {
  const dx = Math.max(RANGE_LANE.x0 - x, 0, x - RANGE_LANE.x1);
  const dz = Math.max(Math.abs(z - RANGE_LANE.z) - RANGE_LANE.half, 0);
  return Math.hypot(dx, dz);
}

export function heightAt(x, z) {
  let h = baseHeight(x, z);
  const dc = Math.hypot(x - COMPOUND.x, z - COMPOUND.z);
  h = lerp(H_COMPOUND, h, smoothstep(COMPOUND.r, COMPOUND.r + 60, dc));
  h = lerp(H_LANE, h, smoothstep(0, 30, laneDistance(x, z)));
  return h;
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.75;
  return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

export function buildTerrain() {
  const SEG = 400;
  const geo = new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();

  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const grass = new THREE.Color(0x6b8a3a), grass2 = new THREE.Color(0x8c9b46);
  const dry = new THREE.Color(0xb3a45e), dirt = new THREE.Color(0x8a7352);
  const yard = new THREE.Color(0x9e8b67), road = new THREE.Color(0x9a8466);
  const mowed = new THREE.Color(0x86a04c), rock = new THREE.Color(0x8c877c);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
    c.copy(grass).lerp(grass2, fbm(x * 0.05, z * 0.05, 2));
    c.lerp(dry, smoothstep(0.55, 0.75, fbm(x * 0.008 + 11, z * 0.008 - 4, 3)) * 0.8);
    const slope = 1 - nrm.getY(i);
    c.lerp(dirt, smoothstep(0.12, 0.3, slope));
    if (y > 22) c.lerp(dry, smoothstep(22, 45, y) * 0.45);           // drier grass up the hills
    c.lerp(rock, smoothstep(0.28, 0.5, slope) * 0.85);                  // rock only where it's steep
    const dc = Math.hypot(x - COMPOUND.x, z - COMPOUND.z);
    c.lerp(yard, 1 - smoothstep(30, 45, dc));
    if (x < COMPOUND.x - 30) c.lerp(road, 1 - smoothstep(2, 3.5, Math.abs(z - roadCenterZ(x))));
    c.lerp(mowed, (1 - smoothstep(0, 4, laneDistance(x, z))) * 0.7);
    const v = 0.92 + fbm(x * 0.4, z * 0.4, 1) * 0.16; // fine variation
    colors[i * 3] = c.r * v; colors[i * 3 + 1] = c.g * v; colors[i * 3 + 2] = c.b * v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Ground detail repeats every 4 m on top of the large-scale vertex colours.
  const { map, normalMap } = textures().ground;
  const detail = map.clone(), detailN = normalMap.clone();
  for (const t of [detail, detailN]) t.repeat.set(MAP_HALF / 2, MAP_HALF / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, map: detail, normalMap: detailN, normalScale: new THREE.Vector2(0.6, 0.6),
  }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

// Exact segment-vs-heightfield test (sampled + bisection). Returns the hit point or null.
export function intersectTerrain(a, b, out = new THREE.Vector3()) {
  const len = a.distanceTo(b);
  const steps = Math.max(1, Math.ceil(len / 1.5));
  let t0 = 0;
  for (let s = 1; s <= steps; s++) {
    const t1 = s / steps;
    const x = lerp(a.x, b.x, t1), y = lerp(a.y, b.y, t1), z = lerp(a.z, b.z, t1);
    if (y < heightAt(x, z)) {
      let lo = t0, hi = t1;
      for (let i = 0; i < 12; i++) {
        const m = (lo + hi) / 2;
        const mx = lerp(a.x, b.x, m), my = lerp(a.y, b.y, m), mz = lerp(a.z, b.z, m);
        if (my < heightAt(mx, mz)) hi = m; else lo = m;
      }
      return { point: out.copy(a).lerp(b, hi), distance: len * hi };
    }
    t0 = t1;
  }
  return null;
}

export const inPlayArea = (x, z) => Math.abs(x) < PLAY_HALF && Math.abs(z) < PLAY_HALF;
export { clamp };
