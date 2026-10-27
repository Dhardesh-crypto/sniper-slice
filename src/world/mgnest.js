// Machine-gun nests you can man. Every nest prop (`mgNest`, a ring of sandbags open at the back)
// is armed when the world is built: the gun modelled into the prop is cut out of its mesh and a
// real MG42 goes on the front of the parapet on its bipod, free to traverse; the sandbags become
// solid (you, the guards and bullets stop at them; you step in through the gap at the back).
// Step up behind the gun and press E: you're on it, the view held to its arc of fire, and the
// left mouse fires it (the arsenal's `mount`: its own 250-round belt and two spare belts in the
// boxes beside it, R to change belts). E again, or a takedown, a fall, death, leaves it.
import * as THREE from 'three';
import { rifleModel } from './characters.js';
import { CATALOG } from '../weapons/defs.js';

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const IRON = new THREE.MeshStandardMaterial({ color: 0x232421, roughness: 0.55, metalness: 0.45 });
const ARC = 1.15;                    // rad either side of straight out over the parapet
const PITCH = [-0.32, 0.3];          // rad down, up
const GUN_AHEAD = 0.42;              // m from the pistol grip forward to the bipod's pivot
const BELT = 250, SPARE = 500;
// On its bipod, braced on the sandbags: far steadier than the MG42 fired from the hip.
export const MOUNTED_DEF = { ...CATALOG.mg42, magazine: BELT, reloadTime: 5.5, hipSpread: 0.0045, aimSpread: 0.0045, recoil: 0.007, zoomFovs: [38], zoomNames: ['Over the gun'] };

// Arm every nest in the scene; returns the nests ({ seat, yaw, gun, weapon, ... }).
export function armNests(world, scene) {
  const found = [];
  scene.traverse(o => { if (o.userData?.propKey === 'mgNest' && o.userData.meshes?.length) found.push(o); });
  return found.map(o => arm(o, world, scene)).filter(Boolean);
}

function arm(o, world, scene) {
  o.updateMatrixWorld(true);
  const d = o.userData.dims, s = Math.max(d.x, d.z) / 2;
  const top = cutGun(o, s);
  if (top === null) return null;                       // (no texture to tell the gun from the bags: leave it a prop)
  const q = o.getWorldQuaternion(new THREE.Quaternion()), base = o.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize();   // the gun's side (the model's +x)

  // The sandbags, solid: a ring of square blocks, none across the gap at the back.
  const R = 0.87 * s, n = Math.max(12, Math.round(2 * Math.PI * R / 0.55)), side = 2 * Math.PI * R / n * 1.04, h = top * 0.95;
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * Math.PI * 2, lx = Math.cos(a), lz = Math.sin(a);
    if (lx < -0.8) continue;
    const p = new THREE.Vector3(lx * R, 0, lz * R).applyQuaternion(q).add(base);
    const block = new THREE.Mesh(new THREE.BoxGeometry(side, h, side), HIDDEN);
    block.position.set(p.x, base.y + h / 2, p.z);
    scene.add(block);
    block.updateMatrixWorld(true);
    world.solids.push(block);
    world.boxes.push(new THREE.Box3().setFromObject(block));
  }

  // The gun: on its bipod on the front sandbags, the muzzle out over them.
  const pivot = new THREE.Vector3(R - 0.12, h + 0.17, 0);
  const yawG = new THREE.Group(), tilt = new THREE.Group(), gun = rifleModel('mg42');
  yawG.position.copy(pivot);
  yawG.rotation.y = Math.PI / 2;
  gun.position.z = -GUN_AHEAD;
  tilt.add(gun);
  yawG.add(tilt);
  for (const sx of [-1, 1]) {                            // the bipod's legs, splayed onto the bags
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.24, 5), IRON);
    leg.position.set(sx * 0.06, -0.09, 0.02);
    leg.rotation.z = sx * 0.45;
    tilt.add(leg);
  }
  const box = ammoBox();                                 // the spare belts, by the seat
  box.position.set(pivot.x - 0.75, 0, 0.45);
  o.add(yawG, box);
  o.updateMatrixWorld(true);

  const seatLocal = new THREE.Vector3(pivot.x - GUN_AHEAD - 0.5, 0, 0);
  const seat = seatLocal.applyQuaternion(q).add(base);
  seat.y = world.floorAt(seat.x, seat.z, base.y + 0.5);
  return {
    o, yawG, tilt, gun, seat, base, fwd,
    yaw: Math.atan2(-fwd.x, -fwd.z),                     // the player's yaw looking straight out
    eye: base.y + pivot.y + 0.16 - seat.y,               // eye height over the gun's sights
    weapon: { def: MOUNTED_DEF, mag: BELT, reserve: SPARE, zeroIndex: 0, zeroAngles: [0] },
    muzzle(out = new THREE.Vector3()) { gun.updateMatrixWorld(true); return out.copy(gun.userData.muzzle).applyMatrix4(gun.matrixWorld); },
    grips() {                                            // where the gunner's hands go (world)
      gun.updateMatrixWorld(true);
      return [new THREE.Vector3(0, -0.02, 0).applyMatrix4(gun.matrixWorld), new THREE.Vector3(-0.02, 0.06, 0.2).applyMatrix4(gun.matrixWorld)];
    },
  };
}

// Cut the gun modelled into the prop out of its mesh: the grey triangles (read from the texture:
// the gun is grey steel, the bags and the floor tan and brown) inside the ring or above the
// parapet. Returns the sandbags' height, or null.
function cutGun(o, s) {
  const inv = o.matrixWorld.clone().invert(), v = new THREE.Vector3(), dims = o.userData.dims;
  let top = 0, cutAny = false;
  for (const m of o.userData.meshes) {
    const img = m.material.map?.image, g = m.geometry;
    if (!img || !g.index || !g.attributes.uv) return null;
    const texel = texelColour(img, m.material.map.flipY);
    if (!texel) return null;
    const pos = g.attributes.position, uv = g.attributes.uv, idx = g.index.array, keep = [];
    const toLocal = m.matrixWorld.clone().premultiply(inv);
    for (let t = 0; t < idx.length; t += 3) {
      let x = 0, y = 0, z = 0, l = 0, sat = 0;
      for (let k = 0; k < 3; k++) {
        const i = idx[t + k];
        v.fromBufferAttribute(pos, i).applyMatrix4(toLocal);
        x += v.x / 3; y += v.y / 3; z += v.z / 3;
        const [L, S] = texel(uv.getX(i), uv.getY(i));
        l += L / 3; sat += S / 3;
      }
      const r = Math.hypot(x, z) / s;
      const gun = sat < 0.08 && l < 0.4 && (r < 0.7 || y > dims.y * 0.62);
      if (gun) { cutAny = true; continue; }
      keep.push(idx[t], idx[t + 1], idx[t + 2]);
      if (r > 0.75) top = Math.max(top, y);
    }
    const bags = g.clone();
    bags.setIndex(keep);
    m.geometry = bags;
  }
  return cutAny ? Math.min(top, dims.y) : null;
}

const lumCache = new WeakMap();
function texelColour(img, flipY) {      // (u, v) → [luminance, saturation], 0..1
  if (!lumCache.has(img)) {
    try {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      lumCache.set(img, { w: img.width, h: img.height, px: g.getImageData(0, 0, img.width, img.height).data });
    } catch { lumCache.set(img, null); }
  }
  const t = lumCache.get(img);
  if (!t) return null;
  return (u, v) => {
    const x = Math.min(t.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * t.w)));
    const yy = flipY ? 1 - v : v, y = Math.min(t.h - 1, Math.max(0, Math.floor((yy - Math.floor(yy)) * t.h)));
    const i = (y * t.w + x) * 4;
    const r = t.px[i], g = t.px[i + 1], b = t.px[i + 2];
    return [(r + g + b) / 765, (Math.max(r, g, b) - Math.min(r, g, b)) / 255];
  };
}

function ammoBox() {
  const g = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0x4a4e3c, roughness: 0.7, metalness: 0.3 });
  for (const [x, z, r] of [[0, 0, 0.1], [0.05, 0.13, -0.15]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.17, 0.11), steel);
    b.position.set(x, 0.085, z); b.rotation.y = r;
    b.castShadow = b.receiveShadow = true;
    g.add(b);
  }
  return g;
}

// Manning a nest: the prompt, getting on and off the gun, the view held to its arc, the gun
// turned to where you look. main.js runs tick() with the game's other E prompts and frame()
// after the mouse look.
export class MountedGuns {
  constructor({ world, player, input, arsenal, audio }) {
    Object.assign(this, { world, player, input, arsenal, audio });
    this.on = null;
    this.near = null;
  }

  nearest() {
    const p = this.player;
    if (p.dead || p.climb || p.carrying || p.locked || p.stance === 'prone') return null;
    for (const n of this.world.nests ?? []) {
      if (Math.hypot(p.pos.x - n.seat.x, p.pos.z - n.seat.z) < 1.1 && Math.abs(p.pos.y - n.seat.y) < 0.8) return n;
    }
    return null;
  }

  // other: another E prompt is up (a pickup, a door, a body): it has the key.
  tick(dt, other = false) {
    const p = this.player;
    if (this.on) {
      if (p.dead || p.locked || this.input.wasPressed('KeyE')) this.leave();
      return;
    }
    this.near = this.nearest();
    if (this.near && !other && this.input.wasPressed('KeyE') && !this.arsenal.busy) this.man(this.near);
  }

  man(n) {
    const p = this.player, a = this.arsenal;
    this.on = n;
    p.mounted = n;
    p.pos.copy(n.seat); p.prevPos.copy(n.seat); p.vel.set(0, 0, 0);
    p.setStance('stand');
    p.yaw = n.yaw; p.pitch = Math.max(PITCH[0], Math.min(PITCH[1], p.pitch));
    a.mount = n;
    a.zoomIndex = 0;
    a.bursting = false;
    this.audio.click(0, 900, 0.3);
  }

  leave() {
    const p = this.player, n = this.on;
    this.on = null;
    p.mounted = null;
    if (this.arsenal.bursting) this.audio.burstTail();
    this.arsenal.bursting = false;
    this.arsenal.mount = null;
    if (!p.dead && !p.locked) { p.pos.addScaledVector(n.fwd, -0.35); p.pos.y = this.world.floorAt(p.pos.x, p.pos.z, p.pos.y + 0.3); }
    this.audio.click(0, 700, 0.25);
  }

  // After the mouse look: hold the view to the gun's arc, and lay the gun on it.
  frame() {
    const n = this.on, p = this.player;
    if (!n) return;
    let rel = Math.atan2(Math.sin(p.yaw - n.yaw), Math.cos(p.yaw - n.yaw));
    rel = THREE.MathUtils.clamp(rel, -ARC, ARC);
    p.yaw = n.yaw + rel;
    p.pitch = THREE.MathUtils.clamp(p.pitch, PITCH[0], PITCH[1]);
    n.yawG.rotation.y = Math.PI / 2 + rel;
    n.tilt.rotation.x = -p.pitch;
    n.o.updateMatrixWorld(true);
  }

  state() {
    if (this.on) {
      const w = this.on.weapon;
      return { label: `E · LEAVE THE GUN   ·   BELT ${w.mag} + ${w.reserve}`, progress: 0 };
    }
    return this.near ? { label: 'E · MAN THE MG42', progress: 0 } : null;
  }
}
