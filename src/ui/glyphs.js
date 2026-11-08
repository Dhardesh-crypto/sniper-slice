// Key names on screen that follow the device you're using. Text that names a key writes it as a
// token, {E} or {SPACE}, and goes through fill() on its way to the screen: on the keyboard the
// token is the key ("E · OPEN THE DOOR"), on a pad the button that stands for it in
// core/gamepad.js ("X · OPEN THE DOOR", or "□" on a PlayStation pad).
// Static text in index.html: an element with data-pad="…" shows that text instead of its own while
// you're on the pad (refreshStatic), and the Gamepad section of the controls page is built here.
let input = null;
const listeners = [];

// Keyboard names, as the game always printed them.
const KB = { SPACE: 'SPACE', DRIVE: 'W/S DRIVE · A/D STEER · SPACE HANDBRAKE' };
// The pad, per key (gamepad.js has the layout). "(HOLD)" where the pad needs the button held for
// that one (the same button tapped does something else).
const PAD = {
  xbox: { E: 'X', F: 'R3', U: '↓', G: 'RB', K: 'Y (HOLD)', L: '→ (HOLD)', Q: '↑', H: '↓', SPACE: 'A', R: 'Y', B: 'LB', M: 'VIEW', X: '→', V: 'R3', C: 'B', Z: 'B (HOLD)', SHIFT: 'L3', RMB: 'LT', LMB: 'RT', ESC: 'MENU', DRIVE: 'LEFT STICK DRIVE AND STEER · A HANDBRAKE' },
  ps:   { E: '□', F: 'R3', U: '↓', G: 'R1', K: '△ (HOLD)', L: '→ (HOLD)', Q: '↑', H: '↓', SPACE: '✕', R: '△', B: 'L1', M: 'CREATE', X: '→', V: 'R3', C: '○', Z: '○ (HOLD)', SHIFT: 'L3', RMB: 'L2', LMB: 'R2', ESC: 'OPTIONS', DRIVE: 'LEFT STICK DRIVE AND STEER · ✕ HANDBRAKE' },
};

export function initGlyphs(inp) {
  input = inp;
  inp.onDevice = () => { refreshStatic(); for (const f of listeners) f(); };
  refreshStatic();
}
export const onGlyphChange = (f) => listeners.push(f);
export const onPad = () => input?.device === 'pad';
const kind = () => input?.pad.kind ?? 'xbox';

// The name of one key on the device in use.
export function key(k) {
  if (onPad()) return PAD[kind()][k] ?? k;
  return KB[k] ?? k;
}

// Every {KEY} token in a text, named for the device in use.
export function fill(text) {
  if (typeof text !== 'string' || !text.includes('{')) return text;
  return text.replace(/\{([A-Z]+)\}/g, (_, k) => key(k));
}

// index.html: swap the text of [data-pad] elements, and show the controls for the device in use.
export function refreshStatic() {
  const pad = onPad();
  for (const el of document.querySelectorAll('[data-pad]')) {
    if (el.dataset.kb === undefined) el.dataset.kb = el.textContent;
    el.textContent = pad ? fill(el.dataset.pad) : el.dataset.kb;
  }
  const sec = document.getElementById('pad-controls');
  if (sec) { sec.innerHTML = padControlsHtml(); sec.classList.toggle('first', pad); }
}

// The Gamepad section of the controls page.
function padControlsHtml() {
  const ps = kind() === 'ps';
  const n = (x, p) => (ps ? p : x);
  const rows = [
    ['Left stick', 'Move (half a push walks) · click: sprint, it stays on while you push forward'],
    ['Right stick', 'Look · click: takedown, drag or drop a body · scoped: 4× / 8×'],
    [n('LT', 'L2'), 'Aim / scope (follows the Aim setting: hold or toggle)'],
    [n('RT', 'R2'), 'Fire'],
    ['Left stick click (scoped)', 'Hold breath'],
    [n('LB', 'L1') + ' (hold)', 'Binoculars: range and tag · ' + n('RB', 'R1') + ' through them: air strike'],
    [n('RB', 'R1'), 'Use the item: hold to aim a throw, release to throw (' + n('LT', 'L2') + ' cancels)'],
    [n('A', '✕'), 'Climb a wall or ladder, let go of a ladder · skip the kill cam'],
    [n('B', '○'), 'Crouch · hold: prone'],
    [n('X', '□'), 'Interact: open, read, search (hold), drive, man a gun, workbench'],
    [n('Y', '△'), 'Reload (again as the bar crosses the gold mark: quick reload) · hold: detonate TNT and satchels'],
    ['D-pad ↑ (hold)', 'Item wheel: point the right stick at an item · scoped: zero up'],
    ['D-pad ↓', 'Heal · hold: put on or take off a uniform · scoped: zero down'],
    ['D-pad ←', 'Rifle ↔ pistol · hold: weapon wheel (right stick picks)'],
    ['D-pad →', 'Next kind of round · hold: satchel fuse'],
    [n('View', 'Create'), 'Map: left stick moves the cursor, ' + n('A', '✕') + ' sets a waypoint, ' + n('Y', '△') + ' clears it'],
    [n('Menu', 'Options'), 'Pause · in the menus: d-pad moves, ' + n('A', '✕') + ' presses, ' + n('B', '○') + ' goes back, ' + n('LB / RB', 'L1 / R1') + ' change tab'],
  ];
  return `<h2>Gamepad</h2><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}
