// The gamepad, read once a frame and turned into the keys and mouse buttons the game already
// listens for (Input.down / Input.wasPressed). No system needs to know a pad exists: X on the pad
// "holds E", the right trigger "holds the left mouse button", and so on. The sticks are the two
// exceptions, being analog: the left one is `input.padMove` (player.js, driving.js reads it), the
// right one `input.padLook` (main.js turns it into look, or into a slot on an open wheel).
//
// Layout (Xbox names, the browser's "standard" mapping; a PlayStation pad has the same places):
//   left stick   move · click: sprint (stays on while you push forward) · scoped: hold breath
//   right stick  look · click: takedown / drag a body (F) · scoped: 4× / 8× (V)
//   LT / RT      aim (right mouse) / fire (left mouse)
//   LB  hold     binoculars (B)            RB   use the item: hold to aim a throw (G)
//   A            climb, let go of a ladder, skip the kill cam (Space)
//   B            crouch (C) · hold: prone (Z)
//   X            interact: press and hold both work as E does
//   Y            reload (R) · hold: detonate (K)
//   d-pad up     item wheel, held (Q)      · scoped: zero up (Page Up)
//   d-pad down   heal (H) · hold: uniform (U) · scoped: zero down (Page Down)
//   d-pad left   rifle ↔ pistol · hold: weapon wheel
//   d-pad right  next kind of round (a tap of X) · hold: satchel fuse (L)
//   View / Menu  map (M) / pause
// While the menu is up (no pointer lock and no pad play) the game gets nothing: the buttons drive
// the menu instead (ui/padnav.js reads `edges`).
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const N = 16;
const DEAD = 0.18;       // stick deadzone (radial)
const TAP = 0.28;        // s: shorter than this is a tap, longer a hold (B, Y, the d-pad)

export class Gamepad {
  constructor(input) {
    this.input = input;
    this.prev = new Array(N).fill(false);
    this.heldT = new Array(N).fill(0);    // how long each button has been down (kept after release)
    this.used = new Array(N).fill(false); // a hold already fired, so the release isn't also a tap
    this.pulses = new Map();               // code → seconds it stays "held" (a key tapped, not held)
    this.sprintLatch = false;
    this.edges = { down: [], up: [], now: this.prev };
    this.connected = false;
    this.kind = 'xbox';                    // 'xbox' | 'ps': which button names to show
    this.pad = null;
  }

  read() {
    const pads = navigator.getGamepads?.() ?? [];
    let any = null;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      if (p.mapping === 'standard') return p;
      any ??= p;
    }
    return any;
  }

  // ctx: { aiming } from the game (whether the scope or iron sights are up right now).
  poll(dt, ctx = {}) {
    const inp = this.input, held = inp.padHeld;
    held.clear();
    const g = this.pad = this.read();
    if (!g) { this.connected = false; inp.padMove = inp.padLook = null; this.edges = { down: [], up: [], now: this.prev.fill(false) }; return; }
    this.connected = true;
    this.kind = /054c|playstation|dualshock|dualsense|^wireless controller/i.test(g.id) ? 'ps' : 'xbox';

    const now = [];
    for (let i = 0; i < N; i++) {
      const b = g.buttons[i];
      now[i] = !!b && (b.pressed || b.value > (i === PAD.LT || i === PAD.RT ? 0.35 : 0.5));
    }
    // Sticks with a radial deadzone, rescaled so the edge of the deadzone reads as 0, not 0.18.
    const stick = (x = 0, y = 0) => {
      const m = Math.hypot(x, y);
      if (m < DEAD) return null;
      const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
      return { x: x * k, y: y * k };
    };
    const ls = stick(g.axes[0], g.axes[1]), rs = stick(g.axes[2], g.axes[3]);

    const down = [], up = [];
    for (let i = 0; i < N; i++) {
      if (now[i] && !this.prev[i]) { down.push(i); this.heldT[i] = 0; this.used[i] = false; }
      if (now[i]) this.heldT[i] += dt;
      if (!now[i] && this.prev[i]) up.push(i);
    }
    this.prev = now;
    this.edges = { down, up, now };
    if (down.length || ls || rs) inp.setDevice('pad');

    // Short "taps" of a key the game wants to see held for a moment (X's tap: arsenal.js).
    for (const [code, t] of this.pulses) {
      if (t <= 0) { this.pulses.delete(code); continue; }
      held.add(code);
      this.pulses.set(code, t - dt);
    }

    if (!inp.locked) { inp.padMove = inp.padLook = null; this.sprintLatch = false; return; }
    inp.padMove = ls;
    inp.padLook = rs;

    const press = (code) => inp.pressed.add(code);
    const hold = (code) => held.add(code);
    const pulse = (code) => { press(code); this.pulses.set(code, 0.06); held.add(code); };
    const pressed = (i) => down.includes(i);
    const tapped = (i) => up.includes(i) && !this.used[i] && this.heldT[i] < TAP;
    const heldOnce = (i, t = TAP) => { if (now[i] && !this.used[i] && this.heldT[i] >= t) { this.used[i] = true; return true; } return false; };
    const heldLong = (i, t = TAP) => { if (now[i] && this.heldT[i] >= t) { this.used[i] = true; return true; } return false; };
    const both = (i, code) => { if (now[i]) hold(code); if (pressed(i)) press(code); };
    const aiming = !!ctx.aiming;

    both(PAD.A, 'Space');
    both(PAD.X, 'KeyE');
    both(PAD.RB, 'KeyG');
    both(PAD.LT, 'Mouse2');
    both(PAD.RT, 'Mouse0');
    if (now[PAD.LB]) hold('KeyB');
    if (tapped(PAD.B)) press('KeyC');
    if (heldOnce(PAD.B)) press('KeyZ');
    if (tapped(PAD.Y)) press('KeyR');
    if (heldOnce(PAD.Y, 0.4)) press('KeyK');
    if (pressed(PAD.VIEW)) press('KeyM');
    if (pressed(PAD.MENU)) inp.unlock();

    // Sprint: a click of the left stick, kept while the stick stays pushed forward (holding a
    // stick down while steering it is tiring). Scoped, the same click held is the held breath.
    if (pressed(PAD.L3) && !aiming) this.sprintLatch = true;
    if (!ls || ls.y > -0.35 || now[PAD.LT]) this.sprintLatch = false;
    if (this.sprintLatch || now[PAD.L3]) hold('ShiftLeft');
    if (pressed(PAD.R3)) press(aiming ? 'KeyV' : 'KeyF');

    // The d-pad: zeroing while scoped, the wheels and quick keys otherwise.
    if (aiming) {
      if (pressed(PAD.UP)) press('PageUp');
      if (pressed(PAD.DOWN)) press('PageDown');
    } else {
      if (now[PAD.UP]) hold('KeyQ');
      if (tapped(PAD.DOWN)) press('KeyH');
      if (heldLong(PAD.DOWN)) hold('KeyU');
    }
    if (tapped(PAD.LEFT)) press('PadSwap');
    if (heldLong(PAD.LEFT, 0.2)) hold('PadWheel');       // opens the weapon wheel at once (arsenal.js)
    if (tapped(PAD.RIGHT)) pulse('KeyX');                  // X tapped: the next kind of round
    if (heldOnce(PAD.RIGHT)) press('KeyL');

    // In a vehicle (and on a ladder, which reads W / S) the stick also counts as the keys.
    if (ls) {
      if (ls.y < -0.4) hold('KeyW');
      if (ls.y > 0.4) hold('KeyS');
      if (ls.x < -0.4) hold('KeyA');
      if (ls.x > 0.4) hold('KeyD');
    }
  }

  // A shake of the pad (where the browser can): weak is the high motor, strong the low one.
  rumble(weak, strong, ms) {
    const a = this.pad?.vibrationActuator;
    if (!a?.playEffect) return;
    a.playEffect('dual-rumble', { duration: ms, weakMagnitude: Math.min(1, weak), strongMagnitude: Math.min(1, strong) }).catch(() => {});
  }
}
