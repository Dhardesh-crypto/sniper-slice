// Shooting through cover. A rifle round goes through a plank wall, a door, a shutter, a crate, a
// tent, a vine row or a pane, and through a lath-and-plaster partition; stone, sandbags, earth and
// steel stop it. How much it can go through (m of the stuff, for a full-power round at 800 m/s)
// falls with the square of its speed (a pistol bullet gets through a pane or a tent, not a door), AP rounds
// go twice as far, and it comes out the other side slower and weaker by the share it used up.
// The thickness is measured: a ray back from beyond the hit finds where the round would come out.
import * as THREE from 'three';
import { M, isPlaster } from '../world/kit.js';

const REACH = new Map([
  [M.wood, 0.3], [M.darkWood, 0.3], [M.shutter, 0.3], [M.crate, 0.3],
  [M.window, 0.1], [M.canvas, 1], [M.vine, 1], [M.roof, 0.05],
  [M.stone, 0.04], [M.metal, 0.006], [M.truck, 0.006],
]);
const PLASTER = 0.18;
const _ray = new THREE.Raycaster();

function reach(mat) {
  if (!mat || mat.visible === false) return 0;              // (hidden blocks stand in for things too varied to tell)
  if (REACH.has(mat)) return REACH.get(mat);
  return isPlaster(mat) ? PLASTER : 0;
}

// A round going `dir` at `speed` m/s struck `hit`: where it comes out and what's left of it
// ({ exit, keep: 0–1 of its speed }), or null if it stops in there.
export function throughCover(hit, dir, speed, ap = false) {
  const o = hit.object;
  if (!o || hit.terrain || hit.soldier) return null;
  const mat = Array.isArray(o.material) ? o.material[0] : o.material;
  const can = reach(mat) * (ap ? 2 : 1) * Math.min(1.3, (speed / 800) ** 2);
  if (can < 0.005) return null;
  // Out the far side: back along the shot from as far as it could get, to the surface.
  const far = hit.point.clone().addScaledVector(dir, can + 0.01);
  _ray.set(far, dir.clone().negate());
  _ray.far = can + 0.01;
  const back = _ray.intersectObject(o, false)[0];
  if (!back) return null;                                   // thicker than it can get through
  const thick = can + 0.01 - back.distance;
  if (thick >= can) return null;
  return { exit: back.point.clone().addScaledVector(dir, 0.02), keep: Math.sqrt(1 - thick / can), thick };
}
