// Operation Flak Line: a battery of 8.8 cm flak guns on a ridge in the Apennine foothills, behind
// a trench line. The bombers sent against the rail junction in the Po valley have to fly over the
// ridge, and the battery has been shooting them down. Destroy the four guns (armour-piercing
// rounds at a breech, or a charge), take the battery's fire plan from the command dugout, and get
// back to the farm you started from.
//
// From the valley in the south the slope climbs to a fire trench zig-zagging along the hillside,
// with belts of barbed wire in front (cut a way through: wire cutters make it quick) and MG nests
// in it. Two communication trenches run up to the battery on the crest: the four guns in their
// sandbagged pits round the command post, 2 cm guns on the flanks, the ammunition bunker, the
// crew's dugouts, a searchlight. Tunnels: from a shell-hole by the ruined farmhouse under the
// wire to the back of the trench line; and from the ammunition bunker out to the woods east.
import * as THREE from 'three';
import { fbm, lerp, smoothstep } from '../world/noise.js';
import { M, Builder } from '../world/kit.js';
import { building, furniture } from '../world/buildings.js';
import { Soldier } from '../world/soldier.js';
import { vehicleModel } from '../world/vehicle-models.js';
import { hasProp, propModel, dressProps } from '../world/props.js';
import { trenchSystem, dressTrenches, besideTrench } from '../world/trenches.js';
import { Tunnels } from '../world/tunnels.js';

const START = { x: -20, z: 300 };
const FARM = { x: -150, z: 215 };                      // the ruined farmhouse below the line
const CREST = -40;                                     // z of the ridge top
const GUNS = [[-55, -30], [-15, -62], [30, -60], [65, -26]].map(([x, z], i) => ({ x, z, i }));
const POST = { x: 5, z: -20 };                         // the command post (fire control)
const AMMO = { x: 5, z: -95 };                         // the ammunition bunker
const WOODS = { x: 230, z: -70 };
// The fire trench (zig-zag traverses) and the two communication trenches up to the battery.
const FIRE = [[-220, 120], [-180, 108], [-150, 124], [-110, 110], [-75, 126], [-40, 112], [-5, 126], [30, 110], [65, 125], [100, 110], [140, 124], [180, 108], [220, 120]];
const COMM = [[[-75, 122], [-70, 80], [-60, 40], [-55, 0], [-48, -18]], [[100, 112], [90, 70], [80, 30], [70, -2], [62, -14]]];
const LINES = [FIRE, ...COMM];
const DUGOUTS = [
  besideTrench(FIRE, 96, -1),                          // let into the back wall of the fire trench (doorways onto it)
  besideTrench(FIRE, 272, -1),
  besideTrench(FIRE, 388, -1, { w: 3.6 }),
  besideTrench(COMM[0], 120, 1),                       // up at the battery: crew quarters off the west communication trench
  { x: POST.x, z: POST.z + 6, yaw: Math.PI, w: 5, d: 3.6, command: true },   // the command dugout (the safe)
];
const SYS = trenchSystem(LINES, { depth: 1.9, half: 0.85, bank: 0.8, dugouts: DUGOUTS });
const WIRE_Z = [150, 162];                             // two belts of wire in front of the fire trench

// The country: a valley in the south rising to the ridge, hills beyond.
function ground(x, z) {
  let h = 18 + 34 * smoothstep(260, CREST, z) + (fbm(x * 0.006 + 3, z * 0.006 - 2, 4) - 0.5) * 12;
  h -= 6 * Math.exp(-((x - FARM.x) ** 2 + (z - FARM.z) ** 2) / (2 * 60 * 60));   // the farm in a fold
  if (z < CREST - 40) h -= (CREST - 40 - z) * 0.12;                                // the far side falls away
  const r = Math.max(Math.abs(x), Math.abs(z - 60));
  if (r > 380) { const t = (r - 380) / 100; h += t * t * (35 + 40 * fbm(x * 0.006 + 1.1, z * 0.006, 3)); }
  return h;
}
// The crest levelled for the battery, each gun in a shallow pit.
function heightAt(x, z) {
  let h = ground(x, z);
  const pad = 1 - smoothstep(70, 110, Math.hypot(x - POST.x, (z - POST.z) * 1.3));
  if (pad > 0) h = lerp(h, ground(POST.x, POST.z), pad);
  for (const g of GUNS) { const d = Math.hypot(x - g.x, z - g.z); if (d < 6.5) h -= 0.9 * (1 - smoothstep(4.2, 6.5, d)); }
  return h - SYS.carve(x, z);
}
const slopeAt = (x, z) => Math.max(Math.abs(heightAt(x + 0.7, z) - heightAt(x - 0.7, z)), Math.abs(heightAt(x, z + 0.7) - heightAt(x, z - 0.7))) / 1.4;

const map = {
  // Late autumn in the foothills: a low, pale sun through haze, the far ridges blue.
  light: { zenith: 72, azimuth: 205, sun: 0xffd9a8, sunIntensity: 2.2, turbidity: 7, rayleigh: 1.8, clouds: 0.55, hemiSky: 0xb7c3cf, hemi: 0.55, exposure: 0.9 },
  fog: { color: 0xaab4bb, near: 220, far: 1300 },
  horizon: 'bridge', music: 'bridge',             // (the Serchio valley's far country and score suit these hills)
  animals: [['cow', FARM.x + 40, FARM.z + 30, 18, 3]],
  half: 480, playHalf: 450, focus: { x: 0, z: 40, r: 170 }, start: START, navHalf: 330,
  maxSlope: 0.95,
  heightAt,
  roadCenterZ: (x) => NaN,
  keepClear(x, z, m = 0) {
    if (SYS.dist(x, z) < 3 + m || SYS.inDugout(x, z, 2 + m)) return true;
    if (z > WIRE_Z[0] - 5 - m && z < WIRE_Z[1] + 5 + m && Math.abs(x) < 230) return true;
    if (Math.hypot(x - POST.x, (z - POST.z) * 1.3) < 95 + m) return true;             // the battery
    if (Math.hypot(x - FARM.x, z - FARM.z) < 20 + m) return true;
    return Math.hypot(x - START.x, z - START.z) < 12 + m;
  },
  paint(c, x, z, { dirt, dry, rock }) {
    if (SYS.dist(x, z) < 2.2) c.lerp(dirt, 0.85);
    if (Math.hypot(x - POST.x, (z - POST.z) * 1.3) < 85) c.lerp(dry, 0.5);
    for (const g of GUNS) if (Math.hypot(x - g.x, z - g.z) < 6) c.lerp(dirt, 0.7);
    if (z > WIRE_Z[0] - 8 && z < WIRE_Z[1] + 8 && Math.abs(x) < 230) c.lerp(dirt, 0.35 * fbm(x * 0.2, z * 0.2, 2));   // churned by shelling
    if (slopeAt(x, z) > 0.9) c.lerp(rock, 0.6);
  },
  reinforceHome: [POST.x, POST.z + 20],
  flee: [AMMO.x, AMMO.z],
  routes: {
    'Trench sentry': FIRE.slice(0, 7).map(([x, z]) => [x, z]).concat([[...FIRE[0], 8]]),
    'East trench sentry': FIRE.slice(6).map(([x, z]) => [x, z]).concat([[...FIRE[6], 8]]),
    'Runner': COMM[0].map(([x, z]) => [x, z]).concat([...COMM[0]].reverse().slice(1).map(([x, z], i) => i === 0 ? [x, z, 10] : [x, z])),
    'Battery sentry': [[-80, -10], [-30, -85], [40, -85, 6], [90, -10], [-80, -10, 6]],
    'Wire patrol': [[-200, 140], [200, 140, 6], [-200, 140, 6]],
  },
  pickups: layout,
};

// ---- the line and the battery ----
function site(scene, world) {
  const b = new Builder(scene);
  const ladders = [], doors = [], soldiers = [], hotspotDefs = [], towerTops = [];
  const add = (x, z, yaw, opts) => {
    const s = new Soldier({ position: new THREE.Vector3(x, opts.y ?? heightAt(x, z), z), yaw, ...opts });
    scene.add(s.root);
    soldiers.push(s);
    return s;
  };
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8b8a82, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4f524d, roughness: 0.5, metalness: 0.7 });
  const place = (m, x, y, z, rotY = 0) => { if (m) { m.position.set(x, y, z); m.rotation.y = rotY; b.group.add(m); } return m; };

  // ---- trenches and dugouts ----
  const dug = dressTrenches(b, SYS, heightAt);
  const command = dug[DUGOUTS.findIndex(d => d.command)];

  // ---- the four 8.8 cm guns, each in a sandbag ring, barrel to the north-west sky. The breech
  // block under the barrel is the weak spot: two armour-piercing rounds, or a charge. ----
  const guns = GUNS.map(g => {
    const y = heightAt(g.x, g.z), yaw = Math.atan2(g.x - POST.x, g.z - POST.z) * 0.3 + Math.PI * 0.85;
    for (let a = 0; a < 22; a++) {
      const ang = a / 22 * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(ang - Math.atan2(POST.z - g.z, POST.x - g.x)), Math.cos(ang - Math.atan2(POST.z - g.z, POST.x - g.x)))) < 0.3) continue;   // (the way in, toward the post)
      const rx = g.x + Math.cos(ang) * 6.2, rz = g.z + Math.sin(ang) * 6.2, ry = heightAt(rx, rz) - 0.1;
      b.box(1.85, 0.55, 0.75, M.sandbag, rx, ry, rz, { rotY: -ang + Math.PI / 2 });
      b.box(1.7, 0.5, 0.7, M.sandbag, rx, ry + 0.55, rz, { rotY: -ang + Math.PI / 2 + 0.08 });   // (two courses, a little offset)
    }
    const model = hasProp('flak88') ? place(propModel('flak88', { y: 4.4 }, { own: true }), g.x, y, g.z, yaw) : null;
    if (!model) {   // (no model: a cross-shaped carriage and a long barrel raised to the sky)
      for (const r of [0, Math.PI / 2]) b.box(6.4, 0.25, 0.4, steel, g.x, y, g.z, { rotY: yaw + r, solid: false });
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6, 10), steel);
      barrel.position.set(g.x, y + 2.6, g.z); barrel.rotation.set(0.85, yaw, 0, 'YXZ'); b.group.add(barrel);
      b.box(1.6, 1.6, 1.1, steel, g.x, y + 0.3, g.z, { rotY: yaw, solid: false });
    }
    const breech = b.box(1.3, 1.1, 1.3, hidden, g.x, y + 0.6, g.z);
    hotspotDefs.push({ kind: 'flak', title: '8.8 CM FLAK GUN', explosive: true, armored: true, hitsToExplode: 2, meshes: [breech], parts: model ? model.userData.meshes : [breech],
      blast: { radius: 8, hurt: 15, size: 2.0, burn: true, heavy: true, label: '8.8 CM GUN DESTROYED' } });
    // Its ready ammunition: crates by the ring.
    b.box(0.9, 0.5, 0.5, M.crate, g.x + 4, heightAt(g.x + 4, g.z + 1.5), g.z + 1.5, { rotY: 0.3 });
    return { ...g, model, breech, y };
  });

  // The 2 cm guns on the flanks.
  for (const [fx, fz] of [[-110, -40], [120, -45]]) {
    const fy = heightAt(fx, fz);
    for (let a = 0; a < 8; a++) { const ang = a / 8 * Math.PI * 2; if (a === 2) continue; b.box(1.6, 0.9, 0.6, M.sandbag, fx + Math.cos(ang) * 3.2, fy, fz + Math.sin(ang) * 3.2, { rotY: -ang }); }
    place(propModel('flak', { y: 2.9 }), fx, fy, fz, Math.PI / 2);
    const core = b.box(1.4, 1.2, 1.4, hidden, fx, fy, fz);
    hotspotDefs.push({ kind: 'flak20', title: '2 CM FLAK GUN', explosive: true, armored: true, hitsToExplode: 2, meshes: [core], parts: [core],
      blast: { radius: 6, hurt: 12, size: 1.4, burn: true, heavy: true, label: '2 CM GUN DESTROYED' } });
  }

  // ---- the command post: the fire-control predictor on its stand, a rangefinder, a field telephone ----
  const py = heightAt(POST.x, POST.z);
  for (let a = 0; a < 10; a++) { const ang = a / 10 * Math.PI * 2; if (a === 7) continue; b.box(1.6, 0.9, 0.6, M.sandbag, POST.x + Math.cos(ang) * 4.2, py, POST.z + Math.sin(ang) * 4.2, { rotY: -ang + Math.PI / 2 }); }
  b.box(1.1, 1.2, 0.9, steel, POST.x, py, POST.z);                                         // the predictor
  b.box(4, 0.18, 0.18, steel, POST.x, py + 1.6, POST.z - 1.4, { solid: false });          // the rangefinder's arms
  b.box(0.2, 1.6, 0.2, steel, POST.x, py, POST.z - 1.4, { solid: false });

  // ---- the ammunition bunker: concrete, earth over it; a big explosion if it goes ----
  const ay = heightAt(AMMO.x, AMMO.z);
  b.box(10, 2.8, 6, concrete, AMMO.x, ay, AMMO.z);
  b.box(12, 1.2, 8, M.earth, AMMO.x, ay + 2.8, AMMO.z, { solid: false });
  const ammoDoor = b.box(1.4, 2.2, 0.3, steel, AMMO.x, ay, AMMO.z + 3.1);
  hotspotDefs.push({ kind: 'ammo', title: 'AMMUNITION BUNKER', explosive: true, armored: true, hitsToExplode: 3, meshes: [ammoDoor], parts: [ammoDoor],
    blast: { radius: 14, hurt: 24, size: 3.2, burn: true, heavy: true, label: 'THE AMMUNITION BUNKER GOES UP' } });

  // ---- the ruined farmhouse below the line (where the tunnel starts) ----
  const fy = heightAt(FARM.x, FARM.z);
  const farm = building(b, { x: FARM.x, z: FARM.z, y: fy, w: 11, d: 8, floors: 1, h: 3.2, mat: M.stone, roof: 'flat',
    openings: [{ side: 'n', at: -2, w: 1.2, door: true }, { side: 's', at: 2, w: 1.1, door: true }, { side: 'e', at: 0, w: 1.0, window: true }, { side: 'w', at: 1, w: 1.0, window: true }] });
  doors.push(...farm.doors);
  furniture.table(b, FARM.x + 2, fy, FARM.z - 1, 1.6, 0.9);
  farm.docs = { note: new THREE.Vector3(FARM.x + 2, fy + 0.79, FARM.z - 1) };

  // The searchlight on the crest, behind the guns; an observation tower over the line.
  place(propModel('searchlight', { y: 2.6 }), -30, heightAt(-30, -95), -95, 2.6);
  place(propModel('searchlight', { y: 2.6 }), 40, heightAt(40, -98), -98, 3.6);

  // The alarm siren on a pole by the command post.
  const [sx, sz] = [POST.x - 12, POST.z + 8], sy = heightAt(sx, sz);
  b.box(0.2, 5.2, 0.2, M.wood, sx, sy, sz);
  const junction = b.box(0.36, 0.46, 0.2, M.metal, sx, sy + 1.0, sz + 0.2, { solid: false });
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.12, 0.55, 14, 1, true).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a8d84, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
  horn.position.set(sx + 0.25, sy + 5.0, sz);
  const hornBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.35, 12).rotateZ(Math.PI / 2), M.metal);
  hornBody.position.set(sx - 0.05, sy + 5.0, sz);
  const sirenWire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.8, 5), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }));
  sirenWire.position.set(sx + 0.12, sy + 3.1, sz + 0.12);
  for (const m of [horn, hornBody, sirenWire]) { m.castShadow = true; b.group.add(m); }
  const siren = { pos: new THREE.Vector3(sx, sy, sz), junction: junction.position.clone(), horn: horn.position.clone(), hornMeshes: [horn, hornBody], wire: sirenWire, standAt: new THREE.Vector3(sx, sy, sz + 0.9) };

  // ---- the garrison ----
  add(POST.x + 1.5, POST.z - 2, Math.PI, { officer: true, name: 'Hauptmann', look: 'officerLieutenant' });
  add(POST.x - 2, POST.z + 1, Math.PI, { name: 'Battery officer', stance: 'alert', look: 'guardSergeant' });
  for (const g of guns) {
    add(g.x + 2.5, g.z + 2.5, Math.PI, { name: 'Gun crew', look: 'guardLuftwaffe' });
    if (g.i % 2 === 0) add(g.x - 2.5, g.z + 1.5, Math.PI * 0.8, { name: 'Gun crew', look: 'guardLuftwaffe' });
  }
  add(AMMO.x + 3, AMMO.z + 5, 0, { name: 'Ammunition guard', stance: 'alert' });
  add(-80, -10, 0, { name: 'Battery sentry', look: 'guardCamo' });
  add(...FIRE[0], 0, { name: 'Trench sentry' });
  add(...FIRE[6], 0, { name: 'East trench sentry', look: 'guardCamo' });
  add(...COMM[0][0], 0, { name: 'Runner' });
  add(-200, 140, Math.PI / 2, { name: 'Wire patrol', look: 'guardCamo' });
  for (const g of dug.slice(0, 3)) add(g.entrance.x, g.entrance.z, Math.PI, { y: g.floor, name: 'Trench guard', stance: 'alert' });
  add(dug[3].inside.x, dug[3].inside.z, 0, { y: dug[3].floor, name: 'Off-duty gunner' });
  add(command.inside.x + 1, command.inside.z, Math.PI / 2, { y: command.floor, name: 'Signaller' });

  const dressed = dressProps(scene, dressing(), heightAt, b.boxes, vehicleModel);
  b.solids.push(...dressed.solids); b.boxes.push(...dressed.boxes);

  return {
    solids: b.solids, boxes: b.boxes, soldiers, ladders, doors, towerTops, siren,
    generator: null, generatorMesh: null,
    spawn: new THREE.Vector3(START.x, heightAt(START.x, START.z), START.z),
    hotspotDefs, guns, command, farm, dug,
  };
}

// Set dressing: the wire belts, MG nests in the trench, the battery's vehicles and stores.
function dressing() {
  const wire = [];
  for (const [i, z] of WIRE_Z.entries()) for (let x = -215 + i * 2.5; x < 215; x += 5.2) wire.push(['wire', x, z + Math.sin(x * 0.07) * 1.5, 0]);
  return [
    ...wire,
    ['mgNest', -40, 116, 0], ['mgNest', 140, 118, 0], ['mgNest', -180, 112, 0],
    ['truck', -40, -110, Math.PI / 2], ['halftrack', 60, -115, -Math.PI / 2], ['motorcycle', 20, 5, 0.6],
    ['supplies', -20, -100, 0.4], ['supplies', 30, -102, -0.2], ['drums', -45, -105, 0], ['tent', 85, 20, 0.3], ['tent', 100, 0, 1.2],
    ['kitchen', 70, 35, 0.6], ['generator', -25, 8, 0], ['sandbags', -90, 60, 0], ['sandbags', 110, 55, 0.5],
    ['rock', START.x + 18, START.z - 6, 1], ['rock', START.x - 20, START.z + 4, 2], ['rock', 200, 200, 0.4], ['rock', -230, 40, 1.4],
  ];
}

// ---- what's to be found ----
function layout({ world, on }) {
  const sp = world.spawn, dug = world.site?.dug ?? [];
  const boxes = [
    { kind: 'parts', where: 'the farmhouse', at: on(FARM.x - 3, FARM.z + 1) },
    { kind: 'parts', where: 'a dugout in the fire trench', at: dug[0] ? dug[0].inside.clone().setY(dug[0].floor + 0.05) : on(-128, 102) },
    { kind: 'parts', where: 'by the east 2 cm gun', at: on(124, -40) },
    { kind: 'parts', where: 'the crew dugout', at: dug[3] ? dug[3].inside.clone().setY(dug[3].floor + 0.05) : on(-63, 10) },
    { kind: 'weapon', weapon: 'mg42', where: 'the west MG nest', at: on(-42, 114) },
    { kind: 'weapon', weapon: 'panzerfaust', where: 'behind the ammunition bunker', at: on(AMMO.x - 7, AMMO.z - 4) },
  ];
  for (const [type, x, z] of [
    ['ammo', -150, 205], ['medical', -146, 222], ['explosives', 20, -100], ['explosives', -110, 95], ['ammo', 160, 98], ['heavy', 60, -110],
    ['ammo', sp.x + 3, sp.z + 2], ['medical', sp.x - 3, sp.z + 3], ['bottles', 72, 32], ['ammo', -50, 0],
  ]) boxes.push({ kind: 'supply', type, where: type, at: on(x, z) });
  const benches = [{ where: 'the start', at: on(sp.x + 2, sp.z - 3) }, { where: 'the farmhouse', at: on(FARM.x - 3, FARM.z - 2) }];
  return { boxes, benches };
}

// ---- documents, the safe, the objectives ----
const SAFE = { id: 'flak-safe', name: 'THE COMMAND DUGOUT SAFE', combination: '08 – 08 – 36' };

function intel(it, world, { pickups, arsenal, mission, scene, player, audio, hud }) {
  const { command, farm, dug } = world.site;
  it.addSafe({ ...SAFE, at: command.inside.clone().add(new THREE.Vector3(-1.6, 0, -1.0)), yaw: 0, objective: 'safe', objectiveText: 'THE FIRE PLAN TAKEN',
    docs: [{ id: 'flak-fireplan', title: 'Fire plan, schwere Flakabteilung 525',
      text: 'The barrage boxes over the ridge and the junction, the heights to fuse for, the warning chain from the observers on Monte Castello, and the battery\'s alternate positions if it must move.' }],
    contents: () => { const got = []; const part = pickups?.givePart?.(); if (part) got.push(`part: ${part.name}`); if (arsenal) { arsenal.weapons.rifle.ammo.ap += 6; got.push('+6 AP rounds'); } return got; } });
  it.addDocument({ id: 'flak-note', title: 'A note in the farmhouse', at: farm.docs.note,
    text: 'The old drain from the cellar runs under the wire and comes up behind their trench, by the west communication trench. The hatch is in the shell-hole behind the house. Wire cutters: try their stores. — Marco' });
  it.addDocument({ id: 'flak-orders', title: 'Battery standing orders', at: command.table,
    text: 'Guns to be ready by 07:00 for the bomber stream. Breech covers on when not firing. The ammunition bunker door to be kept shut and guarded. Nobody uses the tunnel from the bunker except on the Hauptmann\'s order.' });
  if (dug[0]) it.addDocument({ id: 'flak-letter', title: 'A letter, half written', at: dug[0].table,
    text: `Liebe Mutti, the Hauptmann keeps his safe numbers on a card in his tunic — ${SAFE.combination.split(' – ')[0]}, something, something, he jokes they are the gun's own numbers. Yesterday we got three of them.` });
  mission.papersDoc = { id: 'flak-papers', title: "The Hauptmann's papers", reveals: SAFE.id,
    text: `Soldbuch of Hauptmann K. Weidner, schwere Flak-Abteilung 525. A card in the cover: ${SAFE.combination}.` };
  mission.documentsTotal = 4;
  // The tunnels: from behind the farmhouse under the wire to behind the trench line; and from the
  // ammunition bunker out to the woods east.
  world.tunnels = new Tunnels({ scene, world, player, interactions: it, audio, hud, pairs: [
    [{ x: FARM.x + 3, z: FARM.z - 10 }, { x: -82, z: 70 }],
    [{ x: AMMO.x - 7, z: AMMO.z + 1 }, { x: WOODS.x, z: WOODS.z }],
  ] });
}

const def = {
  target: 'Hauptmann Weidner',
  targetArea: { x: POST.x, z: POST.z },
  extraction: START,
  killText: 'WEIDNER IS DEAD',
  extractText: 'THE RIDGE IS SILENT · GET BACK DOWN TO THE VALLEY',
  papersText: "WEIDNER'S PAPERS TAKEN",
  objectives: [
    { id: 'guns', text: 'Destroy the four 8.8 cm guns (AP rounds at a breech, or a charge)' },
    { id: 'safe', text: 'Take the fire plan from the command dugout safe' },
    { id: 'officer', text: 'Eliminate Hauptmann Weidner, the battery commander', optional: true },
    { id: 'ammo', text: 'Blow up the ammunition bunker', optional: true },
    { id: 'papers', text: "Take Weidner's papers", optional: true },
    { id: 'extract', text: 'Get back down to the valley', hidden: true },
  ],
  tick(m) {
    const hs = m.world.hotspots, site = m.world.site;
    const left = hs.filter(h => h.kind === 'flak' && !h.exploded).length;
    if (left === 0) m.complete('guns', 'ALL FOUR GUNS DESTROYED');
    else if (site.gunsLeft !== undefined && left < site.gunsLeft) m.hud.message(`8.8 CM GUN DESTROYED · ${left} LEFT`, '');
    site.gunsLeft = left;
    if (hs.some(h => h.kind === 'ammo' && h.exploded)) m.complete('ammo', 'THE AMMUNITION BUNKER IS GONE');
  },
  markers(m) {
    const out = [];
    if (!m.obj('guns').done) for (const g of m.world.site.guns) if (!m.world.hotspots.find(h => h.meshes[0] === g.breech)?.exploded) out.push({ pos: new THREE.Vector3(g.x, g.y + 5, g.z), kind: 'tank', label: '88', height: 1 });
    return out;
  },
};

const briefing = `
  <p class="brief">The bombers going for the rail junction in the Po valley have to cross this ridge, and the 8.8 cm battery on
    it has been shooting them down. The raid goes in tomorrow. You come up from the valley in the south.</p>
  <ul class="goals">
    <li><b>Destroy the four 8.8 cm guns</b> on the crest. They're armoured: two armour-piercing rounds at the breech, or a charge.</li>
    <li><b>Take the fire plan</b> from the safe in the command dugout behind the guns (the combination is written down somewhere,
      and the battery commander, Hauptmann Weidner, carries it).</li>
    <li><b>Optional:</b> eliminate Weidner; blow up the ammunition bunker; take his papers.</li>
    <li><b>Then</b> get back down to the valley.</li>
  </ul>
  <p class="brief">Below the guns a trench line runs along the slope, with two belts of barbed wire in front: cut a way through
    (wire cutters make it quick and quiet: look in their stores), or find the old drain under it the partisans talk about.</p>`;

export default { id: 'flak', props: ['flak88', 'flak', 'searchlight', 'mgNest', 'wire', 'sandbags', 'supplies', 'drums', 'tent', 'kitchen', 'generator', 'truck', 'halftrack', 'motorcycle', 'rock'],
  subtitle: 'Operation Flak Line · Apennine foothills, 1944', map, site, def, intel, briefing };
