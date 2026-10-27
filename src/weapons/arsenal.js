// Everything about aiming and shooting: scope and zeroing, sway, breath, recoil,
// the bolt and reloads, binoculars and tagging, and the simulated bullets in flight.
import * as THREE from 'three';
import { integrate, solveZeroAngle } from './ballistics.js';
import { WEAPONS, SIGHT_HEIGHT, BINOCULARS, WIND_EFFECT, AMMO, HEAVY_AMMO, buildWeapon } from './defs.js';

const STANCE_SWAY = { stand: 0.0036, crouch: 0.0024, prone: 0.001 }; // radians
const BULLET_SUBSTEPS = 6;
const FIXED_STEP = 1 / 60;
const _v = new THREE.Vector3();

function tanFov(deg) { return Math.tan(THREE.MathUtils.degToRad(deg) / 2); }
function fovFromTan(t) { return THREE.MathUtils.radToDeg(Math.atan(t) * 2); }

export class Arsenal {
  constructor({ world, player, input, audio, fx, settings }) {
    Object.assign(this, { world, player, input, audio, fx, settings });
    this.camera = null; // set by the game; shots leave along what the player saw last frame
    this.avatar = null; // third-person body: hip and pistol shots leave its muzzle
    this.ballisticWind = new THREE.Vector3();
    this.weapons = {};
    for (const def of Object.values(WEAPONS)) {
      this.weapons[def.id] = {
        def,
        mag: def.magazine,
        reserve: def.reserve,
        zeroIndex: def.defaultZero,
        zeroAngles: def.zeros.map(z => solveZeroAngle(def.muzzleVelocity, def.drag, z, SIGHT_HEIGHT)),
      };
    }
    // Rifle rounds by type; `reserve` reads and writes the pool of the type that's loaded.
    const rifle = this.weapons.rifle;
    rifle.ammo = Object.fromEntries(Object.entries(AMMO).map(([k, a]) => [k, a.start]));
    rifle.loaded = 'standard';
    rifle.pendingAmmo = null;
    Object.defineProperty(rifle, 'reserve', { get() { return this.ammo[this.loaded]; }, set(v) { this.ammo[this.loaded] = v; } });
    // Heavy ammunition by weapon (shells, belts, rockets…): `reserve` is the pool of the one carried.
    const heavy = this.weapons.heavy;
    this.heavyAmmo = Object.fromEntries(Object.keys(HEAVY_AMMO).map(id => [id, 0]));
    const pools = this.heavyAmmo;
    heavy.mag = 0;
    Object.defineProperty(heavy, 'reserve', { get() { return pools[this.def.id] ?? 0; }, set(v) { if (this.def.id in pools) pools[this.def.id] = v; } });
    this.rockets = null;     // set by main: anti-tank rounds in flight
    this.mount = null;       // a nest's machine gun you're on (mgnest.js): its weapon fires instead
    this.current = 'rifle';
    this.aim = 0;            // 0 hip … 1 fully aimed (scoped)
    this.aiming = false;
    this.binoculars = false;
    this.zoomIndex = 0;
    this.binocZoomIndex = 0;
    this.fov = settings.fov;

    this.breath = 1;         // fraction of breath left
    this.holding = false;
    this.exhaustedT = 0;
    this.swayT = Math.random() * 100;
    this.swayScale = 1;
    this.sway = { yaw: 0, pitch: 0 };
    this.heartPulse = 0;
    this.heartPhase = 0;
    this.recoil = 0;
    this.recoilVel = 0;
    this.roll = 0;
    this.rollVel = 0;
    this.shake = 0;
    this.viewKick = 0;
    this.readyT = 0;     // weapon raised after a shot (third-person pose)

    this.cooldown = 0;
    this.boltT = -1;
    this.reloadT = 0;
    this.switchT = 0;
    this.pendingSwitch = null;

    this.bullets = [];
    this.lastTrajectory = null;
    this.prediction = null;
    this.predictFrame = 0;
    this.rangeReadout = null;
    this.tagCandidate = null;
    this.tagT = 0;
    this.stats = { shots: 0, hits: 0, kills: 0, headshots: 0, longest: 0 };
    this.onHit = null;
    this.onKill = null;
    this.onKillCam = null;
    this.lastKillCam = -100;
    this.onTag = null;
  }

  get weapon() { return this.mount ? this.mount.weapon : this.weapons[this.current]; }
  get def() { return this.weapon.def; }
  get scoped() { return this.current === 'rifle' && !this.mount && this.aim > 0.9; }
  get zero() { return this.def.zeros[this.weapon.zeroIndex]; }
  get busy() { return this.reloadT > 0 || this.switchT > 0; }
  // Can't aim or shoot while climbing, dragging a body, in a takedown, healing or aiming a throw.
  get handsTied() { const p = this.player; return !!(p.climb || p.carrying || p.locked || p.busyHands); }

  // Put on a loadout: { rifle, pistol, heavy, fit: { weaponId: { slot: partId } } } (the loadout
  // screen, a workbench, a loaded save). Each weapon is built from its base and fitted parts.
  equip(loadout) {
    for (const slot of ['rifle', 'pistol', 'heavy']) {
      const id = loadout[slot], w = this.weapons[slot];
      if (!id) continue;
      const def = buildWeapon(id, loadout.fit?.[id] ?? {});
      const newGun = w.def.id !== id;
      if (newGun && w.def.id) {                       // the old gun's rounds go back in your pouch
        if (slot === 'rifle') w.ammo[w.loaded] += w.mag; else w.reserve += w.mag;
        w.mag = 0;
      }
      w.def = def;
      w.zeroIndex = Math.min(w.zeroIndex, def.zeros.length - 1);
      w.zeroAngles = def.zeros.map(z => solveZeroAngle(def.muzzleVelocity, def.drag, z, SIGHT_HEIGHT));
      if (w.mag > def.magazine) { if (slot === 'rifle') w.ammo[w.loaded] += w.mag - def.magazine; else w.reserve += w.mag - def.magazine; w.mag = def.magazine; }
      if (newGun || w.mag === 0) { const n = Math.min(def.magazine - w.mag, w.reserve); w.mag += n; w.reserve -= n; }
    }
    if (this.current === 'heavy' && !loadout.heavy) this.current = 'rifle';
    this.zoomIndex = Math.min(this.zoomIndex, this.def.zoomFovs.length - 1);
    this.loadout = JSON.parse(JSON.stringify(loadout));
    this.onEquip?.(this.loadout);
  }

  // What the next shot is: the weapon, adjusted for the rifle's loaded ammunition.
  shotDef() {
    const def = this.def;
    if (this.current !== 'rifle' || this.mount) return def;
    const a = AMMO[this.weapon.loaded];
    if (!a.velocityScale && !a.ap) return def;
    const out = { ...def, ammo: this.weapon.loaded, ap: !!a.ap };
    if (a.velocityScale && !def.integralSuppressor) {      // a built-in silencer already fires subsonic
      out.muzzleVelocity = def.muzzleVelocity * a.velocityScale;
      out.noiseRadius = def.noiseRadius * a.noiseScale;
    }
    if (a.damageScale && !def.integralSuppressor) out.damage = Object.fromEntries(Object.entries(def.damage).map(([k, v]) => [k, v === 999 ? v : v * a.damageScale]));
    return out;
  }

  // X: load the next ammunition type you have rounds of (a reload).
  switchAmmo() {
    const w = this.weapons.rifle, types = Object.keys(AMMO);
    const from = w.pendingAmmo ?? w.loaded;
    for (let i = 1; i <= types.length; i++) {
      const next = types[(types.indexOf(from) + i) % types.length];
      if (next === w.loaded || w.ammo[next] > 0) {
        if (next === w.loaded && !w.pendingAmmo) { this.onAmmo?.(null); return; }   // nothing else to load
        w.pendingAmmo = next === w.loaded ? null : next;
        if (w.pendingAmmo) this.beginReload();
        this.onAmmo?.(AMMO[next].name);
        return;
      }
    }
  }

  // ---- fixed-step simulation ----
  tick(dt) {
    const inp = this.input, w = this.weapon, def = this.def;

    if (this.pendingSwitch === null && !this.reloadT && !this.mount) {
      if (inp.wasPressed('Digit1') && this.current !== 'rifle') this.beginSwitch('rifle');
      if (inp.wasPressed('Digit2') && this.current !== 'pistol') this.beginSwitch('pistol');
      if (inp.wasPressed('Digit3') && this.current !== 'heavy' && this.loadout?.heavy) this.beginSwitch('heavy');
    }
    if (this.switchT > 0) {
      this.switchT = Math.max(0, this.switchT - dt);   // (left at a hair below 0 it read as "still switching")
      if (this.pendingSwitch && this.switchT < 0.3) {
        this.current = this.pendingSwitch;
        this.pendingSwitch = null;
        this.zoomIndex = 0;
      }
    }

    // Aim: hold right mouse, or (setting) click once to raise and again to lower: easier on a trackpad.
    if (this.settings.aimMode === 'toggle') {
      if (inp.wasPressed('Mouse2')) this.aimLatched = !this.aimLatched;
      if (this.player.sprinting || this.player.climb || this.player.carrying || this.pendingSwitch) this.aimLatched = false;
    } else this.aimLatched = inp.down('Mouse2');
    this.aiming = this.aimLatched && !this.player.sprinting && !this.busy && !this.handsTied;
    this.binoculars = inp.down('KeyB') && !this.aiming && !this.busy;

    if (inp.wasPressed('KeyR') && w.mag < def.magazine && w.reserve > 0 && !this.busy) this.beginReload();
    if (inp.wasPressed('KeyX') && this.current === 'rifle' && !this.mount && this.switchT <= 0 && !this.handsTied) this.switchAmmo();
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        if (w.pendingAmmo) { w.ammo[w.loaded] += w.mag; w.mag = 0; w.loaded = w.pendingAmmo; w.pendingAmmo = null; } // unload, then load the new type
        const n = Math.min(def.magazine - w.mag, w.reserve);
        w.mag += n;
        w.reserve -= n;
        this.reloadT = 0;
      }
    }

    if (def.zeros.length > 1) {
      if ((this.aiming && inp.wasPressed('ArrowUp')) || inp.wasPressed('PageUp')) w.zeroIndex = Math.min(def.zeros.length - 1, w.zeroIndex + 1);
      if ((this.aiming && inp.wasPressed('ArrowDown')) || inp.wasPressed('PageDown')) w.zeroIndex = Math.max(0, w.zeroIndex - 1);
    }
    // Zoom the scope or the binoculars, whichever you're looking through: mouse wheel,
    // = / − (in / out), or V to switch between the two magnifications.
    const wheel = inp.takeWheel();
    let step = wheel ? (wheel < 0 ? 1 : -1) : 0;
    if (inp.wasPressed('Equal') || inp.wasPressed('NumpadAdd')) step = 1;
    if (inp.wasPressed('Minus') || inp.wasPressed('NumpadSubtract')) step = -1;
    const cycle = inp.wasPressed('KeyV');
    const zoom = (i, n) => (cycle ? (i + 1) % n : THREE.MathUtils.clamp(i + step, 0, n - 1));
    if ((step || cycle) && this.aiming && def.zoomFovs.length > 1) {
      this.zoomIndex = zoom(this.zoomIndex, def.zoomFovs.length);
    } else if ((step || cycle) && this.binoculars) {
      this.binocZoomIndex = zoom(this.binocZoomIndex, BINOCULARS.zoomFovs.length);
    }

    this.tickBreath(dt);
    this.readyT = Math.max(0, this.readyT - dt / 0.9);
    this.ballisticWind.copy(this.world.wind).multiplyScalar(WIND_EFFECT);

    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.boltT >= 0) {
      this.boltT += dt / (def.cycleTime - 0.2);
      if (this.boltT >= 1) this.boltT = -1;
    }
    // Fire: left mouse, or Space while aiming (Space climbs when you're not aiming).
    const trigger = def.auto   // the machine gun fires as long as the trigger's held
      ? inp.down('Mouse0') || (this.aiming && inp.down('Space'))
      : inp.wasPressed('Mouse0') || (this.aiming && inp.wasPressed('Space'));
    // A machine-gun burst ends with its echo rolling away.
    if (this.bursting && (!trigger || w.mag === 0 || this.busy || this.handsTied)) { this.bursting = false; this.audio.burstTail(); }
    if (trigger && !this.binoculars && !this.player.sprinting && !this.busy && !this.handsTied && this.cooldown <= 0) {
      if (w.mag > 0) { this.fire(); if (def.auto) this.bursting = true; }
      else if (inp.wasPressed('Mouse0') || inp.wasPressed('Space')) { this.audio.dryFire(); this.cooldown = 0.3; }
    }
    if (w.mag === 0 && w.reserve > 0 && !this.busy && this.cooldown <= 0 && !this.aiming) this.beginReload();

    this.tickBullets(dt);
    this.rockets?.tick(dt);
    this.tickBinoculars(dt);
  }

  beginSwitch(id) {
    this.pendingSwitch = id;
    this.switchT = 0.6;
    this.boltT = -1;
    this.audio.click(0.05, 1300, 0.2);
  }

  beginReload() {
    this.reloadT = this.def.reloadTime;
    this.audio.reloadFor(this.def, this.def.reloadTime);
  }

  tickBreath(dt) {
    const canHold = this.scoped && this.exhaustedT <= 0;
    const wantHold = this.input.down('ShiftLeft') || this.input.down('ShiftRight');
    if (canHold && wantHold && this.breath > 0) {
      if (!this.holding) this.audio.breathIn();
      this.holding = true;
      // Lungs run out faster when the heart is racing.
      const duration = THREE.MathUtils.clamp(6.5 - (this.player.heartRate - 70) / 22, 2.5, 6.5) * (this.def.breathScale ?? 1); // a cheek-rest stock helps
      this.breath -= dt / duration;
      if (this.breath <= 0) {
        this.breath = 0;
        this.holding = false;
        this.exhaustedT = 2.5;
        this.player.heartRate += 12;
        this.audio.breathOut();
      }
    } else {
      if (this.holding) this.audio.breathOut();
      this.holding = false;
      this.breath = Math.min(1, this.breath + dt / 3.5);
    }
    this.exhaustedT = Math.max(0, this.exhaustedT - dt);
  }

  fire() {
    const w = this.weapon, def = this.shotDef(), cam = this.camera;
    const q = cam.quaternion;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    let origin, dir, aimPoint = null;
    if (this.scoped) {
      // Through the scope: from the eye, bore elevated by the zero.
      const angle = w.zeroAngles[w.zeroIndex];
      dir = fwd.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle));
      origin = cam.position.clone().addScaledVector(up, -SIGHT_HEIGHT);
    } else {
      // Third person: from the muzzle toward whatever is under the crosshair.
      origin = this.mount ? this.mount.muzzle() : this.avatar.muzzle(this.current);
      const ahead = Math.max(0, origin.clone().sub(cam.position).dot(fwd));
      const from = cam.position.clone().addScaledVector(fwd, ahead);
      const hit = this.world.raycastRay(from, fwd, 1500);
      aimPoint = hit ? hit.point.clone() : null;
      dir = (hit ? hit.point.clone() : from.clone().addScaledVector(fwd, 1500)).sub(origin).normalize();
      const spread = (this.current !== 'rifle' || this.mount) && this.aim > 0.75 ? def.aimSpread ?? 0.0025 : def.hipSpread;
      const r = Math.sqrt(Math.random()) * spread, a = Math.random() * Math.PI * 2;
      dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    }
    const bullet = (d) => ({
      def, pos: origin.clone(), vel: d.clone().multiplyScalar(def.muzzleVelocity),
      origin, dir: d.clone(), time: 0, path: [origin.clone()], prev: new THREE.Vector3(),
    });
    if (def.rocket) {
      this.rockets?.launch(origin, aimPoint, dir, def);              // an anti-tank round
    } else if (def.pellets) {
      // A shotgun: each pellet its own bullet in a cone.
      for (let i = 0; i < def.pellets; i++) {
        const r = Math.sqrt(Math.random()) * def.pelletSpread, a = Math.random() * Math.PI * 2;
        this.bullets.push(bullet(dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize()));
      }
    } else {
      // A lethal, worthy shot is handed to the kill cam, which plays it out and applies the hit.
      const b = bullet(dir), cine = this.current === 'heavy' || this.mount ? null : this.killCamShot(b);
      if (cine) this.onKillCam?.(cine);
      else this.bullets.push(b);
    }

    w.mag--;
    this.cooldown = def.cycleTime;
    this.stats.shots++;
    this.recoilVel += def.recoil * 22 * (this.scoped ? 1 : 0.5);
    this.rollVel += (Math.random() < 0.5 ? -1 : 1) * def.recoil * 9;
    this.shake = this.mount ? 0.2 : this.current === 'rifle' ? 1 : this.current === 'heavy' ? (def.auto ? 0.25 : 0.8) : 0.3;
    this.viewKick = 1;
    this.readyT = 1;
    if (!this.scoped) this.fx.flash(origin, dir);
    // The spent case: out at once from an automatic or a semi-automatic, when the bolt's worked from a
    // bolt rifle; none from a pistol (it lands at your feet unseen), a shotgun's comes with the pump.
    if (!def.rocket && this.current !== 'pistol') {
      const port = this.scoped ? cam.position.clone().addScaledVector(fwd, 0.5).addScaledVector(up, -0.12) : origin;
      this.world.casings?.eject(port, dir, right, def.auto || def.semi || this.mount ? 0 : def.pellets ? 0.3 : 0.45, !!def.auto);
    }
    if (!this.mount) this.player.heartRate = Math.min(180, this.player.heartRate + 3);   // (braced on a mounted gun: no)
    this.audio.weaponShot(def);           // each gun its own report; suppressed if one's fitted
    if (this.current === 'rifle' && !this.mount && w.mag > 0 && !def.semi) { this.boltT = 0; this.audio.bolt(); }   // semi-automatics cycle themselves
    if (def.pellets && w.mag > 0) this.audio.pump();                                                      // and the shotgun's pump
    this.lastShot = { noiseRadius: def.noiseRadius, position: origin.clone(), time: this.world.time };
    this.onShot?.(origin.clone(), def);
  }

  // Fly a copy of the bullet to its end, exactly as tickBullets would (wind frozen at the
  // trigger pull; the flight is under a second, so gusts barely change it).
  simulate(bullet, maxTime = 4) {
    const pos = bullet.pos.clone(), vel = bullet.vel.clone(), prev = new THREE.Vector3();
    const path = [pos.clone()];
    const h = FIXED_STEP / BULLET_SUBSTEPS;
    for (let t = 0; t < maxTime; t += h) {
      prev.copy(pos);
      integrate(pos, vel, bullet.def.drag, this.ballisticWind, h);
      const hit = this.world.raycastSegment(prev, pos);
      if (hit) {
        path.push(hit.point.clone());
        return { path, hit, time: t + h, vel };
      }
      path.push(pos.clone());
    }
    return { path, hit: null, time: maxTime, vel };
  }

  // Decide whether this shot gets the X-ray kill cam (setting: always / sometimes / off).
  killCamShot(bullet) {
    const mode = this.settings.killCam;
    if (mode === 'off' || !this.onKillCam) return null;
    const sim = this.simulate(bullet);
    const hit = sim.hit;
    // A shot that will blow up a vehicle always gets the cam (unless one just played).
    if (hit?.hotspot?.explodesOnNext(bullet.def.ap)) {
      if (this.world.time - this.lastKillCam < 6) return null;
      this.lastKillCam = this.world.time;
      return { bullet, ...sim, distance: bullet.origin.distanceTo(hit.point) };
    }
    if (!hit?.soldier || !hit.soldier.alive) return null;
    const damage = bullet.def.damage[hit.zone] ?? 50;
    if (damage < hit.soldier.hp) return null;
    const distance = bullet.origin.distanceTo(hit.point);
    const head = hit.zone === 'head';
    const vitalZone = hit.zone === 'torso' || hit.zone === 'pelvis';
    let play = mode === 'always';
    if (mode === 'sometimes') {
      const since = this.world.time - this.lastKillCam;
      const worthy = head || distance >= 150 || vitalZone;
      const roll = head || distance >= 250 || Math.random() < 0.5;
      play = worthy && roll && since > 6;
    }
    if (!play) return null;
    this.lastKillCam = this.world.time;
    return { bullet, ...sim, distance };
  }

  tickBullets(dt) {
    const h = dt / BULLET_SUBSTEPS;
    for (const b of this.bullets) {
      for (let i = 0; i < BULLET_SUBSTEPS && !b.dead; i++) {
        b.prev.copy(b.pos);
        integrate(b.pos, b.vel, b.def.drag, this.ballisticWind, h);
        b.time += h;
        const hit = this.world.raycastSegment(b.prev, b.pos);
        if (hit?.soldier && hit.soldier === b.ignore) { b.path.push(b.pos.clone()); continue; }   // (the man it just went through)
        if (hit) {
          b.path.push(hit.point.clone());
          this.resolveHit(b, hit);
          b.dead = true;
        } else {
          b.path.push(b.pos.clone());
          if (b.time > 4 || b.pos.y < -100) b.dead = true;
        }
      }
      if (b.dead) this.lastTrajectory = b.path;
    }
    this.bullets = this.bullets.filter(b => !b.dead);
  }

  resolveHit(bullet, hit) {
    const distance = bullet.origin.distanceTo(hit.point);
    const dir = _v.copy(bullet.vel).normalize().clone();
    if (hit.object?.userData.onShot) {            // something alive that isn't a man (a guard's dog)
      hit.object.userData.onShot(hit, dir, distance);
      this.fx.blood(hit.point, dir, true);
      this.world.decals?.spatter(hit.point, dir);
      this.audio.hitConfirm(true, false);
      this.stats.hits++;
      this.onHit?.({ miss: true, distance, point: hit.point.clone() });
      return;
    }
    if (hit.soldier) {
      const res = hit.soldier.applyHit(hit.zone, bullet.def, dir);
      this.fx.blood(hit.point, dir.clone().negate());
      if (res.already) {
        this.fx.dust(hit.point, hit.normal, distance);
        this.passThrough(bullet, hit, dir);
        return;
      }
      this.stats.hits++;
      if (res.killed) {
        this.stats.kills++;
        this.stats.longest = Math.max(this.stats.longest, distance);
        if (hit.zone === 'head') this.stats.headshots++;
      }
      this.fx.blood(hit.point, dir, true); // exit spray
      this.world.decals?.spatter(hit.point, dir, hit.soldier);   // and on whatever's behind him
      this.audio.hitConfirm(res.killed, res.zone === 'head');
      if (res.killed) bullet.kills = (bullet.kills ?? 0) + 1;
      const evt = { ...res, distance, soldier: hit.soldier, point: hit.point.clone(), speed: bullet.vel.length(), time: bullet.time, kills: bullet.kills ?? 0 };
      this.onHit?.(evt);
      if (res.killed) this.onKill?.(evt);
      this.passThrough(bullet, hit, dir);
    } else if (hit.trap && this.items) {
      this.items.shot(hit.trap);       // TNT or a satchel: it goes off
    } else if (hit.hotspot && this.hotspots) {
      // A weak spot: the hotspot system decides what breaks or blows up.
      const live = hit.hotspot.active;
      this.hotspots.hit(hit.hotspot, hit.point, dir, distance, !!bullet.def.ap);
      this.onImpactNoise?.(hit.point.clone());
      if (live) { this.stats.hits++; this.onHit?.({ hotspot: hit.hotspot, distance, point: hit.point.clone() }); }
      else this.onHit?.({ miss: true, distance, point: hit.point.clone() });
    } else {
      if (hit.object?.userData.water) this.fx.emit(hit.point, new THREE.Vector3(0, 1, 0), { color: 0xe4ecee, count: 10, speed: 4, size: 0.25 * (1 + distance / 150), life: 0.8, grow: 1.5, gravity: -9 });   // a splash
      else { this.fx.dust(hit.point, hit.normal, distance); this.world.decals?.bullet(hit); }   // (and the hole it leaves)
      this.audio.impact(this.player.pos.distanceTo(hit.point));
      this.onImpactNoise?.(hit.point.clone()); // the crack of a near miss carries
      this.onHit?.({ miss: true, distance, point: hit.point.clone() });
    }
  }

  // A full-power round goes on through a man (the double kill): slower and weaker, it can still
  // wound or kill whoever stands in line behind him. A slow one (a pistol, subsonic, the De Lisle)
  // stops in the first body; none goes through more than two.
  passThrough(bullet, hit, dir) {
    const speed = bullet.vel.length() * (bullet.def.ap ? 0.75 : 0.55);
    if (speed < 230 || (bullet.through ?? 0) >= 2) return;
    const def = { ...bullet.def, damage: Object.fromEntries(Object.entries(bullet.def.damage).map(([k, v]) => [k, v * 0.8])) };
    const pos = hit.point.clone().addScaledVector(dir, 0.05);
    this.bullets.push({
      def, pos, vel: dir.clone().multiplyScalar(speed), origin: bullet.origin, dir: dir.clone(), time: bullet.time,
      path: [pos.clone()], prev: new THREE.Vector3(), ignore: hit.soldier, through: (bullet.through ?? 0) + 1, kills: bullet.kills ?? 0,
    });
  }

  tickBinoculars(dt) {
    this.rangeReadout = null;
    if (!this.binoculars || !this.camera || this.aimT < 0.5) { this.tagT = 0; return; }
    const eye = this.camera.position;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const hit = this.world.raycastRay(eye, dir, 1200);
    if (hit) this.rangeReadout = hit.distance;
    // Tag whatever is under the crosshair, or that the crosshair is over, as long as any part of
    // it is in sight: a soldier whose head alone shows over a wall, the corner of a crate, a
    // truck behind a hedge. Each target is checked at several points (every hit zone of a
    // soldier; the middle and corners of an object and its vehicle).
    const tol = THREE.MathUtils.degToRad(BINOCULARS.zoomFovs[this.binocZoomIndex]) * 0.06;
    const owner = (o) => o?.userData.soldier ?? o?.userData.hotspot ?? this.hotspots?.list.find(h => h.parts?.includes(o));
    const under = owner(hit?.object);
    let s = under && !under.tagged && (under.alive ?? under.active) ? under : null;
    let best = Infinity;
    const to = new THREE.Vector3(), q = new THREE.Vector3();
    const angleTo = (point) => to.subVectors(point, eye).angleTo(dir);
    const inSight = (target, point) => {
      to.subVectors(point, eye);
      const dist = to.length();
      if (dist > 900) return false;
      // In sight: the line reaches the point, or stops on the target itself (some vehicle
      // bodies aren't solid to bullets, so a clear line to a point inside one counts too).
      const los = this.world.raycastSegment(eye, q.copy(point).addScaledVector(to, 0.15 / dist));
      return !los || owner(los.object) === target || los.distance > dist - 0.1;
    };
    // over: how far the crosshair is outside the target (≤ 0: on it); points: where to look for it.
    const consider = (target, over, points) => {
      if (over > tol || over >= best) return;
      if (points.some(pt => inSight(target, pt))) { s = target; best = over; }
    };
    if (!s) {
      const sphere = new THREE.Sphere(), box = new THREE.Box3();
      for (const c of this.world.soldiers) {
        if (!c.alive || c.tagged) continue;
        let over = Infinity;
        const points = c.hitMeshes.map(m => {
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          sphere.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
          over = Math.min(over, angleTo(sphere.center) - Math.atan2(sphere.radius, sphere.center.distanceTo(eye)));
          return sphere.center.clone();
        });
        consider(c, over, points);
      }
      for (const h of this.hotspots?.list ?? []) {
        if (h.tagged || !h.active) continue;
        box.makeEmpty();
        for (const m of [...h.meshes, ...(h.parts ?? [])]) box.union(new THREE.Box3().setFromObject(m));
        box.getBoundingSphere(sphere);
        const over = angleTo(sphere.center) - Math.atan2(sphere.radius * 0.8, sphere.center.distanceTo(eye));
        if (over <= tol && over < best) consider(h, over, sightPoints(h));
      }
    }
    if (s) {
      if (this.tagCandidate !== s) { this.tagCandidate = s; this.tagT = 0; }
      this.tagT += dt;
      if (this.tagT > 0.35) {
        s.tagged = true;
        this.audio.click(0, 900, 0.2);
        this.onTag?.(s);
      }
    } else {
      this.tagCandidate = null;
      this.tagT = 0;
    }
  }

  // ---- per render frame ----
  frame(dt) {
    const p = this.player;
    this.aimT = this.aim;
    const aimTarget = this.aiming ? 1 : 0;
    this.aim += (aimTarget - this.aim) * (1 - Math.exp(-(this.aiming ? 11 * (this.def.aimSpeed ?? 1) : 14) * dt));
    if (Math.abs(this.aim - aimTarget) < 0.002) this.aim = aimTarget;
    this.binocT = (this.binocT ?? 0) + ((this.binoculars ? 1 : 0) - (this.binocT ?? 0)) * (1 - Math.exp(-12 * dt));
    this.aimT = Math.max(this.aim, this.binocT);

    // FOV interpolates in tangent space so zooming feels linear.
    const base = tanFov(this.settings.fov);
    const aimedTan = tanFov(this.def.zoomFovs[this.zoomIndex] ?? this.settings.fov);
    let t = base + (aimedTan - base) * this.aim;
    t = t + (tanFov(BINOCULARS.zoomFovs[this.binocZoomIndex]) - t) * this.binocT;
    const target = fovFromTan(t);
    this.fov += (target - this.fov) * (1 - Math.exp(-20 * dt));

    // The scope is steady, as in Sniper Elite. Sway only appears once the heart races
    // (above ~100 bpm, e.g. after sprinting) and fades as it settles: a slow figure-eight,
    // a pulse on every heartbeat and breathing. Holding breath almost stills it.
    this.swayT += dt;
    const hr = p.heartRate;
    const hrFactor = Math.max(0, hr - 100) / 50;
    let amp = STANCE_SWAY[p.stance] * hrFactor * (p.moving ? 2.2 : 1) * (this.def.swayScale ?? 1);
    if (this.current === 'pistol') amp *= 1.4;
    const holdTarget = this.holding ? 0.1 : this.exhaustedT > 0 ? 2.2 : 1;
    this.swayScale += (holdTarget - this.swayScale) * (1 - Math.exp(-(this.holding ? 5 : 3) * dt));
    amp *= this.swayScale;
    // Sway only shows when aimed; the shoulder camera stays steady. Binoculars are steadier than a rifle.
    const aimedAmount = Math.max(this.current === 'rifle' ? this.aim : this.aim * 0.5, this.binocT * 0.15);
    const s = this.swayT;
    let yaw = (Math.sin(s * 0.83) + 0.35 * Math.sin(s * 2.1 + 1.7)) * amp;
    let pitch = (Math.sin(s * 1.66 + 0.6) * 0.6 + 0.25 * Math.sin(s * 3.3)) * amp;
    if (!this.holding) pitch += Math.sin(s * Math.PI * 2 / 4.2) * amp * 0.45; // breathing
    this.heartPhase += dt * hr / 60;
    if (this.heartPhase >= 1) { this.heartPhase -= 1; this.heartPulse = 1; }
    this.heartPulse *= Math.exp(-14 * dt);
    pitch += this.heartPulse * amp * 0.35;
    this.sway.yaw = yaw * aimedAmount;
    this.sway.pitch = pitch * aimedAmount;

    // Working the bolt nudges the scope down and sideways, then it settles.
    if (this.boltT >= 0 && this.current === 'rifle') {
      const b = Math.sin(this.boltT * Math.PI);
      this.sway.pitch -= b * 0.014 * this.aim;
      this.sway.yaw += b * 0.008 * this.aim;
    }

    // Recoil: damped springs kick the view up and roll it, plus a short shake.
    const k = 140, c = 2 * Math.sqrt(k) * 0.75;
    this.recoilVel += (-k * this.recoil - c * this.recoilVel) * dt;
    this.recoil += this.recoilVel * dt;
    const kr = 90, cr = 2 * Math.sqrt(kr) * 0.6;
    this.rollVel += (-kr * this.roll - cr * this.rollVel) * dt;
    this.roll += this.rollVel * dt;
    this.shake *= Math.exp(-10 * dt);
    if (this.shake > 0.01) {
      const sh = this.shake * (this.scoped ? 0.004 : 0.008);
      this.sway.yaw += (Math.random() - 0.5) * sh;
      this.sway.pitch += (Math.random() - 0.5) * sh;
    }
    this.viewKick *= Math.exp(-9 * dt);

    this.updatePrediction();
    this.updatePistolAim();
  }

  // With the pistol out, where the shot would really go (from the muzzle, with drop): the dot
  // turns red when that lands on a guard where it kills (the head, or anywhere he can't take).
  updatePistolAim() {
    if (this.current !== 'pistol' || this.binoculars || !this.camera || this.busy) { this.lethal = false; return; }
    if ((this.pistolFrame = (this.pistolFrame ?? 0) + 1) % 3 && this.lethal !== undefined) return;
    const def = this.shotDef(), cam = this.camera, fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const origin = this.avatar.muzzle(this.current);
    const ahead = Math.max(0, origin.clone().sub(cam.position).dot(fwd));
    const from = cam.position.clone().addScaledVector(fwd, ahead);
    const aim = this.world.raycastRay(from, fwd, 300);
    this.lethal = false;
    if (!aim?.soldier?.alive) return;            // nothing to shoot at under the crosshair
    const pos = origin.clone(), vel = aim.point.clone().sub(origin).normalize().multiplyScalar(def.muzzleVelocity);
    const prev = new THREE.Vector3(), h = 1 / 120;
    for (let t = 0; t < 1.2; t += h) {
      prev.copy(pos);
      integrate(pos, vel, def.drag, this.ballisticWind, h);
      const hit = this.world.raycastSegment(prev, pos);
      if (!hit) continue;
      this.lethal = !!hit.soldier?.alive && (def.damage[hit.zone] ?? 0) >= hit.soldier.hp;
      return;
    }
  }

  // The "empty lung" marker: where the shot would land right now, wind and drop included.
  // Shown whenever scoped, only while holding breath, or never (a setting).
  updatePrediction() {
    const mode = this.settings.lungMarker;
    const show = this.scoped && this.camera && (mode === 'always' || (mode === 'breath' && this.holding));
    if (!show) { this.prediction = null; return; }
    if ((this.predictFrame++ & 1) && this.prediction) return;
    const w = this.weapon, def = this.shotDef(), q = this.camera.quaternion, eye = this.camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const a = w.zeroAngles[w.zeroIndex];
    const vel = fwd.multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a)).multiplyScalar(def.muzzleVelocity);
    const pos = eye.clone().addScaledVector(up, -SIGHT_HEIGHT);
    const path = [pos.clone()], prev = new THREE.Vector3();
    // The bullet's own step (a coarser one drifts a few cm by 300 m: enough to clear a parapet
    // the real round clips), tested for hits every 12 steps (1/30 s, where the curve strays
    // about a millimetre from a straight line) to keep it cheap.
    const h = FIXED_STEP / BULLET_SUBSTEPS;
    let impact = null;
    for (let t = 0; t < 3.5 && !impact; t += 12 * h) {   // 3.5 s: the De Lisle's slow round past 500 m
      prev.copy(pos);
      for (let i = 0; i < 12; i++) integrate(pos, vel, def.drag, this.ballisticWind, h);
      const hit = this.world.raycastSegment(prev, pos);
      if (hit) impact = hit.point.clone();
      path.push(hit ? impact : pos.clone());
    }
    // A slow round falls steeply: a shot that clears a head lands well behind it, at a point that
    // can look as if it sits right on the head. So when something nearer shows under the marker,
    // put the marker where the bullet passes at that distance instead: on the head means it hits.
    let shown = impact;
    for (let i = 0; i < 3 && shown; i++) {
      const range = eye.distanceTo(shown);
      const seen = this.world.raycastSegment(eye, shown);
      if (!seen || seen.distance > range - 0.5) break;
      shown = crossingAt(path, eye, seen.distance);
    }
    this.prediction = shown;
  }

  hudState() {
    const w = this.weapon;
    return {
      weapon: this.mount ? 'heavy' : this.current, name: this.def.name + (w.loaded ? ` · ${AMMO[w.pendingAmmo ?? w.loaded].name}` : ''), mag: w.mag, reserve: w.reserve,
      zero: this.def.zeros.length > 1 ? this.zero : null,
      zoomName: this.def.zoomNames[this.zoomIndex], zoomFov: this.def.zoomFovs[this.zoomIndex],
      binocFov: BINOCULARS.zoomFovs[this.binocZoomIndex], binocZoomName: BINOCULARS.zoomNames[this.binocZoomIndex],
      aim: this.aim, binoc: this.binocT ?? 0, scoped: this.scoped, breath: this.breath,
      holding: this.holding, exhausted: this.exhaustedT > 0, reloading: this.reloadT > 0, ready: this.readyT,
      range: this.rangeReadout, tagProgress: this.tagCandidate ? Math.min(1, this.tagT / 0.35) : 0,
      lethal: !!this.lethal,
    };
  }
}

// Points to look for a weak spot at: the middle and the corners (pulled in a little) of its own
// meshes and, for an engine, of the vehicle around it.
function sightPoints(h) {
  const out = [];
  for (const m of [...h.meshes, ...(h.parts ?? [])]) {
    const box = new THREE.Box3().setFromObject(m), c = box.getCenter(new THREE.Vector3());
    out.push(c);
    for (let i = 0; i < 8; i++) {
      const corner = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      out.push(corner.lerp(c, 0.25));
    }
  }
  return out;
}

// Where a flight path (a list of points) is `dist` from the eye, interpolated; null if it never gets there.
function crossingAt(path, eye, dist) {
  for (let i = 1; i < path.length; i++) {
    const d0 = eye.distanceTo(path[i - 1]), d1 = eye.distanceTo(path[i]);
    if (d0 < dist && d1 >= dist) return path[i - 1].clone().lerp(path[i], (dist - d0) / (d1 - d0));
  }
  return null;
}
