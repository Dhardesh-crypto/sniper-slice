// Operation Vineyard: the farm compound in the Tuscan hills (the first mission). The map and
// the site are the original ones (terrain.js, compound.js); this adds what's to be found in the
// Oberst's villa: four documents (one gives the safe's combination; the Oberst carries it too)
// and his office safe with his orders.
import { VINEYARD_MAP } from '../world/terrain.js';
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

export default {
  id: 'vineyard',
  props: ['generator', 'watchtower'],
  subtitle: 'Operation Vineyard · Tuscany, 1944',
  map: VINEYARD_MAP,
  // The compound and the firing range by the start hill.
  site(scene) {
    const c = buildCompound(scene), r = buildRange(scene);
    return { ...c, soldiers: [...c.soldiers, ...r.targets], solids: [...c.solids, ...r.solids], boxes: [...c.boxes, ...r.boxes], spawn: r.spawn };
  },
  def: {},            // the original objectives (see mission.js)
  intel: placeVineyardIntel,
};
