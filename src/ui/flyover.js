// The mission's own land, shown before you set foot on it: a fifteen-second flight in the game
// itself from behind where you start, out over the country between, to the place the job is,
// with three captions (the operation, your way in, the target). Not a film: the camera flies the
// map as it is built for this run, in this run's weather, so what you see is what you will cross.
// Any key or click skips it. main.js starts it on a new mission (not on a loaded game) and hands
// it each frame while `active`.
import * as THREE from 'three';
import { heightAt, activeMap, roadList } from '../world/terrain.js';

const LENGTH = 15;         // seconds
const CLEAR = 14;          // m the camera keeps above the ground under it

export class Flyover {
  constructor({ world, post, fov = 55 }) {
    Object.assign(this, { world, post });
    this.cam = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 0.3, 4000);
    this.active = false;
    // Two bars and a caption, over the picture (its own element: the HUD is hidden meanwhile).
    const el = this.el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;display:none;z-index:40;font-family:inherit;color:#f1ead6;';
    el.innerHTML = '<div style="position:absolute;left:0;right:0;top:0;height:9vh;background:#000"></div><div style="position:absolute;left:0;right:0;bottom:0;height:9vh;background:#000"></div>'
      + '<div class="cap" style="position:absolute;left:6vw;bottom:12vh;font-size:2.6vh;letter-spacing:.18em;text-shadow:0 1px 6px #000;transition:opacity .5s"></div>'
      + '<div style="position:absolute;right:3vw;bottom:2.6vh;font-size:1.5vh;letter-spacing:.14em;opacity:.7">ANY KEY · SKIP</div>';
    document.body.appendChild(el);
    this.cap = el.querySelector('.cap');
  }

  // from: where you start; to: where the job is; captions: [[seconds, text], …]; onEnd: called
  // once, when it finishes or is skipped.
  begin({ from, to, captions = [], onEnd = null }) {
    const g = (x, z, up) => new THREE.Vector3(x, heightAt(x, z) + up, z);
    const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len;
    // Behind and above the start; out to one side over the middle (toward the map's main road, if
    // it has one there: the way most of them come and go); then low toward the place itself.
    const mid = { x: from.x + dx * 0.5, z: from.z + dz * 0.5 }, road = roadList()[0];
    let side = 1;
    if (road) { const n = road.near(mid.x, mid.z) ?? road.far(mid.x, mid.z); side = ((n.x - mid.x) * -uz + (n.z - mid.z) * ux) >= 0 ? 1 : -1; }
    const off = Math.min(110, len * 0.35) * side;
    const pts = [
      g(from.x - ux * 55, from.z - uz * 55, 34),
      g(from.x + ux * 20 - uz * off * 0.3, from.z + uz * 20 + ux * off * 0.3, 52),
      g(mid.x - uz * off, mid.z + ux * off, 70),
      g(to.x - ux * Math.min(150, len * 0.45) - uz * off * 0.4, to.z - uz * Math.min(150, len * 0.45) + ux * off * 0.4, 44),
      g(to.x - ux * 75, to.z - uz * 75, 30),
    ];
    this.path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.from = g(from.x, from.z, 1.5); this.to = g(to.x, to.z, 3);
    this.captions = captions; this.onEnd = onEnd;
    this.t = 0; this.active = true;
    this.el.style.display = 'block';
    this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix();
    this.frame(0);
  }

  skip() { if (this.active) this.end(); }
  end() {
    this.active = false;
    this.el.style.display = 'none';
    const f = this.onEnd; this.onEnd = null;
    f?.();
  }

  // One frame: move the camera, set the caption. Returns the camera to draw with.
  frame(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / LENGTH), e = k * k * (3 - 2 * k);              // (eased at both ends)
    const p = this.path.getPoint(e);
    p.y = Math.max(p.y, heightAt(p.x, p.z) + CLEAR);
    this.cam.position.copy(p);
    // It looks back at where you start for the first moments, then swings to the job.
    const look = this.from.clone().lerp(this.to, THREE.MathUtils.smoothstep(k, 0.12, 0.55));
    this.cam.lookAt(look);
    this.cam.updateMatrixWorld();
    let text = '';
    for (const [at, s] of this.captions) if (this.t >= at) text = s;
    if (text !== this.shown) { this.shown = text; this.cap.textContent = text; }
    if (this.t >= LENGTH) this.end();
    return this.cam;
  }
}

// The three captions for a mission: its name, the way in (which side of the target you start on),
// and what you are there for.
export function flyoverCaptions({ title, side, target }) {
  const map = activeMap();
  return [[0.4, (title ?? 'THE MISSION').toUpperCase()], [4.2, `YOUR WAY IN · FROM THE ${(side ?? 'edge').toUpperCase()}`],
    [8.6, target ? `THE TARGET · ${target.toUpperCase()}` : 'THE TARGET AREA'], [13.2, map.dusk ? 'DUSK · THE LIGHTS ARE ON' : '']];
}
