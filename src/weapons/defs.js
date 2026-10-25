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

// Rifle ammunition (X switches; a switch reloads the magazine with the new type).
//   subsonic: quiet (heard at 40 m, not 400 m) but slow, so it drops a lot more and hits softer
//   ap: armour-piercing: blows an engine in one hit and is the round that hurts the Panzer
export const AMMO = {
  standard: { name: 'Standard', short: 'STD', start: 30 },
  subsonic: { name: 'Subsonic', short: 'SUB', start: 10, muzzleVelocity: 400, noiseRadius: 40, damageScale: 0.85 },
  ap: { name: 'Armour-piercing', short: 'AP', start: 6, ap: true },
};

// Binoculars zoom like the rifle scope: the mouse wheel steps between the same levels.
export const BINOCULARS = { zoomFovs: [7.5, 3.5], zoomNames: ['4×', '8×'] };

// Gameplay scaling: bullets feel 60% of the displayed wind, so holds stay small.
export const WIND_EFFECT = 0.6;
