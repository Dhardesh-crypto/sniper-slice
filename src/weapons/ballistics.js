// Point-mass exterior ballistics: gravity + quadratic air drag relative to the wind.
// Pure math (only three's Vector3), so it runs in Node tests and in the game alike.
import { Vector3 } from 'three';

export const GRAVITY = 9.81;

const _rel = new Vector3();

// Advance one step (semi-implicit Euler). `k` is the drag factor 0.5·rho·Cd·A/m in 1/m.
export function integrate(pos, vel, k, wind, dt) {
  _rel.copy(vel).sub(wind);
  const s = _rel.length();
  vel.x -= k * s * _rel.x * dt;
  vel.y -= (k * s * _rel.y + GRAVITY) * dt;
  vel.z -= k * s * _rel.z * dt;
  pos.addScaledVector(vel, dt);
}

const NO_WIND = new Vector3();

// Height (m) relative to a level line of sight at `range`, for a bore elevated by
// `angle` that starts `sightHeight` below the sight. Also returns the flight time.
export function flightAtRange(angle, v0, k, range, sightHeight, wind = NO_WIND, dt = 1 / 4000) {
  const pos = new Vector3(0, -sightHeight, 0);
  const vel = new Vector3(Math.cos(angle) * v0, Math.sin(angle) * v0, 0);
  const prev = new Vector3();
  let t = 0;
  while (pos.x < range) {
    prev.copy(pos);
    integrate(pos, vel, k, wind, dt);
    t += dt;
    if (t > 10) return null;
  }
  const f = (range - prev.x) / (pos.x - prev.x);
  return {
    y: prev.y + (pos.y - prev.y) * f,
    z: prev.z + (pos.z - prev.z) * f,
    time: t - dt + dt * f,
    speed: vel.length(),
  };
}

// Bore elevation (rad) that puts the bullet back on the line of sight at `zeroRange`.
export function solveZeroAngle(v0, k, zeroRange, sightHeight) {
  let lo = -0.01, hi = 0.08;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const r = flightAtRange(mid, v0, k, zeroRange, sightHeight, NO_WIND, 1 / 2000);
    if (!r || r.y < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
