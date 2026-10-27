// Operation Vineyard: the farm compound in the Tuscan hills (the first mission). The map and
// the site are the original ones (terrain.js, compound.js); this adds what's to be found in the
// Oberst's villa: four documents (one gives the safe's combination; the Oberst carries it too)
// and his office safe with his orders.
import { VINEYARD_MAP, heightAt, roadCenterZ } from '../world/terrain.js';
import { dressProps } from '../world/props.js';
import { vehicleModel } from '../world/vehicle-models.js';
import { buildCompound, buildRange } from '../world/compound.js';
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
  id: 'vineyard',
  props: ['generator', 'watchtower', 'vineRow', 'rock', 'wreckPanzer', 'wreckHalftrack', 'sentryBox', 'sandbags', 'motorcycle', 'halftrack', 'mgNest', 'haystack', 'cart', 'barrels', 'well', 'kitchen', 'supplies', 'pak40', 'pole', 'signpost', 'horseCart'],
  subtitle: 'Operation Vineyard · Tuscany, 1944',
  map: {
    ...VINEYARD_MAP,
    // Late morning in Tuscany: high, warm sun through a light haze.
    light: { zenith: 50, azimuth: 200, sun: 0xffe4b8, sunIntensity: 2.8, turbidity: 6, clouds: 0.4 },
    fog: { color: 0xb6c6cd },   // the haze takes the colour of this sky low on the horizon (and so does the far country's)
    animals: [['cow', 95, 40, 18, 4], ['horse', 80, -2, 8, 1]],   // a few cows in the east field, the farm's horse
  },
  // The compound and the firing range by the start hill.
  site(scene) {
    const c = buildCompound(scene), r = buildRange(scene);
    const boxes = [...c.boxes, ...r.boxes], d = dressProps(scene, dressing(), heightAt, boxes, vehicleModel);
    return { ...c, soldiers: [...c.soldiers, ...r.targets], solids: [...c.solids, ...r.solids, ...d.solids], boxes: [...boxes, ...d.boxes], spawn: r.spawn };
  },
  def: {},            // the original objectives (see mission.js)
  intel: placeVineyardIntel,
};
