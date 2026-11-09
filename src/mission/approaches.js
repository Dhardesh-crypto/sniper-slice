// Several ways in and out of every mission, as Sniper Elite 5 has: besides the start the mission
// was built with, two more starting points on other sides of the map, chosen in the Mission tab
// before you set out, and the same three places as pick-ups once the job's done (any one of them).
//
// Found from the map itself, the same every time (no randomness, so a choice made in the menu is
// the same place after the reload that starts the mission): a ring of candidate spots round the
// target, kept if they're open, level ground (not water, not inside a building, not a cliff), well
// away from every guard and from each other, and scored for cover (tall grass) and distance from
// the guards. The two best on different sides of the target are the extra approaches.
import * as THREE from 'three';
import { activeMap, PLAY_HALF, COMPOUND } from '../world/terrain.js';
import { inTallGrass } from '../world/vegetation.js';

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const GUARD_CLEAR = 110;     // m from the nearest guard at least
const APART = 180;           // m between any two approaches at least

// Which way `p` lies from the target, as the map shows it (-z is north).
function side(p, c) {
  const a = Math.atan2(p.x - c.x, -(p.z - c.z));          // 0 north, clockwise
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

export function findApproaches(world) {
  const map = activeMap(), c = map.focus ?? COMPOUND;
  const main = world.spawn.clone();
  const guards = world.soldiers.filter(s => !s.range).map(s => s.root.position);
  const water = world.waterLevel;
  const out = [{ id: 'start', name: 'The usual way in', side: side(main, c), at: main }];
  const cands = [];
  for (const k of [0.62, 0.72, 0.82, 0.9]) {
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, r = PLAY_HALF * k;
      const x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
      if (Math.abs(x) > PLAY_HALF - 15 || Math.abs(z) > PLAY_HALF - 15) continue;
      const y = world.groundAt(x, z);
      if (water != null && y < water + 0.6) continue;                                          // in the sea or a river
      if (Math.abs(world.floorAt(x, z, y + 3) - y) > 0.3) continue;                            // on a roof or a wall
      const slope = Math.max(Math.abs(world.groundAt(x + 3, z) - world.groundAt(x - 3, z)), Math.abs(world.groundAt(x, z + 3) - world.groundAt(x, z - 3))) / 6;
      if (slope > 0.35) continue;                                                             // a cliff or a steep bank
      if (!world.clearAbove(x, z, y, y + 2)) continue;                                        // under something
      const near = Math.min(...guards.map(g => Math.hypot(g.x - x, g.z - z)), Infinity);
      if (near < GUARD_CLEAR) continue;
      const grass = inTallGrass(world.grassPatches ?? [], x, z) ? 1 : 0;
      cands.push({ at: new THREE.Vector3(x, y, z), score: Math.min(near, 300) / 300 + 0.6 * grass - slope });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  for (const cand of cands) {
    if (out.length >= 3) break;
    if (out.some(o => o.at.distanceTo(cand.at) < APART)) continue;
    const s = side(cand.at, c);
    if (out.some(o => o.side === s)) continue;                                               // a different side of the target each
    out.push({ id: `alt${out.length}`, name: `From the ${s}`, side: s, at: cand.at });
  }
  return out;
}

// The way to face from a starting point: toward the target.
export function faceTarget(at) {
  const c = activeMap().focus ?? COMPOUND;
  return Math.atan2(-(c.x - at.x), -(c.z - at.z));
}
