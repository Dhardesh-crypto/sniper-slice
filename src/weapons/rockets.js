// Anti-tank rounds in flight: the Panzerschreck's rocket, the Panzerfaust's warhead and the
// PIAT's bomb. Each leaves on an arc solved to land where the crosshair is (if it can reach),
// trails smoke, and goes off on whatever it touches: a blast like a grenade's, and a direct
// hit on a vehicle counts as one or two armour-piercing hits on its weak spot (the Panzer
// takes two). Explosives it hits (crates, TNT, satchels) go off too.
import * as THREE from 'three';

export class Rockets {
  constructor({ scene, world, explosions, hotspots, items, fx }) {
    Object.assign(this, { scene, world, explosions, hotspots, items, fx });
    this.list = [];
  }

  // Launch angle (low arc) to reach `target` from `origin` at `speed` under `g`; null if out of reach.
  static aim(origin, target, speed, g) {
    const d = new THREE.Vector3(target.x - origin.x, 0, target.z - origin.z), x = d.length(), y = target.y - origin.y;
    const v2 = speed * speed, disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
    if (disc < 0 || x < 0.01) return null;
    const angle = Math.atan2(v2 - Math.sqrt(disc), g * x);
    return d.normalize().multiplyScalar(Math.cos(angle) * speed).setY(Math.sin(angle) * speed);
  }

  // dir: where the crosshair points (used when the target is out of reach: it flies that way).
  launch(origin, target, dir, def) {
    const r = def.rocket;
    const vel = (target && Rockets.aim(origin, target, r.speed, r.gravity)) ?? dir.clone().multiplyScalar(r.speed);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.45, 8), new THREE.MeshStandardMaterial({ color: 0x3d4234, roughness: 0.6 }));
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.list.push({ pos: origin.clone(), vel, def, r, t: 0, mesh, smokeT: 0, origin: origin.clone() });
  }

  tick(dt) {
    const prev = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const k of this.list) {
      prev.copy(k.pos);
      k.vel.y -= k.r.gravity * dt;
      k.pos.addScaledVector(k.vel, dt);
      k.t += dt;
      k.mesh.position.copy(k.pos);
      k.mesh.quaternion.setFromUnitVectors(up, k.vel.clone().normalize());
      if ((k.smokeT -= dt) <= 0) {
        k.smokeT = 0.02;
        this.fx.emit(k.pos, k.vel.clone().normalize().negate(), { color: 0xb9b3a6, count: 1, speed: 0.4, size: 0.25, life: 1.2, grow: 3, gravity: 0.3 });
      }
      const hit = this.world.raycastSegment(prev, k.pos);
      if (hit || k.t > 8 || k.pos.y < -200) { this.detonate(k, hit); k.done = true; }
    }
    this.list = this.list.filter(k => { if (k.done) k.mesh.removeFromParent(); return !k.done; });
  }

  detonate(k, hit) {
    const at = (hit?.point ?? k.pos).clone(), dir = k.vel.clone().normalize();
    at.addScaledVector(dir, -0.15);                       // just short of the surface
    if (hit?.trap) this.items?.shot(hit.trap);            // a charge or an explosives crate
    // A direct hit on a vehicle: armour-piercing hits on its weak spot.
    const h = hit?.hotspot ?? this.hotspots?.list.find(x => x.parts?.includes(hit?.object));
    if (h && h.explosive && h.active) for (let i = 0; i < k.r.hits && !h.exploded; i++) this.hotspots.hit(h, hit.point, dir, k.origin.distanceTo(hit.point), true);
    else if (h && h.active) this.hotspots.hit(h, hit.point, dir, k.origin.distanceTo(hit.point), true);
    this.explosions.explode(at, { radius: k.r.radius, hurt: k.r.radius * 2, size: 1.1, noise: 320, chain: 2, label: null });
  }
}
