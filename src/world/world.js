// Assembles the map and answers the world's physical questions: what does this segment
// hit, where may the player stand, which way is the wind blowing.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildTerrain, heightAt, intersectTerrain, PLAY_HALF, activeMap, MAP_HALF } from './terrain.js';
import { buildTrees, buildGrass, buildNearGrass, windUniforms, cullTreeChunks } from './vegetation.js';
import { buildGround, cullGround } from './ground.js';
import { mergeDecor } from './kit.js';
import { dressInteriors } from './interior.js';

import { buildHorizon } from './horizon.js';

// Late-afternoon sun, about 24° up, low enough for long shadows and warm light.
export const STEP = 0.55;   // tallest ledge you walk up without climbing (stair treads, the terrace)

// A map's own light and weather (all optional; these are the defaults): the sun's angle from the
// zenith and its compass bearing in degrees, its colour and strength, the sky's haze, the clouds,
// the sky-and-ground fill, and the exposure.
const CHARGE_REACH = 0.8;   // m past whatever a shot meets first that a charge on it still takes the bullet
const LIGHT = { zenith: 66, azimuth: 215, sun: 0xffe0b0, sunIntensity: 2.7, turbidity: 5, rayleigh: 1.6, clouds: 0.48,
  hemiSky: 0xc9dbea, hemiGround: 0x6a5232, hemi: 0.5, env: 0.22, exposure: 0.85 };

export class World {
  // site: the mission's builder, (scene) => { solids, boxes, soldiers, spawn, ladders, … }.
  constructor(scene, renderer, site) {
    this.scene = scene;
    this.time = 0;

    this.setupSkyAndLight(renderer);
    this.terrain = buildTerrain();
    scene.add(this.terrain);
    if (!activeMap().fog?.density) buildHorizon(scene, activeMap().id);      // (in thick mist the far hills don't show)
    const { trees, trunks, chunks } = buildTrees(scene);
    this.trees = trees;
    this.treeChunks = chunks;
    // The trees by 8 m cell, so collisions and the canopy check only look at the ones nearby.
    this.treeGrid = new Map();
    for (const t of trees) {
      const k = `${Math.floor(t.x / 8)},${Math.floor(t.z / 8)}`;
      if (!this.treeGrid.has(k)) this.treeGrid.set(k, []);
      this.treeGrid.get(k).push(t);
    }
    const grass = buildGrass(scene);
    this.grassPatches = grass.patches;
    this.tuftCount = grass.tuftCount;
    this.nearGrass = buildNearGrass(scene, grass.patches);

    // The mission's site. The siren, radio, generator, tank and staff car are optional.
    const b = site(scene, this);
    this.generatorPos = b.generator ?? null;
    this.spawn = b.spawn;
    this.soldiers = b.soldiers;
    this.solids = [...b.solids, ...trunks];
    this.boxes = b.boxes;
    this.ladders = b.ladders ?? [];
    this.towerTops = b.towerTops ?? [];
    this.siren = b.siren ?? null;
    this.radio = b.radio ?? null;
    this.generatorMesh = b.generatorMesh ?? null;
    this.tankSpot = b.tank ?? null;
    this.staffCar = b.staffCar ?? null;
    this.villa = b.villa ?? null;
    this.site = b;
    const furniture = dressInteriors(b.soldiers);   // (now the mission's own furniture is in, and its guards)
    const have = new Set(this.boxes);
    for (const bx of furniture) if (!have.has(bx)) this.boxes.push(bx);
    mergeDecor(scene);
    // Ground detail (Blender): stones and scrub, or ferns, needles, stumps and branches in a forest.
    // Stumps are solid: they join the trees for walking into and the solids for bullets.
    const ground = buildGround(scene, { boxes: b.boxes, water: activeMap().waterLevel ?? null });
    this.groundChunks = ground.chunks;
    this.solids.push(...ground.solids);
    for (const t of ground.trees) {
      this.trees.push(t);
      const k = `${Math.floor(t.x / 8)},${Math.floor(t.z / 8)}`;
      if (!this.treeGrid.has(k)) this.treeGrid.set(k, []);
      this.treeGrid.get(k).push(t);
    }
    this.doors = b.doors ?? [];
    this.doorBoxes = new Set(this.doors.map(d => d.box));     // the guards' paths go through doors
    // Where a guard kneels to restart it: in front of the shed's open side.
    this.generatorStand = this.generatorPos && new THREE.Vector3(this.generatorPos.x, heightAt(this.generatorPos.x, this.generatorPos.z), this.generatorPos.z - 1.4);
    this.hotspots = [];      // weak spots you can shoot (see src/world/hotspots.js)
    for (const s of this.soldiers) this.equip(s);
    this.hitMeshes = this.soldiers.flatMap(s => s.hitMeshes);
    this.raycastTargets = [...this.solids, ...this.hitMeshes];
    // The sea, if the map has one: a surface bullets splash into (it isn't walked on).
    this.waterLevel = activeMap().waterLevel ?? null;
    this.maxSlope = activeMap().maxSlope ?? null;          // cliffs you can't walk up (a gorge)
    if (this.waterLevel != null) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2 + 3000, MAP_HALF * 2 + 3000).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x2d4a52, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.88 }));
      water.position.y = this.waterLevel;
      water.receiveShadow = true;
      water.userData.noAO = true;
      water.userData.water = true;
      scene.add(water);
      this.water = water;
      this.raycastTargets.push(water);
    }

    // Wind: direction it blows TOWARD (radians, 0 = +x), base speed, slow gusts.
    this.windAngle = THREE.MathUtils.degToRad(100);
    this.windBase = 3.2;
    this.wind = new THREE.Vector3();
    this.updateWind();

    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
  }

  setupSkyAndLight(renderer) {
    const scene = this.scene;
    const L = { ...LIGHT, ...activeMap().light };
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(L.zenith), THREE.MathUtils.degToRad(L.azimuth));
    renderer.toneMappingExposure = L.exposure;
    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = L.turbidity;
    u.rayleigh.value = L.rayleigh;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.82;
    // Drifting fair-weather clouds (the shader's own cloud layer; `time` advances in tick).
    u.cloudCoverage.value = L.clouds;
    u.cloudDensity.value = 0.5;
    u.cloudScale.value = 0.00022;
    u.cloudSpeed.value = 0.00003;
    u.cloudElevation.value = 0.55;
    this.sky = sky;
    u.sunPosition.value.copy(this.sunDir);
    scene.add(sky);

    // Environment lighting from the sky itself.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    scene.environment = pmrem.fromScene(envScene, 0, 1, 5000).texture;
    scene.environmentIntensity = L.env;
    pmrem.dispose();

    const fog = activeMap().fog;          // a misty map brings the fog in close
    scene.fog = fog?.density ? new THREE.FogExp2(fog.color, fog.density) : new THREE.Fog(fog?.color ?? 0xb9c6cc, fog?.near ?? 320, fog?.far ?? 1600);
    scene.add(new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemi));

    const sun = new THREE.DirectionalLight(L.sun, L.sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const c = sun.shadow.camera;
    c.left = -90; c.right = 90; c.top = 90; c.bottom = -90; c.near = 1; c.far = 600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target);
    this.sun = sun;
  }

  // Keep the shadow box centred on what the player is looking at.
  focusShadows(point) {
    const snap = 4; // snap to texel-ish steps to avoid shimmering
    const fx = Math.round(point.x / snap) * snap, fz = Math.round(point.z / snap) * snap;
    const fy = heightAt(fx, fz);
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx, fy, fz).addScaledVector(this.sunDir, 300);
  }

  updateWind() {
    const t = this.time;
    const gust = 1 + 0.18 * Math.sin(t * 0.21) + 0.1 * Math.sin(t * 0.67 + 1.3);
    const angle = this.windAngle + 0.08 * Math.sin(t * 0.05);
    this.windSpeed = this.windBase * gust;
    this.wind.set(Math.cos(angle) * this.windSpeed, 0, Math.sin(angle) * this.windSpeed);
    windUniforms.uWind.value.set(this.wind.x, this.wind.z);
  }

  tick(dt) {
    this.time += dt;
    this.sky.material.uniforms.time.value = this.time; // seconds: clouds drift ~0.03 noise units/s
    windUniforms.uTime.value = this.time;
    this.updateWind();
    // Animation level of detail: soldiers far from the player animate a third as often
    // (accumulating the time), which is invisible at that range. Dying ones always update.
    this.frame = (this.frame ?? 0) + 1;
    for (const s of this.soldiers) {
      s.lodDt = (s.lodDt ?? 0) + dt;
      const far = this.viewer && s.alive && s.root.position.distanceToSquared(this.viewer) > 120 * 120;
      if (far && (this.frame + s.hitMeshes.length + this.soldiers.indexOf(s)) % 3) continue;
      s.update(s.lodDt);
      s.lodDt = 0;
    }
    // Range targets stand back up a few seconds after being dropped.
    for (const s of this.soldiers) {
      if (s.range && !s.alive && (s.respawnT = (s.respawnT ?? 0) + dt) > 4) { s.respawnT = 0; s.reset(); }
    }
  }

  // A soldier who arrives during play (reinforcements).
  addSoldier(s) {
    this.scene.add(s.root);
    this.equip(s);
    this.soldiers.push(s);
    this.hitMeshes.push(...s.hitMeshes);
    this.raycastTargets.push(...s.hitMeshes);
  }

  // What a soldier asks of the world: where a dropped rifle lands, and whether his rifle (or his
  // fall) would go into a wall.
  equip(s) {
    s.floorAt = (x, z, y) => this.floorAt(x, z, y, 0.05);
    s.wallHit = (a, b) => this.boxAlong(a, b);
  }

  // How far along the segment a→b (0..1) it first enters a collision box (a wall, a crate, a
  // closed door), or null. Boxes it starts inside don't count (the floor slab under his feet).
  boxAlong(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const lx = Math.min(a.x, b.x), hx = Math.max(a.x, b.x), ly = Math.min(a.y, b.y), hy = Math.max(a.y, b.y), lz = Math.min(a.z, b.z), hz = Math.max(a.z, b.z);
    let best = null;
    for (const bx of this.boxes) {
      const mn = bx.min, mx = bx.max;
      if (mx.x < lx || mn.x > hx || mx.y < ly || mn.y > hy || mx.z < lz || mn.z > hz) continue;
      let t0 = 0, t1 = 1;
      for (const [o, d, lo, hi] of [[a.x, dx, mn.x, mx.x], [a.y, dy, mn.y, mx.y], [a.z, dz, mn.z, mx.z]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = 2; break; } continue; }
        let u = (lo - o) / d, v = (hi - o) / d;
        if (u > v) [u, v] = [v, u];
        if (u > t0) t0 = u;
        if (v < t1) t1 = v;
        if (t0 > t1) break;
      }
      if (t0 > t1 || t0 <= 0) continue;
      if (best === null || t0 < best) best = t0;
    }
    return best;
  }

  // Nearest hit along the segment a→b: terrain, solids, trees or a soldier's body part.
  raycastSegment(a, b) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-6) return null;
    dir.divideScalar(len);
    this.raycaster.set(a, dir);
    this.raycaster.near = 0;
    this.raycaster.far = len + CHARGE_REACH;
    const all = this.raycaster.intersectObjects(this.raycastTargets, false);
    const hits = all.filter(h => h.distance <= len);
    let best = null;
    if (hits.length) {
      // A charge (TNT, a satchel) sits on or against something, partly inside its block: a shot at it
      // that meets the thing first, just short of the charge, still sets the charge off.
      const charge = !hits[0].object.userData.trap && all.find(h => h.object.userData.trap && h.distance - hits[0].distance < CHARGE_REACH);
      const h = charge || hits[0];
      const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      best = { point: h.point, distance: h.distance, object: h.object, normal, zone: h.object.userData.zone, soldier: h.object.userData.soldier, hotspot: h.object.userData.hotspot, trap: h.object.userData.trap };
    }
    const t = intersectTerrain(a, b);
    if (t && (!best || t.distance < best.distance)) {
      best = { point: t.point, distance: t.distance, object: null, normal: new THREE.Vector3(0, 1, 0), terrain: true };
    }
    return best;
  }

  raycastRay(origin, dir, far = 1200) {
    return this.raycastSegment(origin, origin.clone().addScaledVector(dir, far));
  }

  // Push a standing circle (player) out of boxes and tree trunks; clamp to the play area.
  collideCircle(pos, radius, feetY, headY) {
    for (const b of this.boxes) {
      if (b.max.y <= feetY + STEP || b.min.y > headY) continue; // low ledges are stepped onto, not walls
      const cx = THREE.MathUtils.clamp(pos.x, b.min.x, b.max.x);
      const cz = THREE.MathUtils.clamp(pos.z, b.min.z, b.max.z);
      let dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 < 1e-8) { // centre inside the box: push out along the shallowest axis
        const ox = Math.min(pos.x - b.min.x, b.max.x - pos.x), oz = Math.min(pos.z - b.min.z, b.max.z - pos.z);
        if (ox < oz) pos.x = pos.x - b.min.x < b.max.x - pos.x ? b.min.x - radius : b.max.x + radius;
        else pos.z = pos.z - b.min.z < b.max.z - pos.z ? b.min.z - radius : b.max.z + radius;
        continue;
      }
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * radius;
      pos.z = cz + (dz / d) * radius;
    }
    for (const t of this.treesNear(pos.x, pos.z)) {
      const dx = pos.x - t.x, dz = pos.z - t.z;
      const r = radius + t.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = t.x + (dx / d) * r;
        pos.z = t.z + (dz / d) * r;
      }
    }
    pos.x = THREE.MathUtils.clamp(pos.x, -PLAY_HALF, PLAY_HALF);
    pos.z = THREE.MathUtils.clamp(pos.z, -PLAY_HALF, PLAY_HALF);
  }

  // Each frame: on a map that says how far you can see (mist), skip the trees beyond it; and draw
  // the trees near the viewer whole, the rest as far cards (zoom: how much a scope magnifies).
  cullTrees(viewer, zoom = 1) {
    cullTreeChunks(this.treeChunks, viewer, activeMap().forest?.viewDistance ?? Infinity, zoom);
    cullGround(this.groundChunks, viewer, zoom);
  }

  // Trees within about 8 m of (x, z).
  *treesNear(x, z) {
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) yield* this.treeGrid.get(`${cx + i},${cz + j}`) ?? [];
  }

  // How many trees stand within 7 m: under a thick canopy you are harder to make out.
  canopyAt(x, z) {
    let n = 0;
    for (const t of this.treesNear(x, z)) if ((t.x - x) ** 2 + (t.z - z) ** 2 < 49) n++;
    return n;
  }

  groundAt(x, z) {
    return heightAt(x, z);
  }

  // The highest surface under (x, z) you could stand on from height y: terrain, or the top
  // of a box no more than `reach` above y (a stair tread, a wall top, a tower platform).
  floorAt(x, z, y, reach = STEP) {
    let f = heightAt(x, z);
    for (const b of this.boxes) {
      if (b.max.y > y + reach || b.max.y <= f) continue;
      if (x < b.min.x - 0.05 || x > b.max.x + 0.05 || z < b.min.z - 0.05 || z > b.max.z + 0.05) continue;
      f = b.max.y;
    }
    return f;
  }

  // Is the space from y0 to y1 above (x, z) free of boxes? (Room to stand after a climb.)
  clearAbove(x, z, y0, y1) {
    for (const b of this.boxes) {
      if (b.max.y <= y0 + 0.02 || b.min.y >= y1) continue;
      if (x > b.min.x - 0.2 && x < b.max.x + 0.2 && z > b.min.z - 0.2 && z < b.max.z + 0.2) return false;
    }
    return true;
  }
}
