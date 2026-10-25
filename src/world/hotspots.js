// Weak spots you can shoot, Sniper Elite style:
//   siren horn     one hit wrecks the alarm (like cutting the wire, but loud)
//   generator      one hit stops it: no more sound cover there, and a guard comes to fix it
//   truck engines  first hit: smoke (the reinforcement truck stalls); second hit: it explodes,
//                  killing anyone close, and the radio truck takes the radio with it
//   staff car      the same, engine at the back
//   tank           armoured: standard rounds ping off; two armour-piercing hits on the engine
//                  grille, or a satchel charge, destroy it
// An armour-piercing round counts as two hits on an ordinary engine (it blows in one shot).
// Each can be tagged with the binoculars; tagged spots show on screen and on the compass.
// Looking through the scope or the binoculars, every weak spot still worth shooting glows a
// faint red (brighter under the crosshair), so you can see where a shot does damage.
import * as THREE from 'three';


// A soft red glow filling the weak spot's bounding box, fading out toward its edges (so it reads
// as a glow, not a box). Drawn over everything: an engine sits under the bonnet.
function glowMaterial(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  return new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 0 }, center: { value: bb.getCenter(new THREE.Vector3()) }, extent: { value: bb.getSize(new THREE.Vector3()).multiplyScalar(0.5) } },
    vertexShader: `varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float opacity; uniform vec3 center, extent; varying vec3 vP;
      void main() {
        vec3 q = abs(vP - center) / extent;                        // 0 at the middle, 1 at the faces
        vec3 f = 1.0 - smoothstep(0.1, 1.0, q);
        float m = max(q.x, max(q.y, q.z));                       // the face this fragment is on: fade
        if (q.x == m) f.x = 1.0; else if (q.y == m) f.y = 1.0; else f.z = 1.0;   // only across it
        gl_FragColor = vec4(vec3(1.0, 0.16, 0.1) * opacity * f.x * f.y * f.z, 1.0);
      }`,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

class Hotspot {
  constructor(opts) {
    Object.assign(this, { hits: 0, tagged: false, broken: false, exploded: false, ...opts });
    for (const m of this.meshes) m.userData.hotspot = this;
  }
  center(out = new THREE.Vector3()) {
    const m = this.meshes[0];
    m.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(m).getCenter(out);
  }
  get active() { return !this.exploded && !(this.broken && !this.explosive); }
  // Shots left to the next thing that happens, for the tag label.
  get toExplode() { return this.hitsToExplode ?? 2; }
  label() {
    if (this.explosive) {
      const left = this.toExplode - this.hits;
      return this.armored ? `${this.title} · ${left} AP ${left === 1 ? 'hit' : 'hits'} or a satchel` : `${this.title} · ${left} ${left === 1 ? 'hit' : 'hits'}`;
    }
    return `${this.title} · 1 hit`;
  }
  // Will the next hit (with this ammunition) blow it up? (The kill cam plays those.)
  explodesOnNext(ap = false) {
    if (!this.explosive || this.exploded || (this.armored && !ap)) return false;
    return this.hits + (ap && !this.armored ? 2 : 1) >= this.toExplode;
  }
}

export class Hotspots {
  constructor({ scene, world, player, stealth, masking, audio, fx, hud, arsenal, explosions }) {
    Object.assign(this, { scene, world, player, stealth, masking, audio, fx, hud, arsenal, explosions });
    this.list = world.hotspots;
    this.ai = null;               // set by main (alarm, repairs, the reinforcement truck)
    this.mission = null;          // set by main (radio objective, kill count)
    this.repairT = 8;
    this.glowCheckT = 0;

    // Whichever of these the map has.
    const siren = world.siren;
    if (siren) this.add({ kind: 'siren', title: 'SIREN', meshes: siren.hornMeshes, onHit: (h) => this.breakSiren(h) });
    if (world.generatorMesh) this.add({ kind: 'generator', title: 'GENERATOR', meshes: [world.generatorMesh], onHit: (h) => this.breakGenerator(h) });
    if (world.radio?.engine) this.add({ kind: 'engine', title: 'RADIO TRUCK ENGINE', explosive: true, meshes: [world.radio.engine], parts: world.radio.truckParts,
      onExplode: () => {
        world.radio.antenna.visible = false;
        this.mission?.radioDestroyed();
      } });
    if (world.staffCar) this.add({ kind: 'engine', title: world.staffCar.title ?? 'STAFF CAR ENGINE', explosive: true, meshes: [world.staffCar.engine], parts: world.staffCar.parts });
    for (const v of world.site?.vehicles ?? []) this.add({ kind: 'engine', title: v.title, explosive: true, meshes: [v.engine], parts: v.parts });
  }

  add(opts) {
    const h = new Hotspot(opts);
    for (const m of h.meshes) if (!this.world.raycastTargets.includes(m)) this.world.raycastTargets.push(m);
    this.list.push(h);
    h.glows = h.meshes.map(m => {
      const g = new THREE.Mesh(m.geometry, glowMaterial(m.geometry));
      g.renderOrder = 998; g.visible = false; g.userData.noAO = true;
      m.add(g);
      return g;
    });
    return h;
  }

  // The weak-spot glow, while looking through the scope or the binoculars. It only shows when
  // nothing but the thing itself is in the way (checked a few times a second).
  highlight(dt, camera) {
    const zoom = this.arsenal.binoculars || (this.arsenal.aiming && this.arsenal.current === 'rifle') ? this.arsenal.aimT : 0;
    const check = (this.glowCheckT -= dt) <= 0;
    if (check) this.glowCheckT = 0.15;
    let under = null;
    if (zoom > 0.5 && check) {
      const dir = camera.getWorldDirection(new THREE.Vector3());
      under = this.world.raycastRay(camera.position, dir, 600)?.object;
    }
    for (const h of this.list) {
      if (check) {
        h.glowSeen = false;
        if (zoom > 0.5 && h.active) {
          const c = h.center(), d = camera.position.distanceTo(c);
          const hit = d < 600 && this.world.raycastSegment(camera.position, c);
          h.glowSeen = d < 600 && (!hit || hit.hotspot === h || h.parts?.includes(hit.object) || hit.distance > d - 1.5);
          h.glowAimed = h.glowSeen && under != null && (h.meshes.includes(under) || h.parts?.includes(under));
        }
      }
      const target = h.glowSeen && h.active ? zoom * (h.glowAimed ? 0.32 : 0.16) : 0;
      h.glowK = (h.glowK ?? 0) + (target - (h.glowK ?? 0)) * (1 - Math.exp(-10 * dt));
      for (const g of h.glows) { g.material.uniforms.opacity.value = h.glowK; g.visible = h.glowK > 0.005; }
    }
  }

  remove(h) {
    const i = this.list.indexOf(h);
    if (i >= 0) this.list.splice(i, 1);
  }

  // A bullet struck a weak spot (ap: an armour-piercing round).
  hit(h, point, dir, distance, ap = false) {
    this.fx.emit(point, dir.clone().negate(), { color: 0xffe0a0, count: 6, speed: 4, size: 0.05, life: 0.25, grow: 1, gravity: -6 });
    this.audio.metalHit(this.player.pos.distanceTo(point));
    if (!h.active) return;
    if (h.armored && !ap) { this.hud.message(`${h.title} · ARMOURED: USE AP ROUNDS OR A SATCHEL`, ''); return; }
    h.hits += ap && !h.armored ? 2 : 1;
    if (h.explosive) {
      if (h.hits < h.toExplode) {
        h.broken = true;
        this.hud.message(`${h.title} HIT · SMOKING · ONE MORE SHOT`, '');
        h.onBreak?.(h);
      } else this.explode(h);
    } else {
      h.broken = true;
      h.onHit?.(h);
    }
  }

  // ---- the siren ----
  breakSiren(h) {
    const ai = this.ai;
    ai.alarm.working = false;
    ai.alarm.knownDead = false;            // a runner will still go and find it broken
    const [horn] = h.meshes;
    horn.rotation.x = 0.9;                 // knocked askew on its bracket
    horn.position.y -= 0.15;
    this.stealth.noise(h.center(), 30, 'impact');
    if (ai.alarm.on) ai.stopAlarm();
    this.hud.message('SIREN DESTROYED · THE ALARM CAN\'T SOUND', '');
  }

  // ---- the generator ----
  breakGenerator(h) {
    this.masking.generatorOn = false;
    const c = h.center();
    this.fx.emit(c, new THREE.Vector3(0, 1, 0), { color: 0x4a4640, count: 8, speed: 1.5, size: 0.6, life: 3, grow: 3, gravity: 0.6 });
    this.audio.generatorDie();
    this.stealth.noise(c, 25, 'impact');
    this.hud.message('GENERATOR DOWN · NO SOUND COVER THERE', '');
    this.repairT = 6;
  }

  // A guard puts the generator right again.
  repaired() {
    const h = this.list.find(x => x.kind === 'generator');
    h.broken = false; h.hits = 0;
    this.masking.generatorOn = true;
    this.audio.click(0, 700, 0.3);
  }

  // ---- explosions ----
  explode(h) {
    if (h.exploded) return;
    const at = h.center();
    this.wreck(h);
    const name = h.title.replace(' ENGINE', '');
    this.explosions.explode(at, { radius: h.armored ? 7.5 : 6.5, size: h.armored ? 1.5 : 1, burn: true, heavy: true, label: `${name} DESTROYED` });
    h.onExplode?.(h);
  }

  // The wreck goes black (also used when a save restores one).
  wreck(h) {
    h.exploded = true;
    for (const m of h.parts ?? h.meshes) {
      if (!m.material) continue;
      m.material = m.material.clone();
      m.material.color.multiplyScalar(0.18);
      m.material.map = null;
      m.material.needsUpdate = true;
    }
  }

  // ---- per tick ----
  tick(dt) {
    // Damaged engines smoke (wrecks burn: see explosions.js).
    for (const h of this.list) {
      if (!h.explosive || !h.broken || h.exploded) continue;
      h.smokeT = (h.smokeT ?? 0) - dt;
      if (h.smokeT <= 0) {
        h.smokeT = 0.3;
        this.fx.emit(h.center(), new THREE.Vector3(0, 1, 0), { color: 0x8a867e, count: 1, speed: 1.2, size: 0.5, life: 3, grow: 4, gravity: 0.5 });
      }
    }
    // A broken generator: once things are quiet, a guard is sent to fix it.
    const gen = this.list.find(x => x.kind === 'generator');
    if (gen?.broken && this.ai && !this.ai.alarm.on) {
      this.repairT -= dt;
      if (this.repairT <= 0) {
        this.repairT = 20;
        this.ai.requestRepair(this.world.generatorStand, () => this.repaired());
      }
    }
  }

  // For the HUD: tagged, still-useful weak spots.
  tagged() { return this.list.filter(h => h.tagged && h.active); }
}
