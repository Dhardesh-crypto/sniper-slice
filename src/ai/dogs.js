// Guard dogs: a German shepherd at a patrolling guard's heel (one or two teams a run, drawn from
// the run's seed). It walks and runs with him, and it smells you: within about 12 m, further when
// the wind carries your scent to it, less in the rain. Then it puts its nose down and tracks you,
// barking, and the barking brings the guards (its handler first, then anyone in earshot); if it
// reaches you it bites. A wall stops its teeth, not its nose: with one between you it runs the way a
// guard would walk round, and bites only with nothing in the way. Kill its handler and it stays by the body barking; shoot it and it yelps
// and goes down. The dog itself, its clips and how they play, is world/dog.js; this moves it and
// decides what it does.
import * as THREE from 'three';
import { makeDog, poseDog, dogBark, dogBite, dogDie } from '../world/dog.js';
import { activeMap } from '../world/terrain.js';
import { seeded } from '../core/run.js';

const SMELL = 12;              // m, still air, dry
const BARK_HEARD = 45;         // m a bark carries to the guards
const BITE = 1.3, BITE_DAMAGE = 11;
const HEEL = new THREE.Vector3(-0.9, 0, -0.9);   // where it walks: at his left, half a pace behind
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const MOUTH = 0.5;             // m off the ground: what a bite has to get past
const REROUTE = 0.5;           // s between looks for the way round
const ray = new THREE.Ray(), meets = new THREE.Vector3(), from = new THREE.Vector3(), to = new THREE.Vector3();

export class Dogs {
  constructor({ scene, world, player, stealth, audio, fx, hud, nav, seed }) {
    Object.assign(this, { scene, world, player, stealth, audio, fx, hud, nav });
    this.dogs = [];
    const rnd = seeded(seed ^ 0xd065);
    const n = rnd() < 0.35 ? 2 : 1;
    this.handlers = world.soldiers.filter(s => s.alive && !s.officer && !s.range && s.brain && !s.brain.fixed && s.brain.route);
    this.rnd = rnd;
    this.more(n);
  }

  // Dogs for `n` more of the men on patrol.
  more(n) {
    const { rnd, handlers } = this;
    for (let i = 0; i < n && handlers.length; i++) {
      if (!this.add(handlers.splice(Math.floor(rnd() * handlers.length), 1)[0])) break;
    }
  }

  // A dog at `h`'s heel (or null when the dog model hasn't loaded).
  add(h) {
    const { world, scene } = this;
    {
      const at = h.root.position;
      const a = makeDog(scene, at.x - 1, at.z - 1);
      if (!a) return null;
      // Something to shoot: an unseen block over its body, moving with it.
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 1.0), HIDDEN);
      hit.position.y = 0.45;
      a.root.add(hit);
      const dog = { a, handler: h, mode: 'heel', barkT: 0, biteT: 0, routeT: 0, smellT: Math.random() * 0.3, lostT: 0, hit, fall: 0 };
      hit.userData.onShot = () => this.kill(dog);
      world.raycastTargets.push(hit);
      h.dog = dog;
      this.dogs.push(dog);
      return dog;
    }
  }

  // quiet: no yelp (a loaded save: it was dead already).
  kill(dog, quiet = false) {
    if (dog.mode === 'dead') return;
    dog.mode = 'dead';
    dogDie(dog.a);
    if (!quiet) this.audio.yelp(dog.a.root.position.distanceTo(this.player.pos));
    const i = this.world.raycastTargets.indexOf(dog.hit);
    if (i >= 0) this.world.raycastTargets.splice(i, 1);
  }

  // For a save (core/saves.js): each dog by its handler, where it is, and whether it's been shot.
  snapshot() {
    return this.dogs.map(d => ({ handler: this.world.soldiers.indexOf(d.handler), dead: d.mode === 'dead', pos: d.a.root.position.toArray(), yaw: d.a.root.rotation.y }));
  }

  // From a save: a dog that was shot lies where it fell, already still. (Matched by handler, so a
  // run that has a dog more or less than the save, from what the garrison has learnt since, still
  // puts each saved dog back.)
  restore(list = []) {
    for (const e of list) {
      const h = this.world.soldiers[e.handler];
      if (!h) continue;
      let dog = this.dogs.find(d => d.handler === h);
      if (!dog) {
        const i = this.handlers.indexOf(h);
        if (i >= 0) this.handlers.splice(i, 1);
        dog = this.add(h);
      }
      if (!dog) continue;
      dog.a.root.position.fromArray(e.pos);
      dog.a.root.rotation.y = e.yaw;
      if (e.dead) {
        this.kill(dog, true);
        dog.a.v = 0;
        poseDog(dog.a, 10);          // (the fall played through: it lies there)
      } else if (!h.alive) dog.mode = 'mourn';
    }
  }

  // How far it smells you: further downwind of you, less in the rain.
  smellRange(dog) {
    const p = this.player.pos, d = dog.a.root.position, wind = this.world.wind ?? new THREE.Vector3();
    const to = new THREE.Vector3(d.x - p.x, 0, d.z - p.z).normalize(), w = wind.length();
    const downwind = w > 0.1 ? to.dot(wind.clone().setY(0).divideScalar(w)) : 0;
    return SMELL * (1 + 0.6 * downwind * Math.min(1, w / 4)) * (activeMap().weather?.rain ? 0.6 : 1);
  }

  // Is there a wall (anything that would stop it walking) between its mouth and you?
  walled(pos) {
    const p = this.player.pos;
    from.set(pos.x, pos.y + MOUTH, pos.z);
    to.set(p.x, p.y + MOUTH, p.z);
    const len = from.distanceTo(to);
    if (len < 1e-3) return false;
    ray.set(from, to.sub(from).divideScalar(len));
    return this.world.boxes.some(b => ray.intersectBox(b, meets) && meets.distanceTo(from) < len);
  }

  // Where it runs to reach you: straight at you in the open, else the next corner of the way round.
  chase(dog, dt) {
    const pos = dog.a.root.position, p = this.player.pos;
    if ((dog.routeT -= dt) <= 0) {
      dog.routeT = REROUTE;
      dog.route = this.walled(pos) ? this.nav.path(pos, p) : null;
      dog.routeI = 0;
    }
    const r = dog.route;
    if (!r) return p;
    while (dog.routeI < r.length - 1 && Math.hypot(r[dog.routeI].x - pos.x, r[dog.routeI].z - pos.z) < 0.8) dog.routeI++;
    return r[dog.routeI];
  }

  tick(dt) {
    const p = this.player;
    for (const dog of this.dogs) {
      const { a, handler: h } = dog, pos = a.root.position;
      if (dog.mode === 'dead') { dog.a.v = 0; poseDog(dog.a, dt); continue; }
      const toYou = pos.distanceTo(p.pos);
      // Smell, a few times a second.
      if ((dog.smellT -= dt) <= 0) {
        dog.smellT = 0.25;
        const smells = !p.dead && !p.underground && toYou < this.smellRange(dog) && Math.abs(p.pos.y - pos.y) < 4;
        if (smells && dog.mode !== 'track') { dog.mode = 'track'; dog.lostT = 0; }
        if (dog.mode === 'track') dog.lostT = smells || toYou < SMELL * 1.8 ? 0 : dog.lostT + 0.25;
      }
      if (dog.mode === 'track' && (dog.lostT > 6 || p.dead)) dog.mode = h.alive ? 'heel' : 'mourn';
      if (dog.mode === 'heel' && !h.alive) dog.mode = 'mourn';

      let goal = null, want = 0, face = null;
      if (dog.mode === 'heel') {
        goal = HEEL.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), h.root.rotation.y).add(h.root.position);
        want = h.speed > 2.5 ? 6 : h.speed > 0.3 ? 1.5 : 1.2;
        face = h.root.rotation.y;
      } else if (dog.mode === 'mourn') {
        goal = h.bodyPosition(new THREE.Vector3()).add(new THREE.Vector3(0.8, 0, 0.6));
        want = 3;
        if ((dog.barkT -= dt) <= 0) { dog.barkT = 2.2 + Math.random(); this.bark(dog, BARK_HEARD * 0.8); }
      } else if (dog.mode === 'track') {
        goal = this.chase(dog, dt);
        const casting = toYou > 5 && toYou < 9;                  // nose down on the scent as it closes
        want = dog.route ? 5 : casting ? 3.6 : toYou > 5 ? 6.5 : toYou > BITE ? 2.5 : 0;
        a.nose = casting;
        if ((dog.barkT -= dt) <= 0) { dog.barkT = 0.8 + Math.random() * 0.6; this.bark(dog, BARK_HEARD); }
        // Its handler goes where it's pulling; if it can see you, so does everyone near.
        if (h.alive && h.aware.state === 'calm') this.stealth.raise(h, 'suspicious', p.pos.clone(), 'heard');
        if (toYou < BITE + 0.2 && !p.dead && (dog.biteT -= dt) <= 0 && !this.walled(pos)) {
          dog.biteT = 0.9;
          dogBite(a);
          p.damage(BITE_DAMAGE, pos);
          this.fx.blood(p.pos.clone().setY(p.pos.y + 0.6), new THREE.Vector3(0, 1, 0));
        }
      }
      if (dog.mode !== 'track') a.nose = false;
      a.watch = dog.mode === 'track' && toYou < 12 ? p.pos : null;    // (it keeps its eyes on you)
      this.move(dog, goal, want, face, dt);
      poseDog(a, dt);
    }
  }

  bark(dog, radius) {
    const at = dog.a.root.position;
    dogBark(dog.a);
    this.audio.bark(at.distanceTo(this.player.pos));
    this.stealth.noise(at.clone(), radius, 'bark');
  }

  move(dog, goal, want, face, dt) {
    const a = dog.a, pos = a.root.position;
    let speed = 0;
    if (goal) {
      const dx = goal.x - pos.x, dz = goal.z - pos.z, dist = Math.hypot(dx, dz);
      if (dist > 0.35) {
        speed = Math.min(want, dist * 2.5);
        this.turn(a, Math.atan2(dx, dz), dist > 2 ? 6 : 3, dt);
      } else if (face !== null) this.turn(a, face, 2, dt);
    }
    a.v += (speed - a.v) * Math.min(1, dt * (speed > a.v ? 3 : 5));
    const ox = pos.x, oz = pos.z;
    pos.x += Math.sin(a.root.rotation.y) * a.v * dt;
    pos.z += Math.cos(a.root.rotation.y) * a.v * dt;
    this.world.collideCircle(pos, 0.3, pos.y, pos.y + 0.7);
    // A dog won't jump off anything higher than a man would; if the ground goes from under it, it
    // falls, and from five metres or more it doesn't get up.
    let floor = this.world.floorAt(pos.x, pos.z, pos.y);
    if (!dog.fallV && floor < pos.y - 2) { pos.x = ox; pos.z = oz; a.v = 0; floor = this.world.floorAt(pos.x, pos.z, pos.y); }
    if (dog.fallV || floor < pos.y - 0.6) {
      if (!dog.fallV) { dog.fallV = 1e-3; dog.fallTop = pos.y; }
      dog.fallV += 9.8 * dt;
      pos.y = Math.max(floor, pos.y - dog.fallV * dt);
      if (pos.y > floor) return;
      const h = dog.fallTop - floor;
      dog.fallV = 0;
      if (h >= 5) this.kill(dog);
    } else pos.y = floor;
  }

  turn(a, want, rate, dt) {
    const d = Math.atan2(Math.sin(want - a.root.rotation.y), Math.cos(want - a.root.rotation.y));
    a.root.rotation.y += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }
}
