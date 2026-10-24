import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { flightAtRange, solveZeroAngle } from '../src/weapons/ballistics.js';
import { WEAPONS, SIGHT_HEIGHT } from '../src/weapons/defs.js';

const R = WEAPONS.rifle;

test('zeroed rifle lands on the line of sight at every zero range', () => {
  for (const zero of R.zeros) {
    const a = solveZeroAngle(R.muzzleVelocity, R.drag, zero, SIGHT_HEIGHT);
    const r = flightAtRange(a, R.muzzleVelocity, R.drag, zero, SIGHT_HEIGHT);
    assert.ok(Math.abs(r.y) < 0.01, `zero ${zero} m off by ${r.y.toFixed(3)} m`);
  }
});

test('drop with a 100 m zero is plausible for a .30-calibre rifle', () => {
  const a = solveZeroAngle(R.muzzleVelocity, R.drag, 100, SIGHT_HEIGHT);
  const at300 = flightAtRange(a, R.muzzleVelocity, R.drag, 300, SIGHT_HEIGHT);
  const at500 = flightAtRange(a, R.muzzleVelocity, R.drag, 500, SIGHT_HEIGHT);
  console.log(`drop @300 ${at300.y.toFixed(2)} m, @500 ${at500.y.toFixed(2)} m, ` +
    `flight @500 ${at500.time.toFixed(2)} s, speed @500 ${at500.speed.toFixed(0)} m/s`);
  // Tuned flatter than a real .30-06 for an easier, Sniper Elite-style feel.
  assert.ok(at300.y < -0.2 && at300.y > -0.6);
  assert.ok(at500.y < -1.0 && at500.y > -2.2);
  assert.ok(at500.speed > 550 && at500.speed < 750);
});

test('a crosswind drifts the bullet downwind, more at long range', () => {
  const a = solveZeroAngle(R.muzzleVelocity, R.drag, 300, SIGHT_HEIGHT);
  const wind = new Vector3(0, 0, 4); // 4 m/s full-value crosswind
  const d200 = flightAtRange(a, R.muzzleVelocity, R.drag, 200, SIGHT_HEIGHT, wind).z;
  const d500 = flightAtRange(a, R.muzzleVelocity, R.drag, 500, SIGHT_HEIGHT, wind).z;
  console.log(`drift (4 m/s) @200 ${d200.toFixed(2)} m, @500 ${d500.toFixed(2)} m`);
  assert.ok(d200 > 0 && d500 > d200 * 3);
});
