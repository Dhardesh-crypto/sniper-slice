// Line icons for the item wheel, one per item, drawn in the HUD's colour (currentColor) on a
// 48 × 48 grid: a stroke for the outline and a faint fill for the body.
const svg = (body) => `<svg class="icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const FILL = 'fill="currentColor" fill-opacity="0.18"';

export const ICONS = {
  // Stick grenade: the head, the wooden handle and the pull-cord cap, at a slant.
  grenade: svg(`<g transform="rotate(-35 24 24)">
    <rect x="17" y="4" width="14" height="13" rx="2" ${FILL}/>
    <path d="M17 8h14"/>
    <rect x="21.5" y="17" width="5" height="22" rx="1.5" ${FILL}/>
    <rect x="20.5" y="39" width="7" height="4" rx="1"/></g>`),
  // A wine bottle (this is Tuscany).
  bottle: svg(`<path d="M21 4h6v10c0 2 6 5 6 11v17a2 2 0 0 1-2 2H17a2 2 0 0 1-2-2V25c0-6 6-9 6-11z" ${FILL}/>
    <path d="M21 8h6"/><path d="M15 28h18M15 37h18"/>`),
  // A trench whistle with its ring.
  whistle: svg(`<path d="M8 22h18l5-5h7v8a11 11 0 1 1-22 6H8z" ${FILL}/>
    <circle cx="27" cy="31" r="4"/>
    <circle cx="8" cy="17" r="3.5"/><path d="M8 20.5V22"/>
    <path d="M38 10l3-3M33 9l1-4M42 15l4-1"/>`),
  // A Teller mine: a flat drum with the pressure plate on top.
  mine: svg(`<ellipse cx="24" cy="22" rx="17" ry="6" ${FILL}/>
    <path d="M7 22v7c0 3.3 7.6 6 17 6s17-2.7 17-6v-7"/>
    <ellipse cx="24" cy="21" rx="6" ry="2.2"/>
    <path d="M14 30.5v3M24 32v3M34 30.5v3"/>`),
  // Three sticks of TNT taped together, with a fuse.
  tnt: svg(`<rect x="10" y="16" width="9" height="26" rx="2" ${FILL}/>
    <rect x="19.5" y="16" width="9" height="26" rx="2" ${FILL}/>
    <rect x="29" y="16" width="9" height="26" rx="2" ${FILL}/>
    <path d="M9 24h30M9 34h30"/>
    <path d="M24 16c0-5 4-6 7-8s4-3 4-5"/><path d="M35 3l2-1M36 6l2 1"/>`),
  // A satchel charge: the canvas bag, its flap and the carrying strap.
  satchel: svg(`<path d="M16 16c0-8 16-8 16 0"/>
    <rect x="7" y="16" width="34" height="25" rx="3" ${FILL}/>
    <path d="M7 24h34l-3 8H10z"/>
    <rect x="21" y="29" width="6" height="5" rx="1"/>`),
  // A rolled field dressing with its loose end.
  bandage: svg(`<ellipse cx="17" cy="22" rx="8" ry="12" ${FILL}/>
    <ellipse cx="17" cy="22" rx="3" ry="4.5"/>
    <path d="M17 10h14c4.4 0 8 5.4 8 12s-3.6 12-8 12H17"/>
    <path d="M31 34c3 2 5 5 9 6"/><path d="M27 16v12M33 15v14" stroke-dasharray="2 3"/>`),
  // A medic's box with the cross.
  medkit: svg(`<path d="M18 12V8h12v4"/>
    <rect x="6" y="12" width="36" height="28" rx="3" ${FILL}/>
    <path d="M24 19v14M17 26h14" stroke-width="4"/>`),
};
