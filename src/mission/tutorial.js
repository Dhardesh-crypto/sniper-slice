// Training on the start hill of the first mission (Vineyard), and first-time hints everywhere.
//
// Training: seven short steps, each done by doing it (not on a timer), using the firing range
// that already stands by the start hill (world/compound.js: targets at 100 to 500 m). It runs once,
// the first time you play Vineyard; "Skip training" in the pause menu ends it, "Replay training"
// in the settings brings it back. The text names keys as tokens (ui/glyphs.js), so it reads right
// on the keyboard and on a pad.
//
// Hints: the first time something comes up in any mission (a guard you could take down, a body,
// a ladder, the alarm…) a line says which key does what. Each is shown once, ever, and kept in
// the profile, so a hint you've had doesn't come back after a restart or a load.
import { fillHtml, onGlyphChange } from '../ui/glyphs.js';

const HINT_TIME = 7;      // s a hint stays up
const RANGE_DIST = 300;   // the target the binocular and zeroing steps use

export class Tutorial {
  constructor({ input, player, arsenal, items, stealth, world, profile, settings, missionId, mapView }) {
    Object.assign(this, { input, player, arsenal, items, stealth, world, profile, settings, missionId, mapView });
    this.el = document.createElement('div');
    this.el.id = 'hint';
    document.getElementById('hud').appendChild(this.el);
    this.step = -1;           // the training step on screen, -1 when training isn't running
    this.queue = [];          // hints waiting their turn
    this.hint = null;         // { id, html, t }
    this.track = {};          // what the current step has seen you do
    this.steps = this.buildSteps();
    onGlyphChange(() => this.render());   // (picked up the pad mid-step: its button names)
  }

  get training() { return this.step >= 0; }
  target(d) { return this.world.soldiers.find(s => s.range && s.rangeDistance === d); }

  // The mission has started (the first time the game takes the mouse or the pad).
  begin() {
    if (this.missionId !== 'vineyard' || this.profile.tutorialDone() || this.settings.hints === false || !this.target(RANGE_DIST)) return;
    this.go(0);
  }

  go(i) {
    this.step = i;
    this.track = { from: this.player.pos.clone(), yaw: this.player.yaw, turned: 0 };
    this.steps[i]?.enter?.();
    this.render();
    document.body.classList.add('training');
  }

  finish(skipped = false) {
    if (!this.training) return;
    this.step = -1;
    this.profile.setTutorialDone(true);
    document.body.classList.remove('training');
    this.render();
    if (skipped) this.show('skipped', 'Training skipped. {ESC} opens the menu; the controls are on its last tab. Replay the training from Settings.');
  }

  // Settings → "Replay training": from the top, now if this is Vineyard, otherwise next time there.
  replay() {
    this.profile.setTutorialDone(false);
    this.profile.resetHints();
    if (this.missionId === 'vineyard' && this.target(RANGE_DIST)) this.go(0);
  }

  buildSteps() {
    const p = this.player, a = this.arsenal, it = this.items, tr = () => this.track;
    return [
      { // 1: look and walk
        text: 'Look round with {LOOK} and walk with {MOVE}.',
        done: () => tr().turned > 1.2 && p.pos.distanceTo(tr().from) > 4,
      },
      { // 2: low and hidden
        text: 'Crouch with {C}, then go prone with {Z}. Low down in tall grass, nobody sees you. The ring on the minimap is how far your steps carry: the lower you are, the smaller it gets.',
        tick: () => { if (p.stance === 'crouch') tr().crouched = true; },
        done: () => tr().crouched && p.stance === 'prone',
      },
      { // 3: binoculars
        text: `Hold {B} for the binoculars. Find the ${RANGE_DIST} m target on the range below (the signs give the distance) and keep it under the crosshair until it's tagged. Tagged enemies stay marked.`,
        enter: () => { const t = this.target(RANGE_DIST); if (t) t.tagged = false; },
        done: () => !!this.target(RANGE_DIST)?.tagged,
      },
      { // 4: zero and fire
        text: `Aim with {RMB} and zoom with {V}. The bullet drops: set the zero to ${RANGE_DIST} m with {ZERO}, then put the crosshair on the ${RANGE_DIST} m target and fire with {LMB}.`,
        done: () => tr().hit300,
      },
      { // 5: breath and wind
        text: 'Far shots: hold {SHIFT} while scoped to hold your breath, so the sway stops. The wind (top of the screen) pushes the bullet sideways; the marker in the scope shows where it lands. Hit the 400 or 500 m target holding your breath.',
        done: () => tr().breathHit,
      },
      { // 6: the item wheel
        text: 'Hold {Q} for the item wheel and pick the bottle with {LOOK}. Then hold {G} to aim and let go to throw it down the range. A bottle breaking draws a guard to look.',
        enter: () => { it.count.bottle = Math.max(1, it.count.bottle ?? 0); },
        done: () => tr().threw,
      },
      { // 7: off you go
        text: 'That\'s the training. Oberst Krause\'s farm is down the valley: {M} opens the map and the orders. Stay out of sight, use the noise of the planes and the generator, and come back here when he\'s dead.',
        enter: () => { tr().t = 0; },
        tick: (dt) => { tr().t += dt; },
        done: () => tr().t > 12,
      },
    ];
  }

  // From arsenal.onShot / onHit and items.onAction (main.js).
  onShot() { if (this.training) this.track.shotHolding = this.arsenal.holding; }
  onHit(e) {
    if (!this.training || !e.soldier?.range) return;
    const d = e.soldier.rangeDistance;
    if (this.step === 3 && d === RANGE_DIST) this.track.hit300 = true;
    if (this.step === 4 && d >= 400 && this.track.shotHolding) this.track.breathHit = true;
  }
  onThrow() { if (this.step === 5 && this.items.selected === 'bottle') this.track.threw = true; }

  // A first-time hint, if it hasn't been shown before.
  show(id, text) {
    if (this.settings.hints === false || this.profile.hintSeen(id)) return;
    if (this.hint?.id === id || this.queue.some(h => h.id === id)) return;
    this.profile.markHint(id);
    this.queue.push({ id, text, t: HINT_TIME });
  }

  // `look()`: what the other systems say is going on (main.js), for the hints.
  tick(dt, look = () => ({})) {
    if (this.training) {
      const s = this.steps[this.step], tr = this.track;
      // (yaw turned, however you got there: the right stick or the mouse)
      tr.turned += Math.abs(Math.atan2(Math.sin(this.player.yaw - tr.yaw), Math.cos(this.player.yaw - tr.yaw)));
      tr.yaw = this.player.yaw;
      s.tick?.(dt);
      if (s.done()) {
        if (this.step + 1 < this.steps.length) this.go(this.step + 1);
        else this.finish();
      }
    } else if ((this.lookT = (this.lookT ?? 0) - dt) <= 0) { this.lookT = 0.25; this.hints(look()); }   // (4 times a second is plenty)

    if (!this.hint && this.queue.length && !this.training) { this.hint = this.queue.shift(); this.render(); }
    if (this.hint && (this.hint.t -= dt) <= 0) { this.hint = null; this.render(); }
  }

  hints(seen) {
    const h = (cond, id, text) => { if (cond) this.show(id, text); };
    h(seen.takedown, 'takedown', '{F}: a silent takedown. Come at a guard from behind while he hasn\'t seen you.');
    h(seen.body, 'body', 'Hold {E} to search the body for ammunition and kit. {F} drags it: leave it in tall grass, where nobody finds it.');
    h(seen.climb, 'climb', '{SPACE} climbs a wall, a ledge or a ladder.');
    h(seen.gun, 'mg', '{E} mans the machine gun: hold {LMB} to fire, {R} for a new belt, {E} again to leave it.');
    h(seen.bench, 'bench', '{E} at a workbench: change weapons and fit the parts you\'ve found.');
    h(seen.vehicle, 'vehicle', '{E} gets you in: {DRIVE}. Engines are loud.');
    h(seen.masked, 'masking', 'A loud noise is covering you now (a plane, the guns, the generator): a shot fired while it lasts carries much less far.');
    h(seen.alarm, 'alarm', 'The siren is up: reinforcements are on the way. Cut the siren\'s wire at its junction box (hold {E}) or shoot the horn to stop it.');
    h(seen.suspicious, 'suspicious', 'A guard is suspicious: the marker over him fills as he looks. Get out of his sight, low and behind cover, and he gives up.');
    h(seen.hurt, 'heal', 'You\'re hurt: {H} uses a bandage, or a medkit when it\'s bad.');
    h(seen.heavy, 'heavy', '{X}: press for the next kind of round, hold for the weapon wheel and your heavy weapon.');
  }

  render() {
    if (this.training) {
      const s = this.steps[this.step];
      this.el.innerHTML = `<b>Training · ${this.step + 1} / ${this.steps.length}</b><p>${fillHtml(s.text)}</p><small>${fillHtml('Skip it from the menu ({ESC})')}</small>`;
      this.el.className = 'on train';
    } else if (this.hint) {
      this.el.innerHTML = `<p>${fillHtml(this.hint.text)}</p>`;
      this.el.className = 'on';
    } else this.el.className = '';
  }
}
