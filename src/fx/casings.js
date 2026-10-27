// Spent brass: every round from a rifle or machine gun throws its case out of the ejection port, to
// the right and up, tumbling; it bounces once or twice and lies where it lands (on the ground, a
// floor, a sandbag top). An MG42 drops them out of the bottom: a burst leaves a drift under the gun.
// One instanced mesh, a ring of 260 cases: the oldest goes when a new one flies. (No tinkle when they
// land: a thin metallic ping is the kind of sound this game leaves out.)
import * as THREE from 'three';

const N = 260, GRAVITY = 9.8;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

export class Casings {
  constructor({ scene, world }) {
    this.world = world;
    const geo = new THREE.CylinderGeometry(0.0062, 0.0062, 0.057, 6).rotateZ(Math.PI / 2);   // along x
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a7a3a, metalness: 0.8, roughness: 0.45 });
    this.mesh = new THREE.InstancedMesh(geo, mat, N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.flying = [];
    this.next = 0;
    this.later = [];                                  // a bolt rifle's case comes out when the bolt's worked
  }

  // A round fired from `at` (the muzzle) along `dir`; `right`: the gun's right side; `down`: out of
  // the bottom (a machine gun) rather than flicked up and to the right (a rifle).
  eject(at, dir, right, delay = 0, down = false) {
    if (delay > 0) { this.later.push({ t: delay, at: at.clone(), dir: dir.clone(), right: right.clone(), down }); return; }
    const port = at.clone().addScaledVector(dir, -0.6).addScaledVector(right, down ? 0 : 0.04).add(new THREE.Vector3(0, down ? -0.05 : 0, 0));
    const vel = down
      ? right.clone().multiplyScalar((Math.random() - 0.5) * 0.9).add(new THREE.Vector3(0, -0.6 - Math.random() * 0.6, 0)).addScaledVector(dir, -0.9 - Math.random() * 0.6)   // (and off the parapet, back at the gunner's feet)
      : right.clone().multiplyScalar(2.2 + Math.random() * 1.4).add(new THREE.Vector3(0, 1.6 + Math.random(), 0)).addScaledVector(dir, -0.4 + Math.random() * 0.3);
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.flying = this.flying.filter(c => c.i !== i);
    this.flying.push({ i, pos: port, vel, spin, rate: 25 + Math.random() * 20, rot: new THREE.Quaternion(), bounces: 0 });
    this.mesh.count = Math.max(this.mesh.count, i + 1);
  }

  tick(dt) {
    for (const l of this.later) l.t -= dt;
    for (const l of this.later.filter(l => l.t <= 0)) this.eject(l.at, l.dir, l.right, 0, l.down);
    this.later = this.later.filter(l => l.t > 0);
    if (!this.flying.length) return;
    for (const c of this.flying) {
      c.vel.y -= GRAVITY * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.rot.premultiply(_q.setFromAxisAngle(c.spin, c.rate * dt));
      const floor = this.world.floorAt(c.pos.x, c.pos.z, c.pos.y + 0.05, 0.1) + 0.006;
      if (c.pos.y <= floor && c.vel.y < 0) {
        c.pos.y = floor;
        c.bounces++;
        c.vel.y *= -0.3; c.vel.x *= 0.45; c.vel.z *= 0.45; c.rate *= 0.4;
        if (c.bounces >= 3 || Math.abs(c.vel.y) < 0.4) {           // it settles, lying on its side
          c.done = true;
          c.rot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
        }
      }
      this.mesh.setMatrixAt(c.i, _m.compose(c.pos, c.rot, _s));
    }
    this.flying = this.flying.filter(c => !c.done);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
