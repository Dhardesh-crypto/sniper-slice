// Objectives as data (src/mission/objectives.js): each kind of rule, the order they open in,
// what reveals a hidden one, and the several ways to do one job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tickObjectives, objectiveMarkers, remaining, open } from '../src/mission/objectives.js';

function mission(objectives, { soldiers = [], hotspots = [] } = {}) {
  const m = {
    objectives: objectives.map(o => ({ done: false, ...o })), said: [], flags: {},
    world: { soldiers, hotspots, groundAt: () => 7 }, player: { pos: { x: 0, z: 0 } },
    interactions: { found: new Set() }, hud: { message: (t) => m.said.push(t) },
    obj: (id) => m.objectives.find(o => o.id === id),
    complete(id, msg) { const o = m.obj(id); if (o && !o.done) { o.done = true; m.said.push(msg); } },
  };
  return m;
}
const man = (name) => ({ name, alive: true, tagged: false, searched: false });
const spot = (kind, title) => ({ kind, title, exploded: false, broken: false, tagged: false });

test('kill: every man of the name, with progress on the way', () => {
  const men = [man('Counter-sniper'), man('Counter-sniper'), man('Cook')];
  const m = mission([{ id: 'stands', text: 'Kill them', kill: 'Counter-sniper', message: 'EMPTY', progress: '{left} LEFT' }], { soldiers: men });
  tickObjectives(m); assert.equal(m.obj('stands').done, false);
  men[0].alive = false; tickObjectives(m);
  assert.deepEqual(m.said, ['1 LEFT']);
  men[1].alive = false; tickObjectives(m);
  assert.equal(m.obj('stands').done, true); assert.equal(m.said.at(-1), 'EMPTY');
});

test('a rule that matches nothing is never done', () => {
  const m = mission([{ id: 'x', text: 'x', kill: 'Nobody' }, { id: 'y', text: 'y', destroy: { kind: 'none' } }]);
  tickObjectives(m);
  assert.equal(m.obj('x').done, false); assert.equal(m.obj('y').done, false);
});

test('destroy: by kind, by title, and broken counted only when asked', () => {
  const hs = [spot('flak'), spot('flak'), spot('engine', 'ARREST TRUCK ENGINE')];
  const m = mission([
    { id: 'guns', text: 'guns', destroy: { kind: 'flak' } },
    { id: 'truck', text: 'truck', destroy: { title: 'ARREST TRUCK ENGINE', broken: true } },
    { id: 'car', text: 'car', destroy: { title: 'ARREST TRUCK ENGINE' } },
  ], { hotspots: hs });
  hs[0].exploded = true; hs[2].broken = true; tickObjectives(m);
  assert.equal(m.obj('guns').done, false); assert.equal(m.obj('truck').done, true); assert.equal(m.obj('car').done, false);
  hs[1].exploded = true; tickObjectives(m);
  assert.equal(m.obj('guns').done, true);
  assert.deepEqual(remaining({ destroy: { kind: 'flak' } }, m), [0, 2]);
});

test('flag, reach, observe, read, when', () => {
  const men = [man('Vogel')];
  const m = mission([
    { id: 'phone', text: 'phone', flag: 'phoneCut' }, { id: 'ford', text: 'ford', reach: { x: 100, z: 0, r: 5 } },
    { id: 'spot', text: 'spot', observe: 'Vogel' }, { id: 'orders', text: 'orders', read: 'orders' },
    { id: 'odd', text: 'odd', when: (mm) => mm.flags.odd === 3 },
  ], { soldiers: men });
  tickObjectives(m);
  assert.equal(m.objectives.some(o => o.done), false);
  m.flags.phoneCut = true; m.player.pos.x = 97; men[0].tagged = true; m.interactions.found.add('orders'); m.flags.odd = 3;
  tickObjectives(m);
  assert.equal(m.objectives.every(o => o.done), true);
});

test('needs: closed until the other is done, and no marker till then', () => {
  const hs = [spot('vault')];
  const m = mission([{ id: 'code', text: 'code', read: 'code' },
    { id: 'vault', text: 'vault', needs: 'code', destroy: { kind: 'vault' }, marker: { at: { x: 1, z: 2 }, label: 'VAULT' } }], { hotspots: hs });
  hs[0].exploded = true; tickObjectives(m);
  assert.equal(open(m.obj('vault'), m), false); assert.equal(m.obj('vault').done, false);
  assert.equal(objectiveMarkers(m).length, 0);
  m.interactions.found.add('code'); tickObjectives(m); tickObjectives(m);
  assert.equal(m.obj('vault').done, true);
});

test('revealedBy: hidden until found out, then announced', () => {
  const men = [man('Courier'), man('Agent')];
  const m = mission([{ id: 'agent', text: 'Find the agent', hidden: true, optional: true, revealedBy: { searched: 'Courier' }, kill: 'Agent',
    marker: { at: () => ({ x: 5, y: 3, z: 6 }), label: 'AGENT', kind: 'target', height: 2 } }], { soldiers: men });
  men[1].alive = false; tickObjectives(m);
  assert.equal(m.obj('agent').done, false, 'not done while still hidden');
  assert.equal(objectiveMarkers(m).length, 0);
  men[1].alive = true; men[0].searched = true; tickObjectives(m);
  assert.equal(m.obj('agent').hidden, false); assert.equal(m.said[0], 'NEW OBJECTIVE · FIND THE AGENT');
  assert.deepEqual(objectiveMarkers(m), [{ pos: { x: 5, y: 3, z: 6 }, kind: 'target', label: 'AGENT', height: 2 }]);
  men[1].alive = false; tickObjectives(m);
  assert.equal(m.obj('agent').done, true);
});

test('revealedBy an objective, a paper, a place', () => {
  const m = mission([{ id: 'a', text: 'a', flag: 'a' },
    { id: 'b', text: 'b', hidden: true, revealedBy: { objective: 'a' }, flag: 'b' },
    { id: 'c', text: 'c', hidden: true, revealedBy: { read: 'note' }, flag: 'c' },
    { id: 'd', text: 'd', hidden: true, revealedBy: { reach: { x: 50, z: 50, r: 10 } }, flag: 'd' }]);
  tickObjectives(m); assert.deepEqual(m.objectives.map(o => !!o.hidden), [false, true, true, true]);
  m.flags.a = true; tickObjectives(m); tickObjectives(m);
  m.interactions.found.add('note'); m.player.pos = { x: 48, z: 55 }; tickObjectives(m);
  assert.deepEqual(m.objectives.map(o => !!o.hidden), [false, false, false, false]);
});

test('anyOf: the first way that is met does it, and is remembered', () => {
  const men = [man('Vogel')], hs = [spot('engine', 'STAFF CAR ENGINE')];
  const m = mission([{ id: 'officer', text: 'Vogel', anyOf: [
    { way: 'car', flag: 'carBomb', message: 'HIS CAR WENT UP WITH HIM' }, { way: 'shot', kill: 'Vogel', message: 'TARGET ELIMINATED' }] }], { soldiers: men, hotspots: hs });
  tickObjectives(m); assert.equal(m.obj('officer').done, false);
  men[0].alive = false; tickObjectives(m);
  assert.equal(m.obj('officer').way, 'shot'); assert.equal(m.said.at(-1), 'TARGET ELIMINATED');
});

test('an objective without a rule is left to the game, and a marker takes the ground height', () => {
  const m = mission([{ id: 'safe', text: 'safe', marker: [{ at: { x: 1, z: 2 }, label: 'A' }, { at: { x: 3, z: 4 }, label: 'B', kind: 'radio', height: 3 }] }]);
  tickObjectives(m); assert.equal(m.obj('safe').done, false);
  assert.deepEqual(objectiveMarkers(m), [{ pos: { x: 1, y: 7, z: 2 }, kind: 'tank', label: 'A', height: 1 }, { pos: { x: 3, y: 7, z: 4 }, kind: 'radio', label: 'B', height: 3 }]);
});
