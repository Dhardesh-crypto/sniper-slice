// Things to find in the mission (SE5 style):
//   toolboxes      hold E: a weapon part you don't have yet (kept for good, see core/profile.js)
//   weapon crates  hold E: a rare rifle (Gewehr 43, M1 Carbine, De Lisle) or a heavy weapon
//                  (Trench Gun, MG42, Panzerschreck, Panzerfaust, PIAT), kept for good
//   supply caches  hold E: ammo boxes, medical boxes, explosives crates, bottle crates (what you
//                  can carry; if you're full they stay for later)
//   workbenches    press E: change weapons and fit parts mid-mission (opens the loadout screen)
//   tools          press E: wire cutters (wire.js: a quick, quiet cut) and a crowbar (lids pried
//                  off in a moment, quietly), lying beside two of the supply caches
// Opening makes a little noise. Toolboxes, crates and benches show on the map; supply caches
// once you've been near them.
import * as THREE from 'three';
import { COMPOUND, H_COMPOUND, START_HILL, heightAt, roadCenterZ, activeMap } from './terrain.js';
import { CATALOG, HEAVY_AMMO, partById } from '../weapons/defs.js';
import { takeSupplies } from '../player/supplies.js';
import { PickupModels } from './pickup-models.js';

// What each kind of supply cache holds (rolled when you open it).
const SUPPLY = {
  ammo: { name: 'AMMO BOX', roll: (r, n) => ({ rifle: n(8, 12), pistol: r() < 0.5 ? n(6, 10) : 0, special: { subsonic: r() < 0.5 ? n(3, 5) : 0, ap: r() < 0.35 ? n(2, 3) : 0 } }) },
  medical: { name: 'MEDICAL BOX', roll: (r) => ({ kit: { bandage: 2, medkit: r() < 0.4 ? 1 : 0 } }) },
  explosives: { name: 'EXPLOSIVES CRATE', roll: (r) => { const x = r(); return { kit: { grenade: 2, mine: x < 0.45 ? 1 : 0, tnt: x >= 0.45 && x < 0.75 ? 1 : 0, satchel: x >= 0.75 ? 1 : 0 } }; } },
  bottles: { name: 'CRATE OF BOTTLES', roll: () => ({ kit: { bottle: 3 } }) },
  heavy: { name: 'HEAVY AMMUNITION', roll: (r, n) => ({ heavy: { trenchgun: n(6, 10), mg42: n(50, 100), panzerschreck: n(1, 2), panzerfaust: 1, piat: n(1, 2) } }) },
};
const SEEN_RANGE = 35;          // a cache shows on your map once you've been this close

const REACH = 1.6, OPEN_TIME = 2.4, CROWBAR_TIME = 0.8;   // (prying a lid by hand; with a crowbar)
// Tools lying about (one of each, beside a supply cache): kept for the mission.
export const TOOLS = {
  cutters: { name: 'WIRE CUTTERS', info: 'CUT BARBED WIRE QUICKLY AND QUIETLY' },
  crowbar: { name: 'CROWBAR', info: 'OPEN CRATES AND BOXES FASTER AND QUIETER' },
};
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
    this.models = new PickupModels(scene);
    this.boxes = layout.boxes;
    for (const b of this.boxes) {
      b.model = this.models.add(b.kind === 'supply' ? b.type : b.kind === 'weapon' ? 'weapon' : 'toolbox', b.at, Math.random() * Math.PI);
      // An unopened explosives crate goes up when it's shot (or caught in another blast): an
      // unseen box the size of the crate takes the bullets (the model itself is instanced).
      if (b.type === 'explosives') {
        const s = b.model.size;
        b.proxy = new THREE.Mesh(new THREE.BoxGeometry(s.x, s.y, s.z), new THREE.MeshBasicMaterial({ visible: false }));
        b.proxy.position.copy(b.at).setY(b.at.y + s.y / 2);
        b.proxy.rotation.y = b.model.rotY;
        b.proxy.userData.trap = { detonate: () => this.blowCrate(b) };
        scene.add(b.proxy);
        b.proxy.updateMatrixWorld(true);
        world.raycastTargets.push(b.proxy);
      }
      b.opened = false;
    }
    // The two tools, beside two of the supply caches (the same two for the run: loaded games agree).
    this.tools = new Set();
    const caches = this.boxes.filter(b => b.kind === 'supply'), rnd = seededRandom(caches.length * 7919 + (layout.boxes.length * 31));
    for (const [i, tool] of ['cutters', 'crowbar'].entries()) {
      if (!caches.length) break;
      const c = caches.splice(Math.floor(rnd() * caches.length), 1)[0];
      const a = rnd() * Math.PI * 2, at = on(c.at.x + Math.cos(a) * 0.8, c.at.z + Math.sin(a) * 0.8, c.at.y);
      const b = { kind: 'tool', tool, where: `by the ${SUPPLY[c.type].name.toLowerCase()}`, at, opened: false, model: toolModel(tool) };
      b.model.position.copy(at); b.model.rotation.y = a + i;
      scene.add(b.model);
      this.boxes.push(b);
    }
    this.benches = layout.benches;
    for (const b of this.benches) b.model = this.models.add('bench', b.at, Math.PI / 2);
    this.models.finish();
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
      for (const c of this.boxes) if ((c.kind === 'supply' || c.kind === 'tool') && !c.seen && c.at.distanceTo(p.pos) < SEEN_RANGE) c.seen = true;
    }
    this.models.tick(dt);   // lids swinging open
    const b = this.near();
    if (b !== this.target) { this.target = b; this.progress = 0; }
    if (!b || p.dead || p.climb || p.carrying || p.locked) { this.progress = 0; return; }
    if (this.benches.includes(b)) {
      if (this.input.wasPressed('KeyE')) this.onBench?.();
      return;
    }
    if (b.kind === 'tool') { if (this.input.wasPressed('KeyE')) this.open(b); return; }
    if (this.input.down('KeyE') && !p.moving) {
      this.progress += dt / (this.tools.has('crowbar') ? CROWBAR_TIME : OPEN_TIME);
      if (this.progress >= 1) this.open(b);
    } else this.progress = 0;
  }

  open(b) {
    this.progress = 0;
    if (b.kind === 'tool') {
      b.opened = true; b.model.visible = false;
      this.tools.add(b.tool);
      this.audio.pickup();
      this.hud.message(`${TOOLS[b.tool].name} · ${TOOLS[b.tool].info}`, 'head');
      return;
    }
    const quiet = this.tools.has('crowbar') ? 2 : 4;
    if (b.kind === 'supply') {
      const loot = SUPPLY[b.type].roll(Math.random, (a, c) => a + Math.floor(Math.random() * (c - a + 1)));
      const got = takeSupplies({ arsenal: this.arsenal, items: this.items }, loot);
      if (!got.length) { this.hud.message(`${SUPPLY[b.type].name} · YOU CAN'T CARRY ANY MORE: COME BACK LATER`, 'wound'); return; }
      b.opened = true;
      this.models.open(b.model);
      if (b.type === 'explosives') { delete b.proxy.userData.trap; if (b.hotspot) b.hotspot.broken = true; } // emptied: nothing left to go off
      this.stealth.noise(b.at.clone(), quiet, 'rustle');
      this.audio.pickup();
      this.hud.message(`${SUPPLY[b.type].name} · ${got.join(' · ').toUpperCase()}`, '');
      return;
    }
    b.opened = true;
    this.models.open(b.model);
    this.stealth.noise(b.at.clone(), quiet, 'rustle');
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

  // A saved game's state: opened (lid up, contents gone) or blown away.
  restore(b, { opened, destroyed }) {
    if (destroyed) {
      b.destroyed = b.opened = true;
      this.models.hide(b.model);
      this.dropProxy(b);
    } else if (opened && !b.opened && b.kind === 'tool') {
      b.opened = true; b.model.visible = false; this.tools.add(b.tool);
    } else if (opened && !b.opened) {
      b.opened = true;
      this.models.open(b.model, true);
      if (b.proxy) delete b.proxy.userData.trap;
    }
  }

  dropProxy(b) {
    if (!b.proxy) return;
    delete b.proxy.userData.trap;
    b.proxy.visible = false;
    const i = this.world.raycastTargets.indexOf(b.proxy);
    if (i >= 0) this.world.raycastTargets.splice(i, 1);
  }

  // Explosives crates are weak spots too: the binoculars can tag them (an orange triangle on
  // screen, the compass and the map) until they're emptied or blown.
  registerCrates(hotspots) {
    for (const b of this.boxes) {
      if (b.type !== 'explosives') continue;
      b.hotspot = hotspots.add({ kind: 'crate', title: 'EXPLOSIVES CRATE', meshes: [b.proxy] });
    }
  }

  // An explosives crate blows up: a blast like a satchel charge (it can wreck a vehicle parked
  // close by, the Panzer included), and it's gone. Once you've emptied it, there's nothing to go off.
  blowCrate(b) {
    if (b.opened || b.destroyed) return;
    b.destroyed = b.opened = true;
    if (b.hotspot) b.hotspot.broken = true;
    this.models.hide(b.model);
    this.dropProxy(b);
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
      ...this.boxes.filter(b => !b.opened && ((b.kind !== 'supply' && b.kind !== 'tool') || b.seen)).map(b => ({ pos: b.at, kind: b.kind === 'supply' || b.kind === 'tool' ? 'supply' : b.kind === 'weapon' ? 'crate' : 'toolbox' })),
      ...this.benches.map(b => ({ pos: b.at, kind: 'bench' })),
    ];
  }
}

export { partById };

function seededRandom(seed) {
  return () => { seed = (seed + 0x6D2B79F5) >>> 0; let x = seed; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
}

// The tools themselves, lying on the ground: a crowbar (a bent bar, the hook end flattened) and
// wire cutters (two red-handled arms). Small, so a faint glint ring marks where they lie.
function toolModel(tool) {
  const g = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0x4a4c50, metalness: 0.8, roughness: 0.45 });
  if (tool === 'crowbar') {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.75, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7a1e14, metalness: 0.6, roughness: 0.5 }));
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 6, 10, Math.PI), steel);
    hook.position.set(0.39, 0.05, 0); hook.rotation.z = -Math.PI / 2;
    bar.position.y = 0.015;
    g.add(bar, hook);
  } else {
    const handle = new THREE.MeshStandardMaterial({ color: 0xb02a1c, roughness: 0.7 });
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.018, 0.024), handle);
      arm.position.set(-0.08, 0.012, s * 0.03); arm.rotation.y = s * 0.12;
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.022), steel);
      jaw.position.set(0.14, 0.012, s * 0.008); g.add(arm, jaw);
    }
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
