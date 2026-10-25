// Taking supplies (from a body or a cache) up to what you can carry. Shared by searching
// bodies and opening supply caches. Returns what you took, as short labels.
import { CATALOG, HEAVY_AMMO } from '../weapons/defs.js';
export const MAX_RESERVE = { rifle: 40, pistol: 32 };
export const MAX_SPECIAL = { subsonic: 20, ap: 12 };
export const MAX_KIT = { grenade: 4, bottle: 5, mine: 4, tnt: 3, satchel: 3, bandage: 5, medkit: 2 };

// loot: { rifle, pistol, special: { subsonic, ap }, heavy: { trenchgun, mg42, … }, kit: { grenade, bandage, … } }
export function takeSupplies({ arsenal, items }, loot) {
  const got = [];
  for (const kind of ['rifle', 'pistol']) {
    if (!loot[kind]) continue;
    const w = arsenal.weapons[kind];
    // Rifle rounds are standard ones, whatever you have loaded.
    const have = kind === 'rifle' ? w.ammo.standard : w.reserve;
    const take = Math.max(0, Math.min(loot[kind], MAX_RESERVE[kind] - have));
    if (kind === 'rifle') w.ammo.standard += take; else w.reserve += take;
    if (take > 0) got.push(`+${take} ${kind} rounds`);
  }
  for (const [type, k] of Object.entries(loot.special ?? {})) {
    const ammo = arsenal.weapons.rifle.ammo, take = Math.max(0, Math.min(k, MAX_SPECIAL[type] - ammo[type]));
    if (take) { ammo[type] += take; got.push(`+${take} ${type === 'ap' ? 'AP' : 'subsonic'} rounds`); }
  }
  // Heavy ammunition: only for heavy weapons you have (shells, belts, rockets…).
  for (const [id, k] of Object.entries(loot.heavy ?? {})) {
    if (!arsenal.heavyOwned?.(id)) continue;
    const pool = arsenal.heavyAmmo, take = Math.max(0, Math.min(k, HEAVY_AMMO[id].max - pool[id]));
    if (take) { pool[id] += take; got.push(`+${take} ${take === 1 ? CATALOG[id].ammoName.replace(/s$/, '') : CATALOG[id].ammoName}`); }
  }
  for (const [id, k] of Object.entries(loot.kit ?? {})) {
    if (!items) break;
    const take = Math.max(0, Math.min(k, MAX_KIT[id] - items.count[id]));
    if (take) { items.count[id] += take; got.push(`+${take} ${take > 1 ? plural(id) : id}`); }
  }
  return got;
}

const plural = (id) => ({ tnt: 'TNT', medkit: 'medkits', satchel: 'satchels', bottle: 'bottles', bandage: 'bandages', grenade: 'grenades', mine: 'mines' }[id] ?? id);
