// The terrain of the mission being played. Each mission brings a map (its height function,
// colours, where the action is and where you start); the vineyard's, below, is the default.
// Other modules import MAP_HALF, COMPOUND, START_HILL, heightAt… as live values, so they follow
// whichever map `useMap` puts in place before the world is built.
import * as THREE from 'three';
import { fbm, lerp, smoothstep } from './noise.js';
import { textures } from './textures.js';
import { snowTexture } from './winter.js';
import { region } from './landforms.js';
import { makeWaters } from './waters.js';
import { makeRoads } from './roads.js';
import { biomeOf } from './biomes.js';

// The map's size. Every map so far is a square (`half`: half its side; `playHalf`: half the side of
// the ground you can walk on), and MAP_HALF and PLAY_HALF are that. A map can also be longer one way
// than the other: `size: { x: 1400, z: 700 }` (and `playSize`, default 25 m in from each edge), and
// its playable ground any shape inside that: `playArea` (a landforms.js area: a polygon for an L).
// Then MAP_HALF and PLAY_HALF are the longer half (so whatever still thinks in squares, the paper
// map and the guards' grid, takes in the whole of it), and MAP_HALF_X/Z, PLAY_HALF_X/Z the real ones.
export let MAP_HALF = 400;
export let PLAY_HALF = 375;
export let MAP_HALF_X = 400, MAP_HALF_Z = 400, PLAY_HALF_X = 375, PLAY_HALF_Z = 375;
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
  heightAt: vineyardHeight, roadCenterZ: vineyardRoadZ,
  // Tall grass that's always there on the way to the compound from the start hill (vegetation.js).
  coverPatches: [{ x: -150, z: 95, r: 12 }, { x: -95, z: 40, r: 10 }, { x: -40, z: 30, r: 9 }],
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
// What a map may declare beyond its ground (all optional; a map with none is built as before):
// its water at several heights (waters.js), its roads and tracks (roads.js), its biome (biomes.js).
let WATERS = makeWaters(MAP, (x, z) => MAP.heightAt(x, z)), ROADS = makeRoads(MAP), BIOME = null, AREA = null;
export function useMap(map) {
  MAP = map;
  if (map.size) {
    MAP_HALF_X = map.size.x / 2; MAP_HALF_Z = map.size.z / 2;
    PLAY_HALF_X = map.playSize ? map.playSize.x / 2 : MAP_HALF_X - 25; PLAY_HALF_Z = map.playSize ? map.playSize.z / 2 : MAP_HALF_Z - 25;
    MAP_HALF = Math.max(MAP_HALF_X, MAP_HALF_Z); PLAY_HALF = Math.max(PLAY_HALF_X, PLAY_HALF_Z);
    map.half ??= MAP_HALF;                         // (for whatever reads the map's own field)
  } else {
    MAP_HALF = MAP_HALF_X = MAP_HALF_Z = map.half; PLAY_HALF = PLAY_HALF_X = PLAY_HALF_Z = map.playHalf ?? map.half - 25;
  }
  AREA = map.playArea ? region(map.playArea) : null;
  WATERS = makeWaters(map, heightAt); ROADS = makeRoads(map); BIOME = biomeOf(map);
  COMPOUND = map.focus; START_HILL = map.start;
  H_COMPOUND = map.heightAt(map.focus.x, map.focus.z);
  // (a ruin or a windmill of the map's `cover` stands on levelled ground too: cover.js)
  const coverPads = [...(map.cover?.ruins ?? []).map(r => [r.x, r.z, (r.w ?? 8) / 2 + 1, (r.d ?? 6) / 2 + 1]), ...(map.cover?.windmills ?? []).map(w => [w.x, w.z, 4, 4])];
  PADS = [...(map.damage?.pads ?? []), ...coverPads].map(([x, z, hw, hd]) => ({ x, z, hw, hd, y: map.heightAt(x, z) }));
  CRATERS = (map.damage?.craters ?? []).map(([x, z, r]) => ({ x, z, r }));
}
export const activeMap = () => MAP;

// War damage in the ground (a map's `damage`). pads: [x, z, half width, half depth], the ground
// levelled under a ruin, so its walls and rubble can stand on one height; it takes the height of the
// pad's centre and blends back over PAD_BLEND m. craters: [x, z, r], a bowl with a thrown-up rim. The
// ground mesh is on a 2 m grid, so a crater needs r of 3.5 or more to read as one.
let PADS = [], CRATERS = [];
const PAD_BLEND = 6, CRATER_DEPTH = 0.27, CRATER_RIM = 0.2;
function damaged(x, z, h) {
  for (const p of PADS) {
    const e = Math.max(Math.abs(x - p.x) - p.hw, Math.abs(z - p.z) - p.hd, 0);
    if (e < PAD_BLEND) h += (p.y - h) * (1 - smoothstep(0, PAD_BLEND, e));
  }
  for (const c of CRATERS) {
    const d = Math.hypot(x - c.x, z - c.z) / c.r;
    if (d > 1.8) continue;
    const D = c.r * CRATER_DEPTH;
    if (d < 1) h -= D * (1 - d * d) ** 2;
    h += D * CRATER_RIM * Math.exp(-(((d - 1) / 0.28) ** 2));
  }
  return h;
}
// The map's craters, for the finer ground laid over them (ruins.js craters()).
export const craterList = () => CRATERS;
export const CRATER_EDGE = 1.75;      // how far (in radii) the finer ground reaches
// The 2 m mesh would cut across a bowl and through that finer ground, so it sinks under it, deepest in the bowl.
function sunk(x, z) {
  let s = 0;
  for (const c of CRATERS) s = Math.max(s, 0.7 * (1 - smoothstep(1.05, 1.5, Math.hypot(x - c.x, z - c.z) / c.r)));
  return s;
}
// Dust and churned earth round a ruin: 1 at its walls, 0 a few metres out.
function dusted(x, z) {
  let s = 0;
  for (const p of PADS) {
    const e = Math.max(Math.abs(x - p.x) - p.hw, Math.abs(z - p.z) - p.hd, 0);
    s = Math.max(s, 1 - smoothstep(0, 4.5, e + (fbm(x * 0.3, z * 0.3, 2) - 0.5) * 3));
  }
  return s;
}
const clearOfDamage = (x, z, m) => PADS.some(p => Math.abs(x - p.x) < p.hw + 2 + m && Math.abs(z - p.z) < p.hd + 2 + m)
  || CRATERS.some(c => Math.hypot(x - c.x, z - c.z) < c.r * 1.3 + m);

export function heightAt(x, z) { return damaged(x, z, MAP.heightAt(x, z)); }
// The road's z at this x: the map's own function, or its main road (the first of `roads`).
export function roadCenterZ(x) { return MAP.roadCenterZ ? MAP.roadCenterZ(x) : ROADS.centerZ(x); }
// The nearest point on any of the map's roads and tracks: { id, kind, width, d, on, x, z, t, dx, dz } (roads.js).
export const nearestRoad = (x, z) => ROADS.nearestRoad(x, z);
export const roadList = () => ROADS.roads;
// Water: waterAt, the surface where there is water over the ground at (x, z), else null;
// waterSurfaceAt, the surface of the body whose outline covers the spot, wet or dry (its shore);
// waterBodyAt, that body ({ kind, wade, calm, … }: waters.js).
export const waterAt = (x, z) => WATERS.waterAt(x, z);
export const waterSurfaceAt = (x, z) => WATERS.surfaceAt(x, z);
export const waterBodyAt = (x, z) => WATERS.bodyAt(x, z);
export const waterBodies = () => WATERS.bodies;
export const activeBiome = () => BIOME;
// Growth keeps off the map's own clearings, its ruins and craters, its roads, and (on a map that
// declares waters) out of the water.
export function keepClear(x, z, margin = 0) {
  if (clearOfDamage(x, z, margin) || (MAP.keepClear ? MAP.keepClear(x, z, margin) : false)) return true;
  if (ROADS.any && ROADS.clear(x, z, margin)) return true;
  return WATERS.declared && WATERS.waterAt(x, z) != null;
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.75;
  return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

const _at = { x: 0, z: 0, y: 0, slope: 0, up: 1, water: null, sea: null, o: null };   // (what a biome is told about a spot)
const _pre = new THREE.Color(), _snow = new THREE.Color(0xeef1f6), _slush = new THREE.Color(0x77706a);
export function buildTerrain() {
  // 2 m squares, each way (a long map has more of them along its length than across).
  const geo = new THREE.PlaneGeometry(MAP_HALF_X * 2, MAP_HALF_Z * 2, Math.round(MAP_HALF_X), Math.round(MAP_HALF_Z));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  _at.sea = MAP.waterLevel ?? null; _at.o = BIOME?.o ?? null;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)) - sunk(pos.getX(i), pos.getZ(i)));
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
    // The biome's ground (scree and snow, sand, peat, fields: biomes.js), then the map's own on top.
    if (BIOME) { _at.x = x; _at.z = z; _at.y = y; _at.slope = slope; _at.up = nrm.getY(i); _at.water = WATERS.surfaceAt(x, z); BIOME.paint?.(c, _at); }
    if (MAP.winter) _pre.copy(c);
    MAP.paint?.(c, x, z, { yard, road, mowed, rock, dirt, dry, y, slope });
    // Roads and tracks (`roads`): worn bare, a track mostly in its ruts.
    if (ROADS.any) { const w = ROADS.wear(x, z); if (w) c.lerp(w.kind === 'road' ? road : dirt, w.w * (w.kind === 'road' ? 1 : 0.8)); }
    if (PADS.length) c.lerp(dirt, dusted(x, z) * 0.8);
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
  for (const t of [detail, detailN]) t.repeat.set(MAP_HALF_X / 2, MAP_HALF_Z / 2);
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

// The ground you can walk on: inside the play box, and inside the map's `playArea` if it has one.
export const inPlayArea = (x, z) => Math.abs(x) < PLAY_HALF_X && Math.abs(z) < PLAY_HALF_Z && (!AREA || AREA.sd(x, z) <= 0);
// Keep a position (anything with x and z) on that ground: back inside the box, and if the map has
// its own outline, back across its nearest edge (downhill on the distance to it, a few steps).
export function clampToPlay(pos) {
  pos.x = Math.min(PLAY_HALF_X, Math.max(-PLAY_HALF_X, pos.x));
  pos.z = Math.min(PLAY_HALF_Z, Math.max(-PLAY_HALF_Z, pos.z));
  for (let i = 0; AREA && i < 4; i++) {
    const d = AREA.sd(pos.x, pos.z);
    if (d <= 0) break;
    const gx = AREA.sd(pos.x + 0.5, pos.z) - AREA.sd(pos.x - 0.5, pos.z), gz = AREA.sd(pos.x, pos.z + 0.5) - AREA.sd(pos.x, pos.z - 0.5), len = Math.hypot(gx, gz) || 1;
    pos.x -= gx / len * (d + 0.02); pos.z -= gz / len * (d + 0.02);
  }
  return pos;
}
