// Operation Vineyard: the one mission. Kill Oberst Krause, who walks a routine around
// the compound (terrace, radio truck, yard); optionally wreck his field radio so no
// reinforcements can be called, and take his papers; then get back to the start hill.
// Also keeps the score for the end screen.
import * as THREE from 'three';
import { START_HILL, COMPOUND, PLAY_HALF_X, PLAY_HALF_Z, inPlayArea, waterAt, activeMap } from '../world/terrain.js';
import { tickObjectives, objectiveMarkers } from './objectives.js';

const RADIO_TIME = 2.4;     // seconds holding E at the radio truck
const EXTRACT_RADIUS = 10;
// The escape (once the job is done and the pick-ups open): its own part of the mission. Leave
// unheard and you walk out. Let the alarm go up, before or after, and the way you'd be expected
// to leave is watched (that pick-up closes), more men are called in, and after a while the
// partisans open one last way out on the side furthest from the garrison.
const ESCAPE_CALL = 40;      // s of alarm during the escape before more men are sent for
const ESCAPE_LAST = 75;      // s of alarm before the last way out opens

// def (from the mission module): { target: name, objectives: [...], extraction: {x, z},
//   targetArea: {x, z} (marker until the target is tagged), killText, tick(mission, dt) }.
// The objectives 'officer' (kill the target), 'papers', 'radio' and 'extract' are handled here.
// The others say themselves what counts as done (mission/objectives.js: kill, destroy, flag,
// reach, observe, read, when, anyOf; needs, revealedBy; marker); a set piece that has to run
// (a train, a sinking ship) still lives in the module's tick and sets a flag (mission.set).
export class Mission {
  constructor({ world, player, arsenal, stealth, ai, search, input, audio, fx, hud, def = {} }) {
    Object.assign(this, { world, player, arsenal, stealth, ai, search, input, audio, fx, hud, def });
    this.time = 0;
    this.done = false;
    this.officer = world.soldiers.find(s => s.officer);
    if (this.officer) this.officer.name = def.target ?? 'Oberst Krause';
    this.radio = world.radio;
    this.radioProgress = 0;
    const exAt = def.extraction ?? START_HILL;
    const ex = new THREE.Vector3(exAt.x, 0, exAt.z);
    ex.y = world.groundAt(ex.x, ex.z);
    this.pickups = [{ at: ex, name: 'EXTRACTION' }];   // (more with setPickups: mission/approaches.js)
    this.smokeT = 0;
    this.objectives = (def.objectives ?? [
      { id: 'officer', text: 'Eliminate Oberst Krause' },
      { id: 'radio', text: 'Wreck the field radio (no reinforcements)', optional: true },
      { id: 'papers', text: "Take the Oberst's papers", optional: true },
      { id: 'tank', text: 'Destroy the Panzer (AP rounds or a satchel)', optional: true },
      { id: 'safe', text: "Open the Oberst's safe and take his orders", optional: true },
      { id: 'extract', text: 'Get back to the start hill', hidden: true },
    ]).map(o => ({ done: false, ...o }));
    this.flags = {};      // set by levers, set pieces and the like (set): what `flag` objectives wait for
    this.stats = { shots: 0, hits: 0, kills: 0, headshots: 0, takedowns: 0, longest: 0, longKills: 0, spotted: 0, bodiesFound: 0 };
    this.onComplete = null;
  }

  obj(id) { return this.objectives.find(o => o.id === id); }
  set(flag) { this.flags[flag] = true; }

  complete(id, message) {
    const o = this.obj(id);
    if (!o || o.done) return;
    o.done = true;
    this.hud.message(message, '');
    this.audio.pickup();
  }

  // ---- hooks from the rest of the game ----
  onShot() { this.stats.shots++; }
  onHit(e) {
    if (e.miss || e.already) return;
    this.stats.hits++;
    if (e.killed) {
      this.stats.kills++;
      if (e.zone === 'head') this.stats.headshots++;
      this.stats.longest = Math.max(this.stats.longest, e.distance ?? 0);
      if ((e.distance ?? 0) >= 150) this.stats.longKills++;
    }
  }
  onRaise(why) {
    if (why === 'seen') this.stats.spotted++;
    if (why === 'body') this.stats.bodiesFound++;
  }

  // The radio truck blew up (an engine shot): the radio goes with it.
  radioDestroyed() {
    this.ai.radioDown = true;
    this.complete('radio', 'RADIO TRUCK DESTROYED · NO REINFORCEMENTS CAN BE CALLED');
  }

  blastKills(n) { this.stats.kills += n; }

  tankDestroyed() { this.complete('tank', 'PANZER DESTROYED'); }

  // ---- per tick ----
  tick(dt) {
    if (this.done) return;
    this.time += dt;
    const off = this.obj('officer');
    const killedNow = off && this.officer && !this.officer.alive && !off.done;
    if (killedNow) this.complete('officer', this.def.killText ?? 'TARGET ELIMINATED · GET TO THE START HILL');
    if (this.search.papers > 0) this.complete('papers', this.def.papersText ?? "OBERST'S PAPERS TAKEN");
    if (this.radio) this.tickRadio(dt);
    tickObjectives(this);
    this.def.tick?.(this, dt);
    // The extraction opens once every main (not optional) objective is done.
    const ex = this.obj('extract');
    if (ex.hidden && this.objectives.every(o => o === ex || o.optional || o.done)) {
      ex.hidden = false;
      if (!killedNow || off.optional) this.hud.message(this.def.extractText ?? 'ALL DONE · GET TO THE PICK-UP', '');   // (a kill message already says so)
    }
    if (!ex.hidden) {
      this.tickEscape(dt);
      // Green smoke marks the pick-up.
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.35;
        for (const pk of this.pickups) if (!pk.closed) this.fx.emit(pk.at.clone().setY(pk.at.y + 0.5), new THREE.Vector3(0, 1, 0), { color: 0x7fbf6a, count: 2, speed: 2.5, size: 3, life: 7, grow: 2.5, gravity: -0.3 });
      }
      if (!this.player.dead && this.pickups.some(pk => !pk.closed && Math.hypot(this.player.pos.x - pk.at.x, this.player.pos.z - pk.at.z) < EXTRACT_RADIUS)) {
        ex.done = true;
        this.finish();
      }
    }
  }

  tickEscape(dt) {
    // (begun here, not at the kill: a loaded game picks it up again where it stands)
    const e = this.escape ??= { hot: false, hotT: 0, called: false, last: false, alarms: this.ai.alarm.count };
    // (the siren sounding now, or one raised since the escape began)
    if (!e.hot && (this.stealth.alarm || this.ai.alarm.count > e.alarms)) {
      e.hot = true;
      const open = this.pickups.filter(pk => !pk.closed);
      if (open.length > 1) {
        // The one nearest the garrison goes: that is where they look first.
        const c = activeMap().focus ?? COMPOUND;
        const lost = open.reduce((a, b) => (Math.hypot(a.at.x - c.x, a.at.z - c.z) < Math.hypot(b.at.x - c.x, b.at.z - c.z) ? a : b));
        lost.closed = true;
        this.hud.message(`THE ALARM IS UP · THEY ARE WATCHING ${lost.name === 'EXTRACTION' ? 'THE WAY YOU CAME' : lost.name} · TAKE ANOTHER WAY OUT`, 'wound');
      } else this.hud.message('THE ALARM IS UP · GET OUT', 'wound');
    }
    if (!e.hot) return;
    e.hotT += dt;
    if (!e.called && e.hotT > ESCAPE_CALL) {
      e.called = true;
      if (!this.ai.reinforced && !this.ai.radioDown) { this.ai.sendTruck?.({ quiet: true }); this.hud.message('MORE OF THEM ARE COMING · KEEP MOVING', 'wound'); }
    }
    if (!e.last && e.hotT > ESCAPE_LAST) {
      e.last = true;
      const at = this.lastWayOut();
      if (at) { this.pickups.push({ at, name: "PARTISANS' WAY OUT" }); this.hud.message("THE PARTISANS HAVE OPENED ONE LAST WAY OUT · FOLLOW THE SMOKE", ''); }
    }
  }

  // Where the partisans wait: of sixteen spots round the edge of the playable ground, the dry one
  // furthest from every living guard (and at least 150 m from the pick-ups there already are).
  lastWayOut() {
    const guards = this.world.soldiers.filter(s => s.alive && !s.range).map(s => s.root.position);
    let best = null, bd = 0;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, x = Math.cos(a) * PLAY_HALF_X * 0.86, z = Math.sin(a) * PLAY_HALF_Z * 0.86;
      if (!inPlayArea(x, z) || waterAt(x, z) != null) continue;
      if (this.pickups.some(pk => Math.hypot(pk.at.x - x, pk.at.z - z) < 150)) continue;
      const d = Math.min(...guards.map(g => Math.hypot(g.x - x, g.z - z)), 1e4);
      if (d > bd) { bd = d; best = new THREE.Vector3(x, this.world.groundAt(x, z), z); }
    }
    return best;
  }

  // The pick-up points: any of them ends the mission once it's open (the start, and the other
  // ways in: mission/approaches.js). [{ at, name }]; the first is the mission's own.
  setPickups(list) { this.pickups = list.map((p, i) => ({ at: p.at.clone(), name: i ? `PICK-UP · ${p.side.toUpperCase()}` : 'EXTRACTION' })); }

  radioOption() {
    if (!this.radio || !this.obj('radio') || this.obj('radio').done || this.player.climb) return null;
    const p = this.player.pos, j = this.radio.standAt;
    if (Math.hypot(p.x - j.x, p.z - j.z) > 1.5 || Math.abs(p.y - j.y) > 1) return null;
    return { label: '{E} · WRECK THE RADIO', progress: this.radioProgress };
  }

  tickRadio(dt) {
    if (!this.radioOption() || !this.input.down('KeyE') || this.player.moving) { this.radioProgress = 0; return; }
    this.radioProgress += dt / RADIO_TIME;
    if (this.radioProgress >= 1) {
      this.radioProgress = 0;
      this.ai.radioDown = true;
      this.radio.antenna.rotation.z = 1.1; // snapped antenna
      this.fx.emit(this.radio.pos.clone().setY(this.radio.pos.y + 1.5), new THREE.Vector3(0, 1, 0), { color: 0xffe0a0, count: 8, speed: 2.5, size: 0.06, life: 0.4, grow: 1, gravity: 4 });
      this.audio.click(0, 1500, 0.45);
      this.stealth.noise(this.player.pos.clone(), 6, 'sabotage');
      this.complete('radio', 'RADIO WRECKED · NO REINFORCEMENTS CAN BE CALLED');
    }
  }

  // Something you can't undo went wrong (the train got away): the mission is lost.
  fail(why) {
    if (this.done) return;
    this.done = true;
    this.onFail?.(why);
  }

  finish() {
    this.done = true;
    this.onComplete?.(this.summary());
  }

  summary() {
    const s = this.stats, alarms = this.ai.alarm.count;
    const rating = alarms === 0 && s.spotted === 0 ? 'GHOST' : alarms === 0 ? 'SHADOW' : alarms === 1 ? 'SOLDIER' : 'LOUD';
    const mins = Math.floor(this.time / 60), secs = Math.floor(this.time % 60);
    return {
      rating,
      rows: [
        ['Time', `${mins}:${String(secs).padStart(2, '0')}`],
        ['Objectives', this.objectives.filter(o => !o.hidden).map(o => `${o.done ? '✓' : '✗'} ${o.text}`).join('\n')],
        ['Kills', `${s.kills} (${s.headshots} headshots, ${s.takedowns} takedowns)`],
        ['Parts found', String(s.parts ?? 0)],
        ['Hidden cache', s.perk ? 'Found' : 'Not found'],
        ['Documents found', `${this.interactions?.ownFound() ?? 0} / ${this.documentsTotal ?? 0}`],
        ['Longest kill', s.longest ? `${Math.round(s.longest)} m` : '–'],
        ['Accuracy', s.shots ? `${Math.round((100 * s.hits) / s.shots)} % (${s.hits}/${s.shots})` : '–'],
        ['Times spotted', String(s.spotted)],
        ['Bodies found', String(s.bodiesFound)],
        ['Alarms raised', String(alarms)],
        ['Escape', !this.escape ? '–' : this.escape.hot ? (this.escape.last ? 'Under alarm, by the last way out open' : 'Under alarm') : 'Unheard'],
      ],
    };
  }

  // Points for the compass and on-screen markers. Built once a tick and kept: the HUD, the map
  // and Kestrel's thoughts all ask for them every frame (don't change the list you get back).
  markers() {
    if (this.marks && this.marksAt === this.time) return this.marks;
    this.marksAt = this.time;
    const out = this.marks = [];
    if (this.obj('officer') && this.officer && !this.obj('officer').done) {
      const ta = this.def.targetArea ?? { x: COMPOUND.x + 8, z: COMPOUND.z - 4 };
      out.push(this.officer.tagged
        ? { pos: this.officer.root.position, kind: 'target', label: 'TARGET', height: 2.4 }
        : { pos: new THREE.Vector3(ta.x, this.world.groundAt(ta.x, ta.z), ta.z), kind: 'target', label: 'TARGET AREA', height: 9 });
    }
    if (this.radio && this.obj('radio') && !this.obj('radio').done) out.push({ pos: this.radio.pos, kind: 'radio', label: 'RADIO', height: 3.2 });
    if (this.obj('tank') && !this.obj('tank').done && this.tank) out.push({ pos: this.tank.root.position, kind: 'tank', label: 'PANZER', height: 3.4 });
    if (this.obj('papers') && this.officer && !this.officer.alive && !this.obj('papers').done) out.push({ pos: this.officer.bodyPosition(), kind: 'papers', label: 'PAPERS', height: 1.2 });
    for (const k of objectiveMarkers(this)) out.push({ ...k, pos: new THREE.Vector3(k.pos.x, k.pos.y, k.pos.z) });
    for (const m of this.def.markers?.(this) ?? []) out.push(m);
    if (!this.obj('extract').hidden) for (const pk of this.pickups) if (!pk.closed) out.push({ pos: pk.at, kind: 'extract', label: pk.name, height: 3 });
    return out;
  }
}
