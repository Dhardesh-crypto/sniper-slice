// Player settings, remembered in this browser when storage is available.
const KEY = 'sniper-slice.settings';
// lungMarker: 'always' (whenever scoped) | 'breath' (only while holding breath) | 'off'
// killCam: 'always' (every kill) | 'sometimes' (headshots, organ shots, long range) | 'off'
// quality: 'high' | 'medium' | 'low' (see Post.setQuality)
const DEFAULTS = { sensitivity: 1.0, fov: 68, invertY: false, lungMarker: 'always', killCam: 'sometimes', quality: 'medium', volume: 0.8, aimMode: 'hold' };

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked: keep in memory */ }
}
