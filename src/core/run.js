// This run's seed: what the side jobs and the conditions are drawn from. A loaded game takes the
// seed its save was made with (so it has the same weather and jobs); a new run draws a fresh one.
import { VERSION } from './saves.js';

function pendingSeed() {
  try {
    const slot = sessionStorage.getItem('sniper-slice.pendingLoad');
    const d = slot && JSON.parse(localStorage.getItem('sniper-slice.save.' + slot) || 'null');
    return d?.version === VERSION ? d.mission?.stats?.runSeed ?? d.mission?.stats?.jobSeed ?? null : null;
  } catch { return null; }
}

// (Dev: sessionStorage 'sniper-slice.seed' forces one, to replay a run's weather and jobs.)
function forcedSeed() { try { const v = sessionStorage.getItem('sniper-slice.seed'); return v ? +v : null; } catch { return null; } }

export const runSeed = pendingSeed() ?? forcedSeed() ?? Math.floor(Math.random() * 2 ** 31);

// A small seeded generator (mulberry32): the same seed, the same draws.
export function seeded(seed) {
  return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
