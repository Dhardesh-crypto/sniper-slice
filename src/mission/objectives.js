// Objectives as data. A mission lists what there is to do and says, for each, what counts as
// done; nothing here knows any one mission. (Before this, every mission finished its own
// objectives by hand in its `tick`, so none could be found late, depend on another, or be done
// more than one way.) An objective is { id, text, optional?, hidden? } plus any of:
//
//   What counts as done (one of these, or `anyOf`):
//     kill: 'Name' | ['Name', …]            every soldier of those names is dead
//     destroy: { kind?, title?, broken? }   every hot spot of that kind and/or title has blown up
//                                           (`broken: true`: or been broken, as an engine shot dead)
//     flag: 'name'                          the mission's flag of that name is set (mission.set(name):
//                                           a lever pulled, a line cut, a set piece that has run)
//     reach: { x, z, r }                    you stand within r metres of the place
//     observe: 'Name' | { kind?, title? }   you have tagged them through the glasses
//     read: 'documentId'                    you have read that document
//     when: (mission) => true               anything else (a set piece's own state)
//     anyOf: [{ way: 'label', …one of the above }]   several ways to do the one job; the way
//                                           that did it is kept (objective.way) for the debrief
//
//   When it can be done, and when you hear of it:
//     needs: 'id' | ['id', …]               only after those objectives are done
//     revealedBy: { objective | read | searched | observe | reach }
//                                           hidden until then (an objective done, a paper read, a
//                                           named man's body searched, something tagged, a place
//                                           reached), then announced as a new objective
//
//   What you are told:
//     message: 'TEXT'                       on completion
//     progress: 'TEXT · {left} LEFT'        each time one of several goes (kill and destroy)
//     marker: { at, label, kind?, height? } on the compass and the map until it's done; `at` is
//                                           { x, y?, z } or (mission) => Vector3-like

const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// The hot spots a `destroy` (or `observe`) rule is about.
function spots(m, rule) {
  return m.world.hotspots.filter(h => (rule.kind === undefined || h.kind === rule.kind) && (rule.title === undefined || h.title === rule.title));
}

// How many of a rule's things are still to do, and how many there are: [left, of]. A rule with
// nothing to count (a flag, a place) is [1, 1] or [0, 1].
export function remaining(rule, m) {
  if (rule.kill !== undefined) {
    const names = list(rule.kill), men = m.world.soldiers.filter(s => names.includes(s.name));
    return [men.filter(s => s.alive).length, men.length];
  }
  if (rule.destroy !== undefined) {
    const hs = spots(m, rule.destroy);
    return [hs.filter(h => !(h.exploded || (rule.destroy.broken && h.broken))).length, hs.length];
  }
  if (rule.flag !== undefined) return [m.flags?.[rule.flag] ? 0 : 1, 1];
  if (rule.reach !== undefined) return [Math.hypot(m.player.pos.x - rule.reach.x, m.player.pos.z - rule.reach.z) <= rule.reach.r ? 0 : 1, 1];
  if (rule.observe !== undefined) {
    const things = typeof rule.observe === 'string' ? m.world.soldiers.filter(s => s.name === rule.observe) : spots(m, rule.observe);
    return [things.filter(t => !t.tagged).length, things.length];
  }
  if (rule.read !== undefined) return [m.interactions?.found?.has(rule.read) ? 0 : 1, 1];
  if (rule.when !== undefined) return [rule.when(m) ? 0 : 1, 1];
  return [1, 0];      // no rule: finished by the game's own code (mission.complete), never here
}

// Done: there was something to do and none of it is left. (Nothing matching is not "done": a
// misspelt name must not complete an objective the moment the mission starts.)
const met = (rule, m) => { const [left, of] = remaining(rule, m); return of > 0 && left === 0; };

const hasRule = (o) => ['kill', 'destroy', 'flag', 'reach', 'observe', 'read', 'when', 'anyOf'].some(k => o[k] !== undefined);

function revealed(by, m) {
  if (by.objective !== undefined) return list(by.objective).every(id => m.obj(id)?.done);
  if (by.searched !== undefined) return m.world.soldiers.some(s => s.name === by.searched && s.searched);
  return met(by, m);       // read, observe, reach, flag, when: the same rules as for doing one
}

// Can it be worked on yet (everything it needs is done)?
export const open = (o, m) => list(o.needs).every(id => m.obj(id)?.done);

// Once a tick: reveal what has been found out, complete what has been done.
export function tickObjectives(m) {
  for (const o of m.objectives) {
    if (o.done) continue;
    if (o.revealedBy && o.hidden) {
      if (!revealed(o.revealedBy, m)) continue;
      o.hidden = false;
      m.hud.message(`NEW OBJECTIVE · ${o.text.toUpperCase()}`, '');
    }
    if (!hasRule(o) || !open(o, m)) continue;
    const ways = o.anyOf ?? [o];
    const won = ways.find(w => met(w, m));
    if (won) {
      if (o.anyOf) o.way = won.way;
      m.complete(o.id, won.message ?? o.message ?? `${o.text.toUpperCase()} · DONE`);
      continue;
    }
    if (o.progress && !o.anyOf) {
      const [left] = remaining(o, m);
      if (o.left !== undefined && left < o.left) m.hud.message(o.progress.replace('{left}', left), '');
      o.left = left;
    }
  }
}

// Markers for the objectives that say where they are (not hidden, not done, and open).
export function objectiveMarkers(m, out = []) {
  for (const o of m.objectives) {
    if (o.done || o.hidden || !o.marker || !open(o, m)) continue;
    for (const k of list(o.marker)) {
      const at = typeof k.at === 'function' ? k.at(m) : k.at;
      if (!at) continue;
      const y = at.y ?? m.world.groundAt(at.x, at.z);
      out.push({ pos: { x: at.x, y, z: at.z }, kind: k.kind ?? 'tank', label: k.label, height: k.height ?? 1 });
    }
  }
  return out;
}
