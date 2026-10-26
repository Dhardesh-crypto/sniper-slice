// Tracks in the ground: every vehicle that drives leaves its prints in the soft ground behind it,
// a tank's or a halftrack's tread marks, a truck's tyre marks. Each print is a flat, see-through
// patch laid on the terrain (none on a bridge deck or anything else built above the ground).
// The newest few thousand stay; the oldest give way.
import * as THREE from 'three';
import { heightAt } from './terrain.js';

const MAX = 3000;           // prints kept per kind
const STEP = 0.7;           // m between prints
const KINDS = {
  tread: { width: 0.55, color: 0x3a3226, opacity: 0.32, draw: drawTread },
  tyre: { width: 0.28, color: 0x403628, opacity: 0.28, draw: drawTyre },
};

const sources = [], layers = {};
let scene = null;

export function initGroundMarks(s) { scene = s; }

// A vehicle. object: what moves; wheels: [{ at: Vector3 in object's own coordinates (where the
// track or tyre meets the ground), kind: 'tread' | 'tyre' }]; active(): whether it's in the world.
export function addGroundMarks({ object, wheels, active = () => true }) {
  const s = { object, wheels: wheels.map(w => ({ ...w, last: null })), active };
  sources.push(s);
  return s;
}

// A tread's cleats across the band, or a tyre's zig-zag: dark where pressed in, clear around.
function drawTread(g, W, H) {
  for (let y = 0; y < H; y += 16) {
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.fillRect(4, y, W - 8, 9);
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(4, y + 9, W - 8, 7);
  }
}
function drawTyre(g, W, H) {
  g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(6, 0, W - 12, H);
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 5;
  for (let y = 0; y < H; y += 12) { g.beginPath(); g.moveTo(8, y); g.lineTo(W / 2, y + 6); g.lineTo(W - 8, y); g.stroke(); }
}

function layer(kind) {
  if (layers[kind]) return layers[kind];
  const k = KINDS[kind];
  const c = document.createElement('canvas');
  c.width = 32; c.height = 64;
  const g2 = c.getContext('2d');
  k.draw(g2, 32, 64);
  g2.globalCompositeOperation = 'destination-in';   // feather the long edges
  const fade = g2.createLinearGradient(0, 0, 32, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.2, 'rgba(0,0,0,1)'); fade.addColorStop(0.8, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  g2.fillStyle = fade; g2.fillRect(0, 0, 32, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshLambertMaterial({
    color: k.color, map: tex, transparent: true, opacity: k.opacity, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);   // flat, length along z
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.userData.noAO = true;
  scene.add(mesh);
  return (layers[kind] = { mesh, next: 0, width: k.width });
}

const _w = new THREE.Vector3(), _n = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Vector3();
export function tickGroundMarks() {
  if (!scene) return;
  for (const s of sources) {
    if (!s.active()) { for (const w of s.wheels) w.last = null; continue; }
    s.object.updateWorldMatrix(true, false);
    for (const w of s.wheels) {
      s.object.localToWorld(_w.copy(w.at));
      if (!w.last) { w.last = _w.clone(); continue; }
      const dx = _w.x - w.last.x, dz = _w.z - w.last.z, d = Math.hypot(dx, dz);
      if (d < STEP) continue;
      if (d < 5) print(w.kind, w.last, _w, d);   // (a jump is a teleport, not driving)
      w.last.copy(_w);
    }
  }
}

// One print from a to b, laid on the slope of the ground there.
function print(kind, a, b, len) {
  const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, y = heightAt(x, z);
  if (b.y - y > 0.5) return;                       // on a deck or a road above the ground
  const L = layer(kind);
  const e = 0.5;
  _n.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
  _f.set(b.x - a.x, 0, b.z - a.z).normalize();
  _r.crossVectors(_n, _f).normalize();             // across the print
  _f.crossVectors(_r, _n).normalize();             // along it, on the slope
  _m.makeBasis(_r, _n, _f);
  _q.setFromRotationMatrix(_m);
  _m.compose(_c.set(x, y + 0.03, z), _q, _s.set(L.width * (0.9 + Math.random() * 0.2), 1, len));
  L.mesh.setMatrixAt(L.next, _m);
  L.next = (L.next + 1) % MAX;
  L.mesh.count = Math.max(L.mesh.count, L.next === 0 ? MAX : L.next);
  L.mesh.instanceMatrix.needsUpdate = true;
}
