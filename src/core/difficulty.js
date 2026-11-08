// Difficulty, in three parts you set apart, as Sniper Elite 5 does: how much the rifle helps you
// (ballistics), how sharp the guards are (sight and hearing), and how much their fire hurts.
// Each is 'easy', 'normal' or 'hard' in the settings (settings.ballistics / .guards / .combat);
// 'normal' is the game as it was tuned. Read where it applies: weapons/arsenal.js (wind, the
// automatic zero, the landing marker), stealth/stealth.js (sight, hearing), player/player.js (hurt).
export const DIFFICULTY = {
  ballistics: {
    easy: { wind: 0, autoZero: true, marker: 'always' },   // no wind, the scope zeroes itself on what you aim at, the marker always on
    normal: { wind: 1 },
    hard: { wind: 1.5, marker: 'off' },                   // more wind, no landing marker: read it yourself
  },
  guards: {
    easy: { sight: 0.6, hearing: 0.75 },
    normal: { sight: 1, hearing: 1 },
    hard: { sight: 1.4, hearing: 1.25 },
  },
  combat: {
    easy: { hurt: 0.5 },
    normal: { hurt: 1 },
    hard: { hurt: 1.6 },
  },
};

export const level = (settings, part) => DIFFICULTY[part][settings?.[part]] ?? DIFFICULTY[part].normal;
