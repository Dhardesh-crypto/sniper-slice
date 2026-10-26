// Animals about the farms and hills: cows and a horse in the vineyard, goats on the coast, deer in
// the forest. Each wanders slowly round its patch, stops to graze (head down, a slow sway), and
// bolts away at a run from a loud noise nearby (a shot, a blast) or from you walking up close.
import * as THREE from 'three';
import { propModel } from './props.js';
import { heightAt } from './terrain.js';

const SPECS = {
  cow: { size: { x: 2.4 }, walk: 0.9, run: 4.5, shy: 6 },
  horse: { size: { x: 2.4 }, walk: 1.1, run: 9, shy: 10 },
  goat: { size: { x: 1.3 }, walk: 0.8, run: 6, shy: 14 },
  deer: { size: { x: 2.0 }, walk: 1.0, run: 11, shy: 45 },
};

const herd = [];

// A few of one kind round (x, z) within `radius` m.
export function addAnimals(scene, kind, x, z, radius, count = 1) {
  const spec = SPECS[kind];
  for (let i = 0; i < count; i++) {
    const model = propModel(kind, spec.size, { own: true });
    if (!model) return;
    const body = new THREE.Group();            // grazes (tilts) inside the root, which walks
    body.add(model);
    model.rotation.y = Math.PI / 2;           // (props lie nose toward −x; the root walks toward +z)
    const root = new THREE.Group();
    root.add(body);
    const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
    root.position.set(x + Math.cos(a) * r, 0, z + Math.sin(a) * r);
    root.rotation.y = Math.random() * Math.PI * 2;
    scene.add(root);
    herd.push({ kind, spec, root, body, home: new THREE.Vector3(x, 0, z), radius, goal: null, state: 'graze', t: 2 + Math.random() * 8, phase: Math.random() * 10 });
  }
}

// Something loud at `at` (heard up to `radius` m): animals within it bolt away.
export function startle(at, radius) {
  for (const a of herd) {
    if (a.root.position.distanceTo(at) > radius) continue;
    const away = a.root.position.clone().sub(at).setY(0).normalize();
    a.goal = a.root.position.clone().addScaledVector(away, 25 + Math.random() * 20);
    a.state = 'flee';
    a.t = 6;
  }
}

const _d = new THREE.Vector3();
export function tickAnimals(dt, player) {
  for (const a of herd) {
    const p = a.root.position;
    a.phase += dt;
    if (a.state !== 'flee' && player && p.distanceTo(player.pos) < a.spec.shy) startle(player.pos, a.spec.shy + 1);
    if (a.state === 'graze' && (a.t -= dt) <= 0) {
      // A few steps to somewhere else in the patch.
      const ang = Math.random() * Math.PI * 2, r = Math.random() * a.radius;
      a.goal = new THREE.Vector3(a.home.x + Math.cos(ang) * r, 0, a.home.z + Math.sin(ang) * r);
      a.state = 'walk';
    }
    let speed = 0;
    if (a.state === 'walk' || a.state === 'flee') {
      _d.copy(a.goal).sub(p).setY(0);
      const dist = _d.length();
      speed = a.state === 'flee' ? a.spec.run : a.spec.walk;
      if (dist < 0.5 || (a.state === 'flee' && (a.t -= dt) <= 0)) {
        if (a.state === 'flee') { a.home.copy(p).setY(0); }   // it settles where it ran to
        a.state = 'graze'; a.t = 4 + Math.random() * 10; speed = 0;
      } else {
        const want = Math.atan2(_d.x, _d.z);
        let turn = Math.atan2(Math.sin(want - a.root.rotation.y), Math.cos(want - a.root.rotation.y));
        a.root.rotation.y += Math.sign(turn) * Math.min(Math.abs(turn), (a.state === 'flee' ? 3 : 1.2) * dt);
        p.x += Math.sin(a.root.rotation.y) * speed * dt;
        p.z += Math.cos(a.root.rotation.y) * speed * dt;
      }
    }
    p.y = heightAt(p.x, p.z);
    // Walking: a gentle bob and roll; running: a lope; grazing: head down, swaying slowly.
    const graze = a.state === 'graze' ? 1 : 0;
    a.body.rotation.x += ((graze ? 0.12 + 0.03 * Math.sin(a.phase * 0.7) : 0) - a.body.rotation.x) * Math.min(1, dt * 2);
    const gait = speed * (a.state === 'flee' ? 1.6 : 4);
    a.body.position.y = speed > 0 ? Math.abs(Math.sin(a.phase * gait)) * (a.state === 'flee' ? 0.12 : 0.04) : 0;
    a.body.rotation.z = speed > 0 ? Math.sin(a.phase * gait) * 0.03 : 0;
  }
}
