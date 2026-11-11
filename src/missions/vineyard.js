// Operation Vineyard: the farm compound in the Tuscan hills (the first mission). The map and
// the site are the original ones (terrain.js, compound.js); this adds what's to be found in the
// Oberst's villa: four documents (one gives the safe's combination; the Oberst carries it too)
// and his office safe with his orders.
import { VINEYARD_MAP, heightAt, roadCenterZ } from '../world/terrain.js';
import { dressProps } from '../world/props.js';
import { vehicleModel } from '../world/vehicle-models.js';
import { buildCompound, buildRange } from '../world/compound.js';
import { Builder } from '../world/kit.js';
import { shellHouse } from '../world/ruins.js';
import { compose, plateau, terraces, lakeBasin, sunkenLane, roadBed } from '../world/landforms.js';
import { buildCover } from '../world/cover.js';

// The country round the farm, made from the terrain kit (world/landforms.js) on the valley as it
// was; nothing under the compound, the road, the range or your hill has moved:
//   a knoll due north of the compound with an old windmill on it (a ladder inside to a loft with a
//   window that looks straight down on the yard, 190 m off: the long shot);
//   olive terraces on the north-west slope, with a ruined farmstead at their edge (a second perch);
//   a sunken lane from below your hill toward the compound's south-west corner (a covered way in);
//   the farm's pond in the south-east field.
const MILL = { x: 20, z: -220 }, POND = { x: 122, z: 150, r: 20 }, FARM = { x: -152, z: -122 };
const LANE = [[-190, 126], [-150, 86], [-110, 62], [-72, 52]];
const TRACKS = [
  { id: 'mill', kind: 'path', path: [[22, -108], [16, -160], [20, -212]] },
  { id: 'pond', kind: 'track', path: [[62, 62], [92, 108], [104, 136]] },
  { id: 'farm', kind: 'path', path: [[-120, -62], [-140, -92], [-150, -112]] },
];
const land0 = VINEYARD_MAP.heightAt;
const land = compose(land0, [
  plateau({ area: { ...MILL, r: 14, blend: 46, wobble: 6 }, level: land0(MILL.x, MILL.z) + 7, rough: 0.3 }),
  terraces({ area: { x: -235, z: -150, r: 95, blend: 28, wobble: 12 }, step: 2.6, riser: 0.22 }),
  lakeBasin({ ...POND, level: land0(POND.x, POND.z) - 0.8, depth: 1.7, shore: 14, wobble: 0.25, seed: 4 }),
  sunkenLane({ path: LANE, width: 3.2, depth: 1.7, banks: 2.4 }),
  ...TRACKS.map(t => roadBed({ path: t.path, width: 2.5, shoulder: 3 })),
]);
export const VINEYARD_SAFE = { id: 'oberst-safe', name: "THE OBERST'S SAFE", combination: '18 – 04 – 37' };

export function placeVineyardIntel(it, world, { pickups, items, arsenal, mission }) {
  const v = world.villa;
  if (!v) return;
  const orders = {
    id: 'vineyard-orders', title: 'Secret orders: Operation Weinlese',
    text: 'To Oberst Krause, Commander, Vineyard Post.\n\nThe fuel and ammunition held at your post are to be ready for the 14th Panzer Regiment by the end of the month. ' +
      'Hold the road to the coast open at all costs. Partisan activity in the valley is to be answered with reprisals.\n\nAttached: the route of the column through the valley, ' +
      'its timings, and the call signs of the escort.\n\n— Generalmajor v. Albrecht',
  };
  it.addSafe({
    ...VINEYARD_SAFE, at: v.safe.at, yaw: v.safe.yaw, docs: [orders], objective: 'safe', objectiveText: "THE OBERST'S ORDERS TAKEN",
    contents: () => {
      const got = [];
      const part = pickups?.givePart?.();
      if (part) got.push(`part: ${part.name}`);
      if (items) { items.count.medkit = Math.min(2, items.count.medkit + 1); got.push('a medkit'); }
      if (arsenal) { arsenal.weapons.pistol.reserve += 8; got.push('+8 pistol rounds'); }
      return got;
    },
  });
  it.addDocument({
    id: 'vineyard-combination', title: 'A note in the bedside drawer', at: v.docs.bedside, reveals: VINEYARD_SAFE.id,
    text: `My memory is not what it was.\n\nOffice: ${VINEYARD_SAFE.combination}\n\nBurn this after reading. — K.`,
  });
  it.addDocument({
    id: 'vineyard-requisition', title: 'Requisition order', at: v.docs.desk,
    text: 'Requisitioned from the Bellini estate: 2,000 litres of wine, 40 kg of olive oil, the mule cart and the farm truck. ' +
      'The family has been moved to the stables.\n\nThe Oberst asks that the 1938 vintage be kept aside for the General\'s visit.',
  });
  it.addDocument({
    id: 'vineyard-letter', title: 'A letter home, unfinished', at: v.docs.dining,
    text: 'Dearest Liesl,\n\nThe Oberst has us digging again. They say there is an English sniper in the hills: two of the gun crew were shot ' +
      'at the river last week and nobody heard a thing. The men won\'t stand by the windows any more.\n\nThe grapes are nearly ready. You would like it here, ',
  });
  it.addDocument({
    id: 'vineyard-signals', title: 'Radio log', at: v.docs.radio,
    text: '06:00  ROSE to VINEYARD: column delayed 24 hours.\n09:30  VINEYARD to ROSE: requesting two more men for the towers.\n' +
      '14:15  ROSE to VINEYARD: denied. Use the siren. Reinforcements by truck from the coast road if needed: 12 minutes.',
  });
  // The Oberst's own papers (from his body) also hold the combination.
  mission.papersDoc = {
    id: 'vineyard-papers', title: "The Oberst's papers", reveals: VINEYARD_SAFE.id,
    text: `Pay book, a photograph of a woman and two children, a pass for the coast road signed by the General.\n\nFolded inside the pay book, in pencil: ${VINEYARD_SAFE.combination}.`,
  };
  mission.documentsTotal = 6;
}

// Set dressing: a sentry box, sandbags and a motorcycle at the west gate, vehicles parked outside,
// haystacks and a cart in the fields, a well and a field kitchen in the yard, a gun on the east
// side, telegraph poles and a signpost along the road.
function dressing() {
  const poles = [-30, -70, -110, -150, -190, -230].map(x => ['pole', x, roadCenterZ(x) + 7]);
  return [
    ...poles, ['signpost', -20, roadCenterZ(-20) + 5, 0.3],
    ['sentryBox', -19, -40, Math.PI / 2], ['sandbags', -18.5, -20, Math.PI / 2], ['motorcycle', -22, -24, 0.4],
    ['truck', -35, -18, Math.PI / 2], ['halftrack', -36, -31, Math.PI / 2], ['mgNest', -21, -46],
    ['haystack', 65, 20], ['haystack', 72, 30], ['haystack', 60, 46], ['cart', 55, 10, 0.5],
    ['barrels', -5, -33, 0], ['well', 32, -12], ['kitchen', 42, -51, 0], ['supplies', -6, -9],
    ['pak40', 58, -30, Math.PI],
    ['horseCart', 70, 8, 0.6], ['rock', -60, 62, 0.3], ['rock', 120, -85, 1], ['rock', -150, -60, 2], ['rock', 150, 95, 0.5], ['rock', -95, 130, 1.4],
  ];
}

export default {
  looks: ['guardCamo', 'guardItalian', 'guardSergeant', 'officerLieutenant'],   // the characters this mission dresses its men in: loaded for it alone (main.js); keep in step with every `look:` in world/compound.js (tools/smoke.mjs reports one that's missing)
  id: 'vineyard',
  props: ['ruinKit', 'generator', 'vineRow', 'rock', 'wreckPanzer', 'wreckHalftrack', 'sentryBox', 'sandbags', 'motorcycle', 'halftrack', 'mgNest', 'haystack', 'cart', 'barrels', 'well', 'kitchen', 'supplies', 'pak40', 'pole', 'signpost', 'horseCart'],
  subtitle: 'Operation Vineyard · Tuscany, 1944',
  map: {
    damage: { pads: [[62, -8, 7, 6]], craters: [[20, -75, 5], [31, -84, 4], [8, -83, 3.5]] },   // the ground the war left (terrain.js)
    wallStyle: 'tuscany',               // its walls' photographs (public/textures/styles/)
    ...VINEYARD_MAP,
    heightAt: land,
    waters: land.waters,               // the pond (world/waters.js): deep in the middle, its edge stops you
    roads: TRACKS,                     // paths to the mill, the pond and the farmstead (the road itself is roadCenterZ)
    // Built cover (world/cover.js): the field walls of a Tuscan farm, crates, the windmill on its
    // knoll and the ruined farmstead, each with a ladder up; tall grass where the lane ends.
    cover: {
      walls: [[[48, 62], [108, 72], [132, 12]], [[-58, -64], [-140, -60], [-222, -68]], [[-24, 84], [38, 98], [92, 88]], [[-14, -188], [52, -198]], [[-196, -96], [-168, -100], [-150, -140]], [[150, -60], [176, -8], [170, 50]]],
      crates: [[27, -212, 3], [150, 62, 3], [-146, -112, 3]],
      ruins: [{ ...FARM, w: 9, d: 6.5, h: 5.4, seed: 43, tint: '#d9c09a', fallen: 0, doors: ['e'], breach: 'n' }],
      windmills: [{ ...MILL }],
      grass: [{ x: -66, z: 56, r: 9 }, { x: 60, z: -150, r: 9 }, { x: -110, z: -100, r: 9 }, { x: 150, z: 110, r: 9 }],
    },
    // Late morning in Tuscany: high, warm sun through a light haze.
    light: { zenith: 50, azimuth: 200, sun: 0xffe4b8, sunIntensity: 2.8, turbidity: 6, clouds: 0.4, warmth: 1.45, saturation: 1.12 },   // (grade: Tuscany: the warmest, fullest)
    fog: { color: 0xb6c6cd },   // the haze takes the colour of this sky low on the horizon (and so does the far country's)
    animals: [['cow', 95, 40, 18, 4], ['horse', 80, -2, 8, 1]],   // a few cows in the east field, the farm's horse
  },
  // The compound and the firing range by the start hill.
  site(scene) {
    const c = buildCompound(scene), r = buildRange(scene), w = new Builder(scene);
    // The farm's old byre, east of the wall: a shell found it when the front came through.
    shellHouse(w, { x: 62, z: -8, y: heightAt(62, -8), w: 9, d: 7, h: 5.2, seed: 21, tint: '#dcc397', fallen: 1, doors: ['s'], breach: 'w' });
    const cov = buildCover(w);          // the walls, crates, mill and farmstead of the map's `cover`, and the ladders up them
    const boxes = [...c.boxes, ...r.boxes, ...w.boxes], d = dressProps(scene, dressing(), heightAt, boxes, vehicleModel);
    return { ...c, soldiers: [...c.soldiers, ...r.targets], solids: [...c.solids, ...r.solids, ...w.solids, ...d.solids], boxes: [...boxes, ...d.boxes], ladders: [...(c.ladders ?? []), ...cov.ladders], spawn: r.spawn };
  },
  def: { evening: { at: 420 } },            // the original objectives (see mission.js); evening falls seven minutes in (main.js nightfall)
  intel: placeVineyardIntel,
};
