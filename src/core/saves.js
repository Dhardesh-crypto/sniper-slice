// Saving and loading the mission. Slots: three manual ones (pause menu; not while guards are
// fighting you, as in SE5), an autosave at each objective, and a quick save (F5 anywhere,
// F9 loads it). A save is a versioned JSON snapshot in localStorage.
// Loading reloads the page and rebuilds the world from the snapshot after it's built: the
// same compound, then every soldier, body, wreck, trap, objective and timer put back.
import * as THREE from 'three';

const PREFIX = 'sniper-slice.save.';
const PENDING = 'sniper-slice.pendingLoad';
export const VERSION = 1;
export const SLOTS = ['1', '2', '3', 'auto', 'quick'];
const v3 = (v) => v ? [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)] : null;
const toV = (a) => a ? new THREE.Vector3().fromArray(a) : null;

export class Saves {
  constructor(game) {
    this.g = game; // { world, player, arsenal, items, stealth, masking, ai, hotspots, tank, explosions, mission, search, mapView, hud }
  }

  // ---- what may be saved ----
  inCombat() { return this.g.ai.guards().some(s => s.brain.mode === 'combat' || s.brain.mode === 'alarm'); }
  canSave(slot) {
    const { player, mission } = this.g;
    if (player.dead) return 'You are dead';
    if (mission.done) return 'The mission is over';
    if (player.climb || player.locked || player.carrying) return 'Not while climbing, dragging or in a takedown';
    if (slot !== 'quick' && slot !== 'auto' && this.inCombat()) return 'Not while guards are fighting you';
    return null;
  }

  // ---- slots ----
  read(slot) {
    try { const d = JSON.parse(localStorage.getItem(PREFIX + slot) || 'null'); return d && d.version === VERSION ? d : null; }
    catch { return null; }
  }
  list() { return SLOTS.map(slot => ({ slot, save: this.read(slot) })); }

  save(slot) {
    const why = this.canSave(slot);
    if (why) return { ok: false, why };
    try {
      const data = this.snapshot();
      const json = JSON.stringify(data);    // fully built before anything is written
      localStorage.setItem(PREFIX + slot, json);
      return { ok: true };
    } catch (e) {
      return { ok: false, why: e?.name === 'QuotaExceededError' ? 'Browser storage is full' : 'Could not save' };
    }
  }

  // Loading = reload with a note, then apply() once the world is built.
  load(slot) {
    if (!this.read(slot)) return false;
    try { sessionStorage.setItem(PENDING, slot); } catch { return false; }
    location.reload();
    return true;
  }

  // Called once at startup, after the world is built: apply a load the player asked for.
  applyPending() {
    let slot = null;
    try { slot = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); } catch { /* storage blocked */ }
    const data = slot && this.read(slot);
    if (!data) return null;
    this.apply(data);
    return slot;
  }

  // ---- snapshot ----
  snapshot() {
    const { world, player, arsenal, items, stealth, masking, ai, hotspots, tank, explosions, mission, search, mapView } = this.g;
    const objDone = mission.objectives.filter(o => !o.hidden && o.done).length, objAll = mission.objectives.filter(o => !o.hidden).length;
    const mins = Math.floor(mission.time / 60), secs = Math.floor(mission.time % 60);
    const rifle = arsenal.weapons.rifle, pistol = arsenal.weapons.pistol;
    return {
      version: VERSION,
      savedAt: Date.now(),
      label: `${mins}:${String(secs).padStart(2, '0')} · ${objDone}/${objAll} objectives · ${mission.stats.kills} kills`,
      worldTime: world.time,
      player: { pos: v3(player.pos), yaw: player.yaw, pitch: player.pitch, stance: player.stance, health: player.health, heartRate: player.heartRate },
      arsenal: {
        current: arsenal.current,
        rifle: { mag: rifle.mag, ammo: { ...rifle.ammo }, loaded: rifle.loaded, zeroIndex: rifle.zeroIndex },
        pistol: { mag: pistol.mag, reserve: pistol.reserve, zeroIndex: pistol.zeroIndex },
      },
      items: {
        count: Object.fromEntries(Object.entries(items.count).map(([k, n]) => [k, n === Infinity ? -1 : n])),
        selected: items.selected,
        placed: items.placed.filter(t => !t.done).map(t => ({
          id: t.id, pos: v3(t.mesh.getWorldPosition(new THREE.Vector3())), yaw: t.mesh.rotation.y, fuse: t.fuse, arm: t.arm,
          on: t.on === 'vehicle' ? hotspots.list.find(h => h.meshes[0] === t.mesh.parent || h.meshes[0].parent === t.mesh.parent)?.title ?? null : null,
        })),
      },
      soldiers: world.soldiers.filter(s => !s.range).map(s => ({
        name: s.name, reinforcement: s.name === 'Reinforcement', alive: s.alive, hp: s.hp,
        pos: v3(s.root.position), yaw: s.root.rotation.y, homeYaw: s.homeYaw, home: v3(s.home),
        searched: !!s.searched, hidden: !!s.hidden, found: !!s.found, tagged: !!s.tagged, quietDeath: !!s.quietDeath,
        deathClip: s.deathClip ?? null,
        rifle: !s.alive && s.drop ? { pos: s.char.rifle.position.toArray(), quat: s.char.rifle.quaternion.toArray() } : null,
        aware: s.aware && { state: s.aware.state, meter: s.aware.meter, stimulus: v3(s.aware.stimulus), why: s.aware.why ?? null, bodiesSeen: s.aware.bodiesSeen ? [...s.aware.bodiesSeen].map(b => world.soldiers.indexOf(b)) : [] },
        brain: s.brain && { routeI: s.brain.routeI, lastSeen: v3(s.brain.lastSeen) },
      })),
      hotspots: hotspots.list.map(h => ({ title: h.title, hits: h.hits, broken: !!h.broken, exploded: !!h.exploded, tagged: !!h.tagged })),
      ai: {
        alarm: { on: ai.alarm.on, working: ai.alarm.working, knownDead: !!ai.alarm.knownDead, count: ai.alarm.count, quietT: ai.alarm.quietT, reinforceT: ai.alarm.reinforceT ?? null },
        reinforced: ai.reinforced, radioDown: !!ai.radioDown,
        truck: ai.truck ? { x: ai.truck.x, stalled: !!ai.truck.stalled, unloaded: !!ai.truck.unloaded, parkT: ai.truck.parkT } : null,
      },
      stealth: { wariness: stealth.wariness, alarm: stealth.alarm },
      masking: { time: masking.time, nextPlane: masking.planeT >= 0 ? masking.time + 20 : masking.nextPlane, nextBarrage: masking.nextBarrage, generatorOn: masking.generatorOn },
      tank: { alive: tank.alive, turretYaw: tank.turretYaw },
      fires: explosions.fires.map(f => ({ at: v3(f.at), t: f.t })),
      mission: { time: mission.time, stats: { ...mission.stats }, objectives: mission.objectives.map(o => ({ id: o.id, done: o.done, hidden: !!o.hidden })) },
      papers: search.papers,
      loadout: this.g.arsenal.loadout ?? null,
      opened: this.g.pickups ? this.g.pickups.boxes.map(b => b.opened) : [],
      seen: this.g.pickups ? this.g.pickups.boxes.map(b => !!b.seen) : [],
      destroyed: this.g.pickups ? this.g.pickups.boxes.map(b => !!b.destroyed) : [],
      waypoint: mapView.waypoint ? { x: mapView.waypoint.x, z: mapView.waypoint.z } : null,
    };
  }

  // ---- restore ----
  apply(d) {
    const { world, player, arsenal, items, stealth, masking, ai, hotspots, tank, explosions, mission, search, mapView } = this.g;
    world.time = d.worldTime ?? 0;

    // Mission clock, score and objectives (set first: nothing below should re-trigger them).
    mission.time = d.mission.time;
    Object.assign(mission.stats, d.mission.stats);
    for (const o of d.mission.objectives) { const m = mission.obj(o.id); if (m) { m.done = o.done; m.hidden = o.hidden; } }
    search.papers = d.papers ?? 0;

    // The reinforcement truck, if it came.
    ai.reinforced = d.ai.reinforced;
    ai.radioDown = d.ai.radioDown;
    if (d.ai.truck) {
      ai.sendTruck({ quiet: true });
      Object.assign(ai.truck, { x: d.ai.truck.x, stalled: d.ai.truck.stalled, unloaded: true, parkT: Math.max(25, d.ai.truck.parkT ?? 0) });
      ai.tickTruck(0);
    }

    // Soldiers: the original ones by order; reinforcements are spawned again.
    const originals = world.soldiers.filter(s => !s.range);
    let oi = 0, ri = 0;
    const restored = [];
    for (const sd of d.soldiers) {
      let s;
      if (sd.reinforcement) s = ai.spawnReinforcement(toV(sd.pos), sd.yaw, ri++);
      else s = originals[oi++];
      if (!s) continue;
      restored.push([s, sd]);
      s.root.position.fromArray(sd.pos);
      s.root.rotation.y = sd.yaw;
      s.targetYaw = sd.alive ? sd.yaw : s.targetYaw;
      s.homeYaw = sd.homeYaw;
      if (sd.home) s.home.fromArray(sd.home);
      s.searched = sd.searched; s.hidden = sd.hidden; s.found = sd.found; s.tagged = sd.tagged; s.quietDeath = sd.quietDeath;
      if (!sd.alive) s.restoreDead(sd.deathClip ?? 'deathFwd', sd.rifle);
      else {
        s.hp = sd.hp;
        if (sd.aware) Object.assign(s.aware, { state: sd.aware.state, meter: sd.aware.meter, stimulus: toV(sd.aware.stimulus), why: sd.aware.why, lastNews: stealth.time });
        if (sd.aware?.state !== 'calm') s.react(sd.aware.state, toV(sd.aware.stimulus));
        if (sd.brain && s.brain) { s.brain.routeI = sd.brain.routeI ?? 0; s.brain.lastSeen = toV(sd.brain.lastSeen); }
      }
      s.root.updateMatrixWorld(true);
    }
    for (const [s, sd] of restored) if (sd.aware?.bodiesSeen?.length) s.aware.bodiesSeen = new Set(sd.aware.bodiesSeen.map(i => world.soldiers[i]).filter(Boolean));

    // Weak spots and wrecks (visuals only: their explosions already happened).
    for (const hs of d.hotspots) {
      const h = hotspots.list.find(x => x.title === hs.title);
      if (!h) continue;
      h.hits = hs.hits; h.broken = hs.broken; h.tagged = hs.tagged;
      if (h.kind === 'siren' && hs.broken) { const [horn] = h.meshes; horn.rotation.x = 0.9; horn.position.y -= 0.15; }
      if (hs.exploded && !h.exploded) {
        hotspots.wreck(h);
        if (h.title === 'RADIO TRUCK ENGINE') world.radio.antenna.visible = false;
        if (h.kind === 'tank') { const cb = tank.onDestroyed; tank.onDestroyed = null; tank.destroyed(); tank.onDestroyed = cb; }
      }
    }
    if (!d.tank.alive && tank.alive) { const cb = tank.onDestroyed; tank.onDestroyed = null; tank.destroyed(); tank.onDestroyed = cb; }
    tank.turretYaw = d.tank.turretYaw; tank.turretPivot.rotation.y = tank.turretYaw;
    for (const f of d.fires ?? []) explosions.fires.push({ at: toV(f.at), t: f.t, emitT: 0 });

    // Alarm, siren, wariness, masking timers.
    Object.assign(ai.alarm, { on: d.ai.alarm.on, working: d.ai.alarm.working, knownDead: d.ai.alarm.knownDead, count: d.ai.alarm.count, quietT: d.ai.alarm.quietT, reinforceT: d.ai.alarm.reinforceT ?? undefined, runner: null });
    if (!ai.alarm.working) world.siren.wire.visible = false;
    stealth.wariness = d.stealth.wariness;
    stealth.alarm = d.stealth.alarm;
    if (ai.alarm.on) this.g.audio.setSiren(1);
    Object.assign(masking, { time: d.masking.time, nextPlane: d.masking.nextPlane, nextBarrage: d.masking.nextBarrage, generatorOn: d.masking.generatorOn });

    // You, your rifle and your kit.
    player.pos.fromArray(d.player.pos); player.prevPos.copy(player.pos);
    player.yaw = d.player.yaw; player.pitch = d.player.pitch;
    player.setStance(d.player.stance);
    player.eye = player.prevEye = { stand: 1.65, crouch: 0.85, prone: 0.32 }[d.player.stance] ?? player.eye;
    player.health = d.player.health; player.heartRate = d.player.heartRate; player.hurtT = 99;
    const rifle = arsenal.weapons.rifle, pistol = arsenal.weapons.pistol;
    arsenal.current = d.arsenal.current;
    Object.assign(rifle.ammo, d.arsenal.rifle.ammo);
    rifle.loaded = d.arsenal.rifle.loaded; rifle.mag = d.arsenal.rifle.mag; rifle.zeroIndex = d.arsenal.rifle.zeroIndex;
    pistol.mag = d.arsenal.pistol.mag; pistol.reserve = d.arsenal.pistol.reserve; pistol.zeroIndex = d.arsenal.pistol.zeroIndex;
    items.count = Object.fromEntries(Object.entries(d.items.count).map(([k, n]) => [k, n < 0 ? Infinity : n]));
    items.selected = d.items.selected;
    for (const t of d.items.placed) items.restorePlaced(t);
    mapView.waypoint = d.waypoint;
    // The loadout you carried, and the boxes you'd already opened.
    if (d.loadout) this.g.applyLoadout(d.loadout);
    (d.seen ?? []).forEach((v, i) => { const b = this.g.pickups?.boxes[i]; if (b && v) b.seen = true; });
    (d.destroyed ?? []).forEach((v, i) => { const b = this.g.pickups?.boxes[i]; if (b && v) { b.destroyed = b.opened = true; b.mesh.visible = false; b.mesh.traverse(o => { delete o.userData.trap; }); } });
    (d.opened ?? []).forEach((o, i) => { const b = this.g.pickups?.boxes[i]; if (o && b && !b.opened) { b.opened = true; b.mesh.userData.lid.rotation.x = -1.2; b.mesh.userData.lid.position.z -= 0.1; } });
  }
}
