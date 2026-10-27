// What a fight leaves behind: bullet holes in walls, timber and the ground (a dark hole in a ring
// of chipped surface, tinted to what it struck), blood spattered on whatever stood behind a man
// who was hit, a pool spreading slowly under a body, and the trail a wounded man leaves (drops as he
// walks, a smear as he crawls). Three instanced meshes (holes, blood, the trails), each
// a ring of a few hundred decals: the oldest goes when a new one is made. Lit like the world, and
// pulled toward the camera so they don't flicker on the surface. Nothing goes on hidden collision
// blocks (a vehicle's, a nest's) or on doors, which would leave a hole hanging in the air.
import * as THREE from 'three';

const HOLES = 320, BLOOD = 140, POOLS = 16, DRIPS = 240;
const POOL_TIME = 28;          // s for a pool to spread to its full size

function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  // The chipped ring: lighter, ragged, with cracks running out.
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = 9 + Math.random() * 13;
    g.fillStyle = `rgba(${200 + Math.random() * 40 | 0},${190 + Math.random() * 40 | 0},${170 + Math.random() * 40 | 0},${0.35 + Math.random() * 0.4})`;
    g.beginPath(); g.arc(32 + Math.cos(a) * r * 0.6, 32 + Math.sin(a) * r * 0.6, 2 + Math.random() * 5, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(40,34,28,0.7)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    g.beginPath(); g.moveTo(32, 32);
    let x = 32, y = 32;
    for (let k = 0; k < 4; k++) { x += Math.cos(a + (Math.random() - 0.5)) * 5; y += Math.sin(a + (Math.random() - 0.5)) * 5; g.lineTo(x, y); }
    g.stroke();
  }
  // The hole: black in the middle, scorched round it.
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 11);
  grd.addColorStop(0, 'rgba(8,6,5,1)'); grd.addColorStop(0.55, 'rgba(20,16,12,0.95)'); grd.addColorStop(1, 'rgba(50,42,34,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(32, 32, 11, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bloodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const blob = (x, y, r, a) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(92,8,6,${a})`); grd.addColorStop(0.75, `rgba(70,4,3,${a * 0.9})`); grd.addColorStop(1, 'rgba(60,2,2,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  for (let i = 0; i < 9; i++) blob(64 + (Math.random() - 0.5) * 34, 64 + (Math.random() - 0.5) * 34, 10 + Math.random() * 20, 0.85);
  for (let i = 0; i < 26; i++) {                       // droplets thrown out
    const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 30;
    blob(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1.5 + Math.random() * 4, 0.9);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function decalMesh(count, map, roughness, order) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.frustumCulled = false;
  m.renderOrder = order;
  m.receiveShadow = true;
  m.userData.noAO = true;
  m.setColorAt(0, new THREE.Color(1, 1, 1));
  return m;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1), _c = new THREE.Color();
const _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class Decals {
  constructor({ scene, world }) {
    this.world = world;
    this.holes = decalMesh(HOLES, holeTexture(), 0.9, 2);
    this.blood = decalMesh(BLOOD, bloodTexture(), 0.35, 3);
    this.drips = decalMesh(DRIPS, bloodTexture(), 0.35, 3);   // the trail a wounded man leaves
    this.nextHole = 0; this.nextBlood = 0; this.nextDrip = 0;
    this.pools = [];                                   // spreading under bodies: { i, at, normal, spin, size, t }
    this.pooled = new Set();
    scene.add(this.holes, this.blood, this.drips);
  }

  place(mesh, i, point, normal, size, spin, color, stretch = 1) {
    _q.setFromUnitVectors(_z, normal);
    if (spin) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_z, spin));
    _m.compose(_s.copy(point).addScaledVector(normal, 0.004), _q, new THREE.Vector3(size * stretch, size, 1));
    mesh.setMatrixAt(i, _m);
    mesh.setColorAt(i, color);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.count = Math.max(mesh.count, i + 1);
  }

  // A bullet struck the world (`hit` from World.raycastSegment).
  bullet(hit) {
    const o = hit.object;
    if (o && (o.material?.visible === false || o.userData.door || this.world.doors?.some(d => d.mesh === o))) return;
    const normal = hit.terrain ? this.groundNormal(hit.point) : hit.normal.clone().normalize();
    // Tinted to what it struck: lighter on pale plaster and stone, darker in timber and earth.
    const mat = Array.isArray(o?.material) ? o.material[0] : o?.material;
    const base = hit.terrain ? new THREE.Color(0x8a7a62) : (mat?.color ?? new THREE.Color(0xa09080));
    const lum = Math.min(1.2, 0.45 + 0.8 * (0.3 * base.r + 0.6 * base.g + 0.1 * base.b));
    _c.setRGB(lum, lum * 0.96, lum * 0.9);
    const size = hit.terrain ? 0.16 + Math.random() * 0.06 : 0.07 + Math.random() * 0.03;
    this.place(this.holes, this.nextHole, hit.point, normal, size, Math.random() * 6.3, _c);
    this.nextHole = (this.nextHole + 1) % HOLES;
  }

  // Where a round from a guard kicked up the ground near you (a near miss).
  scuff(point) {
    _c.setRGB(0.8, 0.76, 0.7);
    this.place(this.holes, this.nextHole, point, this.groundNormal(point), 0.15 + Math.random() * 0.05, Math.random() * 6.3, _c);
    this.nextHole = (this.nextHole + 1) % HOLES;
  }

  // A man hit at `point` by a round going `dir`: the spatter on what's behind him, within 3 m.
  spatter(point, dir, soldier) {
    const from = point.clone().addScaledVector(dir, 0.3), to = point.clone().addScaledVector(dir, 3);
    const hit = this.world.raycastSegment(from, to);
    if (!hit || hit.soldier || hit.object?.material?.visible === false) return;
    const normal = hit.terrain ? this.groundNormal(hit.point) : hit.normal.clone().normalize();
    const size = (0.5 + Math.random() * 0.5) * (1 - hit.distance / 4.5);
    _c.setRGB(0.85 + Math.random() * 0.15, 1, 1);
    this.place(this.blood, this.nextBlood, hit.point, normal, size, Math.random() * 6.3, _c);
    this.nextBlood = (this.nextBlood + 1) % BLOOD;
  }

  groundNormal(p) {
    const g = (x, z) => this.world.groundAt(x, z), e = 0.5;
    return new THREE.Vector3(g(p.x - e, p.z) - g(p.x + e, p.z), 2 * e, g(p.x, p.z - e) - g(p.x, p.z + e)).normalize();
  }

  // Each frame: a pool starts under every man once he's down, and spreads.
  tick(dt) {
    for (const s of this.world.soldiers) {
      if (s.alive || s.range || this.pooled.has(s) || (s.deathT ?? 1) < 1) continue;
      this.pooled.add(s);
      const at = s.char?.bones?.Spine02?.getWorldPosition(new THREE.Vector3()) ?? s.bodyPosition(new THREE.Vector3());   // (under his chest)
      at.y = this.world.floorAt(at.x, at.z, at.y + 0.5);
      if (this.pools.length >= POOLS) this.pools.shift();
      const normal = Math.abs(at.y - this.world.groundAt(at.x, at.z)) < 0.05 ? this.groundNormal(at) : new THREE.Vector3(0, 1, 0);
      this.pools.push({ i: this.nextBlood, at, normal, spin: Math.random() * 6.3, size: 1.1 + Math.random() * 0.5, t: 0 });
      this.nextBlood = (this.nextBlood + 1) % BLOOD;
    }
    // A man bleeding leaves a trail: drops every stride or so as he walks (more, the worse he
    // bleeds), a smear behind him as he crawls. You can follow it.
    for (const s of this.world.soldiers) {
      if (!s.alive || !(s.bleed > 0) || s.range) { s.dripFrom = null; continue; }
      const at = s.downed ? (s.char?.bones?.Spine02?.getWorldPosition(_d) ?? s.bodyPosition(_d)) : _d.copy(s.root.position);
      if (!s.dripFrom) { s.dripFrom = at.clone(); continue; }
      const moved = Math.hypot(at.x - s.dripFrom.x, at.z - s.dripFrom.z);
      const every = s.downed ? 0.3 : 1.6 / Math.min(3, 0.6 + s.bleed);
      if (moved < every) continue;
      const along = Math.atan2(at.z - s.dripFrom.z, at.x - s.dripFrom.x);
      s.dripFrom.copy(at);
      const p = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25));
      p.y = this.world.floorAt(p.x, p.z, at.y + 0.3);
      const onGround = Math.abs(p.y - this.world.groundAt(p.x, p.z)) < 0.05;
      _c.setRGB(0.7 + Math.random() * 0.2, 1, 1);
      if (s.downed) this.place(this.drips, this.nextDrip, p, onGround ? this.groundNormal(p) : _up, 0.22 + Math.random() * 0.08, -along, _c, 2.2);   // (smeared along the way he dragged himself)
      else this.place(this.drips, this.nextDrip, p, onGround ? this.groundNormal(p) : _up, 0.07 + Math.random() * 0.08, Math.random() * 6.3, _c);
      this.nextDrip = (this.nextDrip + 1) % DRIPS;
    }
    for (const p of this.pools) {
      if (p.t >= POOL_TIME) continue;
      p.t = Math.min(POOL_TIME, p.t + dt);
      const k = 1 - (1 - p.t / POOL_TIME) ** 2;
      _c.setRGB(0.75, 1, 1);
      this.place(this.blood, p.i, p.at, p.normal, 0.15 + p.size * k, p.spin, _c);
    }
  }
}
