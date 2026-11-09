import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

// world/kit.js paints its textures on a canvas, which node hasn't got: penetration.js is given a
// stand-in with the same materials table instead (plain materials; only their identity matters).
const KIT = 'data:text/javascript,' + encodeURIComponent(`import * as THREE from '${import.meta.resolve('three')}';
const m = () => new THREE.MeshStandardMaterial();
export const M = { stone: m(), plaster: m(), plaster2: m(), roof: m(), wood: m(), darkWood: m(), window: m(), shutter: m(), metal: m(), truck: m(), canvas: m(), sandbag: m(), crate: m(), vine: m(), earth: m() };
export const isPlaster = (x) => x === M.plaster || x === M.plaster2;`);
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.endsWith('/world/kit.js')) return { url: ${JSON.stringify(KIT)}, shortCircuit: true };
  return next(spec, ctx);
}`));
const { throughCover, weakened } = await import('../src/weapons/penetration.js');
const { M } = await import(KIT);

// A wall `thick` m deep across the line of fire (along +x), and the round's hit on its near face.
function strike(mat, thick, speed) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(thick, 3, 3), mat);
  wall.position.x = 10 + thick / 2;
  wall.updateMatrixWorld(true);
  const dir = new THREE.Vector3(1, 0, 0);
  const hit = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), dir).intersectObject(wall)[0];
  return throughCover(hit, dir, speed);
}

test('a rifle round goes through a thin plank, slower', () => {
  const pen = strike(M.wood, 0.025, 800);
  assert.ok(pen, 'stopped by a plank');
  assert.ok(pen.keep > 0 && pen.keep < 1, `keep ${pen.keep}`);
  assert.ok(pen.exit.x > 10.025);
});

test('thick stone stops it', () => {
  assert.equal(strike(M.stone, 0.5, 800), null);
});

test('a pistol round stops in a wood door', () => {
  assert.equal(strike(M.wood, 0.05, 300), null);
});

test('a weakened round scales every zone but keeps the head lethal', () => {
  const d = weakened({ head: 999, torso: 100, legs: 40 }, 0.8);
  assert.deepEqual(d, { head: 999, torso: 80, legs: 32 });
  assert.equal(weakened({ head: 999 }, 0.25, 60).head, 60);
});
