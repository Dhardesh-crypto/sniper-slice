// Kestrel thinking aloud, under the breath: scanning with the binoculars, tagging something worth
// noting, coming up on an objective, and when it all goes wrong. Heard only by you (no noise for
// the guards), a good while apart, never over a guard's shout or the kill cam, and each kind works
// through its lines before any comes round again. The voices: public/sounds/th_*.mp3.
import { THOUGHTS } from '../core/audio.js';

const GAP = 14;                                  // s of quiet after a thought
const SCAN_HOLD = 1.5, SCAN_REST = 45;           // looking this long brings a thought; then this long off
const NEAR = { target: 40, extract: 40 };        // m from an objective (any other: NEAR_ELSE)
const NEAR_ELSE = 25;
const HOTSPOT = { fuel: 'fuel', engine: 'vehicle', siren: 'siren', generator: 'generator' };

export class Thoughts {
  constructor({ audio, arsenal, player, mission, ai, quiet }) {
    Object.assign(this, { audio, arsenal, player, mission, ai, quiet });
    this.busy = 0;            // the line still being spoken
    this.wait = 8;            // until the next one (none in the first moments of a mission)
    this.scanT = 0; this.scanRest = 0;
    this.nearT = 0; this.reached = new Set();
    this.alarmRest = 0; this.wasAlarm = false; this.spotted = 0;
    this.bags = {};
  }

  // Say a line of this kind if the moment allows; `urgent` skips the wait, never a line in progress.
  say(kind, urgent = false) {
    const a = this.audio;
    if (this.busy > 0 || (this.wait > 0 && !urgent) || this.player.dead || this.quiet?.()) return false;
    if ((a.ctx?.currentTime ?? 0) < (a.shoutUntil ?? 0)) return false;
    const bag = this.bags[kind]?.length ? this.bags[kind] : (this.bags[kind] = [...THOUGHTS[kind]].sort(() => Math.random() - 0.5));
    const name = bag[bag.length - 1];
    if (!a.sample(name, { gain: 0.8 })) return false;
    bag.pop();
    this.busy = a.samples[name].duration;
    this.wait = this.busy + GAP;
    return true;
  }

  // Something tagged through the binoculars: a soldier, or a hotspot (by its kind).
  tagged(t) {
    if (t.officer) return this.say('target', true);
    const kind = t.aware ? 'guard' : HOTSPOT[t.kind];
    if (kind) this.say(kind);
  }

  tick(dt) {
    this.busy = Math.max(0, this.busy - dt);
    this.wait = Math.max(0, this.wait - dt);
    this.scanRest = Math.max(0, this.scanRest - dt);
    this.alarmRest = Math.max(0, this.alarmRest - dt);
    // The alarm, or being seen: both mean the plan's gone.
    const alarm = this.ai.alarm.on, spotted = this.mission.stats.spotted;
    if (((alarm && !this.wasAlarm) || spotted > this.spotted) && this.alarmRest === 0 && this.say('alarm', true)) this.alarmRest = 40;
    this.wasAlarm = alarm; this.spotted = spotted;
    if (alarm) return;   // (no calm assessing with the siren going)
    this.scanT = this.arsenal.binoculars ? this.scanT + dt : 0;
    if (this.scanT > SCAN_HOLD && this.scanRest === 0 && this.say('scan')) this.scanRest = SCAN_REST;
    // Each objective gets one thought on the way in.
    if ((this.nearT -= dt) > 0) return;
    this.nearT = 0.5;
    for (const m of this.mission.markers()) {
      const key = m.label === 'TARGET AREA' ? 'TARGET' : m.label ?? m.kind;
      if (this.reached.has(key) || Math.hypot(m.pos.x - this.player.pos.x, m.pos.z - this.player.pos.z) > (NEAR[m.kind] ?? NEAR_ELSE)) continue;
      if (this.say(m.kind === 'target' ? 'neartarget' : m.kind === 'extract' ? 'nearexit' : 'nearobj')) this.reached.add(key);
      break;
    }
  }
}
