// The Panzer IV parked in the yard (Higgsfield / SAM 3D model). Its turret and gun are cut out
// of the single mesh at load so they can turn. When the compound is fighting you and the crew
// can see you, the turret traverses toward you and fires a high-explosive shell every few
// seconds: get behind something. It's armoured: only two armour-piercing hits on the engine
// grille at the back, or a satchel charge, destroy it.
import * as THREE from 'three';
import { assets } from './characters.js';

const SCALE = 7.5;               // model units → metres (hull 0.75 units ≈ a Panzer IV's 5.6 m)
const GROUND = 0.213;            // model units from the origin down to the track bottoms
const DECK = 0.08;               // model y of the hull deck: the turret is what rises above it
const TURRET_Z = -0.15;          // model z of the turret ring
const TRAVERSE = 0.35;           // rad/s
const RELOAD = 9;                // s between shots
const RANGE = 300;               // m, for a standing man in the open

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
    this.turretYaw = 0;          // relative to the hull, 0 = gun forward
    this.reload = 4;
    this.alive = true;
    this.tracking = false;

    const src = assets.models.tank?.scene;
    let mesh = null;
    src?.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
    const mat = mesh ? mesh.material.clone() : new THREE.MeshStandardMaterial({ color: 0xa08a52 });
    if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.roughness = 0.85; mat.metalness = 0.2;
    const parts = mesh ? splitTurret(mesh.geometry) : { hull: new THREE.BoxGeometry(0.5, 0.29, 0.75).translate(0, -0.07, -0.08), turret: new THREE.BoxGeometry(0.3, 0.12, 0.32).translate(0, 0.06, 0) };
    this.hull = new THREE.Mesh(parts.hull, mat);
    this.turretPivot = new THREE.Group();
    this.turretPivot.position.set(0, DECK, TURRET_Z);
    this.turret = new THREE.Mesh(parts.turret, mat);
    this.turretPivot.add(this.turret);
    this.model.add(this.hull, this.turretPivot);
    for (const m of [this.hull, this.turret]) { m.castShadow = m.receiveShadow = true; }
    this.root.updateMatrixWorld(true);

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

  // Where the gun's muzzle is, in the world.
  muzzle(out = new THREE.Vector3()) {
    return this.turret.localToWorld(out.set(0, 0.14 - DECK, 0.5 - TURRET_Z));
  }

  destroyed() {
    this.alive = false;
    this.turretPivot.position.y += 0.06;         // the turret is blown up off its ring
    this.turretPivot.rotation.set(0.25, this.turretPivot.rotation.y + 0.4, 0.12);
    this.root.updateMatrixWorld(true);
    this.audio.setTank?.(0);
    this.onDestroyed?.();
  }

  tick(dt) {
    if (!this.alive) return;
    const p = this.player;
    // The crew fights when the compound is: some guard has really spotted you.
    const fighting = this.world.soldiers.some(s => s.alive && s.aware?.state === 'alerted' && s.aware.spotted);
    const target = p.pos.clone().setY(p.pos.y + Math.max(0.3, p.eye * 0.6));
    // The crew sees like the guards do, with better optics: tall grass hides you (crouched or
    // prone), and the range shrinks with how visible you are (standing ~300 m, prone ~150 m).
    const vis = this.stealth.playerVisibility();
    const range = RANGE * Math.sqrt(Math.min(1, vis));
    let canSee = false;
    if (fighting && !p.dead && !this.stealth.concealed && target.distanceTo(this.root.position) < range) {
      const eye = this.root.position.clone().setY(this.root.position.y + 2.6);
      const hit = this.world.raycastSegment(eye, target);
      canSee = !hit || hit.distance > eye.distanceTo(target) - 0.6 || hit.object === this.hull || hit.object === this.turret;
    }
    // Traverse toward you (or back to the front when there's nothing to shoot).
    const local = this.root.worldToLocal(canSee ? target.clone() : this.root.localToWorld(new THREE.Vector3(0, 0, 10)));
    const want = Math.atan2(local.x, local.z);
    let d = want - this.turretYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.turretYaw += Math.sign(d) * Math.min(Math.abs(d), TRAVERSE * dt);
    this.turretPivot.rotation.y = this.turretYaw;
    if (canSee && !this.tracking) this.hud.message('THE PANZER HAS SEEN YOU · TAKE COVER', 'wound');
    this.tracking = canSee;
    this.reload = Math.max(0, this.reload - dt);
    if (canSee && Math.abs(d) < 0.03 && this.reload <= 0) this.fire(target);
  }

  fire(target) {
    this.reload = RELOAD;
    const muzzle = this.muzzle();
    const dir = target.clone().sub(muzzle).normalize();
    this.fx.flash(muzzle, dir);
    this.fx.emit(muzzle, dir, { color: 0xcfc8b8, count: 6, speed: 4, size: 1.2, life: 1.6, grow: 3, gravity: 0.3 });
    const dist = muzzle.distanceTo(target);
    this.audio.explosion(this.player.pos.distanceTo(muzzle) + 60); // the gun's report
    // The shell lands near you: closer the nearer you are and the longer you stand still.
    const miss = 1.2 + dist / 45 + (this.player.moving ? 2 : 0);
    const at = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * miss, 0, (Math.random() - 0.5) * 2 * miss));
    at.y = this.world.floorAt(at.x, at.z, this.player.pos.y + 0.5) + 0.3;
    this.explosions.pending.push({ t: dist / 650, run: () => this.explosions.explode(at, { radius: 4, hurt: 7, size: 1.1, noise: 250, heavy: true, by: 'tank' }) });
  }
}
