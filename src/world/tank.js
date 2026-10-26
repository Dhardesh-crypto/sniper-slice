// The Panzer IV parked in the yard (Higgsfield / SAM 3D model). Its turret and gun are cut out
// of the single mesh at load so they can turn; its crew (turrets.js) searches with it, and when
// the compound is fighting you and they can see you, lays the gun on you and fires a
// high-explosive round every few seconds: get behind something. It's armoured: only two
// armour-piercing hits on the engine grille at the back, or a satchel charge, destroy it.
import * as THREE from 'three';
import { assets } from './characters.js';
import { addTurret } from './turrets.js';

const SCALE = 7.5;               // model units → metres (hull 0.75 units ≈ a Panzer IV's 5.6 m)
const GROUND = 0.213;            // model units from the origin down to the track bottoms
const DECK = 0.08;               // model y of the hull deck: the turret is what rises above it
const TURRET_Z = -0.15;          // model z of the turret ring
const TRAVERSE = 0.35;           // rad/s
const RELOAD = 9;                // s between shots
const MUZZLE = new THREE.Vector3(0, 0.14 - DECK, 0.5 - TURRET_Z);   // in the turret's own space
const EXHAUSTS = [new THREE.Vector3(0.11, 0.02, -0.5), new THREE.Vector3(-0.11, 0.02, -0.5)];   // the muffler at the back
const EXHAUST_DIR = new THREE.Vector3(0, 0.5, -1).normalize();

// Split one mesh into hull and turret+gun by where each triangle sits.
function splitTurret(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position.array, uv = g.attributes.uv?.array;
  const hull = { p: [], u: [] }, turret = { p: [], u: [] };
  for (let t = 0; t < pos.length; t += 9) {
    let inTurret = true;
    for (let k = 0; k < 9; k += 3) {
      const x = pos[t + k], y = pos[t + k + 1], z = pos[t + k + 2];
      const ring = y > DECK && Math.abs(x) < 0.21 && z > -0.34 && z < 0.03;
      const gun = y > 0.1 && Math.abs(x) < 0.05 && z >= 0.03;
      if (!ring && !gun) { inTurret = false; break; }
    }
    const out = inTurret ? turret : hull;
    for (let k = 0; k < 9; k++) out.p.push(pos[t + k]);
    if (uv) { const ui = (t / 3) * 2; for (let k = 0; k < 6; k++) out.u.push(uv[ui + k]); }
  }
  const make = ({ p, u }) => {
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    if (u.length) b.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    b.computeVertexNormals();
    return b;
  };
  const tg = make(turret);
  tg.translate(0, -DECK, -TURRET_Z);   // turret ring at its origin, so it turns in place
  return { hull: make(hull), turret: tg };
}

// The hull and the turret (on a pivot at its ring) of the Panzer IV model, in model units.
function buildPanzer(model) {
  let mesh = null;
  assets.models.tank?.scene?.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  const mat = mesh ? mesh.material.clone() : new THREE.MeshStandardMaterial({ color: 0xa08a52 });
  if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
  mat.roughness = 0.85; mat.metalness = 0.2;
  const parts = mesh ? splitTurret(mesh.geometry) : { hull: new THREE.BoxGeometry(0.5, 0.29, 0.75).translate(0, -0.07, -0.08), turret: new THREE.BoxGeometry(0.3, 0.12, 0.32).translate(0, 0.06, 0) };
  const hull = new THREE.Mesh(parts.hull, mat), turret = new THREE.Mesh(parts.turret, mat), pivot = new THREE.Group();
  pivot.position.set(0, DECK, TURRET_Z);
  pivot.add(turret);
  model.add(hull, pivot);
  for (const m of [hull, turret]) { m.castShadow = m.receiveShadow = true; }
  return { hull, turret, pivot };
}

// A Panzer IV in a column on the road: the same model; its crew searches, and fires once it sees you.
// Tracks at y 0, nose toward +z, in metres.
export function panzerModel() {
  const g = new THREE.Group(), model = new THREE.Group();
  model.scale.setScalar(SCALE);
  model.position.y = GROUND * SCALE;
  g.add(model);
  const { hull, turret, pivot } = buildPanzer(model);
  g.userData.mesh = hull;
  g.userData.crew = addTurret({ pivot, gun: new THREE.Vector3(0, 0, 1), muzzle: MUZZLE, recoil: turret, recoilScale: 1 / SCALE, own: [hull, turret], name: 'PANZER', traverse: TRAVERSE, reload: RELOAD, exhaust: { space: model, points: EXHAUSTS, dir: EXHAUST_DIR } });
  return g;
}

export class Tank {
  constructor({ scene, world, player, stealth, audio, fx, hud, explosions, hotspots }) {
    Object.assign(this, { scene, world, player, stealth, audio, fx, hud, explosions, hotspots });
    const spot = world.tankSpot;
    this.root = new THREE.Group();
    this.root.position.copy(spot.pos);
    this.root.rotation.y = spot.yaw;
    scene.add(this.root);
    this.model = new THREE.Group();
    this.model.scale.setScalar(SCALE);
    this.model.position.y = GROUND * SCALE;
    this.root.add(this.model);
    this.alive = true;
    const { hull, turret, pivot } = buildPanzer(this.model);
    Object.assign(this, { hull, turret, turretPivot: pivot });
    this.root.updateMatrixWorld(true);
    this.crew = addTurret({ pivot, gun: new THREE.Vector3(0, 0, 1), muzzle: MUZZLE, recoil: turret, recoilScale: 1 / SCALE, own: [hull, turret], name: 'PANZER', traverse: TRAVERSE, reload: RELOAD, exhaust: { space: this.model, points: EXHAUSTS, dir: EXHAUST_DIR } });

    // Bullets ping off the hull and turret; the engine grille at the back is the weak spot.
    // (it sits just proud of the deck, which is at y 0.07, so a shot at it isn't caught by the hull)
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.14), new THREE.MeshBasicMaterial({ visible: false }));
    grille.position.set(0, DECK + 0.02, -0.39);
    this.model.add(grille);
    this.root.updateMatrixWorld(true);
    for (const m of [this.hull, this.turret]) world.raycastTargets.push(m);
    this.hotspot = hotspots.add({
      kind: 'tank', title: 'PANZER ENGINE', explosive: true, armored: true, hitsToExplode: 2,
      meshes: [grille], parts: [this.hull, this.turret],
      onExplode: () => this.destroyed(),
    });
    this.onDestroyed = null;
  }

  // Relative to the hull, 0 = gun forward (kept in saves).
  get turretYaw() { return this.crew.yaw; }
  set turretYaw(v) { this.crew.yaw = v; this.turretPivot.rotation.y = v; }

  destroyed() {
    this.alive = false;
    this.crew.dead = true;
    this.turretPivot.position.y += 0.06;         // the turret is blown up off its ring
    this.turretPivot.rotation.set(0.25, this.turretPivot.rotation.y + 0.4, 0.12);
    this.root.updateMatrixWorld(true);
    this.audio.setTank?.(0);
    this.onDestroyed?.();
  }
}
