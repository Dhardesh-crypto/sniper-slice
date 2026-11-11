// The garrison's zones (src/mission/zones.js): who an alarm wakes, who it sends, who is telephoned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Zones } from '../src/mission/zones.js';

const make = () => new Zones([
  { id: 'lodge', name: 'the lodge', x: 95, z: -45, r: 70 },
  { id: 'camp', name: 'the camp', x: -140, z: 52, r: 70 },
  { id: 'meadow', name: 'the meadow', x: -10, z: 190, r: 45 },
  { id: 'far', name: 'the far post', x: 900, z: 900, r: 40 },
], { hear: 150 });
const ids = (l) => l.map(z => z.id).sort();

test('a spot belongs to the zone it is in, or nearest the edge of', () => {
  const Z = make();
  assert.equal(Z.of(100, -40).id, 'lodge'); assert.equal(Z.of(-150, 60).id, 'camp');
  assert.equal(Z.of(0, 120).id, 'meadow', 'outside all: the nearest edge');
  assert.equal(Z.of(-40, 0).id, 'camp');
});

test('an alarm wakes its own place and the siren\'s, sends men from those in earshot, telephones the rest', () => {
  const Z = make(), p = Z.plan(Z.get('lodge'), Z.get('camp'));
  assert.deepEqual(ids(p.full), ['camp', 'lodge']);
  assert.deepEqual(ids(p.patrol), ['meadow'], 'the meadow is within earshot of the lodge, the far post is not');
  assert.deepEqual(ids(p.phoned), ['far', 'meadow']); assert.deepEqual(ids(p.deaf), []);
  const own = Z.plan(Z.get('meadow'));
  assert.deepEqual(ids(own.full), ['meadow']); assert.ok(ids(own.patrol).includes('camp'));
});

test('a cut line: that place is never telephoned; an alarm raised there is not telephoned on', () => {
  const Z = make();
  Z.get('far').cut = true;
  let p = Z.plan(Z.get('lodge'));
  assert.deepEqual(ids(p.phoned), ['camp', 'meadow']); assert.deepEqual(ids(p.deaf), ['far']);
  Z.get('lodge').cut = true;
  p = Z.plan(Z.get('lodge'));
  assert.deepEqual(p.phoned, []); assert.deepEqual(ids(p.patrol), ['camp', 'meadow'], 'earshot still works');
  assert.deepEqual(ids(p.deaf), ['far']);
  const Z2 = make(); Z2.cutAll = true;                       // the radio wrecked
  assert.deepEqual(Z2.plan(Z2.get('camp')).phoned, []);
});
