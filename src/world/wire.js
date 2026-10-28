// Barbed wire you can cut. Every coil of concertina wire (the `wire` prop) blocks the way; walk up
// to it and hold E to cut a gap where you stand: with wire cutters (found lying about: pickups.js) a
// moment's quiet work; without them, slow and noisy, twisting and kicking it apart. The coil falls
// back to two short ends with room to slip between. Kept in saves.
import * as THREE from 'three';

const CUT_TIME = 1.2, BY_HAND = 6;   // s: with wire cutters; without
const GAP = 1.6;                 // m of coil cut away

export class Wire {
  constructor({ scene, world, interactions, stealth, audio, hud, pickups }) {
    Object.assign(this, { scene, world, interactions, stealth, audio, hud, pickups });
    this.coils = [];
    scene.traverse(o => { if (o.userData.propKey === 'wire' && o.userData.block) this.coils.push(o); });
    for (const [i, coil] of this.coils.entries()) {
      const box = coil.userData.block, along = box.max.x - box.min.x >= box.max.z - box.min.z ? 'x' : 'z';
      const c = { i, coil, box, along, lever: null, cut: false };
      c.lever = { at: box.getCenter(new THREE.Vector3()), label: 'CUT THE WIRE', busy: 'CUTTING…', time: CUT_TIME, onUse: () => this.cut(c, c.lever.at.clone()) };
      c.lever.at.y = box.min.y;
      interactions.addLever(c.lever);
      c.lever = interactions.levers.at(-1);              // (it keeps its own copy: that's the one to change)
      this.coils[i] = c;
    }
  }

  // Each tick the cutting spot slides along the coil to where you stand, so you cut it there.
  tick(player) {
    const cutters = !!this.pickups?.tools.has('cutters');
    for (const c of this.coils) {
      if (c.cut) continue;
      c.lever.time = cutters ? CUT_TIME : BY_HAND;
      c.lever.label = cutters ? 'CUT THE WIRE' : 'CUT THE WIRE BY HAND (SLOW, NOISY)';
      const k = c.along, b = c.box, p = player.pos;
      c.lever.at[k] = THREE.MathUtils.clamp(p[k], b.min[k] + GAP / 2, b.max[k] - GAP / 2);
      const o = k === 'x' ? 'z' : 'x';
      c.lever.at[o] = THREE.MathUtils.clamp(p[o], b.min[o], b.max[o]);
    }
  }

  // Cut a gap at `at`: the coil gives way to two short ends.
  cut(c, at, quiet = false) {
    if (c.cut) return;
    c.cut = true;
    c.at = at.clone();
    c.lever.used = true;
    c.lever.at.set(0, -1e4, 0);                            // (out of reach for good)
    const k = c.along, b = c.box, boxes = this.world.boxes;
    const i = boxes.indexOf(b);
    if (i >= 0) boxes.splice(i, 1);
    // The two ends: boxes for what's left either side, and the coil drawn as two pieces.
    const lo = b.clone(), hi = b.clone();
    lo.max[k] = at[k] - GAP / 2; hi.min[k] = at[k] + GAP / 2;
    for (const e of [lo, hi]) if (e.max[k] - e.min[k] > 0.3) boxes.push(e);
    const len = b.max[k] - b.min[k], full = c.coil;
    full.visible = false;
    for (const e of [lo, hi]) {
      const part = e.max[k] - e.min[k];
      if (part < 0.3) continue;
      const piece = full.clone();
      piece.visible = true;
      const mid = (e.min[k] + e.max[k]) / 2;
      piece.position[k] = mid;
      // Squashed along its length to what's left (the model runs along its own x).
      const sx = part / len;
      piece.scale.copy(full.scale);
      if (Math.abs(Math.sin(full.rotation.y)) > 0.7 === (k === 'z')) piece.scale.x *= sx; else piece.scale.z *= sx;
      full.parent.add(piece);
    }
    if (quiet) return;
    this.stealth.noise(at.clone(), this.pickups?.tools.has('cutters') ? 4 : 14, 'cut');
    this.audio.click?.(0, 2400, 0.25);
    this.hud?.message('WIRE CUT', '');
  }

  // For saves: where each cut coil was cut.
  snapshot() { return this.coils.filter(c => c.cut).map(c => ({ i: c.i, at: c.at.toArray() })); }
  restore(list) { for (const s of list ?? []) { const c = this.coils[s.i]; if (c) this.cut(c, new THREE.Vector3().fromArray(s.at), true); } }
}
