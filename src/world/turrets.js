// Tank turrets: every tank's turret turns on its ring, crewed. Calm, the crew traverses slowly
// over its sector, looking; once the compound is alerted it searches faster and all round; when
// it can see you it lays the gun on you and fires a high-explosive round from the barrel (muzzle
// blast, dust, the gun recoiling, a tracer flying to where it lands). A crew can't see through a
// wall, but its gun shoots through one: duck behind cover after they've seen you and they keep
// firing where you were for a while, the round punching through the wall to burst behind it.
// A crewed tank's engine runs: its exhausts smoke (exhaust.js), so a live tank can be told from a
// wreck at a glance.
import * as THREE from 'three';
import { propModel, splitProp } from './props.js';
import { addExhaust } from './exhaust.js';

const RANGE = 300;          // m, a standing man in the open (less the less visible you are)
const SHELL_SPEED = 450;    // m/s: an HE round, slow enough to see its tracer
const RECOIL = 0.3;         // m the gun runs back, in the turret's own units scaled below
const MEMORY = 8;           // s a crew keeps firing at where it last saw you
const TRACKS_HEARD = 350;   // m the tracks of a moving tank carry
const TURRET_HEARD = 90;    // m a turret's traverse motor carries

const crews = [];
let ctx = null;

// The game's services, once: { scene, world, player, stealth, audio, fx, hud, explosions }.
export const turretCrews = crews;

export function initTurrets(services) { ctx = services; }

// Register a turret. pivot: the Object3D that turns (yaw about its parent's y); gun: the
// barrel's direction in the pivot's parent at yaw 0 (a unit vector); muzzle: the muzzle in the
// pivot's own space; recoil: the mesh that runs back when it fires (moved along -gun, in its
// parent's units); own: meshes the crew's sight passes through; name for the warning.
// exhaust: { space, points, dir }: the exhaust pipes in `space`'s own coordinates, and which way they blow.
export function addTurret({ pivot, gun, muzzle, recoil = null, recoilScale = 1, own = [], name = 'TANK', traverse = 0.3, reload = 10, fires = true, sector = 1.0, exhaust = null }) {
  const crew = {
    pivot, gun: gun.clone().normalize(), muzzle, recoil, recoilRest: recoil?.position.clone(), recoilScale, own, name, traverse, reloadTime: reload, fires, sector,
    base: Math.atan2(gun.x, gun.z), yaw: pivot.rotation.y, want: 0, scanT: Math.random() * 4, reload: 3 + Math.random() * 4,
    kick: 0, tracking: false, dead: false, lastSeen: null, lostT: Infinity, prevAt: null, speed: 0,
  };
  crews.push(crew);
  if (exhaust) addExhaust({ ...exhaust, heavy: true, running: () => !crew.dead && shown(crew.pivot), speed: () => crew.speed });
  return crew;
}

// A modelled tank prop with its turret cut out to turn: { group, hull, pivot, turret, crew-ready
// fields }. cut: { deck, ring: [x, z], turret(c) → bool for a triangle centroid (prop space),
// gun: [x, y, z] direction, muzzle: [x, y, z] in prop space }.
export const TURRET_CUTS = {
  // Tiger (size 6.6 × 3.0 × 3.6, gun toward −x): the turret sits on the deck at 1.95 m.
  tiger: {
    size: { x: 6.6, y: 3.0, z: 3.6 }, deck: 1.95, ring: [0.86, 0],
    turret: (c) => c.y > 1.97 && ((c.x > -0.45 && c.x < 2.2 && Math.abs(c.z) < 1.32) || (c.x <= -0.45 && Math.abs(c.z) < 0.4 && c.y < 2.6)),
    gun: [-1, 0, 0], muzzle: [-3.3, 2.2, 0],
    exhaust: { points: [[3.2, 2.05, 0.5], [3.2, 2.05, -0.5]], dir: [0.5, 1, 0] },   // the two pipes on the back deck
  },
};

export function turretProp(key) {
  const cut = TURRET_CUTS[key];
  const model = propModel(key, cut.size, { stretch: true, own: true });
  if (!model) return null;
  const parts = splitProp(model, (c) => (cut.turret(c) ? 'turret' : 'hull'));
  const group = new THREE.Group(), pivot = new THREE.Group(), [rx, rz] = cut.ring;
  pivot.position.set(rx, cut.deck, rz);
  parts.turret.position.set(-rx, -cut.deck, -rz);   // the ring at the pivot, so it turns in place
  pivot.add(parts.turret);
  group.add(parts.hull, pivot);
  const muzzle = new THREE.Vector3(cut.muzzle[0] - rx, cut.muzzle[1] - cut.deck, cut.muzzle[2] - rz);
  const exhaust = cut.exhaust && { space: group, points: cut.exhaust.points.map(q => new THREE.Vector3(...q)), dir: new THREE.Vector3(...cut.exhaust.dir).normalize() };
  return { group, hull: parts.hull, turret: parts.turret, pivot, gun: new THREE.Vector3(...cut.gun), muzzle, exhaust };
}

// Is this object and everything above it shown? (a column vehicle is hidden until it comes)
function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }

export function tickTurrets(dt) {
  if (!ctx) return;
  const { world, player: p, stealth } = ctx;
  const alerted = world.soldiers.some(s => s.alive && s.aware?.state === 'alerted');
  const fighting = alerted && world.soldiers.some(s => s.alive && s.aware?.state === 'alerted' && s.aware.spotted);
  const target = p.pos.clone().setY(p.pos.y + Math.max(0.3, p.eye * 0.6));
  const range = RANGE * Math.sqrt(Math.min(1, stealth.playerVisibility()));
  const at = new THREE.Vector3(), local = new THREE.Vector3();
  let tracks = 0, trackSpeed = 0, trackDist = Infinity, turret = 0, turretDist = Infinity;
  for (const c of crews) {
    if (c.dead || !shown(c.pivot)) continue;
    const parent = c.pivot.parent;
    c.pivot.getWorldPosition(at);
    // How fast the tank is driving (smoothed): a moving one's tracks rattle.
    if (c.prevAt && dt > 0) c.speed += (at.distanceTo(c.prevAt) / dt - c.speed) * Math.min(1, dt * 4);
    (c.prevAt ??= new THREE.Vector3()).copy(at);
    const heard = at.distanceTo(p.pos);
    if (c.speed > 0.5) {
      const l = Math.max(0, 1 - heard / TRACKS_HEARD) * Math.min(1, c.speed / 4);
      if (l > tracks) { tracks = l; trackSpeed = Math.min(1, c.speed / 8); trackDist = heard; }
    }
    const yaw0 = c.yaw;
    // The crew sees like the guards do, with better optics, only once the compound is fighting you.
    let canSee = false;
    if (fighting && !p.dead && !stealth.concealed && target.distanceTo(at) < range) {
      const eye = at.clone().setY(at.y + 1);
      const hit = world.raycastSegment(eye, target);
      canSee = !hit || hit.distance > eye.distanceTo(target) - 0.6 || c.own.includes(hit.object);
    }
    if (canSee) { c.lastSeen = target.clone(); c.lostT = 0; } else c.lostT += dt;
    // Where the gun is laid: on you, or on the cover you went behind (it knows you're there).
    const aimAt = canSee ? target : alerted && !p.dead && c.lostT < MEMORY ? c.lastSeen : null;
    if (aimAt) {
      parent.worldToLocal(local.copy(aimAt)).sub(c.pivot.position);
      c.want = Math.atan2(local.x, local.z) - c.base;
    } else if ((c.scanT -= dt) <= 0) {
      // Searching: a new bearing in the sector every few seconds (all round once alerted).
      const sector = alerted ? Math.PI : c.sector;
      c.want = (Math.random() * 2 - 1) * sector;
      c.scanT = alerted ? 3 + Math.random() * 3 : 6 + Math.random() * 6;
    }
    let d = Math.atan2(Math.sin(c.want - c.yaw), Math.cos(c.want - c.yaw));
    const speed = c.traverse * (canSee || alerted ? 1 : 0.5);
    c.yaw += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
    c.yaw = Math.atan2(Math.sin(c.yaw), Math.cos(c.yaw));
    c.pivot.rotation.y = c.yaw;
    if (Math.abs(c.yaw - yaw0) > 1e-5) {
      const l = Math.max(0, 1 - heard / TURRET_HEARD);
      if (l > turret) { turret = l; turretDist = heard; }
    }
    if (canSee && !c.tracking) ctx.hud.message(`THE ${c.name} HAS SEEN YOU · TAKE COVER`, 'wound');
    c.tracking = canSee;
    c.reload = Math.max(0, c.reload - dt);
    d = Math.atan2(Math.sin(c.want - c.yaw), Math.cos(c.want - c.yaw));
    if (c.fires && aimAt && Math.abs(d) < 0.03 && c.reload <= 0) fire(c, aimAt, !canSee);
    // The gun runs back on firing and returns.
    if (c.recoil && c.kick > 0) {
      c.kick = Math.max(0, c.kick - dt * 2.2);
      const back = RECOIL * c.recoilScale * Math.sin(Math.min(1, c.kick) * Math.PI / 2);
      c.recoil.position.copy(c.recoilRest).addScaledVector(c.gun, -back);
    }
  }
  ctx.audio.setTankTracks?.(tracks, trackSpeed, Math.min(1, trackDist / TRACKS_HEARD));
  ctx.audio.setTurret?.(turret, Math.min(1, turretDist / TURRET_HEARD));
  tickShells(dt);
}

export function muzzleOf(c, out = new THREE.Vector3()) { return c.pivot.localToWorld(out.copy(c.muzzle)); }

// Fire a high-explosive round at the target: it lands near you, closer the nearer you are and
// the longer you stand still (wider when firing blind at the cover you went behind).
function fire(c, target, blind = false) {
  const { world, player, audio, fx, explosions } = ctx;
  c.reload = c.reloadTime;
  c.kick = 1;
  const muzzle = muzzleOf(c);
  const dir = target.clone().sub(muzzle).normalize();
  fx.flash(muzzle, dir);
  fx.emit(muzzle, dir, { color: 0xffd9a0, count: 4, speed: 9, size: 0.9, life: 0.18, grow: 2, gravity: 0, glow: true });
  fx.emit(muzzle, dir, { color: 0xcfc8b8, count: 10, speed: 5, size: 1.4, life: 2.2, grow: 3.5, gravity: 0.3 });
  // The blast kicks up dust all round the tank.
  const base = c.pivot.getWorldPosition(new THREE.Vector3());
  base.y = world.floorAt(base.x, base.z, base.y + 1) + 0.3;
  fx.emit(base, new THREE.Vector3(0, 1, 0), { color: 0xb8a888, count: 10, speed: 6, size: 1.6, life: 1.8, grow: 3, gravity: -0.5 });
  audio.explosion(player.pos.distanceTo(muzzle) + 60);   // the gun's report
  const dist = muzzle.distanceTo(target);
  const miss = 1.2 + dist / 45 + (player.moving ? 2 : 0) + (blind ? 2.5 : 0);
  const land = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * miss, 0, (Math.random() - 0.5) * 2 * miss));
  land.y = world.floorAt(land.x, land.z, player.pos.y + 0.5) + 0.3;
  launchShell(muzzle, land, () => explosions.explode(land, { radius: 4, hurt: 7, size: 1.1, noise: 250, heavy: true, by: 'tank' }));
}

// ---- the round in flight: a glowing tracer streak from the muzzle to where it lands ----
const shells = [];
let shellGeo = null, shellMat = null;
function launchShell(from, to, land) {
  if (!shellGeo) {
    shellGeo = new THREE.CylinderGeometry(0.07, 0.07, 6, 6, 1, true).rotateX(Math.PI / 2);   // along z
    shellMat = new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  }
  const mesh = new THREE.Mesh(shellGeo, shellMat);
  mesh.userData.noAO = true;
  mesh.position.copy(from);
  mesh.lookAt(to);
  // Walls and the like on the way: the round punches through each (dust and debris burst out
  // both sides as it passes).
  const breaches = [];
  for (let a = from.clone(), i = 0; i < 6; i++) {
    const hit = ctx.world.raycastSegment(a, to);
    if (!hit || hit.terrain || hit.soldier || hit.distance > a.distanceTo(to) - 0.5) break;
    breaches.push({ d: from.distanceTo(hit.point), at: hit.point.clone(), normal: hit.normal.clone(), done: false });
    a = hit.point.clone().addScaledVector(to.clone().sub(from).normalize(), 0.6);   // through it
  }
  ctx.scene.add(mesh);
  shells.push({ mesh, from: from.clone(), to: to.clone(), t: 0, time: from.distanceTo(to) / SHELL_SPEED, land, breaches });
}

function tickShells(dt) {
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i];
    s.t += dt;
    const k = Math.min(1, s.t / s.time);
    s.mesh.position.lerpVectors(s.from, s.to, k);
    const flown = k * s.from.distanceTo(s.to), dir = s.to.clone().sub(s.from).normalize();
    for (const b of s.breaches) {
      if (b.done || flown < b.d) continue;
      b.done = true;
      ctx.fx.emit(b.at, b.normal, { color: 0xa89c88, count: 8, speed: 5, size: 1.1, life: 1.4, grow: 2.5, gravity: -2 });
      ctx.fx.emit(b.at, dir, { color: 0x8a7e6c, count: 8, speed: 7, size: 0.8, life: 1.1, grow: 2, gravity: -4 });
      ctx.fx.dust(b.at, b.normal, 30);
      ctx.audio.impact?.(ctx.player.pos.distanceTo(b.at));
    }
    if (k >= 1) {
      ctx.scene.remove(s.mesh);
      shells.splice(i, 1);
      s.land();
    }
  }
}

// A crewed tank parked as scenery: placed on the ground at (x, z) facing rotY, its hull and
// turret stopping bullets, a block stopping you. Returns { solids, boxes, group }.
export function placeTank(scene, key, x, z, rotY, heightAt, name) {
  const t = turretProp(key);
  if (!t) return { solids: [], boxes: [], group: null };
  const y = heightAt(x, z), { x: w, z: d } = TURRET_CUTS[key].size;
  t.group.position.set(x, y, z);
  t.group.rotation.y = rotY;
  scene.add(t.group);
  t.group.updateMatrixWorld(true);
  addTurret({ pivot: t.pivot, gun: t.gun, muzzle: t.muzzle, recoil: t.turret, own: [t.hull, t.turret], name, traverse: 0.25, reload: 12, exhaust: t.exhaust });
  const across = Math.abs(Math.sin(rotY)) > 0.7, [bw, bd] = across ? [d * 0.95, w * 0.95] : [w * 0.95, d * 0.95];
  const box = new THREE.Box3(new THREE.Vector3(x - bw / 2, y, z - bd / 2), new THREE.Vector3(x + bw / 2, y + 2.6, z + bd / 2));
  return { solids: [t.hull, t.turret], boxes: [box], group: t.group };
}
