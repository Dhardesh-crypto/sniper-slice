// Things to find in the mission (SE5 style):
//   toolboxes      hold E: a weapon part you don't have yet (kept for good, see core/profile.js)
//   weapon crates  hold E: a rare rifle (Gewehr 43, M1 Carbine, De Lisle) or a heavy weapon
//                  (Trench Gun, MG42, Panzerschreck, Panzerfaust, PIAT), kept for good
//   supply caches  hold E: ammo boxes, medical boxes, explosives crates, bottle crates (what you
//                  can carry; if you're full they stay for later)
//   workbenches    press E: change weapons and fit parts mid-mission (opens the loadout screen)
// Opening makes a little noise. Toolboxes, crates and benches show on the map; supply caches
// once you've been near them.
import * as THREE from 'three';
import { COMPOUND, H_COMPOUND, START_HILL, heightAt, roadCenterZ, activeMap } from './terrain.js';
import { CATALOG, HEAVY_AMMO, partById } from '../weapons/defs.js';
import { takeSupplies } from '../player/supplies.js';
import { pickupModel, showDetail } from './pickup-models.js';

// What each kind of supply cache holds (rolled when you open it).
const SUPPLY = {
  ammo: { name: 'AMMO BOX', roll: (r, n) => ({ rifle: n(8, 12), pistol: r() < 0.5 ? n(6, 10) : 0, special: { subsonic: r() < 0.5 ? n(3, 5) : 0, ap: r() < 0.35 ? n(2, 3) : 0 } }) },
  medical: { name: 'MEDICAL BOX', roll: (r) => ({ kit: { bandage: 2, medkit: r() < 0.4 ? 1 : 0 } }) },
  explosives: { name: 'EXPLOSIVES CRATE', roll: (r) => { const x = r(); return { kit: { grenade: 2, mine: x < 0.45 ? 1 : 0, tnt: x >= 0.45 && x < 0.75 ? 1 : 0, satchel: x >= 0.75 ? 1 : 0 } }; } },
  bottles: { name: 'CRATE OF BOTTLES', roll: () => ({ kit: { bottle: 3 } }) },
  heavy: { name: 'HEAVY AMMUNITION', roll: (r, n) => ({ heavy: { trenchgun: n(6, 10), mg42: n(50, 100), panzerschreck: n(1, 2), panzerfaust: 1, piat: n(1, 2) } }) },
};
const SEEN_RANGE = 35;          // a cache shows on your map once you've been this close
const DETAIL_RANGE = 80;        // m: closer than this, a box shows its fittings, lettering and contents

const REACH = 1.6, OPEN_TIME = 1.4;
// The vineyard's layout.
function vineyardPickups({ world, on, SUPPLY }) {
    const cx = COMPOUND.x, cz = COMPOUND.z, y = H_COMPOUND, [swTower, neTower] = world.towerTops;
    const boxes = [
      { kind: 'parts', where: 'generator shed', at: on(cx + 22.6, cz + 11.3) },
      { kind: 'parts', where: 'villa terrace', at: on(cx + 16, cz + 0.2, y + 0.5) },
      { kind: 'parts', where: 'beside the barn', at: on(cx - 23.2, cz - 12) },
      { kind: 'parts', where: 'ladder tower', at: on(swTower.x + 0.9, swTower.z + 0.9, swTower.y) },
      { kind: 'parts', where: 'outside the west gate', at: on(cx - 37, cz + 11.6) },
      { kind: 'weapon', weapon: 'g43', where: 'stairs tower', at: on(neTower.x - 0.7, neTower.z + 0.9, neTower.y) },
      { kind: 'weapon', weapon: 'm1carbine', where: 'by the west wall', at: on(cx - 26, cz + 9) },
      { kind: 'weapon', weapon: 'delisle', where: 'behind the barn', at: on(cx - 10, cz - 18.7) },
      // The heavy weapons.
      { kind: 'weapon', weapon: 'trenchgun', where: 'yard near the barn', at: on(cx - 11, cz - 9.6) },
      { kind: 'weapon', weapon: 'mg42', where: 'by the north wall', at: on(cx - 13.5, cz + 22.6) },
      { kind: 'weapon', weapon: 'panzerschreck', where: 'outside the south wall', at: on(cx + 7.6, cz - 29.6) },
      { kind: 'weapon', weapon: 'panzerfaust', where: 'by the road', at: on(cx - 97, roadCenterZ(cx - 97) + 7.6) },
      { kind: 'weapon', weapon: 'piat', where: 'start hill', at: on(START_HILL.x + 40.5, START_HILL.z - 26) },
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
      // Heavy ammunition (for whichever heavy weapons you've found).
      ['heavy', cx - 14.5, cz - 6], ['heavy', cx + 35, cz + 5.4], ['heavy', cx - 37.2, cz - 9.4],
      ['heavy', sp.x + 8, sp.z + 1], ['heavy', cx - 150, rz(cx - 150, -9.4)], ['heavy', cx + 9, cz - 28.4],
    ]) boxes.push({ kind: 'supply', type, where: SUPPLY[type].name.toLowerCase(), at: on(x, z, yy) });
    const spawn = world.spawn;
    const benches = [
      { where: 'start', at: on(spawn.x + 2.5, spawn.z - 4) },
      { where: 'barn', at: on(cx - 6.6, cz - 15) },
    ];
  return { boxes, benches };
}

export class Pickups {
  constructor({ scene, world, player, input, audio, stealth, hud, profile }) {
    Object.assign(this, { scene, world, player, input, audio, stealth, hud, profile });
    const on = (x, z, yy) => new THREE.Vector3(x, world.floorAt(x, z, (yy ?? heightAt(x, z)) + 0.6), z);
    // What's where: the mission's layout (toolboxes, weapon crates, supply caches, workbenches).
    const layout = (activeMap().pickups ?? vineyardPickups)({ world, on, SUPPLY });
    this.boxes = layout.boxes;
    for (const b of this.boxes) {
      b.mesh = pickupModel(b.kind === 'supply' ? b.type : b.kind === 'weapon' ? 'weapon' : 'toolbox');
      // An unopened explosives crate goes up when it's shot (or caught in another blast).
      if (b.type === 'explosives') {
        const trap = { detonate: () => this.blowCrate(b) };
        b.mesh.traverse(o => { if (o.isMesh) { o.userData.trap = trap; world.raycastTargets.push(o); } });
      }
      b.mesh.position.copy(b.at);
      b.mesh.rotation.y = Math.random() * Math.PI;
      scene.add(b.mesh);
      b.opened = false;
    }
    this.benches = layout.benches;
    for (const b of this.benches) {
      b.mesh = pickupModel('bench');
      b.mesh.position.copy(b.at);
      b.mesh.rotation.y = Math.PI / 2;
      scene.add(b.mesh);
    }
    this.target = null;
    this.progress = 0;
    this.swinging = [];          // lids on their way open
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
      for (const c of [...this.boxes, ...this.benches]) showDetail(c.mesh, c.at.distanceTo(p.pos) < DETAIL_RANGE);
    }
    // Lids swing open (and fall back a little past upright).
    this.swinging = this.swinging.filter(m => {
      const lid = m.userData.lid, to = m.userData.openAngle;
      lid.rotation.x = Math.max(to, lid.rotation.x - dt * 5);
      return lid.rotation.x > to;
    });
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
      this.lift(b);
      if (b.type === 'explosives') { b.mesh.traverse(o => { delete o.userData.trap; }); if (b.hotspot) b.hotspot.broken = true; } // emptied: nothing left to go off
      this.stealth.noise(b.at.clone(), 4, 'rustle');
      this.audio.pickup();
      this.hud.message(`${SUPPLY[b.type].name} · ${got.join(' · ').toUpperCase()}`, '');
      return;
    }
    b.opened = true;
    this.lift(b);
    this.stealth.noise(b.at.clone(), 4, 'rustle');
    this.audio.pickup();
    if (b.kind === 'weapon') {
      const w = CATALOG[b.weapon];
      if (w.slot === 'heavy') {
        // A heavy weapon comes with its first ammunition, and goes straight into the heavy slot (key 3).
        const pool = this.arsenal.heavyAmmo, start = HEAVY_AMMO[b.weapon];
        const isNew = this.profile.addWeapon(b.weapon);
        pool[b.weapon] = Math.min(start.max, pool[b.weapon] + start.start);
        this.onHeavy?.(b.weapon);
        this.hud.message(`${isNew ? 'WEAPON FOUND' : 'TAKEN'} · ${w.name.toUpperCase()} · ${start.start} ${w.ammoName.toUpperCase()} · PRESS 3`, 'head');
        return;
      }
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

  // Open the lid (it swings up in tick) and take out what you took.
  lift(b) {
    this.swinging.push(b.mesh);
    if (b.mesh.userData.taken) b.mesh.userData.taken.visible = false;
  }

  // Explosives crates are weak spots too: the binoculars can tag them (an orange triangle on
  // screen, the compass and the map) until they're emptied or blown.
  registerCrates(hotspots) {
    for (const b of this.boxes) {
      if (b.type !== 'explosives') continue;
      const meshes = [];
      b.mesh.traverse(o => { if (o.isMesh) meshes.push(o); });
      b.hotspot = hotspots.add({ kind: 'crate', title: 'EXPLOSIVES CRATE', meshes });
    }
  }

  // An explosives crate blows up: a blast like a satchel charge (it can wreck a vehicle parked
  // close by, the Panzer included), and it's gone. Once you've emptied it, there's nothing to go off.
  blowCrate(b) {
    if (b.opened || b.destroyed) return;
    b.destroyed = b.opened = true;
    if (b.hotspot) b.hotspot.broken = true;
    b.mesh.visible = false;
    b.mesh.traverse(o => { const i = this.world.raycastTargets.indexOf(o); if (i >= 0) this.world.raycastTargets.splice(i, 1); });
    this.explosions.explode(b.at.clone().add(new THREE.Vector3(0, 0.3, 0)), { radius: 6, hurt: 11, size: 1.2, noise: 260, heavy: true, chain: 5.5, label: 'EXPLOSIVES CRATE' });
  }

  // Another blast nearby sets off unopened explosives crates.
  caughtIn(at, radius, pending) {
    for (const b of this.boxes) {
      if (b.type !== 'explosives' || b.opened || b.chain) continue;
      if (b.at.distanceTo(at) < Math.min(radius, 5)) { b.chain = true; pending.push({ t: 0.3, run: () => this.blowCrate(b) }); }
    }
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
