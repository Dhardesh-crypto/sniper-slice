// Dragging bodies: F next to a dead soldier picks him up by the collar; he slides along
// behind you while you walk (slowly, no shooting). F again drops him. A body left in tall
// grass is hidden: patrols won't find it.
import * as THREE from 'three';
import { inTallGrass } from '../world/vegetation.js';

const REACH = 1.9;

export class Carry {
  constructor({ world, player, input, audio, hud }) {
    Object.assign(this, { world, player, input, audio, hud });
    this.body = null;
    this.v = new THREE.Vector3();
    this.dragT = 0;
  }

  nearestBody() {
    const p = this.player.pos;
    let best = null, bestD = REACH;
    for (const s of this.world.soldiers) {
      if (s.alive || s.range || s === this.body) continue;
      s.bodyPosition(this.v);
      const d = Math.hypot(this.v.x - p.x, this.v.z - p.z);
      if (d < bestD && Math.abs(this.v.y - p.y) < 2.5) { best = s; bestD = d; }
    }
    return best;
  }

  tick(dt) {
    const p = this.player;
    if (this.input.wasPressed('KeyF') && !p.climb) {
      if (this.body) this.drop();
      else {
        const b = this.nearestBody();
        if (b) {
          this.body = b;
          b.dragged = true;
          b.hidden = false;
          p.carrying = b;
          if (p.stance === 'prone') p.setStance('crouch');
          this.audio.rustle();
        }
      }
    }
    if (!this.body) return;
    // The body's hips follow a point behind you; the rest of him comes along.
    const back = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)); // yaw 0 faces -z, so +z is behind
    const target = p.pos.clone().addScaledVector(back, 1.15);
    const hips = this.body.bodyPosition(this.v);
    const root = this.body.root.position;
    root.x += target.x - hips.x;
    root.z += target.z - hips.z;
    root.y = this.world.floorAt(root.x, root.z, p.pos.y + 0.1); // stays on the platform or stair you're on
    this.body.fallFrom = root.clone();          // keeps the death shove from fighting the drag
    this.body.root.rotation.y = p.yaw + Math.PI; // head toward you
    this.body.root.updateMatrixWorld(true);
    if (p.moving) {
      this.dragT -= dt;
      if (this.dragT <= 0) { this.dragT = 0.45; this.audio.rustle(); }
    }
  }

  drop() {
    const b = this.body;
    const hips = b.bodyPosition(this.v);
    b.dragged = false;
    b.hidden = inTallGrass(this.world.grassPatches, hips.x, hips.z);
    this.hud.message(b.hidden ? 'BODY HIDDEN IN THE GRASS' : 'BODY DROPPED IN THE OPEN', b.hidden ? '' : 'wound');
    this.player.carrying = null;
    this.body = null;
  }

  state() {
    if (this.body) return { label: 'F · DROP BODY', progress: 0 };
    return this.nearestBody() ? { label: 'F · DRAG BODY', progress: 0 } : null;
  }
}
