// The conditions for this run: most often the weather the mission was written for, but sometimes
// an overcast day, rain, or a morning mist, drawn from the run's seed. Each changes the light
// (the sun dimmed behind cloud, more fill from the sky), how close the haze comes in, how much of
// the far country shows through it, the weather (rain, mist), and how far a guard can see you.
// It edits the map before the world is built from it.
import * as THREE from 'three';
import { LIGHT } from './world.js';
import { seeded } from '../core/run.js';

const KINDS = {
  briefed: { weight: 0.45, label: null },
  overcast: { weight: 0.2, label: 'Overcast' },
  rain: { weight: 0.15, label: 'Rain' },
  mist: { weight: 0.2, label: 'Morning mist' },
};

export function pickConditions(map, seed) {
  const rnd = seeded(seed ^ 0x51ed27);
  // A map written with mist or rain of its own (the forest) keeps it; the dawn mist map can't have more.
  const allowed = Object.keys(KINDS).filter(k => k === 'briefed' || (!map.fog?.density && !map.weather?.rain && !(k === 'mist' && map.weather?.mist)));
  let r = rnd() * allowed.reduce((s, k) => s + KINDS[k].weight, 0), kind = allowed[0];
  for (const k of allowed) { if ((r -= KINDS[k].weight) <= 0) { kind = k; break; } }
  if (kind === 'briefed') return { kind, label: null };

  const L = { ...LIGHT, ...map.light };
  const fog = new THREE.Color(map.fog?.color ?? 0xb9c6cc);
  const grey = new THREE.Color(0xaab2b7);
  if (kind === 'overcast' || kind === 'rain') {
    const wet = kind === 'rain';
    map.light = { ...L, clouds: 0.97, sun: 0xdfe4e8, sunIntensity: L.sunIntensity * (wet ? 0.22 : 0.35), turbidity: L.turbidity + 4,
      hemi: (L.hemi ?? 0.5) * 1.7, hemiSky: 0xc0c8ce, env: (L.env ?? 0.22) * 1.3, exposure: (L.exposure ?? 0.85) + 0.1 };
    fog.lerp(grey, wet ? 0.75 : 0.55).multiplyScalar(wet ? 0.85 : 0.95);
    map.fog = { color: fog.getHex(), near: wet ? 110 : 200, far: wet ? 760 : 1250 };
    map.horizonFade = wet ? 0.85 : 0.45;
    map.sightScale = wet ? 0.75 : 0.95;
    if (wet) map.weather = { ...map.weather, rain: 0.75 };
  } else {
    map.light = { ...L, sunIntensity: L.sunIntensity * 0.8, exposure: (L.exposure ?? 0.85) + 0.05 };
    fog.lerp(new THREE.Color(0xd4d8d6), 0.5);
    map.fog = { color: fog.getHex(), near: 120, far: 900 };
    map.horizonFade = 0.7;
    map.sightScale = 0.7;
    map.weather = { ...map.weather, mist: 1 };
  }
  return { kind, label: KINDS[kind].label };
}
