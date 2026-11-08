// Keyboard + mouse with pointer lock, and a gamepad (core/gamepad.js) folded into the same keys.
// Look deltas are read every render frame; key/button presses are queued so the fixed-step
// simulation never misses one.
//
// "Locked" means you are playing, not in a menu. With the mouse that is the browser's pointer
// lock; with a pad there is no pointer to lock (and a pad button can't ask for one), so the pad
// has its own lock: `lock()` takes whichever fits the device you used last, `unlock()` drops both.
import { Gamepad } from './gamepad.js';

export class Input {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.pressed = new Set();   // edges since the last consume()
    this.buttons = new Set();
    this.padHeld = new Set();   // keys the pad holds this frame (gamepad.js)
    this.padMove = null;        // left stick {x, y} (y down), or null in the deadzone
    this.padLook = null;        // right stick
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.pointerLocked = false;
    this.padLocked = false;
    this.onLockChange = null;
    this.device = 'kb';         // 'kb' | 'pad': whichever was used last (button names follow it)
    this.onDevice = null;
    this.settings = null;       // (main.js: for the vibration setting)
    this.pad = new Gamepad(this);

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.setDevice('kb');
      // Esc while playing on the pad: the browser has no pointer lock to drop, so do it here.
      if (e.code === 'Escape' && this.padLocked) this.unlock();
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Equal', 'Minus', 'F5', 'F9'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    element.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      this.setDevice('kb');
      const b = `Mouse${e.button}`;
      this.buttons.add(b);
      this.pressed.add(b);
    });
    addEventListener('mouseup', (e) => this.buttons.delete(`Mouse${e.button}`));
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.setDevice('kb');
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    addEventListener('wheel', (e) => { if (this.pointerLocked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.pointerLocked = document.pointerLockElement === element;
      if (this.pointerLocked) this.padLocked = false;    // the mouse took over
      if (!this.pointerLocked) { this.buttons.clear(); this.keys.clear(); }
      if (this.locked !== was) this.onLockChange?.(this.locked);
    });
  }

  get locked() { return this.pointerLocked || this.padLocked; }

  setDevice(d) {
    if (d === this.device) return;
    this.device = d;
    this.onDevice?.(d);
  }

  // Start (or resume) playing: the pointer lock for the mouse, the pad's own lock for a pad.
  lock() {
    if (this.device === 'pad') {
      if (this.locked) return;
      this.padLocked = true;
      this.onLockChange?.(true);
      return;
    }
    this.element.requestPointerLock?.()?.catch?.(() => {});
  }

  // Back to the menu (or the map, the workbench, a screen of its own).
  unlock() {
    const was = this.locked;
    this.padLocked = false;
    this.keys.clear(); this.buttons.clear(); this.padHeld.clear();
    if (this.pointerLocked) { document.exitPointerLock?.(); return; }   // (pointerlockchange tells the game)
    if (was) this.onLockChange?.(false);
  }

  // Once a frame, before the simulation: the pad's buttons become keys (gamepad.js).
  poll(dt, ctx) { this.pad.poll(dt, ctx); }

  down(code) { return this.keys.has(code) || this.buttons.has(code) || this.padHeld.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  takeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return d;
  }

  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  // A shake of the pad, for shots, blasts and hits (off in the settings, or on the keyboard).
  rumble(weak, strong, ms) { if (this.device === 'pad' && this.settings?.vibration !== false) this.pad.rumble(weak, strong, ms); }

  consume() { this.pressed.clear(); }
}
