// Exhaust fumes from every vehicle with a crew aboard and its engine running: a thin haze idling,
// thicker and darker on the move. A parked prop, a wreck or an abandoned vehicle gives off none,
// so a live one can be told from scenery at a glance.
import * as THREE from 'three';

const sources = [];
let ctx = null;

// The game's services, once: { fx, player }.
export function initExhaust(services) { ctx = services; }

// A vehicle's exhausts. space: the Object3D the pipes are given in; points: the pipe ends in its
// own coordinates; dir: which way they blow (also in its coordinates); running(): whether the
// engine runs now; speed(): how fast it's driving (m/s); heavy: a tank's big engine (darker, more).
export function addExhaust({ space, points, dir, running = () => true, speed = () => 0, heavy = false }) {
  const s = { space, points, dir: dir.clone().normalize(), running, speed, heavy, t: Math.random() * 0.3 };
  sources.push(s);
  return s;
}

const _p = new THREE.Vector3(), _d = new THREE.Vector3();
export function tickExhaust(dt) {
  if (!ctx) return;
  for (const s of sources) {
    if ((s.t -= dt) > 0 || !s.running()) continue;
    const driving = s.speed() > 0.5;
    s.t = driving ? 0.12 : 0.22;
    s.space.updateWorldMatrix(true, false);
    _d.copy(s.dir).transformDirection(s.space.matrixWorld);
    // (bigger the further you are, like impact dust, so it still shows through the scope)
    s.space.localToWorld(_p.copy(s.points[0]));
    const k = (1 + Math.min(2, _p.distanceTo(ctx.player.pos) / 150)) * (s.heavy ? 1 : 0.7);
    for (const q of s.points) {
      s.space.localToWorld(_p.copy(q));
      ctx.fx.emit(_p, _d, driving
        ? { color: s.heavy ? 0x55585b : 0x81868c, count: 1, speed: 1.8, size: 0.42 * k, life: 2.6, grow: 4, gravity: 0.5 }
        : { color: s.heavy ? 0x878a8e : 0x9a9fa6, count: 1, speed: 0.9, size: 0.3 * k, life: 2.2, grow: 4, gravity: 0.45 });
    }
  }
}
