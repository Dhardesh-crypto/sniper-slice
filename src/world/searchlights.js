// Searchlights, at dusk (the run's conditions: conditions.js sets map.dusk). Each searchlight
// prop, or a watchtower's platform on a map that has none, carries a lamp whose beam sweeps a slow
// arc out over the approaches: a real spotlight and a faint cone of light in the haze. Stand in a
// beam for more than a moment and it has you: the nearest guards are alerted to where you are, and
// the light stays on you for a while, following. A lamp is a weak spot: one shot puts it out.
import * as THREE from 'three';
import { activeMap, COMPOUND } from './terrain.js';

const MAX = 4;                       // spotlights cost every lit pixel something: no more than this
const REACH = 170, ANGLE = 0.1;      // m the beam carries; its half-angle (rad)
const CAUGHT = 0.6;                  // s in the beam before it has you
const FOLLOW = 8;                    // s it stays on you after

export class Searchlights {
  constructor({ scene, world, player, stealth, hotspots, audio, hud }) {
    Object.assign(this, { scene, world, player, stealth, hotspots, audio, hud });
    this.lights = [];
    if (!activeMap().dusk) return;
    const heads = [];
    scene.traverse(o => {
      if (o.userData?.propKey !== 'searchlight') return;
      const bb = new THREE.Box3().setFromObject(o);
      heads.push(new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y - 0.35, (bb.min.z + bb.max.z) / 2));
    });
    if (!heads.length) for (const t of world.towerTops ?? []) heads.push(t.clone().add(new THREE.Vector3(0, 1.5, 0)));
    const c = new THREE.Vector3(COMPOUND.x, 0, COMPOUND.z);
    heads.sort((a, b) => a.distanceTo(c) - b.distanceTo(c));
    for (const head of heads.slice(0, MAX)) this.add(head, Math.atan2(head.x - c.x, head.z - c.z));
  }

  add(head, outward) {
    const spot = new THREE.SpotLight(0xfff0d6, 900, REACH * 1.2, ANGLE * 1.25, 0.45, 1.1);
    spot.position.copy(head);
    spot.castShadow = false;
    this.scene.add(spot, spot.target);
    // The beam in the dusk haze: an open cone, apex at the lamp, brightest near it.
    const geo = new THREE.ConeGeometry(Math.tan(ANGLE) * REACH, REACH, 24, 1, true);
    geo.translate(0, -REACH / 2, 0);
    const pos = geo.attributes.position, alpha = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) alpha[i] = 1 - Math.min(1, -pos.getY(i) / REACH);
    geo.setAttribute('fade', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0xfff0d0) }, strength: { value: 0.11 } },
      vertexShader: 'attribute float fade; varying float vF; void main() { vF = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float strength; varying float vF; void main() { gl_FragColor = vec4(color * strength * vF * vF, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(geo, mat);
    beam.position.copy(head);
    beam.frustumCulled = false;
    beam.userData.noAO = true;
    this.scene.add(beam);
    // The lamp itself: a glow, and an unseen ball to shoot.
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff4dc }));
    lamp.position.copy(head);
    this.scene.add(lamp);
    const L = { head, spot, beam, lamp, outward, phase: Math.random() * 10, period: 18 + Math.random() * 8, dir: new THREE.Vector3(), on: true, inBeam: 0, follow: 0 };
    L.hotspot = this.hotspots?.add({ kind: 'lamp', title: 'SEARCHLIGHT', meshes: [lamp], onHit: () => this.out(L) });
    this.lights.push(L);
  }

  out(L) {
    L.on = false;
    L.spot.visible = L.beam.visible = false;
    L.lamp.material.color.setHex(0x221d18);
    this.hud.message('SEARCHLIGHT SHOT OUT', '');
  }

  tick(dt) {
    const p = this.player;
    const chest = p.pos.clone(); chest.y += Math.max(0.3, p.eye * 0.75);
    for (const L of this.lights) {
      if (!L.on) continue;
      L.phase += dt;
      // Where it points: swept to and fro across the approaches, or held on you once it has you.
      let target;
      if (L.follow > 0) { L.follow -= dt; target = chest.clone(); }
      else {
        const yaw = L.outward + 1.1 * Math.sin(L.phase * 2 * Math.PI / L.period), far = 85;
        target = L.head.clone().add(new THREE.Vector3(Math.sin(yaw) * far, 0, Math.cos(yaw) * far));
        target.y = this.world.groundAt(target.x, target.z);
      }
      const want = target.sub(L.head).normalize();
      L.dir.lerp(want, L.follow > 0 ? Math.min(1, dt * 3) : 1).normalize();
      L.spot.target.position.copy(L.head).addScaledVector(L.dir, 60);
      L.spot.target.updateMatrixWorld();
      L.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), L.dir);
      // Are you in it, with nothing between?
      const to = chest.clone().sub(L.head), d = to.length();
      let lit = !p.dead && d < REACH && to.normalize().angleTo(L.dir) < ANGLE * 1.15;
      if (lit) { const hit = this.world.raycastSegment(L.head.clone().addScaledVector(to, 0.6), chest); lit = !hit || hit.point.distanceTo(chest) < 0.5; }
      L.inBeam = lit ? L.inBeam + dt : 0;
      if (L.inBeam > CAUGHT) {
        if (L.follow <= 0) this.hud.message('CAUGHT IN THE SEARCHLIGHT', 'wound');
        L.follow = FOLLOW;
        // The nearest few guards know where you are.
        const near = this.stealth.guards().map(s => [s, s.root.position.distanceTo(p.pos)]).filter(([, dd]) => dd < 160).sort((a, b) => a[1] - b[1]).slice(0, 3);
        for (const [s] of near) this.stealth.raise(s, 'alerted', p.pos.clone(), 'seen');
      }
    }
  }
}
