// Things to find in the mission (SE5 style):
//   toolboxes      hold E: a weapon part you don't have yet (kept for good, see core/profile.js)
//   weapon crates  hold E: a rare rifle (Gewehr 43, M1 Carbine, De Lisle), kept for good
//   supply caches  hold E: ammo boxes, medical boxes, explosives crates, bottle crates (what you
//                  can carry; if you're full they stay for later)
//   workbenches    press E: change weapons and fit parts mid-mission (opens the loadout screen)
// Opening makes a little noise. Toolboxes, crates and benches show on the map; supply caches
// once you've been near them.
import * as THREE from 'three';
import { COMPOUND, H_COMPOUND, START_HILL, heightAt, roadCenterZ } from './terrain.js';
import { CATALOG, partById } from '../weapons/defs.js';
import { takeSupplies } from '../player/supplies.js';

// What each kind of supply cache holds (rolled when you open it).
const SUPPLY = {
  ammo: { name: 'AMMO BOX', roll: (r, n) => ({ rifle: n(8, 12), pistol: r() < 0.5 ? n(6, 10) : 0, special: { subsonic: r() < 0.5 ? n(3, 5) : 0, ap: r() < 0.35 ? n(2, 3) : 0 } }) },
  medical: { name: 'MEDICAL BOX', roll: (r) => ({ kit: { bandage: 2, medkit: r() < 0.4 ? 1 : 0 } }) },
  explosives: { name: 'EXPLOSIVES CRATE', roll: (r) => { const x = r(); return { kit: { grenade: 2, mine: x < 0.45 ? 1 : 0, tnt: x >= 0.45 && x < 0.75 ? 1 : 0, satchel: x >= 0.75 ? 1 : 0 } }; } },
  bottles: { name: 'CRATE OF BOTTLES', roll: () => ({ kit: { bottle: 3 } }) },
};
const SEEN_RANGE = 35;          // a cache shows on your map once you've been this close

const REACH = 1.6, OPEN_TIME = 1.4;
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

function toolboxModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.24), mat(0x3d4a35, { metalness: 0.4 }));
  body.position.y = 0.11;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.24), mat(0x46543d, { metalness: 0.4 }));
  lid.position.set(0, 0.245, 0);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), mat(0x222222, { metalness: 0.6 }));
  handle.position.set(0, 0.29, 0);
  lid.add(handle); handle.position.y = 0.045;
  g.add(body, lid);
  g.userData.lid = lid;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function weaponCrateModel() {
  const g = new THREE.Group();
  const wood = mat(0x6f5a3a);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 0.42), wood);
  box.position.y = 0.15;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.42), mat(0x7d6644));
  lid.position.y = 0.325;
  for (const x of [-0.45, 0.45]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.31, 0.44), mat(0x2a2a26, { metalness: 0.5 })); band.position.set(x, 0.16, 0); g.add(band); }
  g.add(box, lid);
  g.userData.lid = lid;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function supplyModel(type) {
  const g = new THREE.Group();
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  let lid;
  if (type === 'ammo') {
    const olive = mat(0x4b5233, { metalness: 0.45 });
    add(new THREE.BoxGeometry(0.42, 0.22, 0.2), olive, 0, 0.11, 0);
    add(new THREE.BoxGeometry(0.42, 0.2, 0.2), olive, 0.02, 0.1, 0.24).rotation.y = 0.1;    // a second can beside it
    lid = add(new THREE.BoxGeometry(0.44, 0.04, 0.21), mat(0x3f4529, { metalness: 0.45 }), 0, 0.24, 0);
  } else if (type === 'medical') {
    add(new THREE.BoxGeometry(0.5, 0.26, 0.3), mat(0xd9d6c8), 0, 0.13, 0);
    add(new THREE.BoxGeometry(0.51, 0.06, 0.31), mat(0x3d5a3a), 0, 0.15, 0);                // green band
    lid = add(new THREE.BoxGeometry(0.5, 0.04, 0.3), mat(0xcfccbe), 0, 0.28, 0);
  } else if (type === 'explosives') {
    add(new THREE.BoxGeometry(0.75, 0.34, 0.45), mat(0x6f5a3a), 0, 0.17, 0);
    add(new THREE.BoxGeometry(0.76, 0.07, 0.46), mat(0x8e2a1e), 0, 0.22, 0);                // red stripe
    lid = add(new THREE.BoxGeometry(0.75, 0.04, 0.45), mat(0x7d6644), 0, 0.36, 0);
  } else {
    add(new THREE.BoxGeometry(0.56, 0.24, 0.38), mat(0x7a6142), 0, 0.12, 0);
    const glass = mat(0x2f5a2a, { roughness: 0.2 });
    for (let i = 0; i < 6; i++) add(new THREE.CylinderGeometry(0.012, 0.02, 0.1, 8), glass, -0.17 + (i % 3) * 0.17, 0.29, i < 3 ? -0.09 : 0.09); // bottle necks
    lid = new THREE.Group(); g.add(lid);
  }
  g.userData.lid = lid;
  return g;
}

function workbenchModel() {
  const g = new THREE.Group();
  const wood = mat(0x7a6040), dark = mat(0x2b2b28, { metalness: 0.5 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.7), wood); top.position.y = 0.9;
  g.add(top);
  for (const [x, z] of [[-0.72, -0.28], [0.72, -0.28], [-0.72, 0.28], [0.72, 0.28]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), wood); leg.position.set(x, 0.45, z); g.add(leg); }
  const vise = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.12), dark); vise.position.set(0.6, 1.0, 0.2); g.add(vise);
  const rack = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 0.04), wood); rack.position.set(0, 1.25, -0.33); g.add(rack);
  for (const x of [-0.5, -0.15, 0.2]) { const tool = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.03), dark); tool.position.set(x, 1.3, -0.3); g.add(tool); }
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.12, 10), mat(0x8a7a3a, { emissive: 0x332a10 })); lamp.position.set(-0.6, 1.0, -0.1); g.add(lamp);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export class Pickups {
  constructor({ scene, world, player, input, audio, stealth, hud, profile }) {
    Object.assign(this, { scene, world, player, input, audio, stealth, hud, profile });
    const cx = COMPOUND.x, cz = COMPOUND.z, y = H_COMPOUND, [swTower, neTower] = world.towerTops;
    const on = (x, z, yy) => new THREE.Vector3(x, world.floorAt(x, z, (yy ?? heightAt(x, z)) + 0.6), z);
    this.boxes = [
      { kind: 'parts', where: 'generator shed', at: on(cx + 22.6, cz + 11.3) },
      { kind: 'parts', where: 'villa terrace', at: on(cx + 16, cz + 0.2, y + 0.5) },
      { kind: 'parts', where: 'beside the barn', at: on(cx - 23.2, cz - 12) },
      { kind: 'parts', where: 'ladder tower', at: on(swTower.x + 0.9, swTower.z + 0.9, swTower.y) },
      { kind: 'parts', where: 'outside the west gate', at: on(cx - 37, cz + 11.6) },
      { kind: 'weapon', weapon: 'g43', where: 'stairs tower', at: on(neTower.x - 0.7, neTower.z + 0.9, neTower.y) },
      { kind: 'weapon', weapon: 'm1carbine', where: 'by the west wall', at: on(cx - 26, cz + 9) },
      { kind: 'weapon', weapon: 'delisle', where: 'behind the barn', at: on(cx - 10, cz - 18.7) },
    ];
    // Supply caches: in the compound and out in the countryside.
    const rz = (x, dz = 0) => roadCenterZ(x) + dz, sp = world.spawn;
    for (const [type, x, z, yy] of [
      ['ammo', cx - 12.5, cz - 7.6], ['medical', cx + 0.6, cz - 1, y + 0.5], ['explosives', cx - 16, cz + 21],
      ['ammo', cx - 26, cz + 21.6], ['bottles', cx + 9, cz + 18.5], ['medical', cx + 35, cz + 3],
      ['explosives', cx - 37.2, cz - 11.6], ['ammo', cx + 5, cz - 28.4],
      ['bottles', cx - 8, cz + 45], ['ammo', sp.x + 6, sp.z + 3], ['medical', sp.x + 4, sp.z - 6],
      ['explosives', cx - 95, rz(cx - 95, 6)], ['ammo', cx - 150, rz(cx - 150, -7)], ['medical', -100, 70],
      ['bottles', START_HILL.x + 38, START_HILL.z - 28], ['ammo', -40, 25],
    ]) this.boxes.push({ kind: 'supply', type, where: SUPPLY[type].name.toLowerCase(), at: on(x, z, yy) });
    for (const b of this.boxes) {
      b.mesh = b.kind === 'supply' ? supplyModel(b.type) : b.kind === 'weapon' ? weaponCrateModel() : toolboxModel();
      b.mesh.position.copy(b.at);
      b.mesh.rotation.y = Math.random() * Math.PI;
      scene.add(b.mesh);
      b.opened = false;
    }
    const spawn = world.spawn;
    this.benches = [
      { where: 'start', at: on(spawn.x + 2.5, spawn.z - 4) },
      { where: 'barn', at: on(cx - 6.6, cz - 15) },
    ];
    for (const b of this.benches) {
      b.mesh = workbenchModel();
      b.mesh.position.copy(b.at);
      b.mesh.rotation.y = Math.PI / 2;
      scene.add(b.mesh);
    }
    this.target = null;
    this.progress = 0;
    this.onBench = null;          // () => void: open the workbench screen
    this.onPart = null;           // (part) => void, for the mission stats
  }

  near() {
    const p = this.player.pos;
    let best = null, bestD = REACH;
    for (const b of [...this.boxes.filter(b => !b.opened), ...this.benches]) {
      const d = Math.hypot(b.at.x - p.x, b.at.z - p.z);
      if (d < bestD && Math.abs(b.at.y - p.y) < 1.2) { best = b; bestD = d; }
    }
    return best;
  }

  tick(dt) {
    const p = this.player;
    // Caches you've come near show on your map from then on.
    if ((this.seenT = (this.seenT ?? 0) - dt) <= 0) {
      this.seenT = 0.5;
      for (const c of this.boxes) if (c.kind === 'supply' && !c.seen && c.at.distanceTo(p.pos) < SEEN_RANGE) c.seen = true;
    }
    const b = this.near();
    if (b !== this.target) { this.target = b; this.progress = 0; }
    if (!b || p.dead || p.climb || p.carrying || p.locked) { this.progress = 0; return; }
    if (this.benches.includes(b)) {
      if (this.input.wasPressed('KeyE')) this.onBench?.();
      return;
    }
    if (this.input.down('KeyE') && !p.moving) {
      this.progress += dt / OPEN_TIME;
      if (this.progress >= 1) this.open(b);
    } else this.progress = 0;
  }

  open(b) {
    this.progress = 0;
    if (b.kind === 'supply') {
      const loot = SUPPLY[b.type].roll(Math.random, (a, c) => a + Math.floor(Math.random() * (c - a + 1)));
      const got = takeSupplies({ arsenal: this.arsenal, items: this.items }, loot);
      if (!got.length) { this.hud.message(`${SUPPLY[b.type].name} · YOU CAN'T CARRY ANY MORE: COME BACK LATER`, 'wound'); return; }
      b.opened = true;
      b.mesh.userData.lid.rotation.x = -1.2;
      this.stealth.noise(b.at.clone(), 4, 'rustle');
      this.audio.pickup();
      this.hud.message(`${SUPPLY[b.type].name} · ${got.join(' · ').toUpperCase()}`, '');
      return;
    }
    b.opened = true;
    b.mesh.userData.lid.rotation.x = -1.2;
    b.mesh.userData.lid.position.z -= 0.1;
    this.stealth.noise(b.at.clone(), 4, 'rustle');
    this.audio.pickup();
    if (b.kind === 'weapon') {
      const w = CATALOG[b.weapon];
      if (this.profile.addWeapon(b.weapon)) this.hud.message(`WEAPON FOUND · ${w.name.toUpperCase()} · FIT IT AT A WORKBENCH`, 'head');
      else this.hud.message(`${w.name.toUpperCase()} · YOU ALREADY HAVE ONE`, '');
      return;
    }
    const missing = this.profile.missingParts();
    if (!missing.length) { this.hud.message('TOOLBOX · NOTHING NEW: YOU HAVE EVERY PART', ''); return; }
    const part = missing[Math.floor(Math.random() * missing.length)];
    this.profile.addPart(part.id);
    this.onPart?.(part);
    this.hud.message(`PART FOUND · ${part.name.toUpperCase()} · ${part.info.toUpperCase()}`, 'head');
  }

  // A part from somewhere else (the Oberst's body).
  givePart() {
    const missing = this.profile.missingParts();
    if (!missing.length) return null;
    const part = missing[Math.floor(Math.random() * missing.length)];
    this.profile.addPart(part.id);
    this.onPart?.(part);
    return part;
  }

  state() {
    const b = this.target;
    if (!b) return null;
    if (this.benches.includes(b)) return { label: 'E · WORKBENCH: CHANGE WEAPONS AND PARTS', progress: 0 };
    const what = b.kind === 'supply' ? SUPPLY[b.type].name : b.kind === 'weapon' ? 'WEAPON CRATE' : 'TOOLBOX';
    return { label: `HOLD E · OPEN ${what}`, progress: this.progress };
  }

  // For the map: unopened boxes and the benches.
  markers() {
    return [
      ...this.boxes.filter(b => !b.opened && (b.kind !== 'supply' || b.seen)).map(b => ({ pos: b.at, kind: b.kind === 'supply' ? 'supply' : b.kind === 'weapon' ? 'crate' : 'toolbox' })),
      ...this.benches.map(b => ({ pos: b.at, kind: 'bench' })),
    ];
  }
}

export { partById };
