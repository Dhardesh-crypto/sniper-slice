// Your profile: what you've collected across missions (weapon parts, rare weapons) and the
// loadout you last chose. Kept in the browser, separate from mission saves: a part you pick
// up is yours from that moment, whether you finish the mission, restart it or die.
import { CATALOG, PARTS, STARTING_WEAPONS } from '../weapons/defs.js';
import { usePerks } from './perks.js';

// Mastery: kills with one weapon at which it earns you a part for its kind (rifle or pistol) that
// you haven't found yet. Use a weapon and it gets better, without a toolbox.
export const MASTERY = [10, 25, 50];

const KEY = 'sniper-slice.profile';
const VERSION = 1;

function fresh() {
  return {
    version: VERSION,
    weapons: Object.fromEntries(STARTING_WEAPONS.map(id => [id, true])),
    parts: {},
    loadout: { rifle: 'springfield', pistol: 'welrod', heavy: null, fit: {} },   // fit: weaponId → { slot: partId }; heavy: none until you find one
  };
}

export class Profile {
  constructor() {
    this.data = fresh();
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d?.version === VERSION) this.data = { ...fresh(), ...d, weapons: { ...fresh().weapons, ...d.weapons } };
    } catch { /* storage blocked or corrupt: start fresh */ }
    usePerks(this.data.perks);
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage blocked: kept for this session */ }
  }

  // The test armoury (a setting): every weapon and part counts as yours, without touching what
  // you've really collected. Switching it off puts back anything you don't own.
  get testAll() { return !!this.data.testAll; }
  setTestAll(on) {
    this.data.testAll = on;
    if (!on) {
      const lo = this.data.loadout;
      for (const slot of ['rifle', 'pistol', 'heavy']) if (lo[slot] && !this.ownsWeapon(lo[slot])) lo[slot] = fresh().loadout[slot];
      for (const [weaponId, fit] of Object.entries(lo.fit)) {
        for (const [slot, partId] of Object.entries(fit)) {
          const part = PARTS[CATALOG[weaponId]?.slot]?.[slot]?.find(p => p.id === partId);
          if (!part || !this.ownsPart(part)) delete fit[slot];
        }
      }
    }
    this.save();
  }

  ownsWeapon(id) { return this.testAll || !!this.data.weapons[id]; }
  ownsPart(part) { return part.stock || this.testAll || !!this.data.parts[part.id]; }

  addWeapon(id) { if (this.data.weapons[id]) return false; this.data.weapons[id] = true; this.save(); return true; }
  addPart(id) { if (this.data.parts[id]) return false; this.data.parts[id] = true; this.save(); return true; }

  // Parts you don't have yet (what a toolbox can still give you).
  missingParts() {
    return Object.values(PARTS).flatMap(slots => Object.values(slots).flat()).filter(p => !p.stock && !this.data.parts[p.id]);
  }

  weaponsFor(slot) { return Object.values(CATALOG).filter(w => w.slot === slot); }

  fitOf(weaponId) { return { ...(this.data.loadout.fit[weaponId] ?? {}) }; }

  setWeapon(slot, id) { if (this.ownsWeapon(id)) { this.data.loadout[slot] = id; this.save(); } }
  setPart(weaponId, slot, partId) {
    (this.data.loadout.fit[weaponId] ??= {})[slot] = partId;
    this.save();
  }

  // Training (mission/tutorial.js): done or skipped, and the first-time hints already shown.
  tutorialDone() { return !!this.data.tutorial?.done; }
  setTutorialDone(on) { (this.data.tutorial ??= { seen: [] }).done = on; this.save(); }
  hintSeen(id) { return !!this.data.tutorial?.seen?.includes(id); }
  markHint(id) { const t = this.data.tutorial ??= { seen: [] }; (t.seen ??= []).push(id); this.save(); }
  resetHints() { if (this.data.tutorial) this.data.tutorial.seen = []; this.save(); }

  // The campaign: missions finished (each unlocks the next) and documents found in each.
  completed(id) { return !!this.data.done?.[id]; }
  completeMission(id) { (this.data.done ??= {})[id] = true; this.save(); }
  unlocked(campaign, id) {
    const i = campaign.findIndex(m => m.id === id);
    return this.testAll || i === 0 || this.completed(campaign[i - 1]?.id);
  }
  addIntel(missionId, docId) {
    const list = (this.data.intel ??= {})[missionId] ??= [];
    if (!list.includes(docId)) { list.push(docId); this.save(); }
  }
  intel(missionId) { return this.data.intel?.[missionId] ?? []; }

  // Challenges met in each mission (mission/challenges.js), and what you tend to do (mission/garrison.js).
  challenges(missionId) { return this.data.challenges?.[missionId] ?? []; }
  addChallenge(missionId, id) {
    const list = (this.data.challenges ??= {})[missionId] ??= [];
    if (list.includes(id)) return false;
    list.push(id); this.save();
    return true;
  }
  get challengeCount() { return Object.values(this.data.challenges ?? {}).reduce((n, l) => n + l.length, 0); }
  get habits() { return this.data.habits ?? {}; }
  setHabits(h) { this.data.habits = h; this.save(); }

  // What you've learnt for good (core/perks.js: one hidden on each mission's map).
  hasPerk(id) { return !!this.data.perks?.[id]; }
  addPerk(id) {
    if (this.hasPerk(id)) return false;
    (this.data.perks ??= {})[id] = true;
    usePerks(this.data.perks); this.save();
    return true;
  }

  // Kills with each weapon. Returns what the kill earned, if it reached a mastery step:
  // { kills, part } (part: the one unlocked, or null if you already have them all).
  kills(weaponId) { return this.data.mastery?.[weaponId] ?? 0; }
  addKill(weaponId) {
    if (!CATALOG[weaponId]) return null;
    const n = ((this.data.mastery ??= {})[weaponId] = this.kills(weaponId) + 1);
    let earned = null;
    if (MASTERY.includes(n)) {
      const mine = Object.values(PARTS[CATALOG[weaponId].slot] ?? {}).flat().filter(p => !p.stock && !this.data.parts[p.id]);
      const part = mine[0] ?? null;
      if (part) this.data.parts[part.id] = true;
      earned = { kills: n, part };
    }
    this.save();
    return earned;
  }

  get loadout() { return this.data.loadout; }
}
