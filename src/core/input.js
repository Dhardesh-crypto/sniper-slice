// Keyboard + mouse with pointer lock. Look deltas are read every render frame;
// key/button presses are queued so the fixed-step simulation never misses one.
export class Input {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.pressed = new Set();   // edges since the last consume()
    this.buttons = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    element.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const b = `Mouse${e.button}`;
      this.buttons.add(b);
      this.pressed.add(b);
    });
    addEventListener('mouseup', (e) => this.buttons.delete(`Mouse${e.button}`));
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === element;
      if (!this.locked) { this.buttons.clear(); this.keys.clear(); }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    this.element.requestPointerLock?.()?.catch?.(() => {});
  }

  down(code) { return this.keys.has(code) || this.buttons.has(code); }
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

  consume() { this.pressed.clear(); }
}
