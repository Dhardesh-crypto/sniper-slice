// Operation Bell Tower: a walled hill town. The Gestapo runs the town hall on the piazza; two
// spotters watch the valley from the church bell tower. You start on a ridge to the south-west,
// half a kilometre out, and come back to it when it's done.
//
// The map is 1 km across. Everything in the town is laid out relative to its centre F: the
// piazza (fountain, siren), the church (walk-in) and its bell tower (a ladder inside up to the
// belfry), the town hall (walk-in, two floors: guard room, radio room, the commander's office
// with the safe, the records room), rows of terraced houses with alleys and some flat roofs you
// can climb to, and the old walls with the west gate where the road comes up.
import * as THREE from 'three';
import { fbm, lerp, smoothstep, makeRng } from '../world/noise.js';
import { M, Builder, plasterFor } from '../world/kit.js';
import { houseLook } from '../world/arch.js';
import { building, furniture, ladder } from '../world/buildings.js';
import { Soldier } from '../world/soldier.js';
import { vehicleModel } from '../world/vehicle-models.js';
import { propModel, dressProps } from '../world/props.js';

const F = { x: 80, z: -60 };                  // the town centre (the piazza)
const START = { x: -300, z: 300 };             // the ridge you start from
const HX = 76, HZ = 64;                        // the walls, half-size

function base(x, z) {
  let h = (fbm(x * 0.003 + 11.3, z * 0.003 - 4.1, 4) - 0.5) * 40;
  h += (fbm(x * 0.03 + 2, z * 0.03, 2) - 0.5) * 2.5;
  h += 42 * Math.exp(-((x - F.x) ** 2 + (z - F.z) ** 2) / (2 * 140 * 140));       // the town's hill
  h += 22 * Math.exp(-((x - START.x) ** 2 + (z - START.z) ** 2) / (2 * 70 * 70));  // the ridge
  const r = Math.max(Math.abs(x), Math.abs(z));
  if (r > 390) {
    const t = (r - 390) / 110;
    h += t * t * (30 + 50 * fbm(x * 0.006 + 3.3, z * 0.006 + 8.1, 3)) + t * (fbm(x * 0.025, z * 0.025, 2) - 0.5) * 10;
  }
  return h;
}
const H = base(F.x, F.z) + 1;                  // the town's ground level
const roadZ = (x) => F.z + Math.sin((x - F.x) * 0.011) * 26 * smoothstep(-80, -200, x - F.x);
const outside = (x, z) => Math.hypot(Math.max(Math.abs(x - F.x) - HX - 2, 0), Math.max(Math.abs(z - F.z) - HZ - 2, 0));

const map = {
  // Late afternoon: a low golden sun from the west, long shadows down the streets.
  light: { zenith: 70, azimuth: 250, sun: 0xffc488, sunIntensity: 2.6, turbidity: 7, rayleigh: 1.9, clouds: 0.35, hemiSky: 0xd8d0c0, exposure: 0.9 },
  animals: [['cow', 70, 45, 16, 3], ['horse', 28, 32, 8, 1]],   // in the fields below the south wall
  half: 500, playHalf: 470, focus: { x: F.x, z: F.z, r: 90 }, start: START, navHalf: 130,
  // The hilltop is flattened inside the walls and falls away outside them.
  heightAt(x, z) { return lerp(H, base(x, z), smoothstep(0, 40, outside(x, z))); },
  roadCenterZ: (x) => (x < F.x - HX ? roadZ(x) : NaN),
  keepClear(x, z, margin = 0) {
    if (outside(x, z) < 4 + margin) return true;
    if (x < F.x - HX && Math.abs(z - roadZ(x)) < 5 + margin) return true;
    if (Math.hypot(x - START.x, z - START.z) < 12 + margin) return true;
    return false;
  },
  paint(c, x, z, { road, rock }) {
    c.lerp(rock, (1 - smoothstep(0, 3, outside(x, z))) * 0.75);          // paving inside the walls
    if (x < F.x - HX) c.lerp(road, 1 - smoothstep(2, 3.5, Math.abs(z - roadZ(x))));
  },
  truck: { from: -560, stop: -96 },                 // reinforcements come up the road to the gate
  reinforceHome: [-60, 4],
  flee: [6, 40],                                    // the commander runs for the back of the town hall
  routes: {
    // (metres from the piazza's centre; an optional third number is a pause in seconds)
    Commander: [[-1, 24, 22], [0, 19], [0, 2, 16], [-2, -15, 12], [0, 2], [0, 19]],
    'Piazza patrol': [[-14, -10], [14, -10], [14, 10, 6], [-14, 10], [-14, -10, 6]],
    'North patrol': [[-50, -41], [50, -41, 8], [-50, -41, 8]],
    'South patrol': [[-50, 40], [50, 40, 8], [-50, 40, 8]],
    'West patrol': [[-48, -30], [-48, 30, 6], [-48, -30, 6]],
  },
  pickups: layout,
};

// ---- the town ----
function site(scene) {
  const b = new Builder(scene);
  const P = (rx, rz) => [F.x + rx, F.z + rz];
  const y = H;
  const ladders = [], doors = [], soldiers = [];
  const rng = makeRng(1943);
  const add = (rx, rz, yaw, opts) => {
    const [x, z] = P(rx, rz);
    const s = new Soldier({ position: new THREE.Vector3(x, opts.y ?? y, z), yaw, ...opts });
    scene.add(s.root);
    soldiers.push(s);
    return s;
  };

  // The old walls, with the west gate (the road), and gaps north, east and south.
  const wall = (x0, z0, x1, z1) => {
    const [ax, az] = P(x0, z0), [bx, bz] = P(x1, z1);
    const w = Math.max(1.2, Math.abs(bx - ax)), d = Math.max(1.2, Math.abs(bz - az));
    b.box(w, 10, d, M.stone, (ax + bx) / 2, y - 6, (az + bz) / 2);
  };
  wall(-HX, -HZ, -32, -HZ); wall(-28, -HZ, HX, -HZ);                               // north (gap at x −32…−28)
  wall(-HX, HZ, 40, HZ); wall(44, HZ, HX, HZ);                                     // south (gap at x 40…44)
  wall(-HX, -HZ, -HX, -4); wall(-HX, 4, -HX, HZ);                                  // west, the gate at z −4…4
  wall(HX, -HZ, HX, 19); wall(HX, 24, HX, HZ);                                     // east (gap at z 19…24)
  for (const s of [-1, 1]) { const [x, z] = P(-HX, s * 4.6); b.box(1.6, 5.2, 1.6, M.stone, x, y, z); }   // gate towers

  // The piazza: a fountain in the middle.
  {
    const [x, z] = P(0, 0), model = propModel('fountain', { x: 4.6, y: 3.0, z: 4.6 }, { stretch: true });
    const hide = new THREE.MeshBasicMaterial({ visible: false });
    b.box(4, 0.7, 4, model ? hide : M.stone, x, y, z); b.box(0.8, 1.8, 0.8, model ? hide : M.stone, x, y + 0.7, z);
    if (model) { model.position.set(x, y, z); b.group.add(model); }
  }

  // The church: a tall nave you can walk into, pews and an altar; the bell tower beside it.
  let church;
  {
    const [x, z] = P(0, -27);
    church = building(b, {
      x, z, y, w: 14, d: 20, floors: 1, h: 9, mat: M.stone, roof: 'gable',
      openings: [
        { side: 's', at: 0, w: 2.0, h: 3.4, door: true },
        ...[-6, -1, 4].map(at => ({ side: 'e', at, w: 1.2, h: 2.6, sill: 4.4, window: true })),
        ...[-6, -1, 4].map(at => ({ side: 'w', at, w: 1.2, h: 2.6, sill: 4.4, window: true })),
      ],
    });
    doors.push(...church.doors);
    for (let r = 0; r < 6; r++) for (const s of [-1, 1]) b.box(4.2, 0.9, 0.6, M.darkWood, x + s * 3.2, y, z + 5.5 - r * 2.0);   // pews
    b.box(3, 1.1, 1.4, M.stone, x, y, z - 8.2);                                                                              // altar
    church.docAt = new THREE.Vector3(x + 0.6, y + 1.12, z - 8.2);
  }
  // The bell tower: a hollow stone shaft, a ladder inside up to the belfry 18 m up, two spotters.
  const T = P(10.5, -34), TS = 6, TOP = y + 18;
  {
    const [tx, tz] = T, t = 0.4, hw = TS / 2;
    b.box(TS, 18, t, M.stone, tx, y, tz - hw + t / 2);                                       // north
    b.box(t, 18, TS - 2 * t, M.stone, tx - hw + t / 2, y, tz);                               // west
    b.box(t, 18, TS - 2 * t, M.stone, tx + hw - t / 2, y, tz);                               // east
    b.box((TS - 1.3) / 2, 18, t, M.stone, tx - hw + (TS - 1.3) / 4, y, tz + hw - t / 2);     // south, a doorway in the middle
    b.box((TS - 1.3) / 2, 18, t, M.stone, tx + hw - (TS - 1.3) / 4, y, tz + hw - t / 2);
    b.box(1.3, 18 - 2.4, t, M.stone, tx, y + 2.4, tz + hw - t / 2);
    // The belfry floor, open over the ladder (north side).
    b.box(TS, 0.25, TS - 1.4, M.wood, tx, TOP - 0.25, tz + 0.7);
    for (const sx of [-1, 1]) b.box(hw - 0.7, 0.25, 1.4, M.wood, tx + sx * (0.7 + (hw - 0.7) / 2), TOP - 0.25, tz - hw + 0.7);
    // A railing round the hatch (you come up facing it; the ladder passes through).
    b.box(1.5, 0.95, 0.06, M.darkWood, tx, TOP, tz - 1.62);
    for (const sx of [-1, 1]) b.box(0.06, 0.95, 1.0, M.darkWood, tx + sx * 0.74, TOP, tz - 2.1);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.8, 3.4, 0.8, M.stone, tx + dx * (hw - 0.4), TOP, tz + dz * (hw - 0.4));   // pillars
    for (const [dx, dz, w, d] of [[0, -hw + 0.2, TS, 0.4], [0, hw - 0.2, TS, 0.4], [-hw + 0.2, 0, 0.4, TS], [hw - 0.2, 0, 0.4, TS]]) b.box(w, 1.0, d, M.stone, tx + dx, TOP, tz + dz);   // parapet
    b.box(TS + 0.6, 0.35, TS + 0.6, M.roof, tx, TOP + 3.4, tz);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 0.9, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x6b5a3a, metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide }));
    bell.position.set(tx, TOP + 2.3, tz);
    b.group.add(bell);
    // The ladder up the inside of the north wall, through the opening.
    const lz = tz - hw + t + 0.1;
    for (const dx of [-0.3, 0.3]) b.box(0.07, 19, 0.07, M.wood, tx + dx, y, lz, { solid: false });
    for (let i = 0; i < 44; i++) b.box(0.6, 0.05, 0.05, M.wood, tx, y + 0.35 + i * 0.4, lz, { solid: false });
    ladders.push({ foot: new THREE.Vector3(tx, y, lz + 0.45), topSpot: new THREE.Vector3(tx, TOP, lz + 1.6), bottom: y, top: TOP, yaw: 0 });
    add(10.5 - 1.3, -34 + 1.2, -Math.PI * 0.75, { y: TOP, name: 'Bell spotter', stance: 'alert', look: 'guardCamo' });
    add(10.5 + 1.3, -34 - 0.2, Math.PI * 0.85, { y: TOP, name: 'Bell spotter', stance: 'alert' });
  }

  // The town hall: the Gestapo's. Ground floor: guard room (west), hall with the stairs, radio
  // room (east). Upstairs: the commander's office (west, the safe) and the records room (east).
  const [hx, hz] = P(0, 27), hh = 3.4;
  const hall = building(b, {
    x: hx, z: hz, y, w: 22, d: 12, floors: 2, h: hh, mat: M.plaster2, roof: 'flat',
    openings: [
      { side: 'n', at: 0, w: 1.6, h: 2.4, door: true },
      { side: 's', at: -6, w: 1.1, door: true },
      ...[-9, -6, 6, 9].map(at => ({ side: 'n', at, w: 1.1, window: true })),
      ...[-9, -3, 3, 9].map(at => ({ side: 'n', at, w: 1.1, window: true, floor: 1 })),
      ...[-2, 3, 8].map(at => ({ side: 's', at, w: 1.1, window: true })),
      ...[-8, -3, 3, 8].map(at => ({ side: 's', at, w: 1.1, window: true, floor: 1 })),
      { side: 'e', at: 0, w: 1.1, window: true }, { side: 'w', at: 0, w: 1.1, window: true },
      { side: 'e', at: 0, w: 1.1, window: true, floor: 1 }, { side: 'w', at: 0, w: 1.1, window: true, floor: 1 },
    ],
    stairs: { at: [2.5, 3.5], dir: 'n', w: 1.0 },
    walls: [0, 1].flatMap(f => [
      { axis: 'z', at: -4, from: -5.85, to: 5.85, floor: f, openings: [{ at: f ? -3 : 2, w: 1.0, door: true }] },
      { axis: 'z', at: 4, from: -5.85, to: 5.85, floor: f, openings: [{ at: f ? -3 : 2, w: 1.0, door: true }] },
    ]),
  });
  doors.push(...hall.doors);
  const up = y + hh;
  furniture.table(b, hx - 7.5, y, hz, 2.0, 1.0);                   // guard room
  furniture.cabinet(b, hx - 10.4, y, hz + 3.5, 0.45, 1.6);
  furniture.table(b, hx + 7.5, y, hz - 2.5, 2.0, 0.9);             // radio room
  furniture.crates(b, hx + 9.5, y, hz + 3.2, 2);
  furniture.desk(b, hx - 7.5, up, hz + 1.0);                       // the commander's office
  furniture.shelf(b, hx - 7.5, up, hz + 5.4);
  for (const dz of [-4, -1.5, 1, 3.5]) furniture.cabinet(b, hx + 10.4, up, hz + dz, 0.45, 1.2);   // records
  furniture.table(b, hx + 7, up, hz, 1.6, 0.9);
  hall.safe = { at: new THREE.Vector3(hx - 10.3, up, hz - 4.9), yaw: Math.PI / 2 };
  hall.docs = {
    desk: new THREE.Vector3(hx - 7.6, up + 0.79, hz + 0.9),
    records: new THREE.Vector3(hx + 7, up + 0.79, hz),
    radio: new THREE.Vector3(hx + 7.3, y + 0.79, hz - 2.4),
    guardroom: new THREE.Vector3(hx - 7.4, y + 0.79, hz + 0.1),
  };
  // A radio mast on the roof.
  { const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 7, 6), M.metal); mast.position.set(hx + 8, y + 2 * hh + 3.5, hz + 3); b.group.add(mast); }

  // Rows of terraced houses with alleys between them. Some have flat roofs (and a ladder up).
  const roofs = [];
  const house = (cx, cz, w, d, floors, flat, enter) => {
    rng();                                           // (the draw that used to pick its plaster: keeps the town's layout as it was)
    const hgt = floors * 3.2, mat = plasterFor(cx, cz);   // each house its own colour
    if (enter) {
      const hb = building(b, { x: cx, z: cz, y, w, d, floors: 2, h: 3.2, mat, roof: flat ? 'flat' : 'gable',
        openings: [{ side: enter, at: 0, w: 1.2, door: true }, { side: enter, at: w / 2 - 1.5, w: 1.0, window: true, floor: 1 }],
        stairs: { at: [w / 2 - 1.4, d / 2 - 1.0], dir: 'n', w: 0.9 } });
      doors.push(...hb.doors);
      return { cx, cz, top: y + 6.4, flat, hb, w, d };
    }
    b.box(w, hgt, d, mat, cx, y, cz);
    if (flat) for (const [dx, dz, ww, dd] of [[0, -d / 2, w, 0.25], [0, d / 2, w, 0.25]]) b.box(ww, 0.7, dd, mat, cx + dx, y + hgt, cz + dz);
    else {
      // Roofs vary along a row: most ridges along the street, some hipped, some turned to the street.
      const r = houseLook(cx, cz).r(55);
      if (r < 0.25) b.hip(w, Math.min(2.2, Math.min(w, d) * 0.3), d, M.roof, cx, y + hgt, cz);
      else if (r < 0.5) b.gable(d, Math.min(2.4, w * 0.3), w, M.roof, cx, y + hgt, cz, Math.PI / 2, { wall: mat });
      else b.gable(w, 2.0, d, M.roof, cx, y + hgt, cz, 0, { wall: mat });
    }
    b.windows(cx, cz, w, d, y, floors);
    return { cx, cz, top: y + hgt, flat, w, d };
  };
  // A row along x (rz fixed) from x0 to x1; `face`: the side on the street; one walk-in house at `enterAt`.
  const rowX = (x0, x1, rz, d, face, enterAt = null) => {
    let x = x0, i = 0;
    while (x < x1 - 4) {
      const w = Math.min(x1 - x, 7 + rng() * 4);
      const floors = 2 + (rng() < 0.4 ? 1 : 0), flat = rng() < 0.35;
      const [cx, cz] = P(x + w / 2, rz);
      const enter = enterAt !== null && x <= enterAt && x + w > enterAt ? face : null;
      roofs.push({ ...house(cx, cz, w, d, enter ? 2 : floors, flat, enter), face });
      x += w;
      if (++i % 3 === 0) x += 3;            // an alley
    }
  };
  const rowZ = (z0, z1, rx, w, skip = null) => {
    let z = z0, i = 0;
    while (z < z1 - 4) {
      const d = Math.min(z1 - z, 7 + rng() * 4);
      if (!(skip && z + d > skip[0] && z < skip[1])) {
        const [cx, cz] = P(rx, z + d / 2);
        roofs.push({ ...house(cx, cz, w, d, 2 + (rng() < 0.4 ? 1 : 0), rng() < 0.3, null), face: null });
      }
      z += d;
      if (++i % 3 === 0) z += 3;
    }
  };
  rowX(-70, 70, -52, 10, 's', -30);                  // north row (a walk-in house at x −30)
  rowX(-70, 70, 52, 10, 'n', 25);                    // south row (a walk-in house at x 25)
  rowZ(-42, 42, -62, 10, [-5, 5]);                   // west rows, the gate street between
  rowZ(-42, 42, 62, 10, [-5, 5]);                    // east rows
  rowZ(-40, -14, -27, 10); rowZ(14, 40, -27, 10);    // inner blocks beside the piazza
  rowZ(-40, -22, 28, 10); rowZ(14, 40, 28, 10);
  // Ladders up to some flat roofs on the rows' street sides.
  let nLadders = 0;
  for (const r of roofs) {
    if (!r.flat || r.hb || !r.face || nLadders >= 4) continue;
    const s = r.face === 's' ? 1 : -1;
    ladders.push(ladder(b, { x: r.cx + 1.5, z: r.cz + s * (r.d / 2 + 0.08), y, top: r.top, face: r.face }));
    r.ladder = true; nLadders++;
  }
  const walkIns = roofs.filter(r => r.hb);

  // Vehicles: the Gestapo's staff car outside the town hall, a truck inside the gate.
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const [kx, kz] = P(15, 16);
  const kubel = vehicleModel('car');
  kubel.position.set(kx, y, kz); kubel.rotation.y = Math.PI / 2;
  b.group.add(kubel);
  b.box(2.6, 0.9, 1.6, hidden, kx + 0.4, y + 0.3, kz);
  const carEngine = b.box(0.9, 0.75, 1.5, hidden, kx - 1.3, y + 0.45, kz);
  const [ux, uz] = P(-50, 9);
  const truck = vehicleModel('truck');
  truck.position.set(ux, y, uz); truck.rotation.y = -Math.PI / 2;
  b.group.add(truck);
  b.box(3.6, 2.4, 2.3, hidden, ux + 1.2, y + 0.35, uz);
  b.box(1.2, 2.0, 2.1, hidden, ux - 1.2, y + 0.35, uz);
  const truckEngine = b.box(1.2, 1.25, 1.8, hidden, ux - 2.4, y + 0.5, uz);

  // The alarm siren on the piazza (cut its wire at the junction box).
  const [sx, sz] = P(15, -11);
  b.box(0.2, 5.2, 0.2, M.wood, sx, y, sz);
  const junction = b.box(0.36, 0.46, 0.2, M.metal, sx, y + 1.0, sz + 0.2, { solid: false });
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.12, 0.55, 14, 1, true).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a8d84, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
  horn.position.set(sx + 0.25, y + 5.0, sz);
  const hornBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.35, 12).rotateZ(Math.PI / 2), M.metal);
  hornBody.position.set(sx - 0.05, y + 5.0, sz);
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.8, 5), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }));
  wire.position.set(sx + 0.12, y + 3.1, sz + 0.12);
  for (const m of [horn, hornBody, wire]) { m.castShadow = true; b.group.add(m); }
  const siren = { pos: new THREE.Vector3(sx, y, sz), junction: junction.position.clone(), horn: horn.position.clone(), hornMeshes: [horn, hornBody], wire, standAt: new THREE.Vector3(sx, y, sz + 0.9) };

  // Sandbags at the gate.
  for (const s of [-1, 1]) { const [x, z] = P(-68, s * 3.2); b.box(1.6, 0.8, 0.5, M.sandbag, x, y, z); }
  {   // and a machine-gun nest beside it, covering the road in
    const [x, z] = P(-64, 9), nest = propModel('mgNest', { x: 3.2, y: 1.3, z: 3.2 }, { stretch: true });
    if (nest) {
      nest.position.set(x, y, z); nest.rotation.y = Math.PI / 2; b.group.add(nest);
      b.box(0.6, 0.95, 3.0, new THREE.MeshBasicMaterial({ visible: false }), x - 1.3, y, z);   // its front wall, for cover
    }
  }

  // The garrison.
  add(-1, 24, Math.PI, { officer: true, name: 'Commander' });
  add(0.8, 19.2, Math.PI, { name: 'Hall guard', stance: 'alert', look: 'guardSergeant' });
  add(-7.5, 25.5, 0, { name: 'Clerk', look: 'officerLieutenant' });
  add(-14, -10, 0, { name: 'Piazza patrol', stance: 'alert' });
  add(-50, -41, Math.PI / 2, { name: 'North patrol' });
  add(-50, 40, Math.PI / 2, { name: 'South patrol', look: 'guardCamo' });
  add(-48, -30, 0, { name: 'West patrol', look: 'guardSergeant' });
  add(-70, -2.5, -Math.PI / 2, { name: 'Gate guard', stance: 'alert' });
  add(-70, 2.5, -Math.PI / 2, { name: 'Gate guard', stance: 'alert' });
  add(13, 18, -Math.PI / 2, { name: 'Driver' });
  // A sentry on a flat roof on the south side, watching the slope.
  const sentryRoof = roofs.find(r => r.flat && !r.hb && r.cz > F.z + 40 && r.cx > F.x + 10) ?? roofs.find(r => r.flat && !r.hb);
  if (sentryRoof) add(sentryRoof.cx - F.x, sentryRoof.cz - F.z, 0, { y: sentryRoof.top, name: 'Roof sentry', stance: 'alert', look: 'guardCamo' });

  const dressed = dressProps(scene, dressing(), map.heightAt, b.boxes, vehicleModel);
  b.solids.push(...dressed.solids); b.boxes.push(...dressed.boxes);

  return {
    solids: b.solids, boxes: b.boxes, soldiers, ladders, doors, siren,
    spawn: new THREE.Vector3(START.x, map.heightAt(START.x, START.z), START.z),
    staffCar: { engine: carEngine, parts: [kubel.userData.mesh], title: 'STAFF CAR ENGINE' },
    vehicles: [{ title: 'TRUCK ENGINE', engine: truckEngine, parts: [truck.userData.mesh] }],
    hall, church, walkIns, towerTop: new THREE.Vector3(T[0], TOP, T[1]), towerTops: [new THREE.Vector3(T[0], TOP, T[1])],
  };
}

// Set dressing: carts and barrels in the streets, a well, sentry boxes at the gates, the road's
// telegraph poles and signpost, haystacks and wire outside the walls.
function dressing() {
  const poles = [-20, -60, -100, -140, -180].map(x => ['pole', x, roadZ(x) + 6]);
  return [
    ...poles, ['signpost', -6, -70, 0.4],
    ['well', 110, -70], ['cart', 60, -45, 0.4], ['cart', 125, -55, -0.6], ['barrels', 40, -80, Math.PI / 2], ['barrels', 128, -90, 0],
    ['motorcycle', 100, -38, 0.3], ['truck', -14, -72, Math.PI / 2], ['halftrack', -8, -50, Math.PI / 2], ['kitchen', 100, -82, 0.2],
    ['supplies', 66, -24],
    ['sentryBox', 6, -68, Math.PI / 2], ['sentryBox', 56, -129, 0], ['sentryBox', 127, 8, Math.PI], ['sentryBox', 161, -46, -Math.PI / 2],
    ['sandbags', 50, -119, 0], ['sandbags', 151, -45, Math.PI / 2], ['pak40', 110, 13, Math.PI / 2],
    ['haystack', 40, 18], ['haystack', 58, 24], ['haystack', -20, -100], ['wire', 90, 12, 0], ['wire', 150, 10, 0],
    ['marketStall', 80, -48, 0], ['marketStall', 72, -51, 0.2], ['cafeSet', 96, -45], ['cafeSet', 99, -50, 1], ['fiat', 110, -52, 0.4],
    ['horseCart', 35, -100, 1.2], ['rock', 10, 62], ['rock', 185, 30, 1], ['rock', -60, -150, 2],
  ];
}

// ---- what's to be found ----
function layout({ world, on }) {
  const P = (rx, rz, yy) => on(F.x + rx, F.z + rz, yy);
  const sp = world.spawn;
  const boxes = [
    { kind: 'parts', where: 'gate street', at: P(-52, 3) },
    { kind: 'parts', where: 'behind the church', at: P(-9, -40) },
    { kind: 'parts', where: 'the south alley', at: P(36, 44) },
    { kind: 'parts', where: 'by the east gap', at: P(70, 22) },
    { kind: 'weapon', weapon: 'mg42', where: 'the radio room', at: P(9, 27.5) },
  ];
  for (const [type, rx, rz] of [
    ['ammo', -16, 12], ['medical', 16, -12], ['explosives', -40, -38], ['ammo', 44, -38], ['bottles', -40, 44],
    ['heavy', 48, 30], ['ammo', -71, -40], ['medical', -71, 40], ['explosives', 71, -40], ['bottles', 20, -42],
  ]) boxes.push({ kind: 'supply', type, where: type, at: P(rx, rz) });
  // Out on the slopes and the ridge.
  for (const [type, x, z] of [['ammo', sp.x + 6, sp.z + 3], ['medical', sp.x + 4, sp.z - 6], ['explosives', -120, 120], ['ammo', -40, 40]]) {
    boxes.push({ kind: 'supply', type, where: type, at: on(x, z) });
  }
  const benches = [
    { where: 'start', at: on(sp.x + 2.5, sp.z - 4) },
    { where: 'the gate street', at: P(-46, -6) },
  ];
  return { boxes, benches };
}

// ---- documents, the safe, the objectives ----
const SAFE = { id: 'gestapo-safe', name: 'THE GESTAPO SAFE', combination: '27 – 11 – 09' };

function intel(it, world, { pickups, arsenal, mission }) {
  const h = world.site.hall;
  it.addSafe({
    ...SAFE, at: h.safe.at, yaw: h.safe.yaw, objective: 'safe', objectiveText: 'THE ARREST LISTS TAKEN',
    docs: [{ id: 'town-lists', title: 'Arrest lists',
      text: 'Geheime Staatspolizei, Aussenstelle.\n\nTo be arrested at dawn on Sunday and held in the town hall cellars for transport north:\n\n' +
        'The priest, Don Anselmo. The baker Ruggeri and both sons. The schoolteacher Maria Conti. Seven others named below, all suspected of carrying messages for the partisans.\n\n' +
        'The informant\'s name is not to be written down. — W.' }],
    contents: () => {
      const got = [];
      const part = pickups?.givePart?.();
      if (part) got.push(`part: ${part.name}`);
      if (arsenal) { arsenal.weapons.pistol.reserve += 8; got.push('+8 pistol rounds'); }
      return got;
    },
  });
  it.addDocument({ id: 'town-combination', title: 'Memo: the office safe', at: h.docs.records, reveals: SAFE.id,
    text: `The office safe has been reset after Unterscharführer Brandt's transfer.\nNew combination: ${SAFE.combination}.\n\nOne copy only. Keep it in the records room, not in the office. — W.` });
  it.addDocument({ id: 'town-roster', title: 'Duty roster', at: h.docs.guardroom,
    text: 'Bell tower: two men, changed at 06:00 and 18:00. They see the whole valley road and the ridge to the south-west.\nGate: two men. Piazza, streets: one each.\n' +
      'The commander walks to the church every day after lunch. He does not like to be kept waiting.' });
  it.addDocument({ id: 'town-radio', title: 'Radio log', at: h.docs.radio,
    text: '11:40  COAST to BELL: a truck of reinforcements stands by at the crossroads. 6 minutes up the hill road.\n12:05  BELL to COAST: understood. Siren on the piazza if needed.' });
  it.addDocument({ id: 'town-orders', title: 'An order from Verona', at: h.docs.desk,
    text: 'Weiss —\n\nThe arrests are to proceed on Sunday as planned. The town is to understand what it means to shelter bandits. Report when done.\n\n— Kommandeur der Sipo, Verona' });
  it.addDocument({ id: 'town-sermon', title: "The priest's notes", at: world.site.church.docAt,
    text: 'For Sunday: "Do not be afraid." The bells have been silent since they came. If anything happens to me, the children are to go to the Contis\' farm in the valley.' });
  // In the walk-in houses: a partisan's note and a child's drawing of the bell tower.
  const [w1, w2] = world.site.walkIns;
  if (w1) it.addDocument({ id: 'town-partisan', title: 'A note under a floorboard', at: new THREE.Vector3(w1.cx - 1, w1.top - 6.4 + 0.08, w1.cz),
    text: 'Englishman — the spotters in the tower cannot see the alley behind the church, nor the roofs on the south side. The gate guards drink after dark. ' +
      'Weiss keeps his own copy of the safe number in his pocket. Good luck. — A friend.' });
  if (w2) it.addDocument({ id: 'town-drawing', title: "A child's drawing", at: new THREE.Vector3(w2.cx + 1, w2.top - 3.2 + 0.05, w2.cz),
    text: 'A crayon drawing of the bell tower with two little soldiers at the top, and a big sun.\n\nOn the back, in a child\'s hand: "Papa says the bell will ring again when they are gone."' });
  mission.papersDoc = { id: 'town-papers', title: "Weiss's papers", reveals: SAFE.id,
    text: `Service book of SS-Sturmbannführer E. Weiss. A cigarette case. In the lining of the case, a slip of paper: ${SAFE.combination}.` };
  mission.documentsTotal = 9;
}

const spotters = (m) => m.world.soldiers.filter(s => s.name === 'Bell spotter');
const def = {
  target: 'Sturmbannführer Weiss',
  targetArea: { x: F.x, z: F.z + 20 },
  extraction: START,
  killText: 'WEISS IS DEAD · GET BACK TO THE RIDGE',
  papersText: "WEISS'S PAPERS TAKEN",
  objectives: [
    { id: 'officer', text: 'Eliminate Sturmbannführer Weiss' },
    { id: 'safe', text: 'Take the arrest lists from the safe in the Gestapo office', optional: true },
    { id: 'spotters', text: 'Silence the observation post in the bell tower', optional: true },
    { id: 'papers', text: "Take Weiss's papers", optional: true },
    { id: 'car', text: 'Destroy the Gestapo staff car', optional: true },
    { id: 'extract', text: 'Get back to the ridge you came from', hidden: true },
  ],
  tick(m) {
    if (!m.obj('spotters').done && spotters(m).every(s => !s.alive)) m.complete('spotters', 'THE BELL TOWER IS SILENT');
    if (!m.obj('car').done && m.world.hotspots.some(h => h.title === 'STAFF CAR ENGINE' && h.exploded)) m.complete('car', 'STAFF CAR DESTROYED');
  },
  markers(m) {
    return m.obj('spotters').done ? [] : [{ pos: m.world.site.towerTop, kind: 'radio', label: 'OBSERVATION POST', height: 1.5 }];
  },
};

const briefing = `
  <p class="brief">The Gestapo has taken over the town hall of this walled hill town. Their commander,
    Sturmbannführer Weiss, means to arrest a dozen townspeople on Sunday. Two spotters in the church
    bell tower watch the valley road and the ridge you start from.</p>
  <ul class="goals">
    <li><b>Eliminate Sturmbannführer Weiss.</b> He keeps a routine: the town hall, the piazza, the church.</li>
    <li><b>Optional:</b> take the arrest lists from the safe in his office upstairs in the town hall.
      The combination is written down somewhere, and he carries it; or crack it by ear.</li>
    <li><b>Optional:</b> silence the observation post in the bell tower: a ladder inside climbs to the belfry.</li>
    <li><b>Optional:</b> take his papers, and destroy his staff car outside the town hall.</li>
    <li><b>Then</b> get back to the ridge to the south-west, where green smoke marks the pick-up.</li>
    <li><b>Inside:</b> walk into the church, the town hall and some houses; read what you find (E). Some flat
      roofs have ladders: the rooftops are a way through the town.</li>
  </ul>
  <p class="brief">The road comes up to the west gate. There are gaps in the old walls to the north, east and south.
    Guards who spot you run for the siren on the piazza; a truck of reinforcements comes up the hill road.</p>`;

export default { id: 'town', props: ['fountain', 'mgNest', 'well', 'cart', 'barrels', 'motorcycle', 'halftrack', 'kitchen', 'supplies', 'sentryBox', 'sandbags', 'pak40', 'haystack', 'wire', 'pole', 'signpost', 'marketStall', 'cafeSet', 'fiat', 'horseCart', 'rock'], subtitle: 'Operation Bell Tower · Umbria, 1944', map, site, def, intel, briefing };
