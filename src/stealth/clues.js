// What a guard can read off the place, with nobody there: a door you left open, the blood where a
// man died after you've moved him, a partner who hasn't come back. Each makes him wary and sends
// him to look, no more, and each is noticed once. Checked a couple of times a second.
import * as THREE from 'three';

const DOOR_SIGHT = 9, BLOOD_SIGHT = 14;   // m
const MOVED = 3;             // m: a body this far from where he fell has left his blood behind
const MATE_REACH = 22;       // m: the nearest man this close at the start is his partner
const MATE_TIME = 75;        // s before he wonders where his partner has got to

export class Clues {
  constructor({ world, stealth, interactions }) {
    Object.assign(this, { world, stealth, interactions });
    this.t = 0;
    this.mateTime = MATE_TIME;    // (a garrison ordered to keep in sight of each other: sooner)
    this.pairUp();
  }

  // The men in pairs, as they stand at the start.
  pairUp() {
    const men = this.stealth.guards().filter(s => !s.officer);
    for (const s of men) {
      if (s.mate) continue;
      let best = null, bestD = MATE_REACH;
      for (const o of men) {
        if (o === s || o.mate) continue;
        const d = o.root.position.distanceTo(s.root.position);
        if (d < bestD) { best = o; bestD = d; }
      }
      if (best) { s.mate = best; best.mate = s; }
    }
  }

  // Does he, standing there, have a clear look at `at`, `reach` m off at most?
  sees(s, at, reach) {
    const d = s.root.position.distanceTo(at);
    if (d > reach) return false;
    const to = at.clone().sub(s.root.position);
    if (Math.cos(Math.atan2(to.x, to.z) - s.root.rotation.y) < Math.cos(1.1)) return false;
    const eye = s.headPosition(new THREE.Vector3());
    const hit = this.world.raycastSegment(eye, at);
    return !hit || hit.distance > eye.distanceTo(at) - 0.8;
  }

  tick(dt) {
    if ((this.t -= dt) > 0) return;
    this.t = 0.5;
    const guards = this.stealth.guards();
    const doors = this.interactions.doors.filter(d => d.leftOpen && d.open && !d.noticed);
    const blood = this.world.soldiers.filter(b => !b.alive && !b.range && b.diedAt && !b.bloodSeen && (b.hidden || b.dragged || b.bodyPosition(new THREE.Vector3()).distanceTo(b.diedAt) > MOVED));
    for (const s of guards) {
      if (s.aware.state !== 'calm') continue;
      for (const d of doors) if (!d.noticed && this.sees(s, d.centre, DOOR_SIGHT)) { d.noticed = true; this.stealth.raise(s, 'suspicious', d.centre.clone(), 'door'); }
      for (const b of blood) {
        const at = b.diedAt.clone().setY(b.diedAt.y + 0.1);
        if (!b.bloodSeen && this.sees(s, at, BLOOD_SIGHT)) { b.bloodSeen = true; this.stealth.raise(s, 'suspicious', b.diedAt.clone(), 'blood'); }
      }
      const m = s.mate;
      if (m && (!m.alive || m.takenDown)) {
        s.mateGone = (s.mateGone ?? 0) + 0.5;
        if (s.mateGone >= this.mateTime) {
          s.mate = null;
          if (!m.found) this.stealth.raise(s, 'suspicious', (m.diedAt ?? m.home).clone(), 'partner');
        }
      }
    }
  }
}
