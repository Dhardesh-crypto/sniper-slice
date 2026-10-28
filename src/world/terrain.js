// The terrain of the mission being played. Each mission brings a map (its height function,
// colours, where the action is and where you start); the vineyard's, below, is the default.
// Other modules import MAP_HALF, COMPOUND, START_HILL, heightAt… as live values, so they follow
// whichever map `useMap` puts in place before the world is built.
import * as THREE from 'three';
import { fbm, lerp, smoothstep, clamp } from './noise.js';
import { textures } from './textures.js';
import { snowTexture } from './winter.js';

export let MAP_HALF = 400;
export let PLAY_HALF = 375;
export let COMPOUND = { x: 20, z: -30, r: 70 };      // the target area (guards' paths are worked out around it)
export let START_HILL = { x: -210, z: 170 };         // where you start (and usually extract)
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

export let H_COMPOUND = baseHeight(COMPOUND.x, COMPOUND.z);
export const H_LANE = baseHeight(FIRING_LINE.x, FIRING_LINE.z);

// Winding dirt road from the compound's west gate to the map edge.
function vineyardRoadZ(x) {
  return COMPOUND.z + Math.sin((x - COMPOUND.x) * 0.012) * 18 * smoothstep(-40, -120, x - COMPOUND.x);
}

function vineyardLaneDistance(x, z) {
  const dx = Math.max(RANGE_LANE.x0 - x, 0, x - RANGE_LANE.x1);
  const dz = Math.max(Math.abs(z - RANGE_LANE.z) - RANGE_LANE.half, 0);
  return Math.hypot(dx, dz);
}

function vineyardHeight(x, z) {
  let h = baseHeight(x, z);
  const dc = Math.hypot(x - 20, z + 30);
  h = lerp(H_VINEYARD, h, smoothstep(70, 130, dc));
  h = lerp(H_LANE, h, smoothstep(0, 30, vineyardLaneDistance(x, z)));
  return h;
}
const H_VINEYARD = baseHeight(20, -30);

// The vineyard: an 800 × 800 m valley with a hill for the player, a flattened farm compound,
// a flattened shooting-range lane and mountains closing the edges.
export const VINEYARD_MAP = {
  half: 400, playHalf: 375, focus: { x: 20, z: -30, r: 70 }, start: { x: -210, z: 170 },
  heightAt: vineyardHeight, roadCenterZ: vineyardRoadZ, laneDistance: vineyardLaneDistance,
  // Grass and trees stay off the compound, the range lane and the road.
  keepClear(x, z, margin = 0) {
    if (Math.hypot(x - 20, z + 30) < 50 + margin) return true;
    if (vineyardLaneDistance(x, z) < 6 + margin) return true;
    if (x < -10 && Math.abs(z - vineyardRoadZ(x)) < 5 + margin) return true;
    return false;
  },
  // Ground colours: the compound yard, the road and the mown lane on top of the grass.
  paint(c, x, z, { yard, road, mowed }) {
    const dc = Math.hypot(x - 20, z + 30);
    c.lerp(yard, 1 - smoothstep(30, 45, dc));
    if (x < -10) c.lerp(road, 1 - smoothstep(2, 3.5, Math.abs(z - vineyardRoadZ(x))));
    c.lerp(mowed, (1 - smoothstep(0, 4, vineyardLaneDistance(x, z))) * 0.7);
  },
};

let MAP = VINEYARD_MAP;
export function useMap(map) {
  MAP = map;
  MAP_HALF = map.half; PLAY_HALF = map.playHalf ?? map.half - 25;
  COMPOUND = map.focus; START_HILL = map.start;
  H_COMPOUND = map.heightAt(map.focus.x, map.focus.z);
}
export const activeMap = () => MAP;
export function heightAt(x, z) { return MAP.heightAt(x, z); }
export function roadCenterZ(x) { return MAP.roadCenterZ ? MAP.roadCenterZ(x) : NaN; }
export function laneDistance(x, z) { return MAP.laneDistance ? MAP.laneDistance(x, z) : Infinity; }
export function keepClear(x, z, margin = 0) { return MAP.keepClear ? MAP.keepClear(x, z, margin) : false; }

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.75;
  return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

const _pre = new THREE.Color(), _snow = new THREE.Color(0xeef1f6), _slush = new THREE.Color(0x77706a);
export function buildTerrain() {
  const SEG = Math.round(MAP_HALF);   // 2 m squares
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
    if (MAP.winter) _pre.copy(c);
    MAP.paint?.(c, x, z, { yard, road, mowed, rock, dirt, dry, y, slope });
    if (MAP.winter) {
      // Snow where it's level enough to lie, thinner in drifts' lee; trodden to slush where the map
      // paints a yard, a road or a path (wherever its own colours changed the ground).
      const trod = Math.min(1, Math.abs(c.r - _pre.r) * 4 + Math.abs(c.g - _pre.g) * 4 + Math.abs(c.b - _pre.b) * 4);
      const lies = (1 - smoothstep(0.22, 0.5, slope)) * (0.82 + 0.18 * fbm(x * 0.03 + 7, z * 0.03, 2));
      c.lerp(_slush, trod * 0.6).lerp(_snow, lies * (1 - 0.75 * trod));
    }
    const v = 0.92 + fbm(x * 0.4, z * 0.4, 1) * 0.16; // fine variation
    colors[i * 3] = c.r * v; colors[i * 3 + 1] = c.g * v; colors[i * 3 + 2] = c.b * v;
  }
  // A map on a photographed ground (its own colour already): the painted colours only lighten and
  // darken it (clearings, paths, slopes), around their average.
  if (MAP.groundTexture && !MAP.winter) {          // (under snow it's ours, not the photo's)
    const avg = [0, 1, 2].map(k => { let s = 0; for (let i = k; i < colors.length; i += 3) s += colors[i]; return s / (colors.length / 3); });
    for (let i = 0; i < colors.length; i++) colors[i] = Math.min(1.6, colors[i] / avg[i % 3]);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Ground detail repeats every 4 m on top of the large-scale vertex colours.
  const { map, normalMap } = textures()[MAP.groundTexture ?? 'ground'];
  const detail = MAP.winter ? snowTexture() : map.clone(), detailN = normalMap.clone();   // (under snow: its own white grain)
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
