// Entry point: renderer, fixed-step simulation loop, menu and settings wiring.
import * as THREE from 'three';
import { World } from './world/world.js';
import { Player } from './player/player.js';
import { Avatar } from './player/avatar.js';
import { CameraRig } from './player/camera-rig.js';
import { Arsenal } from './weapons/arsenal.js';
import { Particles } from './fx/particles.js';
import { KillCam } from './fx/killcam.js';
import { Input } from './core/input.js';
import { Audio, SOUND_CHECK } from './core/audio.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { Hud } from './ui/hud.js';
import { Post } from './core/post.js';
import { loadAssets, assets } from './world/characters.js';
import { loadProps, dressSite } from './world/props.js';
import { usePhotoTextures } from './world/textures.js';
import { MapView } from './ui/map.js';
import { Search } from './player/search.js';
import { Carry } from './player/carry.js';
import { Masking } from './stealth/masking.js';
import { Stealth } from './stealth/stealth.js';
import { GuardAI } from './ai/guards.js';
import { Mission } from './mission/mission.js';
import { Hotspots } from './world/hotspots.js';
import { Takedown } from './player/takedown.js';
import { Explosions } from './fx/explosions.js';
import { Tank } from './world/tank.js';
import { Items } from './player/items.js';
import { Saves } from './core/saves.js';
import { Profile } from './core/profile.js';
import { Pickups } from './world/pickups.js';
import { BeltGrenades } from './world/belt-grenades.js';
import { Rockets } from './weapons/rockets.js';
import { Interactions } from './world/interact.js';
import { CAMPAIGN, currentMissionId, chooseMission, missionById } from './missions/campaign.js';
import { useMap } from './world/terrain.js';
import { HEAVY_AMMO } from './weapons/defs.js';
import { LoadoutUI } from './ui/loadout.js';

const FIXED_DT = 1 / 60;

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // redrawn every other frame (see step): half the cost, no visible difference
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

const scene = new THREE.Scene();
const settings = loadSettings();
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 3000);
camera.rotation.order = 'YXZ';

// Characters and the rifle come from GLB files: load them before building the world.
const playBtn = document.getElementById('play');
playBtn.disabled = true;
await loadAssets((f) => { playBtn.textContent = `Loading ${Math.round(f * 100)}%`; });
playBtn.textContent = 'Click to play';
playBtn.disabled = false;

// The mission being played: its module brings the map, the site, the objectives and the intel.
const MISSION_MODULES = {
  vineyard: () => import('./missions/vineyard.js'),
  town: () => import('./missions/town.js'),
  harbour: () => import('./missions/harbour.js'),
  forest: () => import('./missions/forest.js'),
  railway: () => import('./missions/railway.js'),
  bridge: () => import('./missions/bridge.js'),
  airfield: () => import('./missions/airfield.js'),
  radar: () => import('./missions/coast.js'),
};
const missionId = MISSION_MODULES[currentMissionId()] && missionById(currentMissionId()).ready ? currentMissionId() : 'vineyard';
const M = (await MISSION_MODULES[missionId]()).default;
// The mission's modelled props (and the safe every mission has), before its site is built.
playBtn.disabled = true;
await loadProps(['safe', 'siren', 'crates', ...(M.props ?? [])], (f) => { playBtn.textContent = `Loading ${Math.round(f * 100)}%`; });
playBtn.textContent = 'Click to play';
playBtn.disabled = false;
useMap(M.map);
document.querySelector('#menu .sub').textContent = M.subtitle;
if (M.briefing) document.getElementById('briefing').innerHTML = M.briefing;

const input = new Input(canvas);
const audio = new Audio();
audio.volume = settings.volume;
const world = new World(scene, renderer, M.site);
dressSite(world);
await usePhotoTextures(scene);                   // the photographs over the drawn textures
const player = new Player(world, input, audio);
const avatar = new Avatar(scene);
const rig = new CameraRig(world);
const fx = new Particles(scene, 420);
const arsenal = new Arsenal({ world, player, input, audio, fx, settings });
arsenal.camera = camera;
arsenal.avatar = avatar;
const hud = new Hud();
const post = new Post(renderer, scene, camera);
const mapView = new MapView(world);
const search = new Search({ world, player, arsenal, input, audio, hud });
const carry = new Carry({ world, player, input, audio, hud });
const masking = new Masking({ scene, world, audio, fx });
const stealth = new Stealth({ world, player, arsenal, masking, audio, hud });
arsenal.onImpactNoise = (point) => stealth.noise(point, 14, 'impact');
player.onNoise = (pos, radius, kind) => stealth.noise(pos, radius, kind);
const ai = new GuardAI({ scene, world, player, stealth, audio, fx, hud });
const mission = new Mission({ world, player, arsenal, stealth, ai, search, input, audio, fx, hud, def: M.def });
mission.title = M.subtitle.split(' · ')[0];
const explosions = new Explosions({ scene, world, player, stealth, audio, fx, hud, arsenal });
const hotspots = new Hotspots({ scene, world, player, stealth, masking, audio, fx, hud, arsenal, explosions });
hotspots.ai = ai; hotspots.mission = mission;
ai.hotspots = hotspots;
arsenal.hotspots = hotspots;
explosions.hotspots = hotspots;
explosions.onKills = (n) => mission.blastKills(n);
const tank = world.tankSpot ? new Tank({ scene, world, player, stealth, audio, fx, hud, explosions, hotspots }) : null;   // not every map has one
if (tank) tank.onDestroyed = () => mission.tankDestroyed();
mission.tank = tank;
const items = new Items({ scene, world, player, arsenal, camera, stealth, explosions, hotspots, input, audio, fx, hud });
explosions.chainers.push(items);
const rockets = new Rockets({ scene, world, explosions, hotspots, items, fx });
arsenal.rockets = rockets;
items.onAction = (kind) => avatar.perform(kind === 'throw' && player.stance === 'crouch' ? 'throwCrouch' : kind);
arsenal.items = items;
search.items = items;
arsenal.onAmmo = (name) => hud.message(`LOADING ${name.toUpperCase()} ROUNDS`);
let started = false;   // has the mission begun (the first click into the game)?
// Your collection and loadout (kept across missions), the things to find, and the workbenches.
const profile = new Profile();
const applyLoadout = (lo) => { arsenal.equip(lo); avatar.setWeapons(lo, arsenal); };
applyLoadout(profile.loadout);
const pickups = new Pickups({ scene, world, player, input, audio, stealth, hud, profile });
pickups.onPart = () => { mission.stats.parts = (mission.stats.parts ?? 0) + 1; };
// Heavy weapons: you can take ammunition for the ones you have; a found one goes into the slot.
arsenal.heavyOwned = (id) => profile.ownsWeapon(id);
pickups.onHeavy = (id) => { profile.setWeapon('heavy', id); applyLoadout(profile.loadout); };
// The test armoury fills the heavy ammunition too.
const fillHeavyForTest = () => { if (profile.testAll) for (const [id, a] of Object.entries(HEAVY_AMMO)) arsenal.heavyAmmo[id] = Math.max(arsenal.heavyAmmo[id], a.max); };
fillHeavyForTest();
search.pickups = pickups;
pickups.arsenal = arsenal; pickups.items = items; pickups.explosions = explosions;
explosions.chainers.push(pickups);
pickups.registerCrates(hotspots);
const beltGrenades = new BeltGrenades({ world, hotspots, explosions });
explosions.chainers.push(beltGrenades);
search.beltGrenades = beltGrenades;
mapView.pickups = pickups;
// Doors, documents and safes; the mission places its own.
const interactions = new Interactions({ scene, world, player, input, hud, audio, stealth, profile, missionId });
interactions.addDoors(world.doors);
mission.interactions = interactions;
M.intel?.(interactions, world, { pickups, items, arsenal, mission });
interactions.onSafe = (safe) => { if (safe.objective) mission.complete(safe.objective, safe.objectiveText ?? 'SAFE OPENED'); };
search.onPapers = () => { if (mission.papersDoc) interactions.give(mission.papersDoc); };
const loadoutUI = new LoadoutUI({ profile, apply: applyLoadout });
const benchEl = document.getElementById('bench');
let benchOpen = false;
function openBench() {
  benchOpen = true;
  benchEl.classList.add('on');
  loadoutUI.render(document.getElementById('loadout-bench'), { editable: true });
  document.exitPointerLock?.();
}
function closeBench() {
  if (!benchOpen) return;
  benchOpen = false;
  benchEl.classList.remove('on');
  input.lock();
}
pickups.onBench = openBench;
document.getElementById('bench-close').addEventListener('click', closeBench);
addEventListener('keydown', (e) => { if (e.code === 'Escape' && benchOpen) closeBench(); });
const renderMenuLoadout = () => loadoutUI.render(document.getElementById('loadout-menu'), profile.testAll
  ? { editable: true, note: 'Test armoury (Settings): everything unlocked, and you can change it any time.' }
  : started
  ? { editable: false, note: 'The mission is under way: find a workbench to change your weapons and parts.' }
  : { editable: true, note: 'Your weapons and the parts you have found so far. Changes are kept for your next mission.' });
// The campaign (Mission tab): the eight missions in order; finishing one unlocks the next.
function renderCampaign() {
  const el = document.getElementById('campaign');
  el.innerHTML = CAMPAIGN.map((m, i) => {
    const done = profile.completed(m.id), open = profile.unlocked(CAMPAIGN, m.id), current = m.id === missionId;
    const status = current ? 'playing' : !m.ready ? 'in preparation' : !open ? 'locked' : done ? 'done ✓' : 'ready';
    const intel = profile.intel(m.id).length;
    return `<button class="camp${current ? ' current' : ''}${m.ready && open && !current ? ' playable' : ''}${!open || !m.ready ? ' locked' : ''}" data-mission="${m.id}" ${m.ready && open && !current ? '' : 'disabled'}>
      <span class="n">${i + 1}</span><span><b>${m.name}</b><small>${m.place}${intel ? ` · ${intel} document${intel === 1 ? '' : 's'} found` : ''}</small></span><span class="st">${status}</span></button>`;
  }).join('');
  el.querySelectorAll('.camp.playable').forEach(b => b.addEventListener('click', () => {
    const m = missionById(b.dataset.mission);
    if (confirm(`Start ${m.name}?\n\n${m.brief}`)) chooseMission(m.id);
  }));
}
renderCampaign();

// Settings → Testing: the test armoury, and a sound check for every weapon sample.
const testAll = document.getElementById('set-testall');
testAll.checked = profile.testAll;
testAll.addEventListener('input', () => { profile.setTestAll(testAll.checked); fillHeavyForTest(); applyLoadout(profile.loadout); renderMenuLoadout(); renderCampaign(); });
document.getElementById('sound-check').append(...SOUND_CHECK.map(([label, name, gain]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', async () => { b.classList.add('playing'); await audio.check(name, gain); setTimeout(() => b.classList.remove('playing'), 600); });
  return b;
}));
const saves = new Saves({ world, player, arsenal, items, stealth, masking, ai, hotspots, tank, explosions, mission, search, mapView, hud, audio, pickups, beltGrenades, interactions, missionId, applyLoadout });
// Checkpoints: an autosave each time an objective is done (not the last one: the mission's over).
const completeObjective = mission.complete.bind(mission);
mission.complete = (id, message) => {
  const was = mission.obj(id).done;
  completeObjective(id, message);
  if (!was && !mission.done) setTimeout(() => { if (saves.save('auto').ok) hud.message('CHECKPOINT SAVED', ''); }, 1500);
};
const takedown = new Takedown({ world, player, avatar, stealth, input, audio, fx, hud });
takedown.onKill = () => { mission.stats.kills++; mission.stats.takedowns++; };
takedown.onSlowmo = () => { slowmoT = 0.45; };
mapView.mission = mission;
mapView.hotspots = hotspots;
arsenal.onShot = (origin, def) => { stealth.gunshot(origin, def); mission.onShot(); };
stealth.onRaise = (why) => mission.onRaise(why);
const endScreen = document.getElementById('end');
mission.onComplete = (sum) => {
  profile.completeMission(missionId);     // the next mission unlocks
  document.getElementById('rating').textContent = `RATING · ${sum.rating}`;
  document.getElementById('end-stats').innerHTML = sum.rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  endScreen.classList.add('on');
  menu.classList.add('hidden');
  audio.setSiren(0);
  audio.setTruck(0);
  document.exitPointerLock?.();
};
mission.onFail = (why) => {
  deathScreen.querySelector('h2').textContent = why;
  deathScreen.classList.add('on');
  menu.classList.add('hidden');
  audio.setSiren(0);
  document.exitPointerLock?.();
};
document.getElementById('again').addEventListener('click', () => location.reload());
document.getElementById('restart').addEventListener('click', () => location.reload());

// Save / load slots in the menu.
const slotsEl = document.getElementById('slots');
const SLOT_NAMES = { 1: 'Slot 1', 2: 'Slot 2', 3: 'Slot 3', auto: 'Checkpoint (autosave)', quick: 'Quick save (F5)' };
function showSlots(mode, toggle = true) {
  if (toggle && slotsEl.classList.contains('on') && slotsEl.dataset.mode === mode) { slotsEl.classList.remove('on'); return; }
  slotsEl.dataset.mode = mode;
  slotsEl.classList.add('on');
  slotsEl.querySelector('h2').textContent = mode === 'save' ? 'Save game' : 'Load game';
  const why = mode === 'save' ? saves.canSave('1') : null;
  slotsEl.querySelector('.why').textContent = why ?? '';
  const list = slotsEl.querySelector('.list');
  list.innerHTML = '';
  for (const { slot, save } of saves.list()) {
    if (mode === 'save' && (slot === 'auto' || slot === 'quick')) continue;
    const b = document.createElement('button');
    const when = save ? new Date(save.savedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';
    b.innerHTML = `<span>${SLOT_NAMES[slot]}${save ? ` · ${save.label}` : ' · empty'}</span><small>${when}</small>`;
    b.disabled = mode === 'save' ? !!why : !save;
    b.addEventListener('click', () => {
      if (mode === 'load') { saves.load(slot); return; }
      const r = saves.save(slot);
      if (r.ok) { showSlots('save', false); refreshLoadButton(); }
      slotsEl.querySelector('.why').textContent = r.ok ? `Saved to ${SLOT_NAMES[slot]}.` : r.why;
    });
    list.appendChild(b);
  }
}
document.getElementById('save-btn').addEventListener('click', () => showSlots('save'));
document.getElementById('load-btn').addEventListener('click', () => showSlots('load'));
const refreshLoadButton = () => document.getElementById('load-btn').classList.toggle('none', !saves.list().some(x => x.save));
refreshLoadButton();

// Killed: the body falls, the cursor comes back, a click restarts the mission.
const deathScreen = document.getElementById('death');
deathScreen.addEventListener('click', () => location.reload());
post.setQuality(settings.quality);
arsenal.onHit = (e) => { hud.onHit(e); mission.onHit(e); };
arsenal.onTag = (s) => hud.message(`TAGGED · ${s.label ? s.label() : s.name.toUpperCase()}`);

// A beat of slow motion on every kill that doesn't get the full X-ray kill cam.
let timeScale = 1, slowmoT = 0;
arsenal.onKill = () => { if (!killCam.active) slowmoT = 0.55; };

// X-ray kill cam: the arsenal hands over lethal shots; the cam applies the hit on impact.
const killCam = new KillCam({ scene, camera, audio, world });
arsenal.onKillCam = (cine) => {
  killCam.start(cine, () => {
    cine.bullet.vel.copy(cine.vel);
    cine.bullet.time = cine.time;
    arsenal.lastTrajectory = cine.path;
    arsenal.resolveHit(cine.bullet, cine.hit);
  }, (r) => {
    if (r.zone === 'engine') { input.consume(); return; } // the explosion already posted its message
    const d = `${Math.round(r.distance)} m`;
    const what = r.parts.length ? r.parts.slice(0, 2).join(' · ') : r.zone.toUpperCase();
    hud.message(r.zone === 'head' ? `HEADSHOT · ${what} · ${d}` : `${what} · ${d}`, r.zone === 'head' ? 'head' : '');
    input.consume();
  });
};

// Debug: the last bullet's path as a line (toggle with T).
const trajLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff5533, fog: false }));
trajLine.frustumCulled = false;
trajLine.visible = false;
scene.add(trajLine);
let shownTrajectory = null;

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  hud.resize();
}
addEventListener('resize', onResize);

// ---- menu and settings ----
const menu = document.getElementById('menu');
const bind = (id, key, fmt = (v) => v) => {
  const el = document.getElementById(id);
  const out = el.parentElement.querySelector('output');
  const kind = el.type === 'checkbox' ? 'check' : el.tagName === 'SELECT' ? 'select' : 'number';
  if (kind === 'check') el.checked = settings[key]; else el.value = settings[key];
  const show = () => { if (out) out.textContent = fmt(settings[key]); };
  show();
  el.addEventListener('input', () => {
    settings[key] = kind === 'check' ? el.checked : kind === 'select' ? el.value : parseFloat(el.value);
    show();
    if (key === 'volume') audio.setVolume(settings.volume);
    if (key === 'quality') post.setQuality(settings.quality);
    saveSettings(settings);
  });
};
// Menu tabs (the last one you had open is remembered, on this device only).
const tabButtons = [...document.querySelectorAll('.tabs button')];
function showTab(name) {
  for (const b of tabButtons) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t.dataset.tab === name);
  try { localStorage.setItem('sniper-slice.menuTab', name); } catch { /* storage blocked */ }
  if (name === 'loadout' && typeof renderMenuLoadout === 'function') renderMenuLoadout();
}
for (const b of tabButtons) b.addEventListener('click', () => showTab(b.dataset.tab));
let savedTab = null;
try { savedTab = localStorage.getItem('sniper-slice.menuTab'); } catch { /* storage blocked */ }
showTab(tabButtons.some(b => b.dataset.tab === savedTab) ? savedTab : 'mission');

bind('set-sens', 'sensitivity', (v) => v.toFixed(2));
bind('set-fov', 'fov', (v) => `${v}°`);
bind('set-vol', 'volume', (v) => `${Math.round(v * 100)}%`);
bind('set-invert', 'invertY');
bind('set-lung', 'lungMarker', () => '');
bind('set-killcam', 'killCam', () => '');
bind('set-quality', 'quality', () => '');
bind('set-aim', 'aimMode', () => '');

document.getElementById('play').addEventListener('click', () => {
  audio.start();
  input.lock();
});
// The menu doubles as the pause screen once the mission has started (`started`, declared above).
canvas.addEventListener('click', () => { if (!input.locked) input.lock(); });
input.onLockChange = (locked) => {
  const over = player.dead || mission.done;
  menu.classList.toggle('hidden', locked || mapView.open || over || benchOpen);
  if (locked && !started) {
    started = true;
    document.body.classList.add('started');
    document.getElementById('play').textContent = 'Resume';
    document.querySelector('#menu .sub').textContent = `Paused · ${M.subtitle.split(' · ')[0]}`;
  }
  // Pause while the menu is up (not for the map, which pauses on its own).
  menuPaused = !locked && !mapView.open && !over && !benchOpen;
  if (!locked && !benchOpen && document.querySelector('.tab.on')?.dataset.tab === 'loadout') renderMenuLoadout();
  if (audio.ctx) menuPaused ? audio.ctx.suspend() : audio.ctx.resume();
};
let birdT = 4;
let shadowFrame = 0;
let menuPaused = true;   // the world waits behind the menu until you click play
let forceRun = false;    // window.game.advance() steps even behind the menu

// Map (M): pauses the game and frees the cursor so you can click a waypoint.
function setMap(open, relock = true) {
  mapView.open = open;
  document.body.classList.toggle('mapopen', open);
  if (open) document.exitPointerLock?.();
  else if (relock) input.lock();
  else menu.classList.remove('hidden');
}

// ---- loop ----
let acc = 0;
let fps = 60;
const timer = new THREE.Timer();
timer.connect(document);
const lookAhead = new THREE.Vector3();
let paused = false;

function tick(dt) {
  if (input.wasPressed('F3')) ai.pathLines.visible = hud.debugOn = !hud.debugOn;
  if (input.wasPressed('F5')) { const r = saves.save('quick'); hud.message(r.ok ? 'QUICK SAVED' : `CAN'T SAVE: ${r.why.toUpperCase()}`, r.ok ? '' : 'wound'); }
  if (input.wasPressed('F9')) { if (!saves.load('quick')) hud.message('NO QUICK SAVE YET', 'wound'); }
  if (input.wasPressed('KeyT')) trajLine.visible = !trajLine.visible;
  if (player.dead) { input.keys.clear(); input.buttons.clear(); input.pressed.clear(); }
  player.tick(dt, { aiming: arsenal.aiming });
  items.tick(dt);      // before the rifle: healing or aiming a throw ties your hands
  arsenal.tick(dt);
  search.tick(dt);
  pickups.tick(dt);
  interactions.tick(dt);
  takedown.tick(dt);   // before the body drag: F takes down a living guard first
  carry.tick(dt);
  masking.update(dt, camera.position);
  stealth.tick(dt);
  ai.tick(dt);
  tank?.tick(dt);
  explosions.tick(dt);
  mission.tick(dt);
  hotspots.tick(dt);
  // Birdsong in the quiet; a gunshot or the siren silences it for a while.
  birdT -= dt;
  if (stealth.lastShot && stealth.time - stealth.lastShot.t < 0.05) birdT = 35;
  if (birdT <= 0) { birdT = 3 + Math.random() * 7; if (!stealth.alarm) audio.birdCall(); }
  world.tick(dt);
  if (player.dead && !deathScreen.classList.contains('on')) {
    deathScreen.classList.add('on');
    menu.classList.add('hidden');
    audio.setSiren(0);
    document.exitPointerLock?.();
  }
  input.consume();
}

// Resolution scaler: keeps the frame rate up on big screens by rendering a notch below the
// graphics setting when frames run long, and back up when there's headroom.
const scaler = { t: 0, sum: 0, n: 0, calm: 0 };
function scaleResolution(realDt) {
  if (menuPaused || mapView.open) { scaler.t = scaler.sum = scaler.n = 0; return; }
  if (realDt >= 0.1) return; // a hitch (coming back to the tab, loading a shader), not the frame rate
  scaler.t += realDt; scaler.sum += realDt; scaler.n++;
  if (scaler.t < 1.5) return;
  const avg = scaler.sum / scaler.n, pr = post.pixelRatio;
  scaler.t = scaler.sum = scaler.n = 0;
  if (avg > 1 / 52 && pr > post.minPixelRatio) { post.setPixelRatio(Math.max(post.minPixelRatio, pr - 0.25)); scaler.calm = 0; }
  else if (avg < 1 / 72 && pr < post.maxPixelRatio && ++scaler.calm >= 2) { post.setPixelRatio(Math.min(post.maxPixelRatio, pr + 0.25)); scaler.calm = 0; }
}

function frame(time) {
  timer.update(time);
  const realDt = Math.min(timer.getDelta(), 0.1);
  scaleResolution(realDt);
  step(realDt);
}

function step(realDt, draw = true) {
  fps += (1 / Math.max(realDt, 1e-4) - fps) * 0.05;

  if (input.wasPressed('KeyM') && !killCam.active && (input.locked || mapView.open)) {
    input.pressed.delete('KeyM');
    setMap(!mapView.open);
  }
  if (mapView.open) {
    if (input.wasPressed('Escape')) setMap(false, false);
    input.consume();
    input.takeMouse();
    mapView.drawFull({ player });
    return;
  }

  // During the kill cam the player has no control; the world runs at the cam's pace.
  if (killCam.active) {
    if (input.wasPressed('Mouse0') || input.wasPressed('Space')) killCam.skip();
    input.consume();
    input.takeMouse();
    const ws = killCam.update(realDt);
    world.tick(realDt * ws);
    fx.update(realDt * ws);
    avatar.root.visible = false;
    if (!draw) return;
    renderer.shadowMap.needsUpdate = (shadowFrame++ & 1) === 0;
    killCam.render(renderer, post);
    hud.update(realDt, { camera, player, arsenal, world, fps });
    return;
  }

  // Kill slow-mo: drop to 25% speed, then ease back to full speed.
  if (slowmoT > 0) slowmoT = Math.max(0, slowmoT - realDt);
  const targetScale = items.wheelOpen ? 0.2 : slowmoT > 0.2 ? 0.25 : 1; // the item wheel slows time too
  timeScale += (targetScale - timeScale) * (1 - Math.exp(-(slowmoT > 0.2 ? 30 : 6) * realDt));
  const dt = realDt * timeScale;

  if (!paused && (!menuPaused || forceRun) && (!benchOpen || forceRun)) {
    acc += dt;
    while (acc >= FIXED_DT) {
      tick(FIXED_DT);
      acc -= FIXED_DT;
    }
  }
  const alpha = acc / FIXED_DT;

  // Look: raw mouse delta, scaled down with zoom so the scope isn't twitchy.
  const m = input.takeMouse();
  const zoomScale = Math.tan(THREE.MathUtils.degToRad(arsenal.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(settings.fov) / 2);
  if (items.wheelOpen) items.wheelMouse(m);   // the mouse picks from the wheel instead of turning you
  else player.look(m.x, m.y, settings.sensitivity * zoomScale, settings.invertY);
  items.drawWheel();
  arsenal.frame(dt);

  // Third person while moving; the rifle scope and binoculars go to the eye.
  const fpBlend = Math.max(arsenal.current === 'rifle' ? arsenal.aim : 0, arsenal.binocT ?? 0);
  rig.update(realDt, camera, player, {
    yaw: player.yaw + arsenal.sway.yaw,
    pitch: player.pitch + arsenal.sway.pitch + arsenal.recoil,
    roll: arsenal.roll,
    alpha,
    pistolAim: arsenal.current === 'pistol' && arsenal.aim > 0.3,
    fpBlend,
  });
  if (Math.abs(camera.fov - arsenal.fov) > 1e-3) {
    camera.fov = arsenal.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();

  avatar.update(dt, {
    pos: new THREE.Vector3().lerpVectors(player.prevPos, player.pos, alpha),
    lookYaw: player.yaw, lookPitch: player.pitch, moveYaw: player.moveYaw,
    stance: player.stance, speed: player.speed, sprinting: player.sprinting, climb: player.climb, climbRate: player.climbRate, dead: player.dead, concealed: stealth.state().concealed, takedown: !!takedown.active, takedownYaw: takedown.active?.yaw,
    weapon: arsenal.current, aiming: arsenal.aiming, ready: arsenal.readyT,
    boltT: arsenal.boltT, reloading: arsenal.reloadT > 0, kick: arsenal.viewKick,
    throwAim: items.aimingThrow, healing: !!items.healing, searching: search.progress > 0,
    visible: fpBlend < 0.5 && rig.armLen > 0.9, // hide the body when a wall pushes the camera into it
  });
  takedown.placeKnife();

  // Shadows follow the look direction, reaching farther when zoomed in.
  const reach = 40 + 160 * fpBlend;
  lookAhead.set(0, 0, -reach).applyQuaternion(camera.quaternion).add(camera.position);
  world.focusShadows(lookAhead);
  world.nearGrass.update(player.pos.x, player.pos.z);
  world.viewer = camera.position;
  world.cullTrees(camera.position);

  fx.update(dt);
  hotspots.highlight(dt, camera);
  audio.setWind(world.windSpeed);

  if (trajLine.visible && arsenal.lastTrajectory && arsenal.lastTrajectory !== shownTrajectory) {
    shownTrajectory = arsenal.lastTrajectory;
    trajLine.geometry.dispose();
    trajLine.geometry = new THREE.BufferGeometry().setFromPoints(shownTrajectory);
  }

  if (!draw) return;
  renderer.shadowMap.needsUpdate = (shadowFrame++ & 1) === 0;
  post.draw();
  const st = stealth.state();
  const ss = search.state(), cs = carry.state(), co = player.climbOption(), cut = ai.sabotageOption(), rad = mission.radioOption();
  const td = takedown.state();
  const its = items.state();
  const heal = its.healing && { label: its.healing.id === 'medkit' ? 'USING A MEDKIT…' : 'BANDAGING…', progress: its.healing.progress };
  const pk = pickups.state(), ia = interactions.state();
  const prompts = heal ? [heal] : carry.body ? [cs] : takedown.active ? [] : [td, cut, rad, pk, ia, ss, td ? null : cs, co && { label: co.label, progress: 0 }].filter(Boolean);
  const prompt = prompts.length ? { label: prompts.map(p => p.label).join('   ·   '), progress: prompts[0].progress } : null;
  hud.update(realDt, { camera, player, arsenal, world, fps, search: prompt, waypoint: mapView.waypoint, stealth: st, mission, hotspots, res: post.pixelRatio, items: its });
  mapView.drawMini({ player, stealth: st });
}
// A load the player asked for (the page was reloaded to rebuild the world from the save).
// A save that can't be applied must never leave a black screen: start the mission fresh instead.
let loadedSlot = null;
try { loadedSlot = saves.applyPending(); } catch (e) {
  console.error('Could not load the save', e);
  hud.message('COULD NOT LOAD THAT SAVE · STARTING FRESH', 'wound');
}
if (loadedSlot) {
  document.querySelector('#menu .sub').textContent = `Loaded: ${SLOT_NAMES[loadedSlot]}`;
  hud.message('GAME LOADED', '');
}
// Upload every texture and compile every shader now, behind the menu, so nothing stalls the
// first time it comes into view.
scene.traverse((o) => { for (const m of [].concat(o.material ?? [])) for (const v of Object.values(m)) if (v?.isTexture) renderer.initTexture(v); });
await renderer.compileAsync(scene, camera);
renderer.setAnimationLoop(frame);

// Debug handle for automated play-testing from the console.
window.game = {
  beltGrenades, assets, rockets, interactions,
  THREE, world, player, arsenal, avatar, rig, camera, settings, hud, renderer, input, killCam, post, mapView, search, setMap, carry, masking, stealth, ai, mission, hotspots, takedown, scaleResolution, explosions, tank, items, saves, profile, pickups, applyLoadout, openBench, closeBench,
  get timeScale() { return timeScale; },
  pause(v = true) { paused = v; },
  // Run the game synchronously for `seconds` at `rate` fps (for testing while the tab is in the background).
  advance(seconds, rate = 60) {
    renderer.setAnimationLoop(null);
    const n = Math.round(seconds * rate);
    forceRun = true;
    for (let i = 0; i < n; i++) step(1 / rate, i === n - 1);
    forceRun = false;
    renderer.setAnimationLoop(frame);
  },
  // Point the camera at a world position (sway still applies on top). In third person the
  // camera orbits as it turns, so refine a few times from its new position.
  aimAt(x, y, z) {
    const target = new THREE.Vector3(x, y, z);
    for (let i = 0; i < 4; i++) {
      const from = rig.firstPerson > 0.5 ? player.eyePosition(1, new THREE.Vector3()) : camera.position;
      const d = target.clone().sub(from);
      player.yaw = Math.atan2(-d.x, -d.z);
      player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      step(0, false);
    }
  },
};
