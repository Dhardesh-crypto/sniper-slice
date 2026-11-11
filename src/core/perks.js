// What you keep for good from the missions: one find hidden on each map (a partisan's cache, away
// from the guards and in cover: world/pickups.js sets it down) that teaches you something, from
// then on in every mission. Small edges, the kind a careful player notices: none of them shoots
// for you. Owned ones live in the profile (core/profile.js: `perks`); the rest of the game asks
// `perk('softStep')` (true or false) or `perkK('softStep')` (its number, 1 when you haven't got it).
export const PERKS = {
  softStep: { mission: 'vineyard', name: 'Soft step', info: 'Your footsteps carry a fifth less far', k: 0.8 },
  steadyHands: { mission: 'town', name: 'Steady hands', info: 'The scope sways less', k: 0.85 },
  deepBreath: { mission: 'harbour', name: 'Deep breath', info: 'You hold your breath a third longer', k: 1.33 },
  quickCrawl: { mission: 'forest', name: 'Quick crawl', info: 'You crawl and crouch-walk a fifth faster', k: 1.2 },
  keenEye: { mission: 'flak', name: 'Keen eye', info: 'The binoculars tag in half the time', k: 0.5 },
  quickHands: { mission: 'railway', name: 'Quick hands', info: 'Boxes and crates open a third faster', k: 0.67 },
  sureFoot: { mission: 'bridge', name: 'Sure foot', info: 'Water slows you less', k: 0.6 },
  calmHeart: { mission: 'airfield', name: 'Calm heart', info: 'Your pulse settles faster after a run', k: 1.6 },
  sprinter: { mission: 'radar', name: 'Long legs', info: 'You sprint a tenth faster', k: 1.1 },
};

let owned = {};
// Called once the profile is read (main.js), and again whenever a perk is found.
export function usePerks(data) { owned = data ?? {}; }
export const perk = (id) => !!owned[id];
export const perkK = (id) => (owned[id] ? PERKS[id].k : 1);
// The perk hidden on a mission's map, or null (a mission that has none).
export const perkOf = (missionId) => Object.keys(PERKS).find(id => PERKS[id].mission === missionId) ?? null;
