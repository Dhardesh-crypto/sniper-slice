// What you keep between missions (core/perks.js, core/profile.js): the hidden finds and weapon mastery.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The profile keeps itself in the browser's storage: a stand-in for the test.
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
const { Profile, MASTERY } = await import('../src/core/profile.js');
const { PERKS, perk, perkK, perkOf } = await import('../src/core/perks.js');
const { CATALOG, PARTS } = await import('../src/weapons/defs.js');

test('every mission hides one perk, each a different one', () => {
  const missions = ['vineyard', 'town', 'harbour', 'forest', 'flak', 'railway', 'bridge', 'airfield', 'radar'];
  const found = missions.map(perkOf);
  assert.ok(found.every(Boolean)); assert.equal(new Set(found).size, missions.length);
  assert.equal(perkOf('nowhere'), null);
});

test('a perk counts from the moment it is found, and after a reload', () => {
  store.clear();
  const p = new Profile();
  assert.equal(perk('softStep'), false); assert.equal(perkK('softStep'), 1);
  assert.equal(p.addPerk('softStep'), true); assert.equal(p.addPerk('softStep'), false, 'only once');
  assert.equal(perk('softStep'), true); assert.equal(perkK('softStep'), PERKS.softStep.k);
  assert.equal(perkK('deepBreath'), 1, 'the others still not');
  new Profile();
  assert.equal(perk('softStep'), true, 'kept');
});

test('mastery: a weapon earns a part for its kind at 10, 25 and 50 kills, each a new one', () => {
  store.clear();
  const p = new Profile(), earned = [];
  for (let i = 1; i <= 60; i++) { const e = p.addKill('springfield'); if (e) earned.push(e); else assert.ok(!MASTERY.includes(i)); }
  assert.deepEqual(earned.map(e => e.kills), MASTERY);
  const rifleParts = Object.values(PARTS[CATALOG.springfield.slot]).flat().filter(x => !x.stock).map(x => x.id);
  const ids = earned.map(e => e.part.id);
  assert.equal(new Set(ids).size, 3); assert.ok(ids.every(id => rifleParts.includes(id) && p.ownsPart({ id })));
  assert.equal(p.kills('springfield'), 60); assert.equal(p.kills('welrod'), 0);
  assert.equal(p.addKill('no-such-gun'), null);
  assert.equal(new Profile().kills('springfield'), 60, 'kept');
});
