// Zones: a mission's garrison in several places (a lodge, a camp, a meadow post), each with its
// own men and its own telephone line, instead of one garrison that wakes as one. A map declares
//   zones: [{ id: 'lodge', name: 'the lodge', x, z, r, phone: [x, z] }, …]
// (phone optional: a free spot near the place is found for it). A map without zones is as before.
//
// What it changes is the alarm (ai/guards.js soundAlarm, tickAlarm):
//   - the siren wakes the place the alarm was raised over (where you were last seen, or what the
//     runner's news was about) and the place the siren stands in: those men come for you;
//   - the places within earshot of that one (`hear` metres between their edges) send two men each
//     to look; the rest of their men stand to, watching, at their posts;
//   - everywhere else hears nothing, until the alarm is telephoned round, PHONE_DELAY seconds
//     after it sounds: then the whole garrison knows, as it used to at once;
//   - a telephone line can be cut (a pole with a box, in each place: hold E): a place whose line
//     is cut is never telephoned and can't telephone, so an alarm raised there stays there. A
//     wrecked radio (mission.radioDestroyed, the Town's line) cuts them all.
// The class is plain arithmetic (tests/zones.test.js); the poles are set up by placePhones().
import * as THREE from 'three';

export const PHONE_DELAY = 20;      // s from the siren to the telephone call that warns the rest
export const PATROL = 2;            // men a neighbouring place sends to look

export class Zones {
  constructor(list, { hear = 220 } = {}) {
    this.list = list.map(z => ({ r: 60, ...z, cut: false }));
    this.hear = hear;
    this.cutAll = false;            // (the radio wrecked, the trunk line cut: nobody telephones anybody)
  }

  get(id) { return this.list.find(z => z.id === id) ?? null; }

  // The zone a spot belongs to: the one it is deepest inside, or failing that nearest the edge of.
  of(x, z) {
    let best = null, bd = Infinity;
    for (const k of this.list) { const d = Math.hypot(x - k.x, z - k.z) - k.r; if (d < bd) { bd = d; best = k; } }
    return best;
  }

  // The places that hear a siren raised in `zone`: their edges within `hear` m of its edge.
  neighbours(zone) {
    return this.list.filter(k => k !== zone && Math.hypot(k.x - zone.x, k.z - zone.z) - k.r - zone.r < this.hear);
  }

  lineUp(zone) { return !this.cutAll && !zone.cut; }

  // Who does what when the alarm is raised over `zone` with the siren standing in `sirenZone`:
  //   full    come for you at once;
  //   patrol  send PATROL men, the rest stand to;
  //   phoned  are warned PHONE_DELAY later (none if the alarm zone's own line is down);
  //   deaf    never hear of it.
  plan(zone, sirenZone = zone) {
    const full = [...new Set([zone, sirenZone])];
    const patrol = this.neighbours(zone).filter(k => !full.includes(k));
    const rest = this.list.filter(k => !full.includes(k));
    const canCall = this.lineUp(zone);
    const phoned = canCall ? rest.filter(k => this.lineUp(k)) : [];
    return { full, patrol, phoned, deaf: rest.filter(k => !phoned.includes(k) && !patrol.includes(k)) };
  }
}

// The telephone poles: one per zone, at its `phone` spot or the first free place found round it,
// each a lever to hold E at (world/interact.js). Cutting one marks the zone, sets the mission's
// flag `line-<id>` (so a saved game remembers it) and makes a little noise.
export function placePhones({ zones, scene, world, interactions, mission, hud, stealth }) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x5b4a36, roughness: 1 }), tin = new THREE.MeshStandardMaterial({ color: 0x4a5148, roughness: 0.6, metalness: 0.4 });
  for (const zone of zones.list) {
    let at = null;
    const tries = zone.phone ? [zone.phone] : Array.from({ length: 16 }, (_, i) => [zone.x + Math.cos(i * 2.4) * zone.r * (0.5 + 0.04 * i), zone.z + Math.sin(i * 2.4) * zone.r * (0.5 + 0.04 * i)]);
    for (const [x, z] of tries) {
      const y = world.groundAt(x, z);
      if (Math.abs(world.floorAt(x, z, y + 3) - y) > 0.3 || !world.clearAbove(x, z, y, y + 2.2) || world.waterAt(x, z) != null) continue;
      at = new THREE.Vector3(x, y, z); break;
    }
    if (!at) continue;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 4.6, 7), wood); pole.position.set(at.x, at.y + 2.3, at.z);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.2), tin); box.position.set(at.x, at.y + 1.25, at.z + 0.16);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), wood); arm.position.set(at.x, at.y + 4.3, at.z);
    for (const m of [pole, box, arm]) { m.castShadow = true; scene.add(m); }
    zone.phoneAt = at; zone.phoneBox = box;
    const cut = (quiet) => {
      zone.cut = true; box.rotation.z = 0.5; box.position.y = at.y + 1.05;      // (the box hangs open)
      mission.set(`line-${zone.id}`);
      if (!quiet) { stealth?.noise(at.clone(), 5, 'sabotage'); hud.message(`LINE CUT · ${zone.name.toUpperCase()} CAN'T BE TELEPHONED, OR TELEPHONE`, ''); }
    };
    zone.lever = { at: at.clone().setZ(at.z + 0.6), label: `CUT THE TELEPHONE LINE · ${zone.name.toUpperCase()}`, busy: 'CUTTING THE LINE…', time: 2.5, onUse: () => cut(false) };
    interactions.addLever(zone.lever);
    const mine = interactions.levers.at(-1);          // (the lever as the interactions keep it: a copy)
    zone.restore = () => { if (mission.flags[`line-${zone.id}`] && !zone.cut) { cut(true); mine.used = true; } };
  }
}
