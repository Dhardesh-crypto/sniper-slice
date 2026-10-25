// Assembles the map and answers the world's physical questions: what does this segment
// hit, where may the player stand, which way is the wind blowing.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildTerrain, heightAt, intersectTerrain, PLAY_HALF } from './terrain.js';
import { buildTrees, buildGrass, buildNearGrass, windUniforms } from './vegetation.js';

import { buildHorizon } from './horizon.js';

// Late-afternoon sun, about 24° up, low enough for long shadows and warm light.
export const STEP = 0.55;   // tallest ledge you walk up without climbing (stair treads, the terrace)

const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(66), THREE.MathUtils.degToRad(215));

export class World {
  // site: the mission's builder, (scene) => { solids, boxes, soldiers, spawn, ladders, … }.
  constructor(scene, renderer, site) {
    this.scene = scene;
    this.time = 0;

    this.setupSkyAndLight(renderer);
    this.terrain = buildTerrain();
    scene.add(this.terrain);
    buildHorizon(scene);
    const { trees, trunks } = buildTrees(scene);
    this.trees = trees;
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
    this.doors = b.doors ?? [];
    this.doorBoxes = new Set(this.doors.map(d => d.box));     // the guards' paths go through doors
    // Where a guard kneels to restart it: in front of the shed's open side.
    this.generatorStand = this.generatorPos && new THREE.Vector3(this.generatorPos.x, heightAt(this.generatorPos.x, this.generatorPos.z), this.generatorPos.z - 1.4);
    this.hotspots = [];      // weak spots you can shoot (see src/world/hotspots.js)
    for (const s of this.soldiers) s.floorAt = (x, z, y) => this.floorAt(x, z, y, 0.05); // where dropped rifles land
    this.hitMeshes = this.soldiers.flatMap(s => s.hitMeshes);
    this.raycastTargets = [...this.solids, ...this.hitMeshes];

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
    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = 5;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.82;
    // Drifting fair-weather clouds (the shader's own cloud layer; `time` advances in tick).
    u.cloudCoverage.value = 0.48;
    u.cloudDensity.value = 0.5;
    u.cloudScale.value = 0.00022;
    u.cloudSpeed.value = 0.00003;
    u.cloudElevation.value = 0.55;
    this.sky = sky;
    u.sunPosition.value.copy(SUN_DIR);
    scene.add(sky);

    // Environment lighting from the sky itself.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    scene.environment = pmrem.fromScene(envScene, 0, 1, 5000).texture;
    scene.environmentIntensity = 0.22;
    pmrem.dispose();

    scene.fog = new THREE.Fog(0xb9c6cc, 320, 1600);
    scene.add(new THREE.HemisphereLight(0xc9dbea, 0x6a5232, 0.5));

    const sun = new THREE.DirectionalLight(0xffe0b0, 2.7);
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
    this.sun.position.set(fx, fy, fz).addScaledVector(SUN_DIR, 300);
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
    s.floorAt = (x, z, y) => this.floorAt(x, z, y, 0.05);
    this.soldiers.push(s);
    this.hitMeshes.push(...s.hitMeshes);
    this.raycastTargets.push(...s.hitMeshes);
  }

  // Nearest hit along the segment a→b: terrain, solids, trees or a soldier's body part.
  raycastSegment(a, b) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-6) return null;
    dir.divideScalar(len);
    this.raycaster.set(a, dir);
    this.raycaster.near = 0;
    this.raycaster.far = len;
    const hits = this.raycaster.intersectObjects(this.raycastTargets, false);
    let best = null;
    if (hits.length) {
      const h = hits[0];
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
    for (const t of this.trees) {
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
