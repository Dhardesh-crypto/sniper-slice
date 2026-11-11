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
import { loadAssets, assets, loadModel, weaponModelKey } from './world/characters.js';
import { loadProps, dressSite } from './world/props.js';
import { usePhotoTextures } from './world/textures.js';
import { skinBuildings } from './world/skins.js';
import { updateLods } from './world/lod.js';
import { MapView } from './ui/map.js';
import { Search } from './player/search.js';
import { Carry } from './player/carry.js';
import { MountedGuns } from './world/mgnest.js';
import { SideJobs } from './mission/sidejobs.js';
import { Decals } from './fx/decals.js';
import { Casings } from './fx/casings.js';
import { Dogs } from './ai/dogs.js';
import { CarPatrol } from './ai/patrol.js';
import { Searchlights } from './world/searchlights.js';
import { Birds } from './fx/birds.js';
import { BurnBarrels } from './world/burnbarrels.js';
import { Wire } from './world/wire.js';
import { applyWinter } from './world/winter.js';
import { Footprints } from './world/footprints.js';
import { Glint } from './stealth/glint.js';
import { Flags } from './world/flags.js';
import { SeaShore } from './world/seashore.js';
import { AirWar } from './world/airwar.js';
import { Disguise } from './player/disguise.js';
import { Driving } from './player/driving.js';
import { Flashlights } from './world/flashlights.js';
import { pickConditions } from './world/conditions.js';
import { runSeed, seeded } from './core/run.js';
import { Masking } from './stealth/masking.js';
import { Stealth } from './stealth/stealth.js';
import { GuardAI } from './ai/guards.js';
import { Mission } from './mission/mission.js';
import { Hotspots } from './world/hotspots.js';
import { Thoughts } from './player/thoughts.js';
import { Takedown } from './player/takedown.js';
import { CounterFire } from './ai/counterfire.js';
import { Clues } from './stealth/clues.js';
import { Alarms } from './world/alarms.js';
import { garrisonOrders, noteHabits } from './mission/garrison.js';
import { scoreChallenges, challengesHtml } from './mission/challenges.js';
import { Explosions } from './fx/explosions.js';
import { Wreckage } from './fx/wreckage.js';
import { Tank } from './world/tank.js';
import { initTurrets, tickTurrets, turretCrews } from './world/turrets.js';
import { initExhaust, tickExhaust } from './world/exhaust.js';
import { initGroundMarks, tickGroundMarks } from './world/groundmarks.js';
import { Weather } from './world/weather.js';
import { addAnimals, startle, tickAnimals, herdEvents } from './world/animals.js';
import { activeMap } from './world/terrain.js';
import { Items } from './player/items.js';
import { Saves } from './core/saves.js';
import { Profile } from './core/profile.js';
import { Pickups } from './world/pickups.js';
import { BeltGrenades } from './world/belt-grenades.js';
import { Rockets } from './weapons/rockets.js';
import { Interactions } from './world/interact.js';
import { CAMPAIGN, currentMissionId, chooseMission, missionById } from './missions/campaign.js';
import { STORY, HANDLER, storyLine } from './missions/story.js';
import { useMap } from './world/terrain.js';
import { plantProps } from './world/biomes.js';
import { PERKS, perkOf } from './core/perks.js';
import { placePhones, PHONE_DELAY } from './mission/zones.js';
import { duskOf } from './world/conditions.js';
import { Flyover, flyoverCaptions } from './ui/flyover.js';
import { HEAVY_AMMO, CATALOG } from './weapons/defs.js';
import { horizonReady } from './world/horizon.js';
import { LoadoutUI } from './ui/loadout.js';
import { installAtmosphere } from './world/atmosphere.js';
import { PadNav } from './ui/padnav.js';
import { Tutorial } from './mission/tutorial.js';
import { initGlyphs, fill, refreshStatic } from './ui/glyphs.js';
import { findApproaches, faceTarget } from './mission/approaches.js';
import { Flamers } from './world/flamer.js';
import { asset } from './core/version.js';

const FIXED_DT = 1 / 60;

const canvas = document.getElementById('view');
installAtmosphere();   // (before any shader is built)
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // redrawn every other frame (see step): half the cost, no visible difference
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

const scene = new THREE.Scene();
scene.onBeforeRender = (r, s, cam) => updateLods(cam);   // (every camera that draws the world)
const settings = loadSettings();
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 3000);
camera.rotation.order = 'YXZ';

// What's loaded before you can play is what this mission needs to start, no more: its own
// characters, the weapons you carry, its props and trees. The rest comes just in time
// (loadLater, below): the X-ray anatomy and the planes in idle moments after Play, a weapon's
// model when you find it or open the workbench, most sounds a moment after the first click.
const playBtn = document.getElementById('play');
playBtn.disabled = true;                          // (enabled when the loop starts, at the end of this file)
playBtn.textContent = 'Loading…';

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
  flak: () => import('./missions/flak.js'),
};
const missionId = MISSION_MODULES[currentMissionId()] ? currentMissionId() : 'vineyard';
const M = (await MISSION_MODULES[missionId]()).default;
{
  // Characters: you, the plain guard (reinforcements, patrols, any look that's missing), the
  // default officer, a tank's commander, and the looks this mission dresses its men in (`looks`).
  const carried = new Profile().loadout;          // (what you start with: its models now, the others when wanted)
  const models = ['player', 'guard', 'officerColonel', 'guardTanker', ...(M.looks ?? []),
    'rifle', ...['rifle', 'pistol', 'heavy'].map(slot => carried[slot] && weaponModelKey(CATALOG[carried[slot]]?.model)).filter(Boolean),
    ...((M.props ?? []).includes('mgNest') ? ['mg42'] : []),    // (the gun in a nest)
    'tank', 'opel', 'kubel', 'plane'];
  // Trees: the kinds this map plants (a forest map lists its own counts; the others have olives, cypresses, pines).
  // (a map with a `biome` plants that biome's, and may need the second ground model: world/biomes.js)
  const trees = plantProps(M.map);
  const props = [...trees, 'groundDetail', 'archKit', 'interiorKit', 'safe', 'siren', 'crates', 'desk', 'radioSet', 'mapTable', 'tableSet', 'locker', 'filingCabinet', 'bunk', 'dog', 'motorcycle',
    ...(M.map?.animals ?? []).map(a => a[0]), ...(M.props ?? [])];
  // One bar for both: the models are most of the bytes either way.
  const part = [0, 0], show = () => { playBtn.textContent = `Loading ${Math.round((part[0] * 0.5 + part[1] * 0.5) * 100)}%`; };
  await Promise.all([loadAssets((f) => { part[0] = f; show(); }, models), loadProps(props, (f) => { part[1] = f; show(); })]);
  playBtn.textContent = 'Building the map…';
}
M.map.id ??= missionId;                          // (its far country: textures/horizon_<id>.webp)
const conditions = pickConditions(M.map, runSeed, settings.season); // this run's weather: as briefed, or overcast, rain, mist; and maybe winter
useMap(M.map);
document.querySelector('#menu .sub').textContent = M.subtitle + (conditions.label ? ` · ${conditions.label}` : '');
if (M.briefing) document.getElementById('briefing').innerHTML = M.briefing + (conditions.label ? `<p><b>Conditions today:</b> ${conditions.label.toLowerCase()}. ${conditions.kind === 'overcast' ? 'Flat light, the far hills hazy.' : conditions.kind === 'dusk' ? 'The light is going; the searchlights are on and the guards carry torches. Keep out of the beams (a torch finds you even in tall grass), or shoot the lamps out.' : 'They see less far than usual; ' + (conditions.kind === 'rain' ? 'the rain also covers some of your noise.' : 'the mist lifts nothing before noon.')}</p>` : '');
// (a mission whose evening falls while you're in it says so: nightfall, below)
if (M.def?.evening && conditions.kind === 'briefed') document.getElementById('briefing').insertAdjacentHTML('beforeend', `<p><b>The light:</b> evening falls about ${Math.round(M.def.evening.at / 60)} minutes in. By day they see you from further off, but you see everything: look the place over. At dusk they see a quarter less far, and the searchlights and torches are lit: that is the time for the shot, if you keep out of the beams.</p>`);
document.getElementById('briefing').insertAdjacentHTML('afterbegin', storyLine(missionId));   // (the story so far: missions/story.js)
if (conditions.winter) document.getElementById('briefing').insertAdjacentHTML('beforeend', `<p>Snow on the ground: tracks show (the guards' show you their rounds; a guard who finds yours follows them), and a dark uniform shows up against it${conditions.snowing ? '; the falling snow hides you a little' : ''}. The guards gather round their fires.</p>`);

const input = new Input(canvas);
initGlyphs(input);
input.settings = settings;   // (the pad's vibration setting)
const audio = new Audio();
audio.volume = settings.volume;
audio.musicVolume = settings.music;
audio.plan = { weapons: ['rifle', 'pistol', 'heavy'].map(slot => new Profile().loadout[slot]).filter(Boolean), sea: M.map.waterLevel != null };   // (which samples the first wave fetches: core/audio.js loadSamples)
const world = new World(scene, renderer, M.site);
dressSite(world);
await usePhotoTextures(scene, M.map.wallStyle);                   // the photographs over the drawn textures
const skinsReady = skinBuildings(scene, missionId);               // the landmarks' own weathered outsides (world/skins.js)
const player = new Player(world, input, audio);
player.settings = settings;   // (the combat difficulty: core/difficulty.js)
const avatar = new Avatar(scene);
const rig = new CameraRig(world);
const fx = new Particles(scene, 600);   // (tank exhausts keep a few dozen in the air)
// This run's wind, drawn from its seed: still in a morning mist, fresh under rain clouds.
{
  const r = seeded(runSeed ^ 0x3171d), [lo, hi] = { mist: [0.4, 1.6], dusk: [0.8, 3], overcast: [2, 5], rain: [3, 7] }[conditions.kind] ?? [1, 5.5];
  world.windAngle = r() * Math.PI * 2; world.windBase = lo + (hi - lo) * r(); world.updateWind();
}
fx.wind = world.wind; fx.snow = !!activeMap().winter;   // (puffs drift downwind; in winter the ground throws up snow)
world.barrels = new BurnBarrels({ scene, world, fx, seed: runSeed });   // fires in oil drums by the guard posts (before the guards' map is drawn)
const flags = new Flags({ scene, world, seed: runSeed });   // pennants at the posts, to read the wind by
const seashore = new SeaShore({ scene, world, audio, player });   // the waves on the shore, gulls over the sea
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
stealth.settings = settings;  // (the guards' difficulty: sight and hearing)
arsenal.onImpactNoise = (point) => stealth.noise(point, 14, 'impact');
player.onNoise = (pos, radius, kind) => stealth.noise(pos, radius, kind);
const ai = new GuardAI({ scene, world, player, stealth, audio, fx, hud });
const dogs = new Dogs({ scene, world, player, stealth, audio, fx, hud, nav: ai.nav, seed: runSeed });   // a guard dog or two this run
const mission = new Mission({ world, player, arsenal, stealth, ai, search, input, audio, fx, hud, def: M.def });
mission.title = M.subtitle.split(' · ')[0];
const explosions = new Explosions({ scene, world, player, stealth, audio, fx, hud, arsenal });
const hotspots = new Hotspots({ scene, world, player, stealth, masking, audio, fx, hud, arsenal, explosions });
hotspots.wreckage = new Wreckage({ scene, world, fx });   // vehicles that blow up come apart
const patrol = new CarPatrol({ scene, world, ai, stealth, hotspots, audio, fx, hud, player, seed: runSeed });   // a Kübelwagen up and down the road
const searchlights = new Searchlights({ scene, world, player, stealth, hotspots, audio, hud });   // lit at dusk, sweeping
const birds = new Birds({ scene, world, audio, player });   // put up out of the trees by shots and blasts
explosions.onBlast = (at, size) => {
  birds.flush(at, 1.6 * size);
  const near = Math.max(0, 1 - at.distanceTo(player.pos) / (60 * size));   // (the pad shakes for blasts near you)
  if (near > 0) input.rumble(0.5 * near, near, 180 + 320 * near);
};
stealth.glint = new Glint({ scene, world, player, arsenal, camera });   // your scope flashing in the sun, and theirs
const footprints = new Footprints({ scene, world, player, stealth, hud });   // boot prints in the snow (winter)
const flashlights = new Flashlights({ scene, world, player });   // and at dusk the guards carry torches
hotspots.ai = ai; hotspots.mission = mission;
ai.hotspots = hotspots;
arsenal.hotspots = hotspots;
explosions.hotspots = hotspots;
explosions.onKills = (n) => mission.blastKills(n);
initTurrets({ scene, world, player, stealth, audio, fx, hud, explosions });   // every tank's crew
initExhaust({ fx, player });          // fumes from every running engine
initGroundMarks(scene);               // tracks and tyre marks in the soft ground
const weather = new Weather({ scene, camera, fx, audio, player, world });   // rain, mist, spray (per mission)
world.decals = new Decals({ scene, world });   // bullet holes, blood
world.casings = new Casings({ scene, world, audio }); // spent brass, ringing as it lands
for (const [kind, x, z, r, n] of activeMap().animals ?? []) addAnimals(scene, kind, x, z, r, n);   // cows, goats, deer
{ const heard = stealth.noise.bind(stealth); stealth.noise = (pos, radius, kind) => { startle(pos, Math.min(radius, 150)); return heard(pos, radius, kind); }; }   // shots and blasts scatter them
const tank = world.tankSpot ? new Tank({ scene, world, player, stealth, audio, fx, hud, explosions, hotspots }) : null;   // not every map has one
if (tank) tank.onDestroyed = () => mission.tankDestroyed();
mission.tank = tank;
const items = new Items({ scene, world, player, arsenal, camera, stealth, explosions, hotspots, input, audio, fx, hud });
const airwar = new AirWar({ scene, world, player, stealth, audio, fx, hud, explosions, hotspots, camera, arsenal, input, seed: runSeed });   // bombers and flak overhead; strikes you call in
hud.airwar = airwar;
explosions.chainers.push(items);
const rockets = new Rockets({ scene, world, explosions, hotspots, items, fx });
arsenal.rockets = rockets;
items.onAction = (kind) => { avatar.perform(kind === 'throw' && player.stance === 'crouch' ? 'throwCrouch' : kind); if (kind === 'throw') tutorial.onThrow(); };
arsenal.items = items;
search.items = items;
arsenal.onAmmo = (name) => hud.message(name ? `LOADING ${name.toUpperCase()} ROUNDS` : 'NO OTHER AMMUNITION');
let started = false;   // has the mission begun (the first click into the game)?
// Your collection and loadout (kept across missions), the things to find, and the workbenches.
const profile = new Profile();
const applyLoadout = (lo) => { arsenal.equip(lo); avatar.setWeapons(lo, arsenal); };
applyLoadout(profile.loadout);
const pickups = new Pickups({ scene, world, player, input, audio, stealth, hud, profile });
pickups.onPart = () => { mission.stats.parts = (mission.stats.parts ?? 0) + 1; };
pickups.onPerk = () => { mission.stats.perk = true; renderCampaign(); };   // (the mission's hidden find: core/perks.js)
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
const guns = new MountedGuns({ world, player, input, arsenal, audio });
interactions.addDoors(world.doors);
mission.interactions = interactions;
M.intel?.(interactions, world, { pickups, items, arsenal, mission, scene, player, audio, hud, hotspots });
// The garrison's places and their telephone lines (mission/zones.js), on a map that has zones.
if (ai.zones) {
  placePhones({ zones: ai.zones, scene, world, interactions, mission, hud, stealth });
  const names = ai.zones.list.map(z => z.name);
  document.getElementById('briefing').insertAdjacentHTML('beforeend', `<p><b>The garrison</b> is in ${names.length} places: ${names.slice(0, -1).join(', ')} and ${names.at(-1)}. An alarm wakes the place it is raised in; the places near by send two men to look; the rest hear of it by telephone ${PHONE_DELAY} seconds later. Each place has its line on a pole with a grey box: cut it, and that place is never warned, and can warn nobody.</p>`);
}
const wire = new Wire({ scene, world, interactions, stealth, audio, hud, pickups });   // barbed wire: hold E to cut a gap (after the mission's own levers, so saves keep their order)
interactions.onSafe = (safe) => { if (safe.objective) mission.complete(safe.objective, safe.objectiveText ?? 'SAFE OPENED'); };
search.onPapers = () => { if (mission.papersDoc) interactions.give(mission.papersDoc); };
const loadoutUI = new LoadoutUI({ profile, apply: applyLoadout });
const benchEl = document.getElementById('bench');
let benchOpen = false;
function openBench() {
  benchOpen = true;
  benchEl.classList.add('on');
  loadoutUI.render(document.getElementById('loadout-bench'), { editable: true });
  input.unlock();
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
    const status = current ? 'playing' : !open ? 'locked' : done ? 'done ✓' : 'ready';
    const intel = profile.intel(m.id).length;
    // (the mission's hidden cache, core/perks.js: what it taught you once found; that there is one, before)
    const pk = perkOf(m.id), learnt = pk && (profile.hasPerk(pk) ? ` · learnt: ${PERKS[pk].name.toLowerCase()}` : open ? ' · a hidden cache not found yet' : '');
    return `<button class="camp${current ? ' current' : ''}${open && !current ? ' playable' : ''}${!open ? ' locked' : ''}" data-mission="${m.id}" ${open && !current ? '' : 'disabled'}>
      <span class="n">${i + 1}</span><span><b>${m.name}</b><small>${m.place}${intel ? ` · ${intel} document${intel === 1 ? '' : 's'} found` : ''}${learnt || ''}</small></span><span class="st">${status}</span></button>`;
  }).join('');
  el.querySelectorAll('.camp.playable').forEach(b => b.addEventListener('click', () => {
    const m = missionById(b.dataset.mission);
    // On the pad a browser dialog can't be answered (no pointer, and it stops the page reading the
    // pad), so the question is asked on the button itself: press again to go.
    if (input.device === 'pad') {
      if (b.dataset.armed) { chooseMission(m.id); return; }
      b.dataset.armed = '1';
      b.querySelector('.st').textContent = fill('{SPACE} again to start');
      return;
    }
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
const saves = new Saves({ world, player, arsenal, items, stealth, masking, ai, hotspots, tank, explosions, mission, search, mapView, hud, audio, pickups, beltGrenades, interactions, wire, missionId, applyLoadout });
const jobs = new SideJobs({ world, mission, ai, interactions, hud, saves });   // two side jobs drawn for this run
// Checkpoints: an autosave each time an objective is done (not the last one: the mission's over).
const completeObjective = mission.complete.bind(mission);
mission.complete = (id, message) => {
  const was = mission.obj(id).done;
  completeObjective(id, message);
  if (!was && !mission.done) setTimeout(() => { if (saves.save('auto').ok) hud.message('CHECKPOINT SAVED', ''); }, 1500);
};
const takedown = new Takedown({ world, player, avatar, stealth, input, audio, fx, hud, arsenal });
takedown.dogs = dogs;   // (F knifes a dog that's close)
takedown.search = search;   // (and a man you knife or bayonet is searched there and then)
const disguise = new Disguise({ world, player, avatar, arsenal, input, audio, hud, carry, takedown });   // a dead guard's uniform
stealth.disguise = disguise;
hud.disguise = disguise;
saves.g.disguise = disguise;
saves.g.dogs = dogs;
const driving = new Driving({ world, player, avatar, input, audio, hud, stealth, camera, patrol, ai, disguise });   // take a truck, car or motorcycle
takedown.onKill = (s) => { mission.stats.kills++; mission.stats.takedowns++; if (s?.officer) mission.stats.targetBy = 'knife'; };
takedown.onSlowmo = () => { slowmoT = 0.45; };
mapView.mission = mission;
mapView.hotspots = hotspots;
arsenal.onShot = (origin, def) => { stealth.gunshot(origin, def); mission.onShot(); tutorial.onShot(); };
// What the Germans have learnt about you so far, and what they do on the ways in.
const orders = garrisonOrders(profile.habits);
if (orders?.sight) stealth.sightK = orders.sight;
if (orders?.ears) stealth.earsK = orders.ears;
if (orders?.dogs) dogs.more(orders.dogs);
const counterfire = new CounterFire({ scene, world, player, stealth, ai, audio, explosions, beltGrenades });
const flamers = new Flamers({ world, player, stealth, audio, fx, explosions, ai });   // the flamethrower men (world/flamer.js)
ai.flamers = flamers;
hud.grenades = () => counterfire.near();
const clues = new Clues({ world, stealth, interactions });
if (orders?.mate) clues.mateTime = orders.mate;
const alarms = new Alarms({ scene, world, player, stealth, ai, interactions, audio, hud, seed: runSeed, extra: orders?.alarms ?? 0 });
stealth.alarms = alarms;
herdEvents.onBolt = (at) => stealth.disturbance(at, 80);   // (a guard sees the herd go)
if (orders) document.getElementById('briefing').insertAdjacentHTML('afterbegin', `<p class="brief"><b>The garrison:</b> ${orders.text}</p>`);
document.getElementById('briefing').insertAdjacentHTML('beforeend', challengesHtml(mission, profile.challenges(missionId)));
stealth.onRaise = (why) => mission.onRaise(why);
const endScreen = document.getElementById('end');
// The mission is over (won, failed or dead): every running loop stops, the music too.
function silence() {
  audio.setSiren(0); audio.setTruck(0); audio.setEngine(0); audio.loopSample('column', 'army_truck', 0);
  audio.setTankTracks(0); audio.setTurret(0); audio.setRain(0);
  audio.stopMusic();
}
mission.onComplete = (sum) => {
  profile.completeMission(missionId);     // the next mission unlocks
  noteHabits(profile, mission.stats, ai.alarm.count);
  const scored = scoreChallenges({ profile, missionId, mission, pickups, sum: { stats: mission.stats, rating: sum.rating, alarms: ai.alarm.count, time: mission.time, mission } });
  if (scored.fresh.length) sum.rows.push(['Challenges met', scored.fresh.map(c => c.text).join('\n')]);
  if (scored.parts.length) sum.rows.push(['Earned', scored.parts.join(', ')]);
  document.getElementById('rating').textContent = `RATING · ${sum.rating}`;
  document.getElementById('end-stats').innerHTML = sum.rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  // Ellis's report: what it's bought, and where it leads.
  if (story) { document.getElementById('report').innerHTML = `<p class="from">${HANDLER} · to Kestrel</p><p>${story.outro}</p>`; playVoice(`story_${missionId}_outro`); }
  // On to the next mission in the campaign (the last one: only playing it again).
  const next = CAMPAIGN[CAMPAIGN.findIndex(m => m.id === missionId) + 1];
  const nextBtn = document.getElementById('next'), againBtn = document.getElementById('again');
  nextBtn.hidden = !next;
  againBtn.classList.toggle('ghost', !!next);
  if (next) nextBtn.textContent = `Next mission · ${next.name}`;
  nextBtn.onclick = next ? () => chooseMission(next.id) : null;
  endScreen.classList.add('on');
  menu.classList.add('hidden');
  silence();
  input.unlock();
};
mission.onFail = (why) => {
  deathScreen.querySelector('h2').textContent = why;
  deathScreen.classList.add('on');
  menu.classList.add('hidden');
  silence();
  input.unlock();
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
arsenal.onHit = (e) => { hud.onHit(e); mission.onHit(e); tutorial.onHit(e); };
// A near miss: he ducks, and knows roughly where it came from (a supersonic crack: shot at, alerted;
// a subsonic round's hiss and smack: suspicious).
arsenal.onNearMiss = (s, b) => {
  s.nearMiss();
  if (!s.aware) return;
  const from = b.origin.clone(), err = s.root.position.distanceTo(from) * 0.15;
  from.x += (Math.random() - 0.5) * 2 * err; from.z += (Math.random() - 0.5) * 2 * err;
  stealth.raise(s, b.vel.length() > 340 ? 'alerted' : 'suspicious', from, 'heard');
};
const thoughts = new Thoughts({ audio, arsenal, player, mission, ai, quiet: () => killCam.active });
arsenal.onTag = (s) => { hud.message(`TAGGED · ${s.label ? s.label() : s.name.toUpperCase()}`); thoughts.tagged(s); };

// A beat of slow motion on every kill that doesn't get the full X-ray kill cam.
let timeScale = 1, slowmoT = 0;
arsenal.onKill = (e) => {
  if (!killCam.active) slowmoT = 0.55;
  // Mastery (core/profile.js): at 10, 25 and 50 kills a weapon earns a part for its kind.
  const earned = profile.addKill(arsenal.def?.id);
  if (earned) hud.message(`MASTERY · ${(CATALOG[arsenal.def.id]?.name ?? '').toUpperCase()} · ${earned.kills} KILLS · ${earned.part ? `PART EARNED: ${earned.part.name.toUpperCase()}` : 'EVERY PART IS YOURS ALREADY'}`, 'head');
  if (e.kills >= 2) hud.message(e.kills >= 3 ? 'TRIPLE KILL' : 'DOUBLE KILL', 'head');   // one round through two (or three) men
};

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
    if (key === 'music') audio.setMusicVolume(settings.music);
    if (key === 'quality') post.setQuality(settings.quality);
    saveSettings(settings);
  });
};
// Menu tabs (the last one you had open is remembered, on this device only).
const tabButtons = [...document.querySelectorAll('#menu .tabs button')];
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
bind('set-music', 'music', (v) => `${Math.round(v * 100)}%`);
bind('set-invert', 'invertY');
bind('set-pad-sens', 'padSensitivity', (v) => v.toFixed(2));
bind('set-pad-invert', 'padInvertY');
bind('set-vibration', 'vibration');
bind('set-hints', 'hints');
bind('set-ballistics', 'ballistics', () => '');
bind('set-guards', 'guards', () => '');
bind('set-combat', 'combat', () => '');
bind('set-lung', 'lungMarker', () => '');
bind('set-killcam', 'killCam', () => '');
bind('set-quality', 'quality', () => '');
bind('set-aim', 'aimMode', () => '');
bind('set-season', 'season', () => '');
document.getElementById('set-season')?.addEventListener('change', () => setTimeout(() => location.reload(), 60));   // (the map is built for its season: start again)

// The story: before the first start, Ellis's orders on a dispatch card (read out); a loaded game
// goes straight in. The click that closes the card starts the mission.
const story = STORY[missionId];
let briefed = !story;
const playVoice = (name) => {
  try {
    storyVoice?.pause();
    storyVoice = new Audio(asset(`sounds/${name}.mp3`));
    storyVoice.volume = audio.muted ? 0 : Math.min(1, settings.volume * 1.1);   // (?mute: silent)
    storyVoice.play().catch(() => {});
  } catch { /* no audio: the words are on the card */ }
};
let storyVoice = null;
function showDispatch(then) {
  const card = document.getElementById('dispatch');
  card.querySelector('.date').textContent = story.date;
  card.querySelector('h2').textContent = story.title;
  card.querySelector('.from').textContent = `From ${HANDLER} · to Kestrel`;
  const body = card.querySelector('.body');
  body.textContent = '';
  card.classList.add('on');
  menu.classList.add('hidden');
  playVoice(`story_${missionId}_intro`);
  // Typed out as he speaks (about his pace), all at once on a click.
  let i = 0;
  const words = orders ? `${story.intro}\n\n${orders.text}` : story.intro;   // (what the garrison has learnt: mission/garrison.js)
  const type = setInterval(() => { i = Math.min(words.length, i + 3); body.textContent = words.slice(0, i); if (i >= words.length) clearInterval(type); }, 40);
  const go = () => {
    if (body.textContent.length < words.length) { clearInterval(type); body.textContent = words; return; }   // (first click: the whole text)
    card.removeEventListener('click', go); window.removeEventListener('keydown', key);
    card.classList.remove('on');
    then();
  };
  const key = (e) => { if (e.code === 'Space' || e.code === 'Enter') go(); };
  card.addEventListener('click', go);
  window.addEventListener('keydown', key);
}
document.getElementById('play').addEventListener('click', () => {
  if (!briefed) { briefed = true; audio.start(); audio.fetchMusic(M.map.music ?? missionId); showDispatch(() => document.getElementById('play').click()); return; }
  audio.start();
  audio.startMusic(M.map.music ?? missionId);
  input.lock();
});
// The menu doubles as the pause screen once the mission has started (`started`, declared above).
canvas.addEventListener('click', () => { if (!input.pointerLocked) { input.setDevice('kb'); input.lock(); } });
input.onLockChange = (locked) => {
  const over = player.dead || mission.done;
  // Esc (the browser frees the mouse) while aiming a throw: it's put away, not thrown on resume.
  if (!locked) items.cancelThrow();
  // Keys pressed in the menu (F9, R, H, G...) must not all go off on the first step after Resume.
  if (locked) input.consume();
  menu.classList.toggle('hidden', locked || mapView.open || over || benchOpen);
  if (locked && !started) {
    started = true;
    document.body.classList.add('started');
    const play = document.getElementById('play');
    play.textContent = 'Resume';
    delete play.dataset.pad; delete play.dataset.kb;   // (no longer "press to play": ui/glyphs.js leaves it be)
    document.querySelector('#menu .sub').textContent = `Paused · ${M.subtitle.split(' · ')[0]}`;
    takeStart();        // the way in chosen in the Mission tab
    renderApproaches();
    loadLater();        // what the mission didn't need to start (the end of this file)
    const train = () => { if (chosenStart() === 'start') tutorial.begin(); };   // the first mission's training, the first time (mission/tutorial.js): on the start hill only
    if (!loadedSlot && !new URLSearchParams(location.search).has('nofly')) startFlyover(train); else train();
  }
  // Pause while the menu is up (not for the map, which pauses on its own).
  menuPaused = !locked && !mapView.open && !over && !benchOpen;
  if (!locked && !benchOpen && document.querySelector('.tab.on')?.dataset.tab === 'loadout') renderMenuLoadout();
  if (audio.ctx) menuPaused ? audio.ctx.suspend() : audio.ctx.resume();
};
let birdT = 4, lastFlush = null;
let shadowFrame = 0;
let menuPaused = true;   // the world waits behind the menu until you click play
let forceRun = false;    // window.game.advance() steps even behind the menu

// The map's side panel: Objectives / Orders tabs.
for (const b of document.querySelectorAll('#mapside .tabs button')) b.addEventListener('click', (e) => {
  e.stopPropagation();
  for (const x of document.querySelectorAll('#mapside [data-mtab]')) {
    if (x.tagName === 'BUTTON') x.setAttribute('aria-selected', String(x === b));
    else x.classList.toggle('on', x.dataset.mtab === b.dataset.mtab);
  }
});
// Map (M): pauses the game and frees the cursor so you can click a waypoint.
function setMap(open, relock = true) {
  mapView.open = open;
  if (open) document.getElementById('mapside-orders').innerHTML = document.getElementById('briefing').innerHTML;   // (the Orders tab: the briefing as it stands)
  document.body.classList.toggle('mapopen', open);
  if (open) input.unlock();
  else if (relock) input.lock();
  else menu.classList.remove('hidden');
}

// The pad's right stick: look (turn rate in rad/s, on a curve so small pushes aim finely), or the
// slot on an open wheel, pointed at like a clock hand (the wheels take a cursor: wheelMouse).
const PAD_TURN = 3.4, PAD_PITCH = 2.2;   // rad/s at full stick, sensitivity 1, unzoomed
function padLook(realDt, zoomScale) {
  const s = input.padLook;
  if (!s) return;
  const wheel = items.wheelOpen ? items.cursor : arsenal.wwheelOpen ? arsenal.wwCursor : null;
  if (wheel) {
    if (Math.hypot(s.x, s.y) < 0.5) return;
    const to = { x: s.x * 140 - wheel.x, y: s.y * 140 - wheel.y };
    (items.wheelOpen ? items : arsenal).wheelMouse(to);
    return;
  }
  const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.8);
  const k = settings.padSensitivity * zoomScale * realDt / 0.0022;   // player.look's units: mouse counts
  player.look(curve(s.x) * PAD_TURN * k, curve(s.y) * PAD_PITCH * k, 1, settings.padInvertY);
}
// Several ways in and out (mission/approaches.js): the start chosen in the Mission tab, taken
// when the mission begins (not for a loaded game), and every one of them a pick-up at the end.
const approaches = findApproaches(world);
const START_KEY = `sniper-slice.start.${missionId}`;
const chosenStart = () => { try { return sessionStorage.getItem(START_KEY) || 'start'; } catch { return 'start'; } };
mission.setPickups(approaches);
// The fly-over of this mission's land before you set out (ui/flyover.js): on a new mission, not a
// loaded game; ?nofly in the address leaves it out.
const flyover = new Flyover({ world, post });
function startFlyover(then) {
  const a = approaches.find(x => x.id === chosenStart()) ?? approaches[0], c = activeMap().focus;
  const hide = (v) => { for (const id of ['hud', 'markers']) document.getElementById(id).style.visibility = v; };
  hide('hidden');
  // (the garrison isn't shown from the air: where they stand is for you to find out)
  const shown = world.soldiers.filter(s => s.root.visible);
  for (const s of shown) s.root.visible = false;
  flyover.begin({ from: a.at, to: c, captions: flyoverCaptions({ title: mission.title, side: a.side, target: mission.officer?.name }),
    onEnd: () => { hide(''); for (const s of shown) s.root.visible = true; input.consume(); then?.(); } });
}
// Evening falls during a mission that says so (its def's `evening: { at: seconds }`), on a run
// that began in its briefed daylight: the day is for looking (they see you from further off, but
// you see everything), the dusk for the shot (they see a quarter less far; the searchlights and
// the guards' torches come on, and a beam finds you even in tall grass). A minute's warning, then
// a short fade, behind which the light is changed and the lamps are lit.
let eveningWarned = false, eveningFalling = false;
function nightfall() {
  if (eveningFalling) return;
  eveningFalling = true;
  let veil = document.getElementById('evening');
  if (!veil) { veil = document.createElement('div'); veil.id = 'evening'; veil.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;transition:opacity .9s;pointer-events:none;z-index:30'; document.body.appendChild(veil); }
  veil.style.opacity = '1';
  setTimeout(() => {
    Object.assign(activeMap(), duskOf(activeMap()));
    const L = world.relight();
    post.setGrade(L.warmth, L.saturation);
    searchlights.light(); flashlights.light();
    renderer.shadowMap.needsUpdate = true;
    veil.style.opacity = '0';
    hud.message('EVENING · THEY SEE LESS FAR NOW · THE LAMPS ARE LIT: KEEP OUT OF THE BEAMS', '');
  }, 950);
}
function takeStart() {
  const a = approaches.find(x => x.id === chosenStart());
  if (loadedSlot || !a || a.id === 'start') return;
  player.pos.copy(a.at); player.prevPos.copy(a.at); player.vel.set(0, 0, 0);
  player.yaw = player.moveYaw = faceTarget(a.at);
}
function renderApproaches() {
  const el = document.getElementById('approaches');
  if (!el) return;
  const now = chosenStart();
  el.innerHTML = `<h3>Way in</h3><div class="ways">${approaches.map(a => `<button class="way${a.id === now ? ' on' : ''}" data-way="${a.id}" ${started ? 'disabled' : ''}><b>${a.name}</b><small>${a.id === 'start' ? 'as briefed' : `${Math.round(a.at.distanceTo(approaches[0].at))} m from the usual start`}</small></button>`).join('')}</div>
    <p class="set-note">${started ? 'Chosen for this mission.' : 'Pick before you set out.'} Once the job is done, any of these is a pick-up: green smoke marks them.</p>`;
  for (const b of el.querySelectorAll('[data-way]')) b.addEventListener('click', () => { try { sessionStorage.setItem(START_KEY, b.dataset.way); } catch { /* storage blocked */ } renderApproaches(); });
}
renderApproaches();
const tutorial = new Tutorial({ input, player, arsenal, items, stealth, world, profile, settings, missionId, mapView });
document.getElementById('skip-training').addEventListener('click', () => { tutorial.finish(true); document.getElementById('play').click(); });
document.getElementById('replay-training').addEventListener('click', (e) => {
  tutorial.replay();
  e.target.textContent = missionId === 'vineyard' ? 'Training restarted' : 'It runs next time you play Vineyard';
});
const padNav = new PadNav({
  input, map: mapView,
  closeMap: () => setMap(false),
  closeBench: () => closeBench(),
  resume: () => document.getElementById('play').click(),
});

// ---- loop ----
let acc = 0;
let fps = 60;
const timer = new THREE.Timer();
timer.connect(document);
const lookAhead = new THREE.Vector3();
const avatarPos = new THREE.Vector3();   // (reused every frame: the avatar copies it)
let paused = false;

function tick(dt) {
  if (ai.zones) for (const z of ai.zones.list) z.restore?.();      // (a loaded game's cut lines: mission.flags)
  const ev = mission.def.evening;
  if (ev && !activeMap().dusk && conditions.kind === 'briefed' && !mission.done) {
    if (!eveningWarned && mission.time > ev.at - 60) { eveningWarned = true; if (mission.time < ev.at) hud.message('THE LIGHT IS GOING · IN A MINUTE THEY SEE LESS FAR, AND THE LAMPS COME ON', ''); }
    if (mission.time > ev.at) nightfall();
  }
  if (input.wasPressed('F3')) ai.pathLines.visible = hud.debugOn = !hud.debugOn;
  if (input.wasPressed('F5')) { const r = saves.save('quick'); hud.message(r.ok ? 'QUICK SAVED' : `CAN'T SAVE: ${r.why.toUpperCase()}`, r.ok ? '' : 'wound'); }
  if (input.wasPressed('F9')) { if (!saves.load('quick')) hud.message('NO QUICK SAVE YET', 'wound'); }
  if (input.wasPressed('KeyT')) trajLine.visible = !trajLine.visible;
  if (player.dead) { input.keys.clear(); input.buttons.clear(); input.pressed.clear(); }
  player.tick(dt, { aiming: arsenal.aiming });
  airwar.tick(dt);     // before the items: G through the binoculars calls a strike, not a throw
  items.tick(dt);      // before the rifle: healing or aiming a throw ties your hands
  arsenal.tick(dt);
  search.tick(dt);
  thoughts.tick(dt);
  driving.tick(dt);     // before the rest that E works: getting in or out takes the key
  disguise.tick(dt);
  pickups.tick(dt);
  wire.tick(player);
  world.tunnels?.tick(dt);
  interactions.tick(dt);
  guns.tick(dt, !!(pickups.state() || interactions.state() || search.state()?.label));
  // Shoulder swap: Tab, or on the pad the right stick's click when there's nobody to take down
  // and no body to drag (the same click does those).
  if (input.wasPressed('Tab') || (input.device === 'pad' && input.wasPressed('KeyF') && !arsenal.aiming && !takedown.state() && !carry.state() && !player.carrying)) rig.swapShoulder();
  takedown.tick(dt);   // before the body drag: F takes down a living guard first
  carry.tick(dt);
  masking.update(dt, camera.position);
  stealth.glint.tick(dt);
  stealth.tick(dt);
  footprints.tick(dt);
  clues.tick(dt);
  alarms.tick(dt);
  ai.tick(dt);
  counterfire.tick(dt);
  flamers.tick(dt);
  dogs.tick(dt);
  patrol.tick(dt);
  searchlights.tick(dt);
  birds.tick(dt);
  world.barrels.tick(dt, player.pos);
  flashlights.tick(dt);
  tickTurrets(dt);
  tickExhaust(dt);
  tickGroundMarks();
  flags.tick(dt);
  seashore.tick(dt);
  weather.tick(dt);
  world.decals.tick(dt);
  world.casings.tick(dt);
  tickAnimals(dt, player);
  explosions.tick(dt);
  hotspots.wreckage.tick(dt);
  mission.tick(dt);
  jobs.tick();
  hotspots.tick(dt);
  tutorial.tick(dt, () => ({
    takedown: /TAKEDOWN/.test(takedown.state()?.label ?? ''), body: !!search.state(), climb: !!player.climbOption(),
    gun: !!guns.near, bench: /WORKBENCH/.test(pickups.state()?.label ?? ''), vehicle: !driving.vehicle && !!driving.near(),
    masked: stealth.mask.amount > 0.5, alarm: stealth.alarm, suspicious: stealth.state().worst === 'suspicious',
    hurt: player.health < 50 && !player.dead, heavy: !!arsenal.loadout?.heavy,
  }));
  // Birdsong in the quiet; a gunshot or the siren silences it for a while.
  birdT -= dt;
  const shot = stealth.lastShot;
  if (shot && shot !== lastFlush) {
    lastFlush = shot;
    const spots = birds.flush(shot.origin, THREE.MathUtils.clamp(shot.radius / 220, 0.25, 1.5));
    for (const at of spots) stealth.disturbance(at);   // (a quiet shot he didn't hear: he sees the birds go up)
  }
  if (stealth.lastShot && stealth.time - stealth.lastShot.t < 0.05) birdT = 35;
  if (birdT <= 0) { birdT = 3 + Math.random() * 7; if (!stealth.alarm) audio.birdCall(); }
  world.tick(dt);
  if (player.dead && !deathScreen.classList.contains('on')) {
    deathScreen.classList.add('on');
    deathScreen.querySelector('h2').textContent = player.fellFrom ? `KILLED IN A ${Math.round(player.fellFrom)} M FALL` : 'KILLED IN ACTION';
    menu.classList.add('hidden');
    silence();
    input.unlock();
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
  // A step reallocates every render target (a long frame of its own), so: only after two slow
  // windows in a row (3 s), or four fast ones to go back up, and never within 10 s of the last
  // step. Before, one slow second stepped down and it could go up and down every few seconds.
  scaler.cool = Math.max(0, (scaler.cool ?? 0) - 1.5);
  scaler.slow = avg > 1 / 52 ? (scaler.slow ?? 0) + 1 : 0;
  scaler.calm = avg < 1 / 72 ? scaler.calm + 1 : 0;
  if (scaler.cool > 0) return;
  if (scaler.slow >= 2 && pr > post.minPixelRatio) { post.setPixelRatio(Math.max(post.minPixelRatio, pr - 0.25)); scaler.slow = scaler.calm = 0; scaler.cool = 10; }
  else if (scaler.calm >= 4 && pr < post.maxPixelRatio) { post.setPixelRatio(Math.min(post.maxPixelRatio, pr + 0.25)); scaler.slow = scaler.calm = 0; scaler.cool = 10; }
}

function frame(time) {
  timer.update(time);
  const realDt = Math.min(timer.getDelta(), 0.1);
  scaleResolution(realDt);
  step(realDt);
}

function step(realDt, draw = true) {
  fps += (1 / Math.max(realDt, 1e-4) - fps) * 0.05;
  input.poll(realDt, { aiming: arsenal.aiming });   // the pad's buttons become keys (core/gamepad.js)

  if (input.wasPressed('KeyM') && !killCam.active && (input.locked || mapView.open)) {
    input.pressed.delete('KeyM');
    setMap(!mapView.open);
  }
  padNav.frame(realDt);   // menus and the map on the pad (ui/padnav.js)
  if (mapView.open) {
    if (input.wasPressed('Escape')) setMap(false, false);
    input.consume();
    input.takeMouse();
    mapView.drawFull({ player });
    return;
  }

  audio.duckMusic(killCam.active);
  audio.setMusicAlarm(stealth.alarm);
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
    world.cullTrees(camera.position, Math.tan(THREE.MathUtils.degToRad(settings.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    killCam.render(renderer, post);
    hud.update(realDt, { camera, player, arsenal, world, fps });
    return;
  }

  // The fly-over before you set out: no control, the world idles under the camera.
  if (flyover.active && !forceRun) {
    if (input.pressed.size) flyover.skip();
    input.consume();
    input.takeMouse();
    if (flyover.active) {
      const cam = flyover.frame(realDt);
      if (flyover.active) {
        world.tick(realDt);
        fx.update(realDt);
        avatar.root.visible = false;
        if (!draw) return;
        renderer.shadowMap.needsUpdate = (shadowFrame++ & 1) === 0;
        world.cullTrees(cam.position, 1);
        world.nearGrass.update(cam.position.x, cam.position.z);
        world.focusShadows(flyover.to);
        post.setCamera(cam); post.draw(); post.setCamera(camera);
        return;
      }
    }
  }

  // Kill slow-mo: drop to 25% speed, then ease back to full speed.
  if (slowmoT > 0) slowmoT = Math.max(0, slowmoT - realDt);
  const targetScale = items.wheelOpen || arsenal.wwheelOpen ? 0.2 : slowmoT > 0.2 ? 0.25 : 1; // the item wheel slows time too
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
  else if (arsenal.wwheelOpen) arsenal.wheelMouse(m);
  else player.look(m.x, m.y, settings.sensitivity * zoomScale, settings.invertY);
  padLook(realDt, zoomScale);
  guns.frame();          // on a nest's gun: the view held to its arc, the gun laid on it
  items.drawWheel();
  arsenal.drawWeaponWheel();
  arsenal.frame(dt);

  // Third person while moving; the rifle scope and binoculars go to the eye.
  const fpBlend = Math.max(arsenal.current === 'rifle' && !arsenal.mount ? arsenal.aim : 0, arsenal.binocT ?? 0);
  rig.update(realDt, camera, player, {
    yaw: player.yaw + arsenal.sway.yaw,
    pitch: player.pitch + arsenal.sway.pitch + arsenal.recoil,
    roll: arsenal.roll,
    alpha,
    pistolAim: arsenal.current === 'pistol' && arsenal.aim > 0.3,
    fpBlend,
  });
  driving.frame(camera);   // at the wheel: the chase camera
  if (Math.abs(camera.fov - arsenal.fov) > 1e-3) {
    camera.fov = arsenal.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();

  avatar.update(dt, {
    pos: avatarPos.lerpVectors(player.prevPos, player.pos, alpha),
    lookYaw: driving.bodyYaw() ?? player.yaw, lookPitch: driving.vehicle ? 0 : player.pitch, moveYaw: driving.bodyYaw() ?? player.moveYaw,
    groundAt: driving.vehicle ? null : (x, z) => world.floorAt(x, z, player.pos.y + 0.6),   // (feet on a slope: characters.js footIK)
    stance: player.stance, speed: driving.vehicle ? 0 : player.speed, sprinting: player.sprinting, carrying: !!player.carrying, climb: player.climb, climbRate: player.climbRate, dead: player.dead, concealed: stealth.state().concealed, takedown: !!takedown.active, takedownYaw: takedown.active?.yaw,
    weapon: arsenal.current, aiming: arsenal.aiming, ready: arsenal.readyT,
    boltT: arsenal.boltT, reloading: arsenal.reloadT > 0, kick: arsenal.viewKick,
    throwAim: items.aimingThrow, healing: !!items.healing, searching: search.progress > 0, mounted: player.mounted, lean: player.lean ?? 0,
    visible: fpBlend < 0.5 && rig.armLen > 0.9, // hide the body when a wall pushes the camera into it
  });
  takedown.placeKnife();

  // Shadows follow the look direction, reaching farther when zoomed in.
  const reach = 40 + 160 * fpBlend;
  lookAhead.set(0, 0, -reach).applyQuaternion(camera.quaternion).add(camera.position);
  world.focusShadows(lookAhead);
  world.nearGrass.update(player.pos.x, player.pos.z);
  world.viewer = camera.position;
  world.cullTrees(camera.position, Math.tan(THREE.MathUtils.degToRad(settings.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));

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
  if (world.tunnels?.viewing) world.tunnels.render(renderer); else post.draw();   // (crawling a tunnel: its own little scene)
  const st = stealth.state();
  const ss = search.state(), cs = carry.state(), co = player.climbOption(), cut = ai.sabotageOption(), rad = mission.radioOption();
  const td = takedown.state();
  const its = items.state();
  const heal = its.healing && { label: its.healing.id === 'medkit' ? 'USING A MEDKIT…' : 'BANDAGING…', progress: its.healing.progress };
  const pk = pickups.state(), ia = interactions.state(), mg = guns.state(), dg = disguise.state(), dv = driving.state();
  const prompts = heal ? [heal] : driving.vehicle ? [dv] : dg?.progress > 0 ? [dg] : carry.body ? [cs] : takedown.active ? [] : mg && guns.on ? [mg] : [td, cut, rad, pk, ia, ss, dg, dv, td ? null : cs, mg, co && { label: co.label, progress: 0 }].filter(Boolean);
  const prompt = prompts.length ? { label: fill(prompts.map(p => p.label).join('   ·   ')), progress: prompts[0].progress } : null;   // (key names: ui/glyphs.js)
  hud.update(realDt, { camera, player, arsenal, world, fps, search: prompt, waypoint: mapView.waypoint, stealth: st, mission, hotspots, res: post.pixelRatio, items: its });
  mapView.drawMini({ player, stealth: st });
}
// A load the player asked for (the page was reloaded to rebuild the world from the save).
// A save that can't be applied must never leave a black screen, nor a world half put back:
// reload for a fresh start (applyPending already dropped the note) and say so after it.
let loadedSlot = null;
try { loadedSlot = saves.applyPending(); if (loadedSlot) briefed = true; } catch (e) {
  console.error('Could not load the save', e);
  try { sessionStorage.setItem('sniper-slice.loadFailed', '1'); } catch { /* storage blocked */ }
  location.reload();
  await new Promise(() => {});   // (nothing more runs on this page)
}
try {
  if (sessionStorage.getItem('sniper-slice.loadFailed')) {
    sessionStorage.removeItem('sniper-slice.loadFailed');
    hud.message('COULD NOT LOAD THAT SAVE · STARTING FRESH', 'wound');
  }
} catch { /* storage blocked */ }
if (loadedSlot) {
  document.querySelector('#menu .sub').textContent = `Loaded: ${SLOT_NAMES[loadedSlot]}`;
  hud.message('GAME LOADED', '');
}
// ---- warming up, behind the menu, so nothing stalls the first time it comes into view ----
// Everything that draws is in the scene first: the skins and the far country (they used to
// arrive after this and upload their textures in play), and winter's snow on all of it.
playBtn.textContent = 'Warming up…';
await Promise.race([Promise.all([skinsReady, horizonReady]), new Promise(r => setTimeout(r, 12000))]);   // (a slow line doesn't hold the game for ever)
if (activeMap().winter) applyWinter(scene);
const uploadTextures = (root) => root.traverse((o) => { for (const m of [].concat(o.material ?? [])) for (const v of Object.values(m)) if (v?.isTexture) renderer.initTexture(v); });
async function warmUp() {
  uploadTextures(scene);
  // Shaders: compiled for the target the game really draws into (the post chain's half-float
  // buffer: no tone mapping, linear). Compiled for the screen, as this did before, every one of
  // them was compiled a second time when first seen: the stall on first looking round.
  renderer.setRenderTarget(post.composer.renderTarget1);
  await renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(null);
  // Then the real thing, drawn once in each direction: what compileAsync doesn't reach (the
  // shadow pass, the ambient occlusion's and the post chain's own programs, anything culled).
  const q = camera.quaternion.clone(), p = camera.position.clone();
  camera.position.copy(player.pos).add(new THREE.Vector3(0, 1.6, 0));
  fx.warm?.(camera.position);                       // (one of each kind of particle, shown for these frames)
  for (let i = 0; i < 6; i++) {
    camera.rotation.set(i === 5 ? -0.5 : 0, i * Math.PI * 2 / 5, 0);
    camera.updateMatrixWorld();
    world.cullTrees(camera.position, 1);
    renderer.shadowMap.needsUpdate = true;
    post.draw();
    await new Promise(r => setTimeout(r, 0));       // (let the page breathe: the menu stays responsive)
  }
  killCam.warm(renderer, post);                         // the X-ray's own materials and passes (fx/killcam.js)
  camera.quaternion.copy(q); camera.position.copy(p); camera.updateMatrixWorld();
}
await warmUp();
renderer.setAnimationLoop(frame);
playBtn.dataset.kb = started ? 'Resume' : 'Click to play';   // (and its pad wording: ui/glyphs.js)
refreshStatic();
playBtn.disabled = false;

// ---- just in time: what the mission doesn't need to start ----
// After the first Play, in idle moments, one at a time: the X-ray anatomy (the kill cam draws
// stand-in shapes until it's in), the burnt-out truck and car (for the first vehicle you blow up),
// the planes (the first wave is 45 s or more away). Each one's textures go to the GPU as it lands,
// not when it's first drawn.
let laterStarted = false;
async function loadLater() {
  if (laterStarted) return;
  laterStarted = true;
  const idle = () => new Promise(r => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 1500 }) : setTimeout(r, 300)));
  for (const k of ['anatomy', 'wreckTruck', 'wreckCar', 'p47', 'b25']) {
    await idle();
    await loadProps([k]);
    if (assets.models[k]) uploadTextures(assets.models[k].scene);
  }
  if (activeMap().winter) applyWinter(scene);       // (snow on what's just come in)
}

// Debug handle for automated play-testing from the console.
window.game = { audio, thoughts, seashore, footprints, flags, airwar, disguise, driving,
  beltGrenades, assets, rockets, interactions, turretCrews, guns, dogs, patrol, searchlights, flashlights, birds,
  counterfire, clues, alarms, orders,
  flyover, conditions, activeMap, nightfall,
  THREE, world, player, arsenal, avatar, rig, camera, settings, hud, renderer, input, killCam, post, mapView, search, setMap, carry, masking, stealth, ai, mission, hotspots, takedown, scaleResolution, explosions, tank, items, saves, profile, pickups, applyLoadout, openBench, closeBench, tutorial, padNav,
  get timeScale() { return timeScale; },
  pause(v = true) { paused = v; },
  // Run the game synchronously for `seconds` at `rate` fps (for testing while the tab is in the background).
  advance(seconds, rate = 60) {
    flyover.skip();
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
