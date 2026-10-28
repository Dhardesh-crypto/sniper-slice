// Guard dogs: a German shepherd at a patrolling guard's heel (one or two teams a run, drawn from
// the run's seed). It walks and runs with him, and it smells you: within about 12 m, further when
// the wind carries your scent to it, less in the rain. Then it puts its nose down and tracks you,
// barking, and the barking brings the guards (its handler first, then anyone in earshot); if it
// reaches you it bites. Kill its handler and it stays by the body barking; shoot it and it yelps
// and goes down. The dog is an animals.js model, skinned and walked like the farm animals; this
// moves it and decides what it does.
import * as THREE from 'three';
import { makeAnimal, poseAnimal } from '../world/animals.js';
import { activeMap } from '../world/terrain.js';
import { seeded } from '../core/run.js';

const SMELL = 12;              // m, still air, dry
const BARK_HEARD = 45;         // m a bark carries to the guards
const BITE = 1.3, BITE_DAMAGE = 11;
const HEEL = new THREE.Vector3(-0.9, 0, -0.9);   // where it walks: at his left, half a pace behind
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });

export class Dogs {
  constructor({ scene, world, player, stealth, audio, fx, hud, seed }) {
    Object.assign(this, { scene, world, player, stealth, audio, fx, hud });
    this.dogs = [];
    const rnd = seeded(seed ^ 0xd065);
    const n = rnd() < 0.35 ? 2 : 1;
    const handlers = world.soldiers.filter(s => s.alive && !s.officer && !s.range && s.brain && !s.brain.fixed && s.brain.route);
    for (let i = 0; i < n && handlers.length; i++) {
      const h = handlers.splice(Math.floor(rnd() * handlers.length), 1)[0];
      const at = h.root.position;
      const a = makeAnimal(scene, 'dog', at.x - 1, at.z - 1);
      if (!a) break;
      a.state = 'walk';
      // Something to shoot: an unseen block over its body, moving with it.
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 1.0), HIDDEN);
      hit.position.y = 0.45;
      a.root.add(hit);
      const dog = { a, handler: h, mode: 'heel', barkT: 0, biteT: 0, smellT: Math.random() * 0.3, lostT: 0, hit, fall: 0 };
      hit.userData.onShot = () => this.kill(dog);
      world.raycastTargets.push(hit);
      h.dog = dog;
      this.dogs.push(dog);
    }
  }

  kill(dog) {
    if (dog.mode === 'dead') return;
    dog.mode = 'dead';
    this.audio.yelp(dog.a.root.position.distanceTo(this.player.pos));
    const i = this.world.raycastTargets.indexOf(dog.hit);
    if (i >= 0) this.world.raycastTargets.splice(i, 1);
  }

  // How far it smells you: further downwind of you, less in the rain.
  smellRange(dog) {
    const p = this.player.pos, d = dog.a.root.position, wind = this.world.wind ?? new THREE.Vector3();
    const to = new THREE.Vector3(d.x - p.x, 0, d.z - p.z).normalize(), w = wind.length();
    const downwind = w > 0.1 ? to.dot(wind.clone().setY(0).divideScalar(w)) : 0;
    return SMELL * (1 + 0.6 * downwind * Math.min(1, w / 4)) * (activeMap().weather?.rain ? 0.6 : 1);
  }

  tick(dt) {
    const p = this.player;
    for (const dog of this.dogs) {
      const { a, handler: h } = dog, pos = a.root.position;
      if (dog.mode === 'dead') { this.lie(dog, dt); continue; }
      const toYou = pos.distanceTo(p.pos);
      // Smell, a few times a second.
      if ((dog.smellT -= dt) <= 0) {
        dog.smellT = 0.25;
        const smells = !p.dead && toYou < this.smellRange(dog) && Math.abs(p.pos.y - pos.y) < 4;
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
        goal = p.pos;
        want = toYou > 5 ? 6.5 : toYou > BITE ? 2.5 : 0;
        a.state = toYou > 5 && toYou < 9 ? 'graze' : 'walk';     // nose down on the scent as it closes
        if ((dog.barkT -= dt) <= 0) { dog.barkT = 0.8 + Math.random() * 0.6; this.bark(dog, BARK_HEARD); }
        // Its handler goes where it's pulling; if it can see you, so does everyone near.
        if (h.alive && h.aware.state === 'calm') this.stealth.raise(h, 'suspicious', p.pos.clone(), 'heard');
        if (toYou < BITE + 0.2 && !p.dead && (dog.biteT -= dt) <= 0) {
          dog.biteT = 0.9;
          p.damage(BITE_DAMAGE, pos);
          this.fx.blood(p.pos.clone().setY(p.pos.y + 0.6), new THREE.Vector3(0, 1, 0));
        }
      }
      if (dog.mode !== 'track') a.state = 'walk';
      this.move(dog, goal, want, face, dt);
      poseAnimal(a, dt);
    }
  }

  bark(dog, radius) {
    const at = dog.a.root.position;
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

  // Shot: it rolls onto its side and lies still.
  lie(dog, dt) {
    if (dog.fall >= 1) return;
    dog.fall = Math.min(1, dog.fall + dt / 0.4);
    const a = dog.a, k = dog.fall;
    a.v = 0;
    a.body.rotation.z = (k * k) * Math.PI / 2 * 0.92;
    a.body.position.y = 0.2 * k * (1 - k);
  }
}
