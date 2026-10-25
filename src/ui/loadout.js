// The loadout screen: pick your rifle and pistol, fit the parts you've collected, and see what
// they do. Used as the menu's Loadout tab (editable before the mission starts, read-only once
// it has: find a workbench) and as the workbench screen during the mission.
import { CATALOG, PARTS, SLOT_NAMES, buildWeapon } from '../weapons/defs.js';
import { weaponPicture } from './weapon-pictures.js';

// Stats as 0..1 bars (the reach of the slowest round to the fastest, and so on).
function stats(def) {
  const clamp = (v) => Math.max(0.04, Math.min(1, v));
  return [
    ['Reach', clamp((def.muzzleVelocity - 240) / (1050 - 240)), `${Math.round(def.muzzleVelocity)} m/s`],
    ['Stability', clamp(1.25 - def.swayScale * (def.recoil / 0.085) ** 0.3 * 0.75), `${Math.round(100 / def.swayScale)}%`],
    ['Quiet', clamp(1 - Math.log10(Math.max(10, def.noiseRadius)) / Math.log10(500) + 0.37), `heard at ${Math.round(def.noiseRadius)} m`],
    def.rocket ? ['Damage', 1, `blast ${def.rocket.radius} m · ${def.rocket.hits > 1 ? 'kills the Panzer' : 'wrecks a vehicle'}`]
      : ['Damage', clamp(def.damage.torso * (def.pellets ?? 1) / 180), def.pellets ? `${def.pellets} × ${Math.round(def.damage.torso)} chest` : `${Math.round(def.damage.torso)} chest`],
    ['Magazine', clamp(def.magazine / 20), `${def.magazine} ${def.magazine === 1 ? (def.ammoName ?? 'round').replace(/s$/, '') : def.ammoName ?? 'rounds'}`],
    ['Handling', clamp(1.05 - (def.cycleTime / 1.4) * 0.5 - (def.reloadTime / 3.5) * 0.4), def.auto ? 'automatic' : def.pellets ? 'pump-action' : def.rocket ? `reload ${def.reloadTime.toFixed(1)} s` : def.semi ? 'semi-auto' : `bolt ${def.cycleTime.toFixed(1)} s`],
  ];
}

export class LoadoutUI {
  constructor({ profile, apply }) {
    this.profile = profile;
    this.apply = apply;          // (loadout) => void: equip it now
    this.slot = 'rifle';
  }

  render(el, { editable, note = '' }) {
    this.el = el; this.editable = editable; this.note = note;
    const prof = this.profile, lo = prof.loadout;
    // The heavy slot can be empty: show the first heavy weapon (as a silhouette until you have one).
    const id = lo[this.slot] ?? prof.weaponsFor(this.slot)[0].id, def = buildWeapon(id, prof.fitOf(id));
    const weapons = prof.weaponsFor(this.slot);
    const partsHtml = Object.entries(PARTS[this.slot]).map(([slot, options]) => {
      if (slot === 'muzzle' && CATALOG[id].integralSuppressor) return `<div class="lo-row"><span class="lo-slot">${SLOT_NAMES[slot]}</span><span class="lo-fixed">Built-in silencer</span></div>`;
      const chips = options.map(p => {
        const owned = prof.ownsPart(p), on = def.fitted[slot] === p.id;
        return `<button class="lo-chip${on ? ' on' : ''}" data-slot="${slot}" data-part="${p.id}" ${!owned || !editable ? 'disabled' : ''} title="${owned ? p.info : 'Not found yet: look for toolboxes'}">${owned ? p.name : '? Not found yet'}</button>`;
      }).join('');
      return `<div class="lo-row"><span class="lo-slot">${SLOT_NAMES[slot]}</span><div class="lo-chips">${chips}</div></div>`;
    }).join('');
    el.innerHTML = `
      ${note ? `<p class="lo-note">${note}</p>` : ''}
      <div class="lo-tabs">${['rifle', 'pistol', 'heavy'].map(s => `<button data-slot-tab="${s}" class="${s === this.slot ? 'on' : ''}">${{ rifle: 'Rifle', pistol: 'Pistol', heavy: 'Heavy' }[s]}</button>`).join('')}</div>
      <div class="lo-grid">
        <div>
          <div class="lo-weapons">${weapons.map(w => {
            const own = prof.ownsWeapon(w.id);
            return `<button class="lo-weapon${w.id === lo[this.slot] ? ' on' : ''}" data-weapon="${w.id}" ${!own || !editable ? 'disabled' : ''}>
              <img class="lo-pic${own ? '' : ' unknown'}" src="${weaponPicture(w.id)}" alt="">
              <span><b>${own ? w.name : '? ' + w.name}</b><small>${own ? w.blurb : `Not found yet: ${w.foundOn ?? 'hidden somewhere in the mission'}`}</small></span></button>`;
          }).join('')}</div>
          ${partsHtml}
        </div>
        <div class="lo-stats"><img class="lo-hero" src="${weaponPicture(id, def.suppressor && !def.integralSuppressor ? 'suppressor' : def.brake ? 'brake' : null)}" alt="${def.name}"><h2>${def.name}</h2>${stats(def).map(([k, v, t]) => `
          <div class="lo-stat"><span>${k}</span><i><b style="width:${(v * 100).toFixed(0)}%"></b></i><small>${t}</small></div>`).join('')}
          <p class="lo-scope">Scope: ${def.zoomNames.join(' / ')}</p>
        </div>
      </div>`;
    el.querySelectorAll('[data-slot-tab]').forEach(b => b.addEventListener('click', () => { this.slot = b.dataset.slotTab; this.rerender(); }));
    if (!editable) return;
    el.querySelectorAll('[data-weapon]').forEach(b => b.addEventListener('click', () => { prof.setWeapon(this.slot, b.dataset.weapon); this.changed(); }));
    el.querySelectorAll('[data-part]').forEach(b => b.addEventListener('click', () => { prof.setPart(lo[this.slot], b.dataset.slot, b.dataset.part); this.changed(); }));
  }

  rerender() { this.render(this.el, { editable: this.editable, note: this.note }); }
  changed() { this.apply(this.profile.loadout); this.rerender(); }
}
