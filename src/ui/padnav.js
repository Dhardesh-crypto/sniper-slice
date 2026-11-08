// The menus, the workbench, the end and death screens and the map, worked with a gamepad.
// The page is built for the mouse (index.html), so this doesn't add a second UI: it moves the
// browser's own focus between the buttons, tabs, sliders and lists on the screen in front, and
// presses them with element.click(), as a mouse click would.
//   d-pad / left stick  move the focus (to the nearest control in that direction)
//                       on a slider or a list: left / right changes it
//   A                   press · B  back (resume, close the workbench or the save slots)
//   LB / RB             previous / next menu tab · Menu  play or resume · right stick  scroll
// On the map: the left stick moves a cursor, A sets the waypoint there, Y clears it, B / View closes.
import { PAD } from '../core/gamepad.js';

const FOCUSABLE = 'button, select, input, [data-padnav]';
const REPEAT = [0.38, 0.11];      // s: first repeat of a held direction, then each one after

export class PadNav {
  constructor({ input, map, closeMap, closeBench, resume }) {
    Object.assign(this, { input, map, closeMap, closeBench, resume });
    this.dir = null; this.dirT = 0; this.reps = 0;
    this.cursor = { x: innerWidth / 2, y: innerHeight / 2 };
    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'padcursor';
    document.body.appendChild(this.cursorEl);
    // A mouse click anywhere means the pad isn't driving: drop the highlight it left.
    addEventListener('mousedown', () => document.querySelector('.padfocus')?.classList.remove('padfocus'));
  }

  // The screen in front, the one the buttons should work.
  layer() {
    const on = (id) => document.getElementById(id)?.classList.contains('on') && document.getElementById(id);
    return on('dispatch') || on('bench') || on('end') || on('death')
      || (document.getElementById('menu').classList.contains('hidden') ? null : document.getElementById('menu'));
  }

  frame(dt) {
    const pad = this.input.pad;
    // The press that just paused the game (Menu) or opened the map (View) is that press's whole
    // job: don't let it also work the screen it opened, or it would close it again at once.
    const fresh = this.wasLocked || this.wasMap !== this.map.open;
    this.wasLocked = this.input.locked; this.wasMap = this.map.open;
    if (!pad.connected || this.input.locked) { this.cursorEl.style.display = 'none'; return; }
    if (fresh) return;
    const { down, now } = pad.edges, g = pad.pad;    const was = (i) => down.includes(i);
    if (down.length) this.input.setDevice('pad');

    if (this.map.open) return this.mapFrame(dt, was, g);
    this.cursorEl.style.display = 'none';
    const root = this.layer();
    if (!root) return;

    // The dispatch card and the death screen are a single click.
    if (root.id === 'dispatch' || root.id === 'death') { if (was(PAD.A) || was(PAD.MENU)) root.click(); return; }

    if (was(PAD.MENU) && root.id === 'menu') { document.getElementById('play').click(); return; }
    if (was(PAD.B)) {
      const slots = document.getElementById('slots');
      if (slots?.classList.contains('on')) { slots.classList.remove('on'); return; }
      if (root.id === 'bench') { this.closeBench(); return; }
      if (root.id === 'menu' && document.body.classList.contains('started')) { this.resume(); return; }
    }
    if (root.id === 'menu' && (was(PAD.LB) || was(PAD.RB))) {
      const tabs = [...root.querySelectorAll('.tabs [data-tab]')];
      const i = tabs.findIndex(b => b.getAttribute('aria-selected') === 'true');
      const next = tabs[(i + (was(PAD.RB) ? 1 : -1) + tabs.length) % tabs.length];
      next?.click();
      this.focus(next);
    }
    // The right stick scrolls a panel taller than the screen.
    const ry = g?.axes[3] ?? 0;
    if (Math.abs(ry) > 0.25) (root.querySelector('.panel') ?? root).scrollBy(0, ry * 900 * dt);

    // Nothing focused yet (a screen just opened): its first button, so A does the obvious thing.
    let el = this.current(root);
    if (!el && (down.length || this.dir)) {
      el = (root.id === 'bench' ? null : root.querySelector('.buttons button, .end-buttons button')) ?? this.all(root)[0];   // (the workbench: its parts first)
      this.focus(el);
    }
    if (was(PAD.A) && el) {
      if (el.tagName === 'SELECT') { this.step(el, 1); return; }
      // The loadout redraws itself on a click: find the same button in the new one.
      const same = ['id', 'data-weapon', 'data-part', 'data-slot-tab', 'data-mission'].map(k => el.getAttribute(k) && `[${k}="${el.getAttribute(k)}"]`).find(Boolean);
      el.click();
      if (!el.isConnected && same) this.focus(root.querySelector(same));
      return;
    }
    const d = this.direction(dt, now, g);
    if (!d) return;
    if (el && (el.type === 'range' || el.tagName === 'SELECT') && d[1] === 0) { this.step(el, d[0]); return; }
    this.focus(this.nearest(root, el, d) ?? el ?? this.all(root)[0]);
  }

  // A held direction repeats like a held key: once, a pause, then steadily.
  direction(dt, now, g) {
    const sx = g?.axes[0] ?? 0, sy = g?.axes[1] ?? 0;
    let d = now[PAD.LEFT] ? [-1, 0] : now[PAD.RIGHT] ? [1, 0] : now[PAD.UP] ? [0, -1] : now[PAD.DOWN] ? [0, 1] : null;
    if (!d && Math.hypot(sx, sy) > 0.55) d = Math.abs(sx) > Math.abs(sy) ? [Math.sign(sx), 0] : [0, Math.sign(sy)];
    const key = d ? d.join() : null;
    if (key !== this.dir) { this.dir = key; this.dirT = 0; this.reps = 0; return d; }
    if (!d) return null;
    this.dirT += dt;
    const wait = REPEAT[Math.min(1, this.reps)];
    if (this.dirT < wait) return null;
    this.dirT = 0; this.reps++;
    return d;
  }

  all(root) {
    return [...root.querySelectorAll(FOCUSABLE)].filter(e => {
      if (e.disabled || e.type === 'hidden') return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    });
  }

  current(root) {
    const a = document.activeElement;
    return a && a !== document.body && root.contains(a) && a.matches(FOCUSABLE) ? a : null;
  }

  focus(el) {
    if (!el) return;
    document.querySelector('.padfocus')?.classList.remove('padfocus');
    el.classList.add('padfocus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }

  // The control nearest in the direction asked: along it counts once, across it three times,
  // so "down" picks the one below rather than one far off to the side.
  nearest(root, from, [dx, dy]) {
    if (!from) return null;
    // A control's place is its row: a slider sits at the right end of its label, a checkbox at
    // the left, but both are "the next setting down".
    const c = (e) => { const r = (e.closest('label') ?? e).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r]; };
    const [fx, fy, fr] = c(from);
    let best = null, bestScore = Infinity;
    for (const e of this.all(root)) {
      if (e === from) continue;
      const [x, y, r] = c(e);
      // Ahead of the edge of the one we're on, not just of its centre (rows of wide buttons).
      const along = dx ? (dx > 0 ? r.left - fr.right + 1 : fr.left - r.right + 1) : (dy > 0 ? r.top - fr.bottom + 1 : fr.top - r.bottom + 1);
      if (along <= 0 && (dx ? (x - fx) * dx <= 4 : (y - fy) * dy <= 4)) continue;
      // Across: the gap between the two, nothing where they overlap (one under the other).
      const across = dx ? Math.max(0, r.top - fr.bottom, fr.top - r.bottom) : Math.max(0, r.left - fr.right, fr.left - r.right);
      const score = Math.max(0, along) + 3 * across;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  // Left / right on a slider moves it a step, on a list picks the next option, as a mouse would.
  step(el, s) {
    if (el.type === 'range') {
      const st = parseFloat(el.step) || 1;
      el.value = String(Math.min(parseFloat(el.max), Math.max(parseFloat(el.min), parseFloat(el.value) + s * st)));
    } else {
      const n = el.options.length;
      el.selectedIndex = (el.selectedIndex + s + n) % n;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // The map: a cursor on the stick, the waypoint where you press A.
  mapFrame(dt, was, g) {
    const c = this.cursor, el = this.cursorEl;
    el.style.display = 'block';
    const sx = g?.axes[0] ?? 0, sy = g?.axes[1] ?? 0, m = Math.hypot(sx, sy);
    if (m > 0.15) {
      const v = 900 * Math.pow((m - 0.15) / 0.85, 1.6) * dt / m;   // slow near the centre, quick at the edge
      c.x = Math.min(innerWidth, Math.max(0, c.x + sx * v));
      c.y = Math.min(innerHeight, Math.max(0, c.y + sy * v));
    }
    el.style.transform = `translate(${c.x}px, ${c.y}px)`;
    const click = (button) => this.map.onClick({ clientX: c.x, clientY: c.y, button });
    if (was(PAD.A)) click(0);
    if (was(PAD.Y)) click(2);
    if (was(PAD.LB) || was(PAD.RB)) {
      const tabs = [...document.querySelectorAll('#mapside .tabs button')];
      const i = tabs.findIndex(b => b.getAttribute('aria-selected') === 'true');
      tabs[(i + 1) % tabs.length]?.click();
    }
    if (was(PAD.B) || was(PAD.VIEW)) this.closeMap();
  }
}
