// Weapon tuning. Distances in metres, times in seconds, angles in radians.
export const SIGHT_HEIGHT = 0.045; // bore sits this far below the line of sight

export const WEAPONS = {
  rifle: {
    id: 'rifle',
    name: 'Bolt-action rifle',
    muzzleVelocity: 850,
    drag: 5.5e-4,
    magazine: 5,
    reserve: 30,
    cycleTime: 1.4,      // working the bolt
    reloadTime: 2.6,
    hipSpread: 0.004,
    recoil: 0.085,
    noiseRadius: 400,
    zeros: [100, 150, 200, 250, 300, 350, 400, 450, 500],
    defaultZero: 1,
    scope: true,
    zoomFovs: [7.5, 3.5], // vertical FOV in degrees through the scope
    zoomNames: ['4×', '8×'],
    damage: { head: 999, torso: 160, pelvis: 120, arm: 45, leg: 55 },
  },
  pistol: {
    id: 'pistol',
    name: 'Suppressed pistol',
    muzzleVelocity: 260,
    drag: 2.0e-3,
    magazine: 8,
    reserve: 24,
    cycleTime: 0.35,
    reloadTime: 2.0,
    hipSpread: 0.006,
    recoil: 0.03,
    noiseRadius: 10,
    zeros: [25],
    defaultZero: 0,
    scope: false,
    zoomFovs: [45],
    zoomNames: ['Over the shoulder'],
    damage: { head: 999, torso: 70, pelvis: 60, arm: 30, leg: 35 },
  },
};

// The heavy slot (key 3): one of a shotgun, a machine gun or an anti-tank weapon, aimed over
// the shoulder like the pistol. Each catalog entry below fills in the rest.
WEAPONS.heavy = {
  id: 'heavy', name: 'Heavy weapon', muzzleVelocity: 400, drag: 2e-3, magazine: 1, reserve: 0,
  cycleTime: 0.8, reloadTime: 3, hipSpread: 0.012, recoil: 0.06, noiseRadius: 300,
  zeros: [50], defaultZero: 0, scope: false, zoomFovs: [40], zoomNames: ['Over the shoulder'],
  damage: { head: 999, torso: 100, pelvis: 80, arm: 40, leg: 45 },
};

// Rifle ammunition (X switches; a switch reloads the magazine with the new type).
//   subsonic: quiet (heard at 40 m, not 400 m) but slow, so it drops a lot more and hits softer
//   ap: armour-piercing: blows an engine in one hit and is the round that hurts the Panzer
export const AMMO = {
  standard: { name: 'Standard', short: 'STD', start: 30 },
  subsonic: { name: 'Subsonic', short: 'SUB', start: 10, velocityScale: 0.47, noiseScale: 0.1, damageScale: 0.85 },
  ap: { name: 'Armour-piercing', short: 'AP', start: 6, ap: true },
};

// ---- Weapons you can carry (the rifle slot and the pistol slot) and the parts that fit them.
// Base weapons; `model` names the 3D model, `semi` = semi-automatic (no bolt to work).
export const CATALOG = {
  springfield: { ...WEAPONS.rifle, id: 'springfield', slot: 'rifle', name: 'Springfield M1903', model: 'springfield', blurb: 'Accurate bolt-action, 5 rounds.' },
  enfield: { ...WEAPONS.rifle, id: 'enfield', slot: 'rifle', name: 'Lee-Enfield No.4', model: 'enfield', blurb: '10 rounds and a quick bolt; a little less reach.',
    muzzleVelocity: 800, magazine: 10, cycleTime: 1.0, reloadTime: 3.0, recoil: 0.08, swayScale: 1.05,
    damage: { head: 999, torso: 150, pelvis: 115, arm: 45, leg: 55 } },
  // Noise follows SE5's ratios (Kar98k 140, Gewehr 43 130, M1 Carbine lower) on this game's 400 m scale.
  g43: { ...WEAPONS.rifle, id: 'g43', slot: 'rifle', name: 'Gewehr 43', model: 'g43', semi: true, rare: true, blurb: 'Semi-automatic: fast follow-up shots, less steady.',
    muzzleVelocity: 780, magazine: 10, cycleTime: 0.35, reloadTime: 2.4, recoil: 0.11, noiseRadius: 370, hipSpread: 0.005, swayScale: 1.15,
    damage: { head: 999, torso: 140, pelvis: 110, arm: 40, leg: 50 } },
  m1carbine: { ...WEAPONS.rifle, id: 'm1carbine', slot: 'rifle', name: 'M1 Carbine', model: 'm1carbine', semi: true, rare: true,
    blurb: 'The quietest standard rifle, 15-round semi-automatic; short-ranged round.',
    muzzleVelocity: 600, drag: 7e-4, magazine: 15, cycleTime: 0.3, reloadTime: 2.2, recoil: 0.06, noiseRadius: 300, hipSpread: 0.0045, swayScale: 0.95,
    damage: { head: 999, torso: 110, pelvis: 90, arm: 35, leg: 40 } },
  delisle: { ...WEAPONS.rifle, id: 'delisle', slot: 'rifle', name: 'De Lisle Carbine', model: 'delisle', rare: true, integralSuppressor: true,
    blurb: 'Built-in silencer: practically silent. Slow, heavy round: short range, less power.',
    muzzleVelocity: 260, drag: 1.6e-3, magazine: 8, cycleTime: 1.2, reloadTime: 2.8, recoil: 0.05, noiseRadius: 20, swayScale: 0.95,
    zoomFovs: [7.5, 4.5], zoomNames: ['4×', '6×'], damage: { head: 999, torso: 120, pelvis: 95, arm: 40, leg: 45 } },
  welrod: { ...WEAPONS.pistol, id: 'welrod', slot: 'pistol', name: 'Welrod', model: 'welrod', blurb: 'Built-in silencer: almost silent.' },
  p38: { ...WEAPONS.pistol, id: 'p38', slot: 'pistol', name: 'Walther P38', model: 'p38', blurb: 'More stopping power, but loud unless suppressed.',
    muzzleVelocity: 350, magazine: 8, cycleTime: 0.25, noiseRadius: 120, damage: { head: 999, torso: 95, pelvis: 80, arm: 40, leg: 45 } },
  // The officer's pistol: steadier and a little faster than the P38, just as loud.
  luger: { ...WEAPONS.pistol, id: 'luger', slot: 'pistol', name: 'Luger P08', model: 'luger', rare: true, foundOn: 'Oberst Krause carries one: search his body',
    blurb: 'The officer\'s pistol: steadier and quicker than the P38, just as loud unless suppressed.',
    muzzleVelocity: 370, magazine: 8, cycleTime: 0.22, noiseRadius: 125, hipSpread: 0.0045,
    damage: { head: 999, torso: 95, pelvis: 80, arm: 40, leg: 45 } },
  // Heavy weapons, all found in crates around the map. pellets: a shotgun's shot (each pellet
  // its own bullet in a cone of `pelletSpread`); auto: fires while the trigger is held;
  // rocket: an anti-tank round (speed m/s, its own gravity, blast radius, and how many hits a
  // direct strike counts as on a vehicle: two wreck the Panzer, one any other vehicle).
  trenchgun: { ...WEAPONS.heavy, id: 'trenchgun', slot: 'heavy', name: 'M1897 Trench Gun', model: 'trenchgun', rare: true, ammoName: 'shells',
    foundOn: 'in a crate in the yard, near the barn', blurb: 'Pump-action shotgun: nine pellets, devastating up close, useless far off. Loud.',
    pellets: 9, pelletSpread: 0.025, muzzleVelocity: 400, drag: 3e-3, magazine: 5, cycleTime: 0.8, reloadTime: 3.0, recoil: 0.12, noiseRadius: 320, hipSpread: 0.006, aimSpread: 0.004,
    damage: { head: 110, torso: 34, pelvis: 28, arm: 18, leg: 18 } },
  mg42: { ...WEAPONS.heavy, id: 'mg42', slot: 'heavy', name: 'MG42', model: 'mg42', rare: true, ammoName: 'rounds',
    foundOn: 'in a crate by the north wall', blurb: 'Belt-fed machine gun: hold the trigger. 1,200 rounds a minute, wild from the hip, heard by everyone.',
    auto: true, muzzleVelocity: 740, drag: 6e-4, magazine: 50, cycleTime: 0.05, reloadTime: 3.5, recoil: 0.014, noiseRadius: 450, hipSpread: 0.022, aimSpread: 0.009,
    damage: { head: 999, torso: 70, pelvis: 55, arm: 30, leg: 35 } },
  panzerschreck: { ...WEAPONS.heavy, id: 'panzerschreck', slot: 'heavy', name: 'Panzerschreck', model: 'panzerschreck', rare: true, ammoName: 'rockets',
    foundOn: 'in a crate outside the south wall', blurb: 'Reusable rocket launcher: one rocket wrecks a vehicle, two the Panzer. Reload after every shot.',
    rocket: { speed: 105, gravity: 3.5, radius: 4.5, hits: 1 }, magazine: 1, cycleTime: 0.5, reloadTime: 3.2, recoil: 0.1, noiseRadius: 380, hipSpread: 0.006, aimSpread: 0.003 },
  panzerfaust: { ...WEAPONS.heavy, id: 'panzerfaust', slot: 'heavy', name: 'Panzerfaust', model: 'panzerfaust', rare: true, ammoName: 'Panzerfausts',
    foundOn: 'in a crate by the road west of the compound', blurb: 'Single-shot launcher: short range, but one hit kills even the Panzer. Each one you find is one shot.',
    rocket: { speed: 48, gravity: 6, radius: 5, hits: 2 }, magazine: 1, cycleTime: 0.5, reloadTime: 1.6, recoil: 0.1, noiseRadius: 350, hipSpread: 0.006, aimSpread: 0.003 },
  piat: { ...WEAPONS.heavy, id: 'piat', slot: 'heavy', name: 'PIAT', model: 'piat', rare: true, ammoName: 'PIAT bombs',
    foundOn: 'in a crate on the start hill', blurb: 'Spring-fired projector: much quieter than a rocket, a slow bomb on a high arc. One hit wrecks a vehicle, two the Panzer.',
    rocket: { speed: 68, gravity: 9.8, radius: 4, hits: 1 }, magazine: 1, cycleTime: 0.5, reloadTime: 3.5, recoil: 0.12, noiseRadius: 150, hipSpread: 0.006, aimSpread: 0.003 },
};
// Heavy ammunition: what you start with when you find the weapon, and the most you can carry.
export const HEAVY_AMMO = {
  trenchgun: { start: 15, max: 30 }, mg42: { start: 100, max: 250 }, panzerschreck: { start: 2, max: 5 },
  panzerfaust: { start: 1, max: 3 }, piat: { start: 2, max: 5 },
};
export const STARTING_WEAPONS = ['springfield', 'enfield', 'welrod', 'p38'];   // the rare ones (G43, M1 Carbine, De Lisle, Luger) have to be found

// Parts by slot. `stock: true` = what every weapon starts with. Effects multiply the base.
export const PARTS = {
  rifle: {
    scope: [
      { id: 'scope_std', name: 'Standard scope', stock: true, info: '4× / 8×' },
      { id: 'scope_marksman', name: 'Marksman scope', info: '4× / 8× / 10×, steadier', zoomFovs: [7.5, 3.5, 2.8], zoomNames: ['4×', '8×', '10×'], sway: 0.85 },
      { id: 'scope_long', name: 'Long-range scope', info: '6× / 10× / 12×, steadiest, slower to raise', zoomFovs: [5, 2.8, 2.3], zoomNames: ['6×', '10×', '12×'], sway: 0.75, aimSpeed: 0.8 },
    ],
    barrel: [
      { id: 'barrel_std', name: 'Standard barrel', stock: true, info: '' },
      { id: 'barrel_heavy', name: 'Heavy barrel', info: '+12% bullet speed, less recoil', velocity: 1.12, recoil: 0.85, sway: 1.05 },
      { id: 'barrel_match', name: 'Match barrel', info: '+20% bullet speed, tighter, harder-hitting at range', velocity: 1.2, spread: 0.6, damage: 1.1 },
    ],
    muzzle: [
      { id: 'muzzle_none', name: 'No muzzle device', stock: true, info: '' },
      { id: 'muzzle_suppressor', name: 'Suppressor', info: 'Heard at 30% of the distance; −5% bullet speed', noise: 0.3, velocity: 0.95, suppressor: true },
      { id: 'muzzle_brake', name: 'Muzzle brake', info: 'Much less recoil, faster bolt; louder', recoil: 0.55, cycle: 0.85, noise: 1.15, brake: true },
    ],
    magazine: [
      { id: 'mag_std', name: 'Standard magazine', stock: true, info: '' },
      { id: 'mag_extended', name: 'Extended magazine', info: '+60% rounds', mag: 1.6, reload: 1.1 },
      { id: 'mag_large', name: 'Large magazine', info: 'Double the rounds; slower reload', mag: 2, reload: 1.25 },
    ],
    stock: [
      { id: 'stock_std', name: 'Standard stock', stock: true, info: '' },
      { id: 'stock_cheek', name: 'Cheek-rest stock', info: 'Less sway, hold your breath longer', sway: 0.8, breath: 1.35 },
    ],
  },
  pistol: {
    muzzle: [
      { id: 'pmuzzle_none', name: 'No suppressor', stock: true, info: '' },
      { id: 'pmuzzle_suppressor', name: 'Pistol suppressor', info: 'The P38 heard at 25 m, not 120', noise: 0.21, velocity: 0.95, suppressor: true },
    ],
    barrel: [
      { id: 'pbarrel_std', name: 'Standard barrel', stock: true, info: '' },
      { id: 'pbarrel_long', name: 'Long barrel', info: '+20% bullet speed: more range', velocity: 1.2, damage: 1.1 },
    ],
    magazine: [
      { id: 'pmag_std', name: 'Standard magazine', stock: true, info: '' },
      { id: 'pmag_extended', name: 'Extended magazine', info: '+50% rounds', mag: 1.5, reload: 1.1 },
    ],
  },
  heavy: {},         // nothing to fit to the heavy weapons
};
export const SLOT_NAMES = { scope: 'Scope', barrel: 'Barrel', muzzle: 'Muzzle', magazine: 'Magazine', stock: 'Stock' };
export const allParts = () => Object.values(PARTS).flatMap(slots => Object.values(slots).flat());
export const partById = (id) => allParts().find(p => p.id === id);

// The weapon as fitted: base stats with each fitted part's effects applied.
export function buildWeapon(weaponId, fit = {}) {
  const base = CATALOG[weaponId];
  const def = { ...base, damage: { ...base.damage }, swayScale: base.swayScale ?? 1, breathScale: 1, aimSpeed: 1, fitted: {} };
  for (const [slot, options] of Object.entries(PARTS[base.slot])) {
    if (slot === 'muzzle' && base.integralSuppressor) continue;   // nothing fits over a built-in silencer
    const part = options.find(p => p.id === fit[slot]) ?? options.find(p => p.stock);
    def.fitted[slot] = part.id;
    if (part.zoomFovs) { def.zoomFovs = part.zoomFovs; def.zoomNames = part.zoomNames; }
    if (part.velocity) def.muzzleVelocity *= part.velocity;
    if (part.recoil) def.recoil *= part.recoil;
    if (part.sway) def.swayScale *= part.sway;
    if (part.spread) def.hipSpread *= part.spread;
    if (part.damage) for (const k of Object.keys(def.damage)) if (def.damage[k] !== 999) def.damage[k] *= part.damage;
    if (part.noise) def.noiseRadius *= part.noise;
    if (part.cycle) def.cycleTime *= part.cycle;
    if (part.mag) def.magazine = Math.round(def.magazine * part.mag);
    if (part.reload) def.reloadTime *= part.reload;
    if (part.breath) def.breathScale *= part.breath;
    if (part.aimSpeed) def.aimSpeed *= part.aimSpeed;
    if (part.suppressor) def.suppressor = true;
    if (part.brake) def.brake = true;
  }
  if (weaponId === 'welrod' || base.integralSuppressor) def.suppressor = true;   // built in
  return def;
}

// Binoculars zoom like the rifle scope: the mouse wheel steps between the same levels.
export const BINOCULARS = { zoomFovs: [7.5, 3.5], zoomNames: ['4×', '8×'] };

// Gameplay scaling: bullets feel 60% of the displayed wind, so holds stay small.
export const WIND_EFFECT = 0.6;
