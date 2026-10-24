// Operation Vineyard: the one mission. Kill Oberst Krause, who walks a routine around
// the compound (terrace, radio truck, yard); optionally wreck his field radio so no
// reinforcements can be called, and take his papers; then get back to the start hill.
// Also keeps the score for the end screen.
import * as THREE from 'three';
import { START_HILL, COMPOUND } from '../world/terrain.js';

const RADIO_TIME = 2.4;     // seconds holding E at the radio truck
const EXTRACT_RADIUS = 10;

export class Mission {
  constructor({ world, player, arsenal, stealth, ai, search, input, audio, fx, hud }) {
    Object.assign(this, { world, player, arsenal, stealth, ai, search, input, audio, fx, hud });
    this.time = 0;
    this.done = false;
    this.officer = world.soldiers.find(s => s.officer);
    this.officer.name = 'Oberst Krause';
    this.radio = world.radio;
    this.radioProgress = 0;
    const ex = new THREE.Vector3(START_HILL.x, 0, START_HILL.z);
    ex.y = world.groundAt(ex.x, ex.z);
    this.extraction = ex;
    this.smokeT = 0;
    this.objectives = [
      { id: 'officer', text: 'Eliminate Oberst Krause', done: false },
      { id: 'radio', text: 'Wreck the field radio (no reinforcements)', done: false, optional: true },
      { id: 'papers', text: "Take the Oberst's papers", done: false, optional: true },
      { id: 'extract', text: 'Get back to the start hill', done: false, hidden: true },
    ];
    this.stats = { shots: 0, hits: 0, kills: 0, headshots: 0, takedowns: 0, longest: 0, spotted: 0, bodiesFound: 0 };
    this.onComplete = null;
  }

  obj(id) { return this.objectives.find(o => o.id === id); }

  complete(id, message) {
    const o = this.obj(id);
    if (o.done) return;
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

  // ---- per tick ----
  tick(dt) {
    if (this.done) return;
    this.time += dt;
    if (!this.officer.alive && !this.obj('officer').done) {
      this.complete('officer', 'TARGET ELIMINATED · GET TO THE START HILL');
      this.obj('extract').hidden = false;
    }
    if (this.search.papers > 0) this.complete('papers', "OBERST'S PAPERS TAKEN");
    this.tickRadio(dt);
    const ex = this.obj('extract');
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
    if (this.obj('radio').done || this.player.climb) return null;
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
    if (!this.obj('officer').done) {
      out.push(this.officer.tagged
        ? { pos: this.officer.root.position, kind: 'target', label: 'TARGET', height: 2.4 }
        : { pos: new THREE.Vector3(COMPOUND.x + 8, this.world.groundAt(COMPOUND.x, COMPOUND.z), COMPOUND.z - 4), kind: 'target', label: 'TARGET AREA', height: 9 });
    }
    if (!this.obj('radio').done) out.push({ pos: this.radio.pos, kind: 'radio', label: 'RADIO', height: 3.2 });
    if (!this.officer.alive && !this.obj('papers').done) out.push({ pos: this.officer.bodyPosition(), kind: 'papers', label: 'PAPERS', height: 1.2 });
    if (!this.obj('extract').hidden) out.push({ pos: this.extraction, kind: 'extract', label: 'EXTRACTION', height: 3 });
    return out;
  }
}
