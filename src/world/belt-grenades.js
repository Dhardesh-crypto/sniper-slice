// Stick grenades tucked into some guards' belts. Shoot one and it goes off at his hip: it
// kills him and anyone close, and a blast nearby sets it off too. It can be tagged with the
// binoculars and glows like the other weak spots. Search the body and you take it (it's the
// grenade that guard carries: see player/search.js).
import * as THREE from 'three';

const BLAST = { radius: 5, hurt: 9, size: 0.8, noise: 200, label: 'BELT GRENADE' };
const CHAIN = 2.5;                // a blast this close sets one off

const METAL = new THREE.MeshStandardMaterial({ color: 0x4d5247, roughness: 0.55, metalness: 0.5 });
const WOOD = new THREE.MeshStandardMaterial({ color: 0x8d6a40, roughness: 0.8 });
const CAP = new THREE.MeshStandardMaterial({ color: 0x3a3a36, roughness: 0.5, metalness: 0.6 });

// The grenade, head up at the belt, handle down along the thigh (origin at the middle).
function stickGrenade() {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.076, 14), METAL);
  head.position.y = 0.12;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.014, 0.26, 10), WOOD);
  handle.position.y = -0.04;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 10), CAP);
  cap.position.y = -0.18;
  for (const m of [head, handle, cap]) { m.castShadow = true; g.add(m); }
  return g;
}

export class BeltGrenades {
  constructor({ world, hotspots, explosions }) {
    Object.assign(this, { world, hotspots, explosions });
    this.list = [];
    // Every other guard carries one: the same ones every time (saves count on it).
    world.soldiers.filter(s => !s.range && !s.officer).forEach((s, i) => { if (i % 2 === 0) this.give(s); });
  }

  give(s) {
    s.root.updateMatrixWorld(true);
    const hips = s.char.bones.Hips ?? s.root;
    const hipY = s.root.worldToLocal(hips.getWorldPosition(new THREE.Vector3())).y;
    const g = stickGrenade();
    // At his left hip, just in front of the belt, leaning a little forward.
    g.position.set(0.17, hipY - 0.1, 0.08);
    g.rotation.set(0.25, 0, -0.12);
    s.root.add(g);
    // A slightly larger invisible box is what bullets (and the binoculars) find.
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), new THREE.MeshBasicMaterial({ visible: false }));
    g.add(proxy);
    hips.attach(g);               // ride on the pelvis from now on
    const b = { soldier: s, mesh: g, proxy, gone: false };
    proxy.userData.trap = { detonate: () => this.detonate(b) };
    b.hotspot = this.hotspots.add({ kind: 'grenade', title: 'BELT GRENADE', meshes: [proxy] });
    s.beltGrenade = b;
    this.list.push(b);
  }

  // Gone from the belt: blown up, or taken from the body.
  remove(b) {
    b.gone = true;
    b.hotspot.broken = true;      // no longer a weak spot: the tag and the glow drop
    b.mesh.visible = false;
    delete b.proxy.userData.trap;
    const i = this.world.raycastTargets.indexOf(b.proxy);
    if (i >= 0) this.world.raycastTargets.splice(i, 1);
  }

  detonate(b) {
    if (b.gone) return;
    const at = b.proxy.getWorldPosition(new THREE.Vector3());
    this.remove(b);
    this.explosions.explode(at, BLAST);
  }

  // Searching the body: you take it. Returns whether there was one.
  take(s) {
    const b = s.beltGrenade;
    if (!b || b.gone) return false;
    this.remove(b);
    return true;
  }

  // An explosion nearby sets them off (explosions.js asks).
  caughtIn(at, radius, pending) {
    for (const b of this.list) {
      if (b.gone || b.chain) continue;
      if (b.proxy.getWorldPosition(new THREE.Vector3()).distanceTo(at) < Math.min(radius, CHAIN)) {
        b.chain = true;
        pending.push({ t: 0.3, run: () => { b.chain = false; this.detonate(b); } });
      }
    }
  }

  // For saves: which are gone, in order.
  state() { return this.list.map(b => b.gone); }
  restore(gone = []) { gone.forEach((g, i) => { if (g && this.list[i] && !this.list[i].gone) this.remove(this.list[i]); }); }
}
