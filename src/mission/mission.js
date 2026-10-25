// Operation Vineyard: the one mission. Kill Oberst Krause, who walks a routine around
// the compound (terrace, radio truck, yard); optionally wreck his field radio so no
// reinforcements can be called, and take his papers; then get back to the start hill.
// Also keeps the score for the end screen.
import * as THREE from 'three';
import { START_HILL, COMPOUND } from '../world/terrain.js';

const RADIO_TIME = 2.4;     // seconds holding E at the radio truck
const EXTRACT_RADIUS = 10;

// def (from the mission module): { target: name, objectives: [...], extraction: {x, z},
//   targetArea: {x, z} (marker until the target is tagged), killText, tick(mission, dt) }.
// The objectives 'officer' (kill the target) and 'extract' are handled here; the module and
// the rest of the game complete the others.
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
    this.extraction = ex;
    this.smokeT = 0;
    this.objectives = (def.objectives ?? [
      { id: 'officer', text: 'Eliminate Oberst Krause' },
      { id: 'radio', text: 'Wreck the field radio (no reinforcements)', optional: true },
      { id: 'papers', text: "Take the Oberst's papers", optional: true },
      { id: 'tank', text: 'Destroy the Panzer (AP rounds or a satchel)', optional: true },
      { id: 'safe', text: "Open the Oberst's safe and take his orders", optional: true },
      { id: 'extract', text: 'Get back to the start hill', hidden: true },
    ]).map(o => ({ done: false, ...o }));
    this.stats = { shots: 0, hits: 0, kills: 0, headshots: 0, takedowns: 0, longest: 0, spotted: 0, bodiesFound: 0 };
    this.onComplete = null;
  }

  obj(id) { return this.objectives.find(o => o.id === id); }

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
    if (off && this.officer && !this.officer.alive && !off.done) this.complete('officer', this.def.killText ?? 'TARGET ELIMINATED · GET TO THE START HILL');
    if (this.search.papers > 0) this.complete('papers', this.def.papersText ?? "OBERST'S PAPERS TAKEN");
    if (this.radio) this.tickRadio(dt);
    this.def.tick?.(this, dt);
    // The extraction opens once every main (not optional) objective is done.
    const ex = this.obj('extract');
    if (ex.hidden && this.objectives.every(o => o === ex || o.optional || o.done)) {
      ex.hidden = false;
      if (!off || off.optional) this.hud.message(this.def.extractText ?? 'ALL DONE · GET TO THE PICK-UP', '');
    }
    if (!ex.hidden) {
      // Green smoke marks the pick-up.
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.35;
        this.fx.emit(this.extraction.clone().setY(this.extraction.y + 0.5), new THREE.Vector3(0, 1, 0), { color: 0x7fbf6a, count: 2, speed: 2.5, size: 3, life: 7, grow: 2.5, gravity: -0.3 });
      }
      if (Math.hypot(this.player.pos.x - this.extraction.x, this.player.pos.z - this.extraction.z) < EXTRACT_RADIUS && !this.player.dead) {
        ex.done = true;
        this.finish();
      }
    }
  }

  radioOption() {
    if (!this.radio || !this.obj('radio') || this.obj('radio').done || this.player.climb) return null;
    const p = this.player.pos, j = this.radio.standAt;
    if (Math.hypot(p.x - j.x, p.z - j.z) > 1.5 || Math.abs(p.y - j.y) > 1) return null;
    return { label: 'E · WRECK THE RADIO', progress: this.radioProgress };
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
        ['Documents found', `${this.interactions?.found.size ?? 0} / ${this.documentsTotal ?? 0}`],
        ['Longest kill', s.longest ? `${Math.round(s.longest)} m` : '–'],
        ['Accuracy', s.shots ? `${Math.round((100 * s.hits) / s.shots)} % (${s.hits}/${s.shots})` : '–'],
        ['Times spotted', String(s.spotted)],
        ['Bodies found', String(s.bodiesFound)],
        ['Alarms raised', String(alarms)],
      ],
    };
  }

  // Points for the compass and on-screen markers.
  markers() {
    const out = [];
    if (this.obj('officer') && this.officer && !this.obj('officer').done) {
      const ta = this.def.targetArea ?? { x: COMPOUND.x + 8, z: COMPOUND.z - 4 };
      out.push(this.officer.tagged
        ? { pos: this.officer.root.position, kind: 'target', label: 'TARGET', height: 2.4 }
        : { pos: new THREE.Vector3(ta.x, this.world.groundAt(ta.x, ta.z), ta.z), kind: 'target', label: 'TARGET AREA', height: 9 });
    }
    if (this.radio && this.obj('radio') && !this.obj('radio').done) out.push({ pos: this.radio.pos, kind: 'radio', label: 'RADIO', height: 3.2 });
    if (this.obj('tank') && !this.obj('tank').done && this.tank) out.push({ pos: this.tank.root.position, kind: 'tank', label: 'PANZER', height: 3.4 });
    if (this.obj('papers') && this.officer && !this.officer.alive && !this.obj('papers').done) out.push({ pos: this.officer.bodyPosition(), kind: 'papers', label: 'PAPERS', height: 1.2 });
    for (const m of this.def.markers?.(this) ?? []) out.push(m);
    if (!this.obj('extract').hidden) out.push({ pos: this.extraction, kind: 'extract', label: 'EXTRACTION', height: 3 });
    return out;
  }
}
